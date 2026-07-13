import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  computeEscalationSlaDueAt,
  itemTranslationProvenanceSchema,
  questionnaireCutoffsSchema,
  RiskSource,
  RiskStatus,
  SeverityBand,
  type AdministerResponseInput,
  type AssessmentItemDto,
  type AuthPrincipal,
  type PsychometricAiAssistResult,
  type QuestionnaireResponseDto,
  type VersionItemsResponseDto,
} from '@vpsy/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { EventBus, Events } from '../../common/events/event-bus.service';
import { AiGatewayService } from '../ai-gateway/ai-gateway.service';
import { ScoringService, type ClassicalScoreResult, type SafetyItemHit } from './scoring.service';
import { IrtScoringService, type IrtScorableItem } from './irt-scoring.service';
import { ScoringMethod, type IrtScoreResult } from '@vpsy/contracts';
import { assertAuthorizedAssessmentTarget } from './assessment-target-access';
import { assertActiveInstrumentLicense } from './instrument-license';
import { validateSafetyConfiguration, validateStaticResponses } from './response-validation';

/** Marker embedded in `PsychometricScore.interpretation` by `buildScoreComputation` when demo/uncalibrated item parameters were used — no dedicated schema column exists (schema.prisma out of scope), so detection is string-based. */
const SYNTHETIC_CALIBRATION_MARKER = 'SYNTHETIC CALIBRATION';

/**
 * Mirrors the Prisma `AdministrationMode` enum values (STATIC batch form vs
 * server-driven CAT) without widening `@vpsy/contracts` enums (out of scope
 * this wave). Prisma's generated enum type is a string-literal union, so these
 * literals are assignable at the create site.
 */
export type ResponseAdministrationMode = 'STATIC' | 'CAT';

/**
 * Minimal shape of a loaded QuestionnaireVersion the scoring pipeline needs —
 * kept structural so both `administer` (full Prisma row) and the CAT flow
 * (same include) satisfy it.
 */
export interface ScorableVersion {
  cutoffs: unknown;
  questionnaire?: { scoringMethod: string } | null;
  items?: Array<{ id: string; linkId?: string | null; responseOptions: unknown; parameters?: unknown[] }>;
}

/** Deterministic scoring artifacts shared by the batch and CAT persistence paths. */
export interface ScoreComputation {
  computed: ClassicalScoreResult;
  safetyHits: SafetyItemHit[];
  irtResult: IrtScoreResult | null;
  interpretation: string;
}

export interface PersistedScoreResult {
  response: {
    id: string;
    versionId: string;
    clientId: string;
    answers: unknown;
    completedAt: Date;
  };
  score: {
    id: string;
    responseId: string;
    rawScore: number | null;
    thetaEstimate?: number | null;
    standardError?: number | null;
    severityBand: SeverityBand | null;
    interpretation: string | null;
    createdAt: Date;
  };
  raisedFlagIds: string[];
  raisedEscalations: { escalationId: string; riskFlagId: string }[];
}

/**
 * Structural stand-in for Prisma.TransactionClient covering only the tables
 * the scoring pipeline writes — lets the CAT flow pass the same `tx` it uses
 * to close the CatSession, and keeps unit-test mocks honest about which
 * writes the pipeline performs.
 */
export interface ScoringTx {
  questionnaireResponse: { create: (args: any) => Promise<any> };
  psychometricScore: { create: (args: any) => Promise<any> };
  riskFlag: { create: (args: any) => Promise<any> };
  escalation: { create: (args: any) => Promise<any> };
  client: { update: (args: any) => Promise<any> };
  outboxEvent: { create: (args: any) => Promise<any> };
}

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
    private readonly ai: AiGatewayService,
  ) {}

  async administer(principal: AuthPrincipal, input: AdministerResponseInput): Promise<QuestionnaireResponseDto> {
    const version = await this.prisma.questionnaireVersion.findUnique({
      where: { id: input.versionId },
      include: {
        questionnaire: { select: { id: true, code: true, scoringMethod: true, licensing: true } },
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
    if (!version.questionnaire) {
      throw new NotFoundException('Questionnaire for version not found');
    }
    // Doc 07 §2 — LICENSED/PROPRIETARY fail closed without an active grant.
    await assertActiveInstrumentLicense(this.prisma, principal.tenantId, version.questionnaire);

    const client = await this.prisma.client.findFirst({
      where: { id: input.clientId, tenantId: principal.tenantId },
    });
    if (!client) throw new NotFoundException('Client not found');

    await assertAuthorizedAssessmentTarget(this.prisma, principal, client);
    validateStaticResponses(version.items ?? [], input.answers);

    const computation = this.buildScoreComputation(version, input.answers);

    const result = await this.prisma.$transaction(async (tx) =>
      this.persistScoredResponse(tx, principal, client, input, computation, 'STATIC'),
    );

    await this.publishScoredOutcome(principal, input.clientId, computation, result);

    return this.toDto(result.response, result.score);
  }

  /**
   * Deterministic scoring artifacts for one set of answers against a
   * published version — classical raw-sum banding, safety-item hits, the
   * opt-in IRT EAP result, and the persisted interpretation text (incl. the
   * honest synthetic-calibration branding + the always-on clinician hedge).
   * Shared VERBATIM between the batch administer path and CAT completion
   * (07-psychometrics-engine.md §6) so an adaptively-administered score can
   * never drift from a batch one in labeling or safety semantics.
   */
  buildScoreComputation(
    version: ScorableVersion,
    answers: Record<string, number>,
  ): ScoreComputation {
    const cutoffsParsed = questionnaireCutoffsSchema.safeParse(version.cutoffs);
    if (!cutoffsParsed.success) {
      throw new BadRequestException('Questionnaire version has no valid scoring cutoffs configured');
    }

    validateSafetyConfiguration(version.cutoffs, version.items ?? []);

    const computed = this.scoring.score(answers, cutoffsParsed.data);
    // Deterministic — same principle as Intake's safety screen (§06 core principle).
    const safetyHits = this.scoring.checkSafetyItems(answers, version.cutoffs);

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
      answers,
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

    return { computed, safetyHits, irtResult, interpretation };
  }

  /**
   * Transactional persistence of a scored response: QuestionnaireResponse +
   * PsychometricScore created together (a response can never exist unscored),
   * plus the safety-item hook — RiskFlag(s) + Escalation(s) + client risk
   * escalation, exactly as Intake & Screening does. Runs inside the caller's
   * transaction so CAT completion can atomically pair it with closing the
   * CatSession. `administrationMode` distinguishes a STATIC batch form from a
   * server-driven CAT administration on the persisted record.
   */
  async persistScoredResponse(
    tx: ScoringTx,
    principal: AuthPrincipal,
    client: { id: string; riskLevel: string },
    input: { versionId: string; clientId: string; answers: Record<string, number>; responseTimeMs?: number },
    computation: ScoreComputation,
    administrationMode: ResponseAdministrationMode,
  ): Promise<PersistedScoreResult> {
    const { computed, safetyHits, irtResult, interpretation } = computation;
    const response = await tx.questionnaireResponse.create({
      data: {
        tenantId: principal.tenantId,
        versionId: input.versionId,
        clientId: input.clientId,
        answers: input.answers as any,
        administrationMode,
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
    let highestSafetySeverity: SeverityBand = SeverityBand.LOW;
    for (const hit of safetyHits) {
      // Graduated safety-item severity (WAVE CR item 2): the raw endorsed
      // answer value drives severity instead of flattening every hit to
      // HIGH — answer 1 stays HIGH (as before), answer >= 2 escalates to
      // SEVERE.
      const severity = hit.answer >= 2 ? SeverityBand.SEVERE : SeverityBand.HIGH;
      if (SEVERITY_RANK[severity] > SEVERITY_RANK[highestSafetySeverity]) highestSafetySeverity = severity;

      const rf = await tx.riskFlag.create({
        data: {
          tenantId: principal.tenantId,
          clientId: input.clientId,
          type: hit.category,
          severity,
          source: RiskSource.SCREENING,
          evidence: `Safety item "${hit.itemId}" answered ${hit.answer} (>= threshold ${hit.minAnswer}) on assessment response`,
          evidenceDetail: { itemId: hit.itemId, answer: hit.answer, minAnswer: hit.minAnswer, category: hit.category },
          status: RiskStatus.ESCALATED,
        },
      });
      const openedAt = new Date();
      const escalation = await tx.escalation.create({
        data: {
          tenantId: principal.tenantId,
          riskFlagId: rf.id,
          openedAt,
          slaDueAt: computeEscalationSlaDueAt(severity, openedAt),
        },
      });
      raisedFlagIds.push(rf.id);
      raisedEscalations.push({ escalationId: escalation.id, riskFlagId: rf.id });

      // Durable (ADR-005): written in this same transaction — mirrors
      // Intake & Screening's identical hook (intake.service.ts) exactly, so
      // a standalone assessment's safety escalation can never be silently
      // dropped by a crash between commit and publish either.
      await this.bus.publishDurable(tx, Events.RiskFlagRaised, principal.tenantId, {
        riskFlagId: rf.id,
        clientId: input.clientId,
      });
      await this.bus.publishDurable(tx, Events.EscalationRaised, principal.tenantId, {
        escalationId: escalation.id,
        riskFlagId: rf.id,
        clientId: input.clientId,
      });
    }

    // Reflect elevated risk on the client record — escalate only, never
    // silently downgrade a client already flagged more severely elsewhere.
    if (raisedFlagIds.length > 0 && SEVERITY_RANK[client.riskLevel] < SEVERITY_RANK[highestSafetySeverity]) {
      await tx.client.update({ where: { id: client.id }, data: { riskLevel: highestSafetySeverity } });
    }

    return { response, score, raisedFlagIds, raisedEscalations };
  }

  /**
   * Post-commit audit + event emission for a scored response — shared by the
   * batch path and CAT completion so both administrations leave the identical
   * tamper-evident trail and downstream contexts (Risk & Crisis, MBC) react
   * the same way regardless of how the items were delivered.
   */
  async publishScoredOutcome(
    principal: AuthPrincipal,
    clientId: string,
    computation: ScoreComputation,
    result: PersistedScoreResult,
  ): Promise<void> {
    const { computed, irtResult } = computation;
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
    // AssessmentScored stays direct/non-durable — RiskFlagRaised/
    // EscalationRaised for safety hits are now published durably, in-tx,
    // from `persistScoredResponse` above (ADR-005); publishing them again
    // here would double-fire every safety-critical subscriber.
    await this.bus.publish(Events.AssessmentScored, principal.tenantId, {
      responseId: result.response.id,
      clientId,
      severityBand: computed.severityBand,
    });
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

  /**
   * Serves the item stems + response options for a published QuestionnaireVersion
   * to the web assessment UI (docs/technical/07-psychometrics-engine.md §9;
   * WAVE CR — "UI i18n ≠ validated clinical-item translation").
   *
   * Locale resolution is honest by construction: a validated `ItemTranslation`
   * row is served ONLY when its `provenance.status === 'validated'`. Anything
   * short of that — no row for the locale, a malformed provenance blob, or a
   * `'draft'` row awaiting its translation-validation study — falls back to
   * the source-language stem WITH an explicit `unvalidated-source-language`
   * marker, so a caller can never mistake an un-validated fallback for a real
   * localization. No tenant scoping here: Item/ItemTranslation are
   * instrument-catalog data (not PHI), same documented exclusion as
   * Item/QuestionnaireVersion/ItemParameter from the RLS backstop.
   */
  async getVersionItems(versionId: string, locale?: string): Promise<VersionItemsResponseDto> {
    const version = await this.prisma.questionnaireVersion.findUnique({
      where: { id: versionId },
      include: { items: { where: { active: true }, orderBy: { orderIndex: 'asc' } } },
    });
    if (!version || !version.published) {
      throw new NotFoundException('Published questionnaire version not found');
    }

    const requestedLocale = locale?.trim().toLowerCase();
    const isSourceLocale = !requestedLocale || requestedLocale === 'en';

    const translationsByItemId = new Map<string, { stem: string; responseOptions: unknown; provenance: unknown }>();
    if (!isSourceLocale && version.items.length > 0) {
      const rows = await this.prisma.itemTranslation.findMany({
        where: { itemId: { in: version.items.map((i) => i.id) }, locale: requestedLocale },
      });
      for (const row of rows) {
        translationsByItemId.set(row.itemId, {
          stem: row.stem,
          responseOptions: row.responseOptions,
          provenance: row.provenance,
        });
      }
    }

    const items: AssessmentItemDto[] = version.items.map((item) => {
      if (isSourceLocale) {
        return {
          id: item.id,
          linkId: item.linkId ?? null,
          stem: item.stem,
          responseOptions: item.responseOptions,
          orderIndex: item.orderIndex,
          locale: 'en',
          translationStatus: 'source',
        };
      }

      const translation = translationsByItemId.get(item.id);
      const provenance = itemTranslationProvenanceSchema.safeParse(translation?.provenance);
      if (translation && provenance.success && provenance.data.status === 'validated') {
        return {
          id: item.id,
          linkId: item.linkId ?? null,
          stem: translation.stem,
          responseOptions: translation.responseOptions,
          orderIndex: item.orderIndex,
          locale: requestedLocale!,
          translationStatus: 'validated',
        };
      }

      // No validated translation exists for this locale (missing row, or a
      // 'draft' one still awaiting its validation study) — honest fallback,
      // never silently served as if it were localized.
      return {
        id: item.id,
        linkId: item.linkId ?? null,
        stem: item.stem,
        responseOptions: item.responseOptions,
        orderIndex: item.orderIndex,
        locale: requestedLocale!,
        translationStatus: 'unvalidated-source-language',
      };
    });

    return { versionId: version.id, locale: requestedLocale ?? 'en', items };
  }

  async getResponse(principal: AuthPrincipal, id: string): Promise<QuestionnaireResponseDto> {
    const response = await this.prisma.questionnaireResponse.findFirst({
      where: { id, tenantId: principal.tenantId },
      include: { score: true },
    });
    if (!response) throw new NotFoundException('Response not found');
    return this.toDto(response, response.score);
  }

  /**
   * Psychometric Interpretation (doc 05 §3.7) — CLINICIAN_ONLY assistive
   * interpretation of an ALREADY-COMPUTED, deterministic score; never
   * re-scores or re-bands. Detects the synthetic-calibration caveat via the
   * string marker `buildScoreComputation`/scoring pipeline embeds into
   * `interpretation` (no dedicated schema column — schema.prisma is out of
   * scope for this change) and forwards that boolean, never the raw
   * interpretation text itself, to the AI Gateway.
   */
  async aiInterpret(principal: AuthPrincipal, scoreId: string): Promise<PsychometricAiAssistResult> {
    const score = await this.prisma.psychometricScore.findFirst({
      where: { id: scoreId, tenantId: principal.tenantId },
      include: { response: { include: { version: { include: { questionnaire: true } } } } },
    });
    if (!score) throw new NotFoundException('Score not found');

    const synthetic = score.interpretation?.includes(SYNTHETIC_CALIBRATION_MARKER) ?? false;

    return this.ai.interpretScore({
      tenantId: principal.tenantId,
      clientId: score.response.clientId,
      scoreId: score.id,
      instrumentCode: score.response.version.questionnaire.code,
      severityBand: score.severityBand,
      theta: score.thetaEstimate,
      se: score.standardError,
      synthetic,
    });
  }

  /** Public: CAT completion reuses the exact same response+score serialization. */
  toDto(
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
