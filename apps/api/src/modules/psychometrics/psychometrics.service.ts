import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  questionnaireCutoffsSchema,
  RiskSource,
  RiskStatus,
  SeverityBand,
  type AdministerResponseInput,
  type AuthPrincipal,
  type QuestionnaireResponseDto,
} from '@vpsy/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { EventBus, Events } from '../../common/events/event-bus.service';
import { ScoringService } from './scoring.service';

/** Ordering used to only ever escalate — never silently downgrade — a client's reflected risk level. */
const SEVERITY_RANK: Record<string, number> = {
  [SeverityBand.LOW]: 1,
  [SeverityBand.MODERATE]: 2,
  [SeverityBand.HIGH]: 3,
  [SeverityBand.SEVERE]: 4,
};

/**
 * Psychometrics. Administering a response is a single transactional unit:
 * the response and its computed PsychometricScore are created together, so a
 * response can never exist unscored. Scoring itself is deterministic
 * (ScoringService) — the AI layer is not consulted for safety-relevant
 * severity banding.
 *
 * Safety-item hook (docs/technical/07-psychometrics-engine.md §4): if the
 * scored response endorses a configured safety item (e.g. PHQ-9 item 9 —
 * active suicidal ideation), this is where a standalone assessment raises a
 * RiskFlag + Escalation and routes to the Risk & Crisis context — mirroring
 * Intake & Screening's deterministic safety rules (`intake.service.ts`)
 * exactly, so risk is caught whether or not the client ever goes through
 * intake. Never delegated to the AI layer.
 */
@Injectable()
export class PsychometricsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scoring: ScoringService,
    private readonly audit: AuditService,
    private readonly bus: EventBus,
  ) {}

  async administer(principal: AuthPrincipal, input: AdministerResponseInput): Promise<QuestionnaireResponseDto> {
    const version = await this.prisma.questionnaireVersion.findUnique({
      where: { id: input.versionId },
    });
    if (!version || !version.published) {
      throw new NotFoundException('Published questionnaire version not found');
    }

    const client = await this.prisma.client.findFirst({
      where: { id: input.clientId, tenantId: principal.tenantId },
    });
    if (!client) throw new NotFoundException('Client not found');

    const cutoffsParsed = questionnaireCutoffsSchema.safeParse(version.cutoffs);
    if (!cutoffsParsed.success) {
      throw new BadRequestException('Questionnaire version has no valid scoring cutoffs configured');
    }

    const computed = this.scoring.score(input.answers, cutoffsParsed.data);
    // Deterministic — same principle as Intake's safety screen (§06 core principle).
    const safetyHits = this.scoring.checkSafetyItems(input.answers, version.cutoffs);

    const result = await this.prisma.$transaction(async (tx) => {
      const response = await tx.questionnaireResponse.create({
        data: {
          tenantId: principal.tenantId,
          versionId: input.versionId,
          clientId: input.clientId,
          answers: input.answers as any,
          responseTimeMs: input.responseTimeMs,
        },
      });
      const score = await tx.psychometricScore.create({
        data: {
          tenantId: principal.tenantId,
          responseId: response.id,
          rawScore: computed.rawScore,
          severityBand: computed.severityBand ?? null,
          interpretation: computed.interpretation,
        },
      });

      // Safety item(s) endorsed → raise RiskFlag(s) + Escalation(s), exactly
      // as Intake & Screening does for its own safety screen — a standalone
      // assessment must route to Risk & Crisis just as reliably as intake.
      const raisedFlagIds: string[] = [];
      const raisedEscalations: { escalationId: string; riskFlagId: string }[] = [];
      for (const hit of safetyHits) {
        const rf = await tx.riskFlag.create({
          data: {
            tenantId: principal.tenantId,
            clientId: input.clientId,
            type: hit.category,
            severity: SeverityBand.HIGH,
            source: RiskSource.SCREENING,
            evidence: `Safety item "${hit.itemId}" answered ${hit.answer} (>= threshold ${hit.minAnswer}) on assessment response`,
            status: RiskStatus.ESCALATED,
          },
        });
        const escalation = await tx.escalation.create({
          data: { tenantId: principal.tenantId, riskFlagId: rf.id },
        });
        raisedFlagIds.push(rf.id);
        raisedEscalations.push({ escalationId: escalation.id, riskFlagId: rf.id });
      }

      // Reflect elevated risk on the client record — escalate only, never
      // silently downgrade a client already flagged more severely elsewhere.
      if (raisedFlagIds.length > 0 && SEVERITY_RANK[client.riskLevel] < SEVERITY_RANK[SeverityBand.HIGH]) {
        await tx.client.update({ where: { id: client.id }, data: { riskLevel: SeverityBand.HIGH } });
      }

      return { response, score, raisedFlagIds, raisedEscalations };
    });

    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'assessment.scored',
      entityType: 'QuestionnaireResponse',
      entityId: result.response.id,
      after: {
        rawScore: computed.rawScore,
        severityBand: computed.severityBand,
        safetyFlagsRaised: result.raisedFlagIds.length,
      },
    });
    await this.bus.publish(Events.AssessmentScored, principal.tenantId, {
      responseId: result.response.id,
      clientId: input.clientId,
      severityBand: computed.severityBand,
    });
    for (const flagId of result.raisedFlagIds) {
      await this.bus.publish(Events.RiskFlagRaised, principal.tenantId, { riskFlagId: flagId, clientId: input.clientId });
    }
    for (const esc of result.raisedEscalations) {
      await this.bus.publish(Events.EscalationRaised, principal.tenantId, {
        escalationId: esc.escalationId,
        riskFlagId: esc.riskFlagId,
        clientId: input.clientId,
      });
    }

    return this.toDto(result.response, result.score);
  }

  async getResponse(principal: AuthPrincipal, id: string): Promise<QuestionnaireResponseDto> {
    const response = await this.prisma.questionnaireResponse.findFirst({
      where: { id, tenantId: principal.tenantId },
      include: { score: true },
    });
    if (!response) throw new NotFoundException('Response not found');
    return this.toDto(response, response.score);
  }

  private toDto(
    response: {
      id: string;
      versionId: string;
      clientId: string;
      answers: unknown;
      completedAt: Date;
    },
    score: {
      id: string;
      responseId: string;
      rawScore: number | null;
      severityBand: SeverityBand | null;
      interpretation: string | null;
      createdAt: Date;
    } | null,
  ): QuestionnaireResponseDto {
    return {
      id: response.id,
      versionId: response.versionId,
      clientId: response.clientId,
      answers: response.answers as Record<string, number>,
      completedAt: response.completedAt.toISOString(),
      score: score
        ? {
            id: score.id,
            responseId: score.responseId,
            rawScore: score.rawScore,
            severityBand: score.severityBand,
            interpretation: score.interpretation,
            createdAt: score.createdAt.toISOString(),
          }
        : null,
    };
  }
}
