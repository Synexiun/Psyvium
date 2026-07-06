import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { AuthPrincipal, ScreeningResult, SubmitIntakeInput } from '@vpsy/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { EventBus, Events } from '../../common/events/event-bus.service';
import { AiGatewayService } from '../ai-gateway/ai-gateway.service';
import { ConsentService } from '../consent/consent.service';
import { ScreeningService } from './screening.service';

@Injectable()
export class IntakeService {
  private readonly logger = new Logger(IntakeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly screening: ScreeningService,
    private readonly ai: AiGatewayService,
    private readonly audit: AuditService,
    private readonly bus: EventBus,
    private readonly consents: ConsentService,
  ) {}

  /**
   * The intake spine: assert required consents (purpose scope) → persist →
   * deterministic screening → risk flags/escalation → AI summary (additive)
   * → emit IntakeSubmitted so Matching prepares candidates. Runs in a
   * transaction so state and risk flags commit together.
   */
  async submit(principal: AuthPrincipal, input: SubmitIntakeInput): Promise<ScreeningResult> {
    const client = await this.prisma.client.findFirst({
      where: { userId: principal.userId, tenantId: principal.tenantId },
    });
    if (!client) throw new BadRequestException('No client profile for principal');

    // Phase 2 DoD: "Consent versioning live; intake respects purpose scope."
    await this.consents.assertRequiredConsents(client.id);

    const computed = this.screening.compute(input);

    const result = await this.prisma.$transaction(async (tx) => {
      const intake = await tx.intake.create({
        data: {
          tenantId: principal.tenantId,
          clientId: client.id,
          presentingProblem: input.presentingProblem,
          symptomHistory: input.symptomHistory,
          symptomDurationWeeks: input.symptomDurationWeeks,
          medicationHistory: input.medicationHistory,
          substanceUseScreen: input.substanceUse as any,
          traumaExposure: input.traumaExposure,
          previousTherapy: input.previousTherapy,
          functionalImpairment: input.functionalImpairment as any,
          safetyScreen: input.safety as any,
          status: 'SCREENED',
        },
      });

      const screening = await tx.screeningResult.create({
        data: {
          tenantId: principal.tenantId,
          intakeId: intake.id,
          riskScore: computed.riskScore,
          severityBand: computed.severityBand,
          urgencyScore: computed.urgencyScore,
          suggestedSpecialty: computed.suggestedSpecialty,
          virtualCareSuitable: computed.virtualCareSuitable,
          contraindications: computed.contraindications,
        },
      });

      // Upsert clinical profile from the profiling section
      await tx.clinicalProfile.upsert({
        where: { clientId: client.id },
        create: {
          tenantId: principal.tenantId,
          clientId: client.id,
          goals: input.goals,
          preferredTherapistGender: input.preferredTherapistGender,
          preferredLanguage: input.preferredLanguage,
          therapyFormat: input.therapyFormat,
          severityEstimate: computed.severityBand,
        },
        update: {
          goals: input.goals,
          preferredTherapistGender: input.preferredTherapistGender,
          preferredLanguage: input.preferredLanguage,
          therapyFormat: input.therapyFormat,
          severityEstimate: computed.severityBand,
        },
      });

      // Deterministic risk flags → escalations (safety-critical, human-routed)
      const raisedFlagIds: string[] = [];
      for (const flag of computed.riskFlags) {
        const rf = await tx.riskFlag.create({
          data: {
            tenantId: principal.tenantId,
            clientId: client.id,
            intakeId: intake.id,
            type: flag.type,
            severity: flag.severity,
            source: flag.source,
            evidence: flag.evidence,
            status: 'ESCALATED',
          },
        });
        await tx.escalation.create({
          data: { tenantId: principal.tenantId, riskFlagId: rf.id },
        });
        raisedFlagIds.push(rf.id);
      }

      // Reflect risk on the client record
      await tx.client.update({
        where: { id: client.id },
        data: { riskLevel: computed.severityBand },
      });

      return { intake, screening, raisedFlagIds };
    });

    // ── Post-commit: audit, AI summary, events ──
    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'intake.submitted',
      entityType: 'Intake',
      entityId: result.intake.id,
      after: { severityBand: computed.severityBand, riskScore: computed.riskScore },
    });

    let aiSummary: string | null = null;
    try {
      const ai = await this.ai.summarizeIntake({
        tenantId: principal.tenantId,
        intakeId: result.intake.id,
        presentingProblem: input.presentingProblem,
        severityBand: computed.severityBand,
        suggestedSpecialty: computed.suggestedSpecialty,
        riskPresent: computed.riskFlags.length > 0,
      });
      aiSummary = ai.summary;
      if (ai.recommendationId) {
        await this.prisma.screeningResult.update({
          where: { id: result.screening.id },
          data: { aiSummary, aiRecommendationId: ai.recommendationId },
        });
      }
    } catch (err) {
      this.logger.warn(`AI summary skipped: ${(err as Error).message}`);
    }

    await this.bus.publish(Events.IntakeSubmitted, principal.tenantId, {
      intakeId: result.intake.id,
      clientId: client.id,
      severityBand: computed.severityBand,
      suggestedSpecialty: computed.suggestedSpecialty,
    });
    for (const flagId of result.raisedFlagIds) {
      await this.bus.publish(Events.RiskFlagRaised, principal.tenantId, { riskFlagId: flagId, clientId: client.id });
    }

    return {
      id: result.screening.id,
      intakeId: result.intake.id,
      riskScore: computed.riskScore,
      severityBand: computed.severityBand,
      urgencyScore: computed.urgencyScore,
      suggestedSpecialty: computed.suggestedSpecialty,
      virtualCareSuitable: computed.virtualCareSuitable,
      contraindications: computed.contraindications,
      riskFlagsRaised: result.raisedFlagIds,
      aiSummary,
      createdAt: result.screening.createdAt.toISOString(),
    };
  }
}
