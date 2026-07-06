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
import { IrtScoringService, type IrtScorableItem } from './irt-scoring.service';
import { ScoringMethod, type IrtScoreResult } from '@vpsy/contracts';

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
    private readonly irt: IrtScoringService,
    private readonly audit: AuditService,
    private readonly bus: EventBus,
  ) {}

  async administer(principal: AuthPrincipal, input: AdministerResponseInput): Promise<QuestionnaireResponseDto> {
    const version = await this.prisma.questionnaireVersion.findUnique({
      where: { id: input.versionId },
      include: {
        questionnaire: { select: { scoringMethod: true } },
        items: {
          where: { active: true },
          orderBy: { orderIndex: 'asc' },
          include: { parameters: { where: { active: true }, orderBy: { createdAt: 'desc' } } },
        },
      },
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

    // ── IRT latent-trait scoring (07-psychometrics-engine.md §5) — opt-in per
    // instrument. Only runs when the instrument declares an IRT-family scoring
    // method AND its items carry stored calibration parameters; every other
    // instrument keeps the classical path above, byte-for-byte unchanged.
    // Classical rawScore/severityBand (and the safety-item hook) are still
    // computed and persisted alongside θ — banding cutoffs are published on the
    // raw metric, and downstream risk logic must not change with IRT adoption.
    // Deterministic like everything else here: AI is never consulted.
    const irtResult = this.computeIrt(
      version.questionnaire?.scoringMethod,
      version.items ?? [],
      input.answers,
    );
    // Calibration provenance (AERA/APA/NCME Standards Ch.4/6 — clinical audit
    // 2026-07-06): a score computed from SYNTHETIC/demo calibration must never
    // read like a validated report. Detect the provenance marker stored on the
    // ItemParameter rows and brand the persisted interpretation accordingly.
    const syntheticCalibration =
      irtResult != null &&
      (version.items ?? []).some((item) =>
        JSON.stringify((item.parameters?.[0] as { seEstimates?: unknown } | undefined)?.seEstimates ?? '')
          .toLowerCase()
          .includes('synthetic'),
      );
    // Standards Ch.6: the persisted record itself carries the hedge — not just
    // the UI wrapper — so any surface reading PsychometricScore.interpretation
    // inherits it.
    const HEDGE =
      ' Screening result only — requires clinician confirmation; does not constitute a diagnosis.';
    const interpretation =
      (irtResult
        ? `${computed.interpretation} IRT EAP theta=${irtResult.thetaEstimate.toFixed(3)} (SE=${irtResult.standardError.toFixed(3)}, ` +
          `T=${(50 + 10 * irtResult.thetaEstimate).toFixed(1)}, percentile=${irtResult.percentile.toFixed(1)}) ` +
          `from ${irtResult.itemsUsed} calibrated item(s) [${irtResult.irtModelsUsed.join(', ')}] on an assumed-normal N(0,1) ` +
          `reference metric (no empirical norm sample).` +
          (syntheticCalibration
            ? ' ⚠ SYNTHETIC CALIBRATION — DEMO ONLY: item parameters are not fitted to real response data; theta/SE/percentile are illustrative and must not inform clinical decisions.'
            : '')
        : computed.interpretation) + HEDGE;

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
          thetaEstimate: irtResult?.thetaEstimate ?? null,
          standardError: irtResult?.standardError ?? null,
          reliabilityAtTheta: irtResult?.reliabilityAtTheta ?? null,
          percentile: irtResult?.percentile ?? null,
          severityBand: computed.severityBand ?? null,
          interpretation,
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
        thetaEstimate: irtResult?.thetaEstimate ?? null,
        standardError: irtResult?.standardError ?? null,
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

  /**
   * IRT gate + scoring. Returns null (→ classical-only) unless the instrument
   * opted in (`scoringMethod` IRT/CAT) AND at least one active item carries an
   * active calibration row. When multiple calibrations are active for an item,
   * the newest wins (rows arrive pre-sorted createdAt desc); calibration
   * pinning per QuestionnaireVersion is the documented follow-up alongside CAT.
   * Invalid stored parameters throw 422 (via IrtScoringService.parseParams) —
   * a mis-calibrated instrument must fail loudly, never score wrongly.
   */
  private computeIrt(
    scoringMethod: string | undefined,
    items: Array<{ id: string; linkId?: string | null; parameters?: unknown[] }>,
    answers: Record<string, number>,
  ): IrtScoreResult | null {
    if (scoringMethod !== ScoringMethod.IRT && scoringMethod !== ScoringMethod.CAT) return null;

    const scorable: IrtScorableItem[] = [];
    for (const item of items) {
      const raw = item.parameters?.[0];
      if (!raw) continue;
      const linkId = item.linkId ?? item.id;
      scorable.push({ linkId, params: this.irt.parseParams(raw, linkId) });
    }
    if (scorable.length === 0) return null;

    return this.irt.scoreEap(scorable, answers);
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
      thetaEstimate?: number | null;
      standardError?: number | null;
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
            thetaEstimate: score.thetaEstimate ?? null,
            standardError: score.standardError ?? null,
            severityBand: score.severityBand,
            interpretation: score.interpretation,
            createdAt: score.createdAt.toISOString(),
          }
        : null,
    };
  }
}
