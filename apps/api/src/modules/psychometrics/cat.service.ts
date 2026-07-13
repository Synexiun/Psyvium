import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  questionnaireCutoffsSchema,
  Role,
  ScoringMethod,
  type AuthPrincipal,
  type CatAnswerInput,
  type CatNextItemDto,
  type CatSessionStateDto,
  type CatStartInput,
  type CatTerminationReason,
  type CatThetaPoint,
} from '@vpsy/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { CatSelectionService, type CatCandidate } from './cat-selection.service';
import { IrtScoringService } from './irt-scoring.service';
import { PsychometricsService } from './psychometrics.service';
import { validateSafetyConfiguration } from './response-validation';

/**
 * Computerized Adaptive Testing session flow
 * (docs/technical/07-psychometrics-engine.md §6) — stateful and server-driven:
 *
 *   POST /assessments/cat/start          → session + first item (selected at the prior mean θ=0)
 *   POST /assessments/cat/:id/answer     → record answer, re-run EAP over ALL administered
 *                                           items, select next max-information item or terminate
 *   GET  /assessments/cat/:id            → session state
 *
 * Every number is deterministic, closed-form math on the stored calibration —
 * the AI layer never touches this path (same bar as IrtScoringService). The
 * only randomness is the randomesque exposure draw (CatSelectionService),
 * which chooses AMONG the top-3 most informative items and never affects θ/SE.
 *
 * Termination (doc §6 stopping rules — constants below, checked in order):
 *   1. SE(θ) ≤ CAT_TARGET_SE (0.30)
 *   2. CAT_MAX_ITEMS (12) administered
 *   3. item bank exhausted (every calibrated item administered)
 * minItems / content-blueprint balancing from the doc's full CAT policy are
 * documented follow-ups, not silently half-implemented.
 *
 * On completion the response is persisted through the EXACT batch pipeline
 * (PsychometricsService.buildScoreComputation + persistScoredResponse +
 * publishScoredOutcome): classical raw-sum banding over the administered
 * answers, the deterministic safety-item hook (an endorsed item-9 raises
 * RiskFlag + Escalation exactly as a batch form would), and the honest
 * IRT/synthetic-calibration interpretation labeling — reused, never forked.
 */

/** Doc §6 stop policy: `"stop": {"targetSE": 0.30, ..., "maxItems": 12}`. */
export const CAT_TARGET_SE = 0.3;
export const CAT_MAX_ITEMS = 12;
/** EAP prior N(0,1): the pre-answer state every session starts from. */
const PRIOR_THETA = 0;
const PRIOR_SD = 1;

const CAT_STATUS = { ACTIVE: 'ACTIVE', COMPLETED: 'COMPLETED' } as const;

interface CatItemCandidate extends CatCandidate {
  stem: string;
  responseOptions: unknown;
  orderIndex: number;
}

interface LoadedCatVersion {
  version: {
    id: string;
    cutoffs: unknown;
    questionnaire?: { scoringMethod: string } | null;
    items?: Array<{ id: string; linkId?: string | null; responseOptions: unknown; parameters?: unknown[] }>;
  };
  candidates: CatItemCandidate[];
}

interface CatSessionRow {
  id: string;
  tenantId: string;
  clientId: string;
  versionId: string;
  status: string;
  administeredItemIds: string[];
  answers: unknown;
  thetaHistory: unknown;
  currentTheta: number | null;
  currentSE: number | null;
  terminationReason: string | null;
  responseId: string | null;
}

@Injectable()
export class CatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly selection: CatSelectionService,
    private readonly irt: IrtScoringService,
    private readonly psychometrics: PsychometricsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Starts a CAT session: validates the instrument DECLARES CAT scoring and
   * has calibrated items (both fail loudly — an instrument must opt in, never
   * drift into adaptive administration), then selects the first item at the
   * prior mean θ=0.
   */
  async start(principal: AuthPrincipal, input: CatStartInput): Promise<CatSessionStateDto> {
    const { candidates, version } = await this.loadCatVersion(input.versionId);

    const client = await this.prisma.client.findFirst({
      where: { id: input.clientId, tenantId: principal.tenantId },
      select: { id: true, userId: true },
    });
    if (!client) throw new NotFoundException('Client not found');
    this.assertClientSelf(principal, client.userId);

    // Fail at START, not after the client answered 12 items: a version whose
    // cutoffs can't band the final classical score would strand the session.
    const cutoffsParsed = questionnaireCutoffsSchema.safeParse(version.cutoffs);
    if (!cutoffsParsed.success) {
      throw new BadRequestException('Questionnaire version has no valid scoring cutoffs configured');
    }
    validateSafetyConfiguration(version.cutoffs, version.items ?? []);

    const firstItem = this.selection.selectNextItem(candidates, PRIOR_THETA);

    const session = await this.prisma.catSession.create({
      data: {
        tenantId: principal.tenantId,
        clientId: input.clientId,
        versionId: input.versionId,
        status: CAT_STATUS.ACTIVE,
        administeredItemIds: [firstItem.itemId],
        answers: {},
        thetaHistory: [],
        currentTheta: PRIOR_THETA,
        currentSE: PRIOR_SD,
      },
    });

    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'assessment.cat.started',
      entityType: 'CatSession',
      entityId: session.id,
      after: { versionId: input.versionId, clientId: input.clientId, firstItemId: firstItem.itemId },
    });

    return this.toStateDto(session as CatSessionRow, this.toNextItemDto(firstItem), null);
  }

  /**
   * Records the answer to the session's pending item, re-runs EAP over every
   * administered item, then either selects the next item or terminates and
   * persists the final QuestionnaireResponse + PsychometricScore through the
   * batch pipeline (safety hook included). The submitted `itemId` must echo
   * the pending item — a duplicate/stale submit fails loudly (400) instead of
   * silently recording against the wrong item.
   */
  async answer(principal: AuthPrincipal, sessionId: string, input: CatAnswerInput): Promise<CatSessionStateDto> {
    const session = await this.getOwnedSession(principal, sessionId);
    if (session.status !== CAT_STATUS.ACTIVE) {
      throw new ConflictException('CAT session is already completed');
    }

    const pendingItemId = session.administeredItemIds[session.administeredItemIds.length - 1];
    if (!pendingItemId || input.itemId !== pendingItemId) {
      throw new BadRequestException(
        `Answer must target the session's pending item ${pendingItemId ?? '(none)'} — got ${input.itemId}`,
      );
    }

    const { candidates, version } = await this.loadCatVersion(session.versionId);
    const byItemId = new Map(candidates.map((c) => [c.itemId, c]));
    const pending = byItemId.get(pendingItemId);
    if (!pending) {
      // Item deactivated / calibration withdrawn mid-session — refuse loudly
      // rather than scoring against a bank that no longer contains the item.
      throw new UnprocessableEntityException('The pending item is no longer part of the calibrated item bank');
    }

    // Record the answer (keyed by linkId — the same key convention as batch
    // QuestionnaireResponse.answers, so safety items and EAP behave identically).
    const answers = { ...((session.answers as Record<string, number>) ?? {}), [pending.linkId]: input.answer };

    // Re-estimate over ALL administered items. scoreEap also validates the
    // answer's category/score range against the item's model (422 on garbage),
    // BEFORE any state is persisted.
    const administered = session.administeredItemIds
      .map((id) => byItemId.get(id))
      .filter((c): c is CatItemCandidate => c != null);
    const eap = this.irt.scoreEap(administered, answers);
    if (!eap) throw new UnprocessableEntityException('CAT ability estimation produced no result');

    const thetaHistory: CatThetaPoint[] = [
      ...(((session.thetaHistory as CatThetaPoint[]) ?? []) as CatThetaPoint[]),
      {
        itemId: pending.itemId,
        linkId: pending.linkId,
        answer: input.answer,
        theta: eap.thetaEstimate,
        standardError: eap.standardError,
      },
    ];
    const answeredCount = Object.keys(answers).length;
    const eligible = candidates.filter((c) => !session.administeredItemIds.includes(c.itemId));

    // ── Termination rules (doc §6), checked in this order ──
    const terminationReason: CatTerminationReason | null =
      eap.standardError <= CAT_TARGET_SE
        ? 'SE_TARGET_REACHED'
        : answeredCount >= CAT_MAX_ITEMS
          ? 'MAX_ITEMS_REACHED'
          : eligible.length === 0
            ? 'ITEM_BANK_EXHAUSTED'
            : null;

    if (terminationReason) {
      // Final scoring artifacts via the SHARED batch pipeline (classical bands
      // + safety hook + honest IRT/synthetic labeling). The EAP inside is the
      // same estimator over the same answers, so score.thetaEstimate ===
      // session.currentTheta by construction.
      const computation = this.psychometrics.buildScoreComputation(version, answers);
      const client = await this.prisma.client.findFirst({
        where: { id: session.clientId, tenantId: principal.tenantId },
        select: { id: true, riskLevel: true },
      });
      if (!client) throw new NotFoundException('Client not found');

      const { result, updated } = await this.prisma.$transaction(async (tx) => {
        const persisted = await this.psychometrics.persistScoredResponse(
          tx,
          principal,
          client,
          { versionId: session.versionId, clientId: session.clientId, answers },
          computation,
          'CAT',
        );
        const updatedSession = await tx.catSession.update({
          where: { id: session.id },
          data: {
            status: CAT_STATUS.COMPLETED,
            answers,
            thetaHistory: thetaHistory as any,
            currentTheta: eap.thetaEstimate,
            currentSE: eap.standardError,
            terminationReason,
            responseId: persisted.response.id,
            completedAt: new Date(),
          },
        });
        return { result: persisted, updated: updatedSession };
      });

      await this.psychometrics.publishScoredOutcome(principal, session.clientId, computation, result);

      const scoreDto = this.psychometrics.toDto(result.response, result.score).score;
      return this.toStateDto(updated as CatSessionRow, null, scoreDto);
    }

    const nextItem = this.selection.selectNextItem(eligible, eap.thetaEstimate);
    const updated = await this.prisma.catSession.update({
      where: { id: session.id },
      data: {
        administeredItemIds: [...session.administeredItemIds, nextItem.itemId],
        answers,
        thetaHistory: thetaHistory as any,
        currentTheta: eap.thetaEstimate,
        currentSE: eap.standardError,
      },
    });

    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'assessment.cat.item_answered',
      entityType: 'CatSession',
      entityId: session.id,
      // θ/SE after the answer — never the raw answer value (that lives in the
      // session/response record, not the audit trail).
      after: {
        itemId: pending.itemId,
        itemsAnswered: answeredCount,
        theta: eap.thetaEstimate,
        standardError: eap.standardError,
        nextItemId: nextItem.itemId,
      },
    });

    return this.toStateDto(updated as CatSessionRow, this.toNextItemDto(nextItem), null);
  }

  /** Session state — ACTIVE sessions include the pending item; COMPLETED ones the final score. */
  async getState(principal: AuthPrincipal, sessionId: string): Promise<CatSessionStateDto> {
    const session = await this.getOwnedSession(principal, sessionId);

    if (session.status === CAT_STATUS.ACTIVE) {
      const pendingItemId = session.administeredItemIds[session.administeredItemIds.length - 1];
      const { candidates } = await this.loadCatVersion(session.versionId);
      const pending = candidates.find((c) => c.itemId === pendingItemId) ?? null;
      return this.toStateDto(session, pending ? this.toNextItemDto(pending) : null, null);
    }

    let scoreDto: CatSessionStateDto['score'] = null;
    if (session.responseId) {
      const response = await this.prisma.questionnaireResponse.findFirst({
        where: { id: session.responseId, tenantId: principal.tenantId },
        include: { score: true },
      });
      if (response?.score) scoreDto = this.psychometrics.toDto(response, response.score).score;
    }
    return this.toStateDto(session, null, scoreDto);
  }

  // ── internals ──

  /**
   * Loads + validates a CAT-capable version: published, `scoringMethod: CAT`
   * (declared opt-in, doc §6 — an IRT-but-not-CAT instrument stays batch-only),
   * and ≥1 active item with an active, VALID calibration row (parseParams
   * throws 422 on a mis-stored row — a wrong adaptive selection is worse than
   * none). Candidates keep item order stable (orderIndex) so information ties
   * resolve deterministically.
   */
  private async loadCatVersion(versionId: string): Promise<LoadedCatVersion> {
    const version = await this.prisma.questionnaireVersion.findUnique({
      where: { id: versionId },
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
    if (version.questionnaire?.scoringMethod !== ScoringMethod.CAT) {
      throw new BadRequestException(
        'This instrument does not declare CAT scoring — adaptive administration requires an explicit scoringMethod: CAT opt-in',
      );
    }

    const candidates: CatItemCandidate[] = [];
    for (const item of version.items ?? []) {
      const raw = item.parameters?.[0];
      if (!raw) continue; // uncalibrated items are simply ineligible for CAT
      const linkId = item.linkId ?? item.id;
      candidates.push({
        itemId: item.id,
        linkId,
        params: this.irt.parseParams(raw, linkId),
        stem: item.stem,
        responseOptions: item.responseOptions,
        orderIndex: item.orderIndex,
      });
    }
    if (candidates.length === 0) {
      throw new BadRequestException('This instrument has no calibrated items — CAT requires stored item parameters');
    }

    return { version, candidates };
  }

  /** ABAC (doc 06): a CLIENT may only touch their own sessions; clinicians/managers pass on RBAC. */
  private assertClientSelf(principal: AuthPrincipal, clientUserId: string): void {
    if (principal.roles.includes(Role.CLIENT) && clientUserId !== principal.userId) {
      throw new ForbiddenException('Clients may only administer their own assessments');
    }
  }

  private async getOwnedSession(principal: AuthPrincipal, sessionId: string): Promise<CatSessionRow> {
    const session = await this.prisma.catSession.findFirst({
      where: { id: sessionId, tenantId: principal.tenantId, deletedAt: null },
    });
    if (!session) throw new NotFoundException('CAT session not found');

    const client = await this.prisma.client.findFirst({
      where: { id: session.clientId, tenantId: principal.tenantId },
      select: { userId: true },
    });
    if (!client) throw new NotFoundException('Client not found');
    this.assertClientSelf(principal, client.userId);

    return session as CatSessionRow;
  }

  private toNextItemDto(candidate: CatItemCandidate): CatNextItemDto {
    // Never leak calibration parameters to the respondent — stem/options only.
    return {
      itemId: candidate.itemId,
      linkId: candidate.linkId,
      stem: candidate.stem,
      responseOptions: candidate.responseOptions,
      orderIndex: candidate.orderIndex,
    };
  }

  private toStateDto(
    session: CatSessionRow,
    nextItem: CatNextItemDto | null,
    score: CatSessionStateDto['score'],
  ): CatSessionStateDto {
    const answers = (session.answers as Record<string, number>) ?? {};
    return {
      sessionId: session.id,
      versionId: session.versionId,
      clientId: session.clientId,
      status: session.status === CAT_STATUS.COMPLETED ? 'COMPLETED' : 'ACTIVE',
      itemsAnswered: Object.keys(answers).length,
      currentTheta: session.currentTheta,
      currentSE: session.currentSE,
      thetaHistory: ((session.thetaHistory as CatThetaPoint[]) ?? []) as CatThetaPoint[],
      nextItem,
      terminationReason: (session.terminationReason as CatTerminationReason | null) ?? null,
      responseId: session.responseId ?? null,
      score,
    };
  }
}
