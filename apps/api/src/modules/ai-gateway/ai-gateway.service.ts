import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import {
  AiAgent,
  HumanDecision,
  type AiRecommendationDto,
  type AllocationRationale,
  type AuthPrincipal,
  type DecideAiRecommendationInput,
  type DifferentialDirection,
  type MatchCandidate,
  type SessionNoteDraftScaffold,
  type TreatmentPlanSuggestions,
} from '@vpsy/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { FeatureFlagsService } from '../../common/feature-flags/feature-flags.service';
import { EventBus, Events } from '../../common/events/event-bus.service';
import { ConsentService } from '../consent/consent.service';

/**
 * The AI Gateway is a GOVERNED bounded context (ADR-007). Rules enforced here:
 *  - PHI is minimized before it ever forms a payload — only DE-IDENTIFIED
 *    structured signals (severity band, suggested specialty, risk flag) are
 *    sent to the model. Free-text presenting problems never leave the system.
 *  - Every inference is recorded as an AIRecommendation with model/prompt
 *    versions and a PENDING human-decision gate. AI assists; clinicians decide.
 *  - Output language is assistive, never diagnostic.
 *  - Activate-on-key: with ANTHROPIC_API_KEY (or AI_GATEWAY_API_KEY) set, the
 *    real Claude model runs (source 'ai'). With no key, we DO NOT fake an AI
 *    success — we return a transparent, deterministic RULE-BASED note derived
 *    from real screening outputs, tagged source 'rule-based', so nothing is
 *    ever presented as AI output that a model did not produce.
 *  - WAVE CR — AI-consent gate (APA AI guidance 2025 / GDPR Art.22): every
 *    CLIENT-linked inference (intake summary, session-note assist,
 *    treatment-plan assist) additionally requires a non-revoked, current
 *    `AI_ASSISTED_ANALYSIS` consent (`ConsentService.hasActiveAiConsent`).
 *    Missing/revoked consent is handled exactly like "no API key": the real
 *    model is NEVER called, the honest rule-based path runs instead, and the
 *    withholding is recorded (`withheldReason: 'no-ai-consent'` on both the
 *    return value and the logged AIRecommendation output). This consent is
 *    intentionally NOT part of `REQUIRED_CONSENT_VERSIONS` — declining or
 *    revoking it never blocks intake or any clinical workflow; it only
 *    means AI is not used for that client.
 */
@Injectable()
export class AiGatewayService {
  private readonly logger = new Logger(AiGatewayService.name);
  private readonly apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.AI_GATEWAY_API_KEY ?? '';
  private client: Anthropic | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: EventBus,
    private readonly audit: AuditService,
    private readonly consents: ConsentService,
    private readonly flags: FeatureFlagsService,
  ) {}

  /**
   * PENDING human-decision queue (ADR-007). Newest first. Output is returned
   * only to authenticated clinicians with AI_DECISION — never over realtime.
   */
  async listPendingRecommendations(
    principal: AuthPrincipal,
    limit = 50,
  ): Promise<AiRecommendationDto[]> {
    const rows = await this.prisma.aIRecommendation.findMany({
      where: { tenantId: principal.tenantId, humanDecision: HumanDecision.PENDING },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
    });
    return rows.map((row) => this.toRecommendationDto(row));
  }

  /**
   * Record the clinician's terminal decision on a PENDING recommendation.
   * Compare-and-swap so two concurrent decisions cannot both succeed.
   */
  async decideRecommendation(
    principal: AuthPrincipal,
    recommendationId: string,
    input: DecideAiRecommendationInput,
  ): Promise<AiRecommendationDto> {
    const existing = await this.prisma.aIRecommendation.findFirst({
      where: { id: recommendationId, tenantId: principal.tenantId },
    });
    if (!existing) throw new NotFoundException('AI recommendation not found');
    if (existing.humanDecision !== HumanDecision.PENDING) {
      throw new ConflictException(`Recommendation is already ${existing.humanDecision}`);
    }

    const claimed = await this.prisma.aIRecommendation.updateMany({
      where: {
        id: recommendationId,
        tenantId: principal.tenantId,
        humanDecision: HumanDecision.PENDING,
      },
      data: {
        humanDecision: input.decision,
        decidedBy: principal.userId,
      },
    });
    if (claimed.count !== 1) {
      throw new ConflictException('Recommendation was already decided');
    }

    const updated = await this.prisma.aIRecommendation.findFirstOrThrow({
      where: { id: recommendationId, tenantId: principal.tenantId },
    });

    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'ai.recommendation.decided',
      entityType: 'AIRecommendation',
      entityId: updated.id,
      before: { humanDecision: HumanDecision.PENDING },
      after: {
        humanDecision: input.decision,
        modificationNote: input.modificationNote ?? null,
        rationale: input.rationale ?? null,
        agent: updated.agent,
        linkedEntityType: updated.linkedEntityType,
        linkedEntityId: updated.linkedEntityId,
      },
      critical: true,
    });

    return this.toRecommendationDto(updated);
  }

  private toRecommendationDto(row: {
    id: string;
    agent: string;
    confidence: number;
    humanDecision: string;
    decidedBy: string | null;
    linkedEntityType: string | null;
    linkedEntityId: string | null;
    output: unknown;
    createdAt: Date;
  }): AiRecommendationDto {
    return {
      id: row.id,
      agent: row.agent,
      confidence: row.confidence,
      humanDecision: row.humanDecision as AiRecommendationDto['humanDecision'],
      decidedBy: row.decidedBy,
      linkedEntityType: row.linkedEntityType,
      linkedEntityId: row.linkedEntityId,
      output: row.output,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /**
   * WAVE CR gate check. Fails CLOSED: any lookup error is treated as "no
   * consent" rather than silently permitting a model call.
   */
  private async hasAiConsent(clientId: string): Promise<boolean> {
    try {
      return await this.consents.hasActiveAiConsent(clientId);
    } catch (err) {
      this.logger.warn(`AI consent check failed for client ${clientId}, withholding AI: ${(err as Error).message}`);
      return false;
    }
  }

  /**
   * EU AI Act / staged-rollout kill switch. Feature flag key
   * `AI_ASSISTED_ANALYSIS` defaults ON when no row exists so local demos
   * keep working; admins set enabled=false to stop all model calls.
   */
  private async isAiEnabledForTenant(tenantId: string): Promise<boolean> {
    return this.flags.isEnabled(tenantId, 'AI_ASSISTED_ANALYSIS', true);
  }

  /** True when a real model can be called (key present — flag checked per call). */
  get aiConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  /** Combined gate: key + tenant kill-switch + client consent. */
  private async mayCallModel(tenantId: string, clientId: string): Promise<{
    allowed: boolean;
    withheldReason?: 'no-ai-consent' | 'feature-disabled';
  }> {
    if (!this.aiConfigured) return { allowed: false };
    const enabled = await this.isAiEnabledForTenant(tenantId);
    if (!enabled) return { allowed: false, withheldReason: 'feature-disabled' };
    const consented = await this.hasAiConsent(clientId);
    if (!consented) return { allowed: false, withheldReason: 'no-ai-consent' };
    return { allowed: true };
  }

  /** Model id, stripped of any `provider/` routing prefix. Defaults to Opus 4.8. */
  private get model(): string {
    const raw = process.env.AI_MODEL ?? 'claude-opus-4-8';
    return raw.includes('/') ? raw.slice(raw.lastIndexOf('/') + 1) : raw;
  }

  private getClient(): Anthropic {
    if (!this.client) {
      // 20s ceiling so a slow provider never stalls the (already-committed) intake flow.
      this.client = new Anthropic({ apiKey: this.apiKey, timeout: 20_000, maxRetries: 1 });
    }
    return this.client;
  }

  /** Intake intelligence agent — summarize + suggest specialty & battery. */
  async summarizeIntake(params: {
    tenantId: string;
    clientId: string;
    intakeId: string;
    presentingProblem: string; // received but NEVER forwarded to the model (PHI)
    severityBand: string;
    suggestedSpecialty: string;
    riskPresent: boolean;
  }): Promise<{
    summary: string;
    source: 'ai' | 'rule-based';
    aiConfigured: boolean;
    recommendationId?: string;
    withheldReason?: 'no-ai-consent' | 'feature-disabled';
  }> {
    let summary: string;
    let source: 'ai' | 'rule-based';
    let withheldReason: 'no-ai-consent' | 'feature-disabled' | undefined;

    const gate = await this.mayCallModel(params.tenantId, params.clientId);

    if (gate.allowed) {
      try {
        summary = await this.callModel(AiAgent.INTAKE, {
          severityBand: params.severityBand,
          suggestedSpecialty: params.suggestedSpecialty,
          riskPresent: params.riskPresent,
        });
        source = 'ai';
      } catch (err) {
        // Honest degradation — never present the fallback as an AI result.
        this.logger.warn(`AI intake summary failed, using rule-based note: ${(err as Error).message}`);
        summary = this.ruleBasedIntakeSummary(params);
        source = 'rule-based';
      }
    } else {
      summary = this.ruleBasedIntakeSummary(params);
      source = 'rule-based';
      withheldReason = gate.withheldReason;
    }

    const recommendationId = await this.logRecommendation({
      tenantId: params.tenantId,
      agent: AiAgent.INTAKE,
      input: { severityBand: params.severityBand, presentingProblem: '[redacted-phi]' },
      output: { summary, source, ...(withheldReason ? { withheldReason } : {}) },
      confidence: source === 'ai' ? 0.6 : 0.4,
      linkedEntityType: 'Intake',
      linkedEntityId: params.intakeId,
    });
    return { summary, source, aiConfigured: this.aiConfigured, recommendationId, ...(withheldReason ? { withheldReason } : {}) };
  }

  /**
   * Manager allocation agent (doc 05 §3.8) — rank candidates. Manager remains
   * final authority. The RANKING itself is ALWAYS the deterministic sort
   * below — the AI layer NEVER reorders candidates, it only (optionally)
   * EXPLAINS the top of an already-fixed order with a short rationale note
   * per candidate. Same activate-on-key / honest-degradation / AI-consent
   * (client-linked) gate as every other agent; unkeyed or unconsented leaves
   * the pre-existing behavior (deterministic ranking only) unchanged.
   */
  async rankCandidates(params: {
    tenantId: string;
    clientId: string;
    candidates: MatchCandidate[];
  }): Promise<{
    ranked: MatchCandidate[];
    aiRationales?: AllocationRationale[];
    source?: 'ai' | 'rule-based';
    recommendationId?: string;
    withheldReason?: 'no-ai-consent' | 'feature-disabled';
  }> {
    // Deterministic scoring rationale is computed by the Matching context;
    // this order is FINAL — the AI layer only ever explains it.
    const ranked = [...params.candidates].sort((a, b) => b.score - a.score);

    let aiRationales: AllocationRationale[] | undefined;
    let source: 'ai' | 'rule-based' | undefined;
    let withheldReason: 'no-ai-consent' | 'feature-disabled' | undefined;

    const top3 = ranked.slice(0, 3);
    if (top3.length > 0) {
      const signals = top3.map((c) => ({
        psychologistId: c.psychologistId,
        score: c.score,
        specialtyMatch: !c.fitWarnings.some((w) => w.toLowerCase().includes('specialty')),
        caseloadUtilization: c.caseloadUtilization,
      }));

      const gate = await this.mayCallModel(params.tenantId, params.clientId);

      if (gate.allowed) {
        try {
          aiRationales = await this.callAllocationModel(signals);
          source = 'ai';
        } catch (err) {
          this.logger.warn(`AI allocation rationale failed, using rule-based rationale: ${(err as Error).message}`);
          aiRationales = this.ruleBasedAllocationRationale(signals);
          source = 'rule-based';
        }
      } else {
        aiRationales = this.ruleBasedAllocationRationale(signals);
        source = 'rule-based';
        withheldReason = gate.withheldReason;
      }
    }

    const recommendationId = await this.logRecommendation({
      tenantId: params.tenantId,
      agent: AiAgent.ALLOCATION,
      input: { clientId: params.clientId, candidateCount: params.candidates.length },
      output: {
        ranking: ranked.map((c) => ({ psychologistId: c.psychologistId, score: c.score })),
        aiRationales,
        source,
        ...(withheldReason ? { withheldReason } : {}),
      },
      confidence: 0.7,
      linkedEntityType: 'Assignment',
      linkedEntityId: params.clientId,
    });
    return { ranked, aiRationales, source, recommendationId, ...(withheldReason ? { withheldReason } : {}) };
  }

  /** Session-Note Assistant (doc 05 §3.4) — draft SCAFFOLD only, never a fabricated note. */
  async summarizeSessionNote(params: {
    tenantId: string;
    clientId: string;
    sessionId: string;
    sessionType: string;
    presentingThemeCodes: string[];
    riskPresent: boolean;
    planGoalIds: string[];
  }): Promise<{
    watermark: 'AI-DRAFT — unsigned; clinician review and edit required before signing';
    draft: SessionNoteDraftScaffold;
    source: 'ai' | 'rule-based';
    aiConfigured: boolean;
    recommendationId?: string;
    withheldReason?: 'no-ai-consent' | 'feature-disabled';
  }> {
    const signals = {
      sessionType: params.sessionType,
      presentingThemeCodes: params.presentingThemeCodes,
      riskPresent: params.riskPresent,
      planGoalIds: params.planGoalIds,
    };
    let draft: SessionNoteDraftScaffold;
    let source: 'ai' | 'rule-based';
    let withheldReason: 'no-ai-consent' | 'feature-disabled' | undefined;

    const gate = await this.mayCallModel(params.tenantId, params.clientId);

    if (gate.allowed) {
      try {
        draft = await this.callSessionNoteModel(signals);
        source = 'ai';
      } catch (err) {
        this.logger.warn(`AI session-note draft failed, using rule-based scaffold: ${(err as Error).message}`);
        draft = this.ruleBasedSessionNoteDraft(signals);
        source = 'rule-based';
      }
    } else {
      draft = this.ruleBasedSessionNoteDraft(signals);
      source = 'rule-based';
      withheldReason = gate.withheldReason;
    }

    const recommendationId = await this.logRecommendation({
      tenantId: params.tenantId,
      agent: AiAgent.SESSION_NOTE,
      input: signals,
      output: { draft, source, ...(withheldReason ? { withheldReason } : {}) },
      confidence: source === 'ai' ? 0.6 : 0.4,
      linkedEntityType: 'Session',
      linkedEntityId: params.sessionId,
    });

    return {
      watermark: 'AI-DRAFT — unsigned; clinician review and edit required before signing',
      draft,
      source,
      aiConfigured: this.aiConfigured,
      recommendationId,
      ...(withheldReason ? { withheldReason } : {}),
    };
  }

  /** Treatment-Plan Support (doc 05 §3.3) — options only, never prescriptive. */
  async suggestTreatmentPlan(params: {
    tenantId: string;
    clientId: string;
    severityBand: string;
    specialty: string;
    outcomeTrend: string;
  }): Promise<{
    suggestions: TreatmentPlanSuggestions;
    source: 'ai' | 'rule-based';
    aiConfigured: boolean;
    recommendationId?: string;
    withheldReason?: 'no-ai-consent' | 'feature-disabled';
  }> {
    const signals = {
      severityBand: params.severityBand,
      specialty: params.specialty,
      outcomeTrend: params.outcomeTrend,
    };
    let suggestions: TreatmentPlanSuggestions;
    let source: 'ai' | 'rule-based';
    let withheldReason: 'no-ai-consent' | 'feature-disabled' | undefined;

    const gate = await this.mayCallModel(params.tenantId, params.clientId);

    if (gate.allowed) {
      try {
        suggestions = await this.callTreatmentPlanModel(signals);
        source = 'ai';
      } catch (err) {
        this.logger.warn(`AI treatment-plan suggestion failed, using rule-based options: ${(err as Error).message}`);
        suggestions = this.ruleBasedTreatmentPlanSuggestions(signals);
        source = 'rule-based';
      }
    } else {
      suggestions = this.ruleBasedTreatmentPlanSuggestions(signals);
      source = 'rule-based';
      withheldReason = gate.withheldReason;
    }

    const recommendationId = await this.logRecommendation({
      tenantId: params.tenantId,
      agent: AiAgent.TREATMENT_PLAN,
      input: signals,
      output: { suggestions, source, ...(withheldReason ? { withheldReason } : {}) },
      confidence: source === 'ai' ? 0.6 : 0.4,
      linkedEntityType: 'Client',
      linkedEntityId: params.clientId,
    });

    return {
      suggestions,
      source,
      aiConfigured: this.aiConfigured,
      recommendationId,
      ...(withheldReason ? { withheldReason } : {}),
    };
  }

  /**
   * Differential Hypothesis (doc 05 §3.2) — SUGGESTS non-diagnostic
   * directions only; a clinician who agrees still authors the actual
   * DiagnosisHypothesis record elsewhere (this method never writes one).
   * Anti-anchoring rule: ALWAYS returns >= 2 competing, hedged directions —
   * never a single answer that could anchor the clinician's judgment.
   */
  async suggestDifferentials(params: {
    tenantId: string;
    clientId: string;
    severityBand: string;
    specialty: string;
    screeningDomainsElevated: string[];
  }): Promise<{
    directions: DifferentialDirection[];
    source: 'ai' | 'rule-based';
    aiConfigured: boolean;
    recommendationId?: string;
    withheldReason?: 'no-ai-consent' | 'feature-disabled';
  }> {
    const signals = {
      severityBand: params.severityBand,
      specialty: params.specialty,
      screeningDomainsElevated: params.screeningDomainsElevated,
    };
    let directions: DifferentialDirection[];
    let source: 'ai' | 'rule-based';
    let withheldReason: 'no-ai-consent' | 'feature-disabled' | undefined;

    const gate = await this.mayCallModel(params.tenantId, params.clientId);

    if (gate.allowed) {
      try {
        directions = await this.callDifferentialModel(signals);
        source = 'ai';
      } catch (err) {
        this.logger.warn(`AI differential suggestion failed, using rule-based directions: ${(err as Error).message}`);
        directions = this.ruleBasedDifferentials(signals);
        source = 'rule-based';
      }
    } else {
      directions = this.ruleBasedDifferentials(signals);
      source = 'rule-based';
      withheldReason = gate.withheldReason;
    }

    const recommendationId = await this.logRecommendation({
      tenantId: params.tenantId,
      agent: AiAgent.DIFFERENTIAL,
      input: signals,
      output: { directions, source, ...(withheldReason ? { withheldReason } : {}) },
      confidence: source === 'ai' ? 0.5 : 0.35,
      linkedEntityType: 'Client',
      linkedEntityId: params.clientId,
    });

    return {
      directions,
      source,
      aiConfigured: this.aiConfigured,
      recommendationId,
      ...(withheldReason ? { withheldReason } : {}),
    };
  }

  /** Outcome Intelligence (doc 05 §3.5) — an assistive trend NARRATIVE only; the Reliable Change Index classification is always computed deterministically upstream (OutcomesService) and is never recomputed or contradicted here. */
  async narrateOutcomeTrend(params: {
    tenantId: string;
    clientId: string;
    construct: string;
    rciClassification: string;
    direction: string;
    nPoints: number;
  }): Promise<{
    narrative: string;
    source: 'ai' | 'rule-based';
    aiConfigured: boolean;
    recommendationId?: string;
    withheldReason?: 'no-ai-consent' | 'feature-disabled';
  }> {
    const signals = {
      construct: params.construct,
      rciClassification: params.rciClassification,
      direction: params.direction,
      nPoints: params.nPoints,
    };
    let narrative: string;
    let source: 'ai' | 'rule-based';
    let withheldReason: 'no-ai-consent' | 'feature-disabled' | undefined;

    const gate = await this.mayCallModel(params.tenantId, params.clientId);

    if (gate.allowed) {
      try {
        narrative = await this.callOutcomeModel(signals);
        source = 'ai';
      } catch (err) {
        this.logger.warn(`AI outcome narrative failed, using rule-based narrative: ${(err as Error).message}`);
        narrative = this.ruleBasedOutcomeNarrative(signals);
        source = 'rule-based';
      }
    } else {
      narrative = this.ruleBasedOutcomeNarrative(signals);
      source = 'rule-based';
      withheldReason = gate.withheldReason;
    }

    const recommendationId = await this.logRecommendation({
      tenantId: params.tenantId,
      agent: AiAgent.OUTCOME,
      input: signals,
      output: { narrative, source, ...(withheldReason ? { withheldReason } : {}) },
      confidence: source === 'ai' ? 0.55 : 0.4,
      linkedEntityType: 'Client',
      linkedEntityId: params.clientId,
    });

    return {
      narrative,
      source,
      aiConfigured: this.aiConfigured,
      recommendationId,
      ...(withheldReason ? { withheldReason } : {}),
    };
  }

  /**
   * Psychometric Interpretation (doc 05 §3.7) — CLINICIAN_ONLY assistive
   * interpretation of an ALREADY-COMPUTED, deterministic score; never
   * re-scores or alters severity banding. Must carry the synthetic-
   * calibration caveat whenever the underlying score used demo/uncalibrated
   * item parameters (ScoringService/`buildScoreComputation`'s
   * 'SYNTHETIC CALIBRATION' marker) — both paths (AI and rule-based).
   */
  async interpretScore(params: {
    tenantId: string;
    clientId: string;
    scoreId: string;
    instrumentCode: string;
    severityBand: string | null;
    theta: number | null;
    se: number | null;
    synthetic: boolean;
  }): Promise<{
    interpretation: string;
    source: 'ai' | 'rule-based';
    aiConfigured: boolean;
    recommendationId?: string;
    withheldReason?: 'no-ai-consent' | 'feature-disabled';
  }> {
    const signals = {
      instrumentCode: params.instrumentCode,
      severityBand: params.severityBand,
      theta: params.theta,
      se: params.se,
      synthetic: params.synthetic,
    };
    let interpretation: string;
    let source: 'ai' | 'rule-based';
    let withheldReason: 'no-ai-consent' | 'feature-disabled' | undefined;

    const gate = await this.mayCallModel(params.tenantId, params.clientId);

    if (gate.allowed) {
      try {
        interpretation = await this.callPsychometricModel(signals);
        source = 'ai';
      } catch (err) {
        this.logger.warn(`AI score interpretation failed, using rule-based interpretation: ${(err as Error).message}`);
        interpretation = this.ruleBasedScoreInterpretation(signals);
        source = 'rule-based';
      }
    } else {
      interpretation = this.ruleBasedScoreInterpretation(signals);
      source = 'rule-based';
      withheldReason = gate.withheldReason;
    }

    const recommendationId = await this.logRecommendation({
      tenantId: params.tenantId,
      agent: AiAgent.PSYCHOMETRIC,
      input: signals,
      output: { interpretation, source, ...(withheldReason ? { withheldReason } : {}) },
      confidence: source === 'ai' ? 0.55 : 0.4,
      linkedEntityType: 'PsychometricScore',
      linkedEntityId: params.scoreId,
    });

    return {
      interpretation,
      source,
      aiConfigured: this.aiConfigured,
      recommendationId,
      ...(withheldReason ? { withheldReason } : {}),
    };
  }

  /**
   * Crisis context-assembly (doc 05 §3.6). Detection is 100% DETERMINISTIC
   * and lives entirely in the Risk & Crisis context (out of scope here) —
   * this agent runs strictly AFTER a RiskFlag/Escalation already exists and
   * ONLY assembles a brief situational summary for the human responder. It
   * never detects, scores, or classifies risk itself. Advisory only — the
   * assigned clinician/manager decides and acts on every case.
   */
  async summarizeRiskContext(params: {
    tenantId: string;
    clientId: string;
    riskFlagId: string;
    severity: string;
    riskType: string;
    openEscalations: number;
    hasActiveSafetyPlan: boolean;
    slaDueInMinutes: number;
  }): Promise<{
    summary: string;
    source: 'ai' | 'rule-based';
    aiConfigured: boolean;
    recommendationId?: string;
    withheldReason?: 'no-ai-consent' | 'feature-disabled';
  }> {
    const signals = {
      severity: params.severity,
      riskType: params.riskType,
      openEscalations: params.openEscalations,
      hasActiveSafetyPlan: params.hasActiveSafetyPlan,
      slaDueInMinutes: params.slaDueInMinutes,
    };
    let summary: string;
    let source: 'ai' | 'rule-based';
    let withheldReason: 'no-ai-consent' | 'feature-disabled' | undefined;

    const gate = await this.mayCallModel(params.tenantId, params.clientId);

    if (gate.allowed) {
      try {
        summary = await this.callRiskContextModel(signals);
        source = 'ai';
      } catch (err) {
        this.logger.warn(`AI risk-context summary failed, using rule-based summary: ${(err as Error).message}`);
        summary = this.ruleBasedRiskContext(signals);
        source = 'rule-based';
      }
    } else {
      summary = this.ruleBasedRiskContext(signals);
      source = 'rule-based';
      withheldReason = gate.withheldReason;
    }

    const recommendationId = await this.logRecommendation({
      tenantId: params.tenantId,
      agent: AiAgent.CRISIS_RISK,
      input: signals,
      output: { summary, source, ...(withheldReason ? { withheldReason } : {}) },
      confidence: source === 'ai' ? 0.5 : 0.4,
      linkedEntityType: 'RiskFlag',
      linkedEntityId: params.riskFlagId,
    });

    return {
      summary,
      source,
      aiConfigured: this.aiConfigured,
      recommendationId,
      ...(withheldReason ? { withheldReason } : {}),
    };
  }

  /**
   * Real model call. Receives ONLY de-identified structured signals. Returns the
   * assistive text. Throws on any provider/SDK error so the caller can degrade
   * honestly (it must not swallow errors into a fabricated success).
   */
  private async callModel(
    agent: AiAgent,
    signals: { severityBand: string; suggestedSpecialty: string; riskPresent: boolean },
  ): Promise<string> {
    const system =
      'You are a clinical decision-support assistant inside a licensed psychology platform. ' +
      'You ASSIST; a licensed clinician always decides. Write a concise (2-3 sentence) assistive ' +
      'summary for the clinician from the de-identified signals provided. Never state or imply a ' +
      'diagnosis. Use hedged, assistive language and explicitly note that clinician confirmation is ' +
      'required. If a risk signal is present, state that a separate human risk review governs safety ' +
      'and this summary does not replace it. Do not invent facts beyond the signals given.';
    const user =
      `De-identified intake signals:\n` +
      `- screening severity band: ${signals.severityBand}\n` +
      `- suggested care pathway/specialty: ${signals.suggestedSpecialty}\n` +
      `- safety/risk signal present on screening: ${signals.riskPresent ? 'yes' : 'no'}\n\n` +
      `Write the assistive summary now.`;

    const res = await this.getClient().messages.create({
      model: this.model,
      max_tokens: 400,
      system,
      messages: [{ role: 'user', content: user }],
    });

    const text = res.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();

    if (!text) throw new Error(`empty completion from ${this.model} for ${agent}`);
    return text;
  }

  /**
   * Deterministic, transparent rule-based note (NOT AI). Derived from real
   * screening outputs; used only when no model is configured or a call fails.
   */
  private ruleBasedIntakeSummary(p: {
    severityBand: string;
    suggestedSpecialty: string;
    riskPresent: boolean;
  }): string {
    const risk = p.riskPresent
      ? ' Safety indicators were positive on screening — a human risk review has been opened; this summary does not replace it.'
      : '';
    return (
      `Rule-based assistive note (requires clinician confirmation): presentation appears consistent with ` +
      `a ${p.severityBand.toLowerCase()}-severity concern; consider evaluating within the ` +
      `${p.suggestedSpecialty} pathway. Insufficient evidence for any diagnosis from intake alone.` +
      risk
    );
  }

  /**
   * Real model call for the Session-Note Assistant. Only coded session
   * signals are sent — no raw note text, dictation, or client identifiers
   * ever reach the model. The model is asked for a structural SCAFFOLD
   * (section prompts), not fabricated clinical content, since it has no
   * grounding material to draw a real narrative from.
   */
  private async callSessionNoteModel(signals: {
    sessionType: string;
    presentingThemeCodes: string[];
    riskPresent: boolean;
    planGoalIds: string[];
  }): Promise<SessionNoteDraftScaffold> {
    const system =
      'You are a clinical documentation drafting assistant inside a licensed psychology platform. ' +
      'You ASSIST; a licensed clinician always reviews, edits, and signs before anything becomes a ' +
      'clinical record. You are given ONLY de-identified, coded session signals — never the ' +
      "clinician's raw notes or any client-identifying information. Do not invent clinical facts, " +
      'quotes, or narrative details; produce structural SOAP prompts/placeholders the clinician will ' +
      'fill in themselves. Never assert a diagnosis. If a risk signal is present, note that a ' +
      'separate human risk workflow governs safety and this draft does not replace it. Output EXACTLY ' +
      'four lines, nothing else, in this format:\n' +
      'SUBJECTIVE: <prompt>\nOBJECTIVE: <prompt>\nASSESSMENT: <prompt>\nPLAN: <prompt>';
    const user =
      `De-identified session signals:\n` +
      `- session type: ${signals.sessionType}\n` +
      `- presenting theme codes: ${signals.presentingThemeCodes.join(', ') || 'none'}\n` +
      `- linked plan goal count: ${signals.planGoalIds.length}\n` +
      `- safety/risk signal currently open: ${signals.riskPresent ? 'yes' : 'no'}\n\n` +
      `Write the four-line draft scaffold now.`;

    const res = await this.getClient().messages.create({
      model: this.model,
      max_tokens: 400,
      system,
      messages: [{ role: 'user', content: user }],
    });
    const text = this.extractText(res);
    const sections = this.parseLabeledLines(text, ['SUBJECTIVE', 'OBJECTIVE', 'ASSESSMENT', 'PLAN']);
    if (!sections.SUBJECTIVE || !sections.OBJECTIVE || !sections.ASSESSMENT || !sections.PLAN) {
      throw new Error(`incomplete session-note scaffold from ${this.model}`);
    }
    return {
      subjective: sections.SUBJECTIVE,
      objective: sections.OBJECTIVE,
      assessment: sections.ASSESSMENT,
      plan: sections.PLAN,
    };
  }

  /**
   * Real model call for Treatment-Plan Support. Only severity band, specialty,
   * and outcome-trend direction are sent — no history, hypotheses, or
   * client-identifying information.
   */
  private async callTreatmentPlanModel(signals: {
    severityBand: string;
    specialty: string;
    outcomeTrend: string;
  }): Promise<TreatmentPlanSuggestions> {
    const system =
      'You are a clinical treatment-planning decision-support assistant inside a licensed psychology ' +
      'platform. You ASSIST; a licensed clinician always composes and confirms the actual care plan. ' +
      'You are given ONLY de-identified severity/specialty/outcome-trend signals. Offer OPTIONS, never ' +
      'a single prescriptive plan; never include medication dosing (out of psychology scope — refer to ' +
      'the prescriber workflow). Frame goals/interventions as candidates requiring clinician ' +
      'confirmation. Output EXACTLY in this format, nothing else:\n' +
      'GOALS:\n- <goal>\n- <goal>\nINTERVENTIONS:\n- <intervention: brief rationale>\n- <intervention: brief rationale>\nCADENCE: <measurement cadence suggestion>';
    const user =
      `De-identified treatment signals:\n` +
      `- screening severity band: ${signals.severityBand}\n` +
      `- care pathway/specialty: ${signals.specialty}\n` +
      `- primary outcome-construct trend: ${signals.outcomeTrend}\n\n` +
      `Write the goals/interventions/cadence options now.`;

    const res = await this.getClient().messages.create({
      model: this.model,
      max_tokens: 500,
      system,
      messages: [{ role: 'user', content: user }],
    });
    const text = this.extractText(res);
    const goalSuggestions = this.parseBulletBlock(text, 'GOALS', ['INTERVENTIONS', 'CADENCE']);
    const interventionSuggestions = this.parseBulletBlock(text, 'INTERVENTIONS', ['CADENCE']);
    const cadence = this.parseLabeledLines(text, ['CADENCE']).CADENCE;
    if (goalSuggestions.length === 0 || interventionSuggestions.length === 0 || !cadence) {
      throw new Error(`incomplete treatment-plan suggestions from ${this.model}`);
    }
    return {
      goalSuggestions,
      interventionSuggestions,
      measurementCadenceSuggestion: cadence,
    };
  }

  private extractText(res: Anthropic.Message): string {
    const text = res.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();
    if (!text) throw new Error(`empty completion from ${this.model}`);
    return text;
  }

  /** Extracts `LABEL: value` single-line fields from a model's structured completion. */
  private parseLabeledLines(text: string, labels: string[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const label of labels) {
      const match = text.match(new RegExp(`^${label}:\\s*(.+)$`, 'mi'));
      if (match?.[1]) out[label] = match[1].trim();
    }
    return out;
  }

  /** Extracts a `LABEL:\n- item\n- item` bullet block, stopping at the next known label. */
  private parseBulletBlock(text: string, label: string, followingLabels: string[]): string[] {
    const stopPattern = followingLabels.length ? followingLabels.join('|') : '$a';
    const match = text.match(new RegExp(`${label}:\\s*\\n([\\s\\S]*?)(?=\\n(?:${stopPattern}):|$)`, 'i'));
    if (!match) return [];
    return match[1]
      .split('\n')
      .map((line) => line.replace(/^\s*-\s*/, '').trim())
      .filter((line) => line.length > 0);
  }

  /**
   * Deterministic, transparent rule-based scaffold (NOT AI) for the
   * Session-Note Assistant — structural prompts only, no fabricated content.
   */
  private ruleBasedSessionNoteDraft(p: {
    sessionType: string;
    presentingThemeCodes: string[];
    riskPresent: boolean;
    planGoalIds: string[];
  }): SessionNoteDraftScaffold {
    const themes = p.presentingThemeCodes.length ? p.presentingThemeCodes.join(', ') : 'no theme codes provided';
    const goals = p.planGoalIds.length ? `${p.planGoalIds.length} linked plan goal(s)` : 'no linked plan goals';
    const risk = p.riskPresent
      ? ' A safety/risk signal is currently open — document per the safety protocol; this scaffold does not replace the separate human risk review.'
      : '';
    return {
      subjective: `Rule-based prompt (requires clinician content): describe the client's reported experience since the last ${p.sessionType.toLowerCase()} session, referencing presenting theme(s): ${themes}.`,
      objective: `Rule-based prompt: record clinician observations (affect, engagement, mental status) for this ${p.sessionType.toLowerCase()} session.${risk}`,
      assessment: `Rule-based prompt: summarize clinical impression relative to ${goals}. Insufficient evidence for any diagnosis from coded signals alone.`,
      plan: `Rule-based prompt: document next steps and any plan changes relative to ${goals}; requires clinician confirmation.`,
    };
  }

  /**
   * Deterministic, transparent rule-based options (NOT AI) for
   * Treatment-Plan Support — evidence-informed defaults, never prescriptive.
   */
  private ruleBasedTreatmentPlanSuggestions(p: {
    severityBand: string;
    specialty: string;
    outcomeTrend: string;
  }): TreatmentPlanSuggestions {
    const interventionSuggestions = [
      'CBT: consider cognitive restructuring targeting core symptoms — clinician confirmation required.',
      'PSYCHOEDUCATION: consider psychoeducation on the presenting concern to support informed engagement.',
    ];
    if (p.severityBand === 'SEVERE') {
      interventionSuggestions.push('CRISIS_SAFETY: consider a safety-planning component given SEVERE severity band.');
    }
    if (p.outcomeTrend === 'declining') {
      interventionSuggestions.push('RELAPSE_PREVENTION: consider a relapse-prevention component given a declining trend.');
    }
    return {
      goalSuggestions: [
        `Consider a measurable symptom-reduction goal appropriate to a ${p.severityBand.toLowerCase()}-severity ${p.specialty} presentation — clinician confirmation required.`,
        'Consider a functioning-focused goal (work/family/social) to track alongside symptom measures.',
      ],
      interventionSuggestions,
      measurementCadenceSuggestion:
        p.outcomeTrend === 'declining'
          ? 'Rule-based suggestion: repeat the primary outcome measure every 2 sessions given the declining trend; clinician confirms cadence.'
          : 'Rule-based suggestion: repeat the primary outcome measure every 3-4 sessions; clinician confirms cadence.',
    };
  }

  /**
   * Real model call for the Allocation rationale extension (doc 05 §3.8).
   * The candidate order given here is ALREADY FINAL (the deterministic sort
   * from `rankCandidates`) — the model is explicitly instructed never to
   * reorder it and the parser maps rationale lines back onto the given
   * candidates strictly by position, never by any reordering the model text
   * might imply.
   */
  private async callAllocationModel(
    signals: Array<{ psychologistId: string; score: number; specialtyMatch: boolean; caseloadUtilization: number }>,
  ): Promise<AllocationRationale[]> {
    const system =
      'You are a care-allocation decision-support assistant inside a licensed psychology platform. ' +
      'The candidate RANKING is already fixed by a deterministic algorithm and you must NEVER reorder ' +
      'or re-score it — you only write a short (one sentence) assistive rationale per candidate from ' +
      'the coded signals given. The assigning manager always makes the final assignment decision. ' +
      'Output EXACTLY one line per candidate, in the SAME order given, formatted as:\n' +
      '<n>: <rationale>\n' +
      'with no other text.';
    const user =
      `De-identified candidate signals, in final rank order (do not reorder):\n` +
      signals
        .map(
          (s, i) =>
            `${i + 1}. match score: ${s.score.toFixed(2)}; specialty match: ${s.specialtyMatch ? 'yes' : 'no'}; caseload utilization: ${(s.caseloadUtilization * 100).toFixed(0)}%`,
        )
        .join('\n') +
      `\n\nWrite the ${signals.length} rationale line(s) now.`;

    const res = await this.getClient().messages.create({
      model: this.model,
      max_tokens: 300,
      system,
      messages: [{ role: 'user', content: user }],
    });
    const text = this.extractText(res);
    const rationales: AllocationRationale[] = [];
    for (let i = 0; i < signals.length; i++) {
      const match = text.match(new RegExp(`^${i + 1}:\\s*(.+)$`, 'mi'));
      if (match?.[1]) rationales.push({ psychologistId: signals[i].psychologistId, rationale: match[1].trim() });
    }
    if (rationales.length !== signals.length) {
      throw new Error(`incomplete allocation rationale from ${this.model}`);
    }
    return rationales;
  }

  /** Deterministic, transparent rule-based rationale (NOT AI) for the Allocation extension. */
  private ruleBasedAllocationRationale(
    signals: Array<{ psychologistId: string; score: number; specialtyMatch: boolean; caseloadUtilization: number }>,
  ): AllocationRationale[] {
    return signals.map((s) => ({
      psychologistId: s.psychologistId,
      rationale:
        `Rule-based note (requires manager confirmation): match score ${s.score.toFixed(2)}` +
        (s.specialtyMatch ? ', specialty aligned' : ', specialty not confirmed aligned') +
        `, current caseload utilization ${(s.caseloadUtilization * 100).toFixed(0)}%.`,
    }));
  }

  /**
   * Real model call for Differential Hypothesis. Anti-anchoring rule: a
   * response parsed into fewer than 2 competing directions is treated as an
   * INCOMPLETE model response (thrown, triggering honest rule-based
   * degradation) rather than accepted as a valid single answer — the
   * clinician must never be anchored on one direction.
   */
  private async callDifferentialModel(signals: {
    severityBand: string;
    specialty: string;
    screeningDomainsElevated: string[];
  }): Promise<DifferentialDirection[]> {
    const system =
      'You are a clinical decision-support assistant inside a licensed psychology platform. You ' +
      'ASSIST; a licensed clinician always decides and any diagnosis is made only by that clinician ' +
      'through their own clinical judgment. You are given ONLY de-identified, coded screening signals. ' +
      'NEVER state or imply a diagnosis. To avoid anchoring the clinician on a single answer, you MUST ' +
      'propose AT LEAST TWO distinct, competing, hedged differential DIRECTIONS for further clinical ' +
      'evaluation (not diagnoses) — never just one. Output EXACTLY one line per direction, at least 2 ' +
      'and at most 4 lines, nothing else, formatted as:\n' +
      '- <direction to consider> || <brief hedged rationale from the signals>';
    const user =
      `De-identified screening signals:\n` +
      `- severity band: ${signals.severityBand}\n` +
      `- suggested specialty: ${signals.specialty}\n` +
      `- elevated screening domains: ${signals.screeningDomainsElevated.join(', ') || 'none'}\n\n` +
      `Write at least 2 competing differential direction lines now.`;

    const res = await this.getClient().messages.create({
      model: this.model,
      max_tokens: 400,
      system,
      messages: [{ role: 'user', content: user }],
    });
    const text = this.extractText(res);
    const directions: DifferentialDirection[] = text
      .split('\n')
      .map((line) => line.replace(/^\s*-\s*/, '').trim())
      .filter((line) => line.includes('||'))
      .map((line) => {
        const [direction, rationale] = line.split('||').map((s) => s.trim());
        return { direction, rationale };
      })
      .filter((d) => d.direction && d.rationale);

    if (directions.length < 2) {
      throw new Error(`fewer than 2 differential directions parsed from ${this.model} response`);
    }
    return directions;
  }

  /**
   * Deterministic, transparent rule-based directions (NOT AI). Anti-anchoring
   * rule enforced structurally: always returns >= 2 directions, even from a
   * single elevated screening domain.
   */
  private ruleBasedDifferentials(signals: {
    severityBand: string;
    specialty: string;
    screeningDomainsElevated: string[];
  }): DifferentialDirection[] {
    const domains = signals.screeningDomainsElevated.length ? signals.screeningDomainsElevated : ['general'];
    const directions: DifferentialDirection[] = domains.slice(0, 3).map((domain) => ({
      direction: `Consider further evaluation of ${domain}-related presentation`,
      rationale: `Rule-based note (requires clinician confirmation): ${domain} was elevated on screening within a ${signals.severityBand.toLowerCase()}-severity band; insufficient evidence for any diagnosis from screening alone.`,
    }));
    directions.push({
      direction: `Consider a general ${signals.specialty} evaluation independent of the above`,
      rationale:
        'Rule-based note (requires clinician confirmation): a broader clinical interview may surface presentations not captured by screening domains alone.',
    });
    return directions;
  }

  /**
   * Real model call for Outcome Intelligence. The RCI classification is
   * ALREADY COMPUTED deterministically upstream (OutcomesService) — this
   * call only narrates it and must never recompute or contradict it.
   */
  private async callOutcomeModel(signals: {
    construct: string;
    rciClassification: string;
    direction: string;
    nPoints: number;
  }): Promise<string> {
    const system =
      'You are a clinical outcomes decision-support assistant inside a licensed psychology platform. ' +
      'You ASSIST; a licensed clinician always interprets and decides. You are given an ALREADY-COMPUTED, ' +
      'deterministic Reliable Change Index (RCI) classification for one outcome construct — never ' +
      'recompute, contradict, or second-guess that classification. Write a concise (2-3 sentence) ' +
      'assistive narrative describing the trend for the clinician. Never state or imply a diagnosis. Use ' +
      'hedged, assistive language noting clinician review is required, especially with few data points.';
    const user =
      `De-identified outcome-trend signals:\n` +
      `- construct: ${signals.construct}\n` +
      `- deterministic RCI classification: ${signals.rciClassification}\n` +
      `- direction: ${signals.direction}\n` +
      `- number of data points in series: ${signals.nPoints}\n\n` +
      `Write the assistive trend narrative now.`;

    const res = await this.getClient().messages.create({
      model: this.model,
      max_tokens: 300,
      system,
      messages: [{ role: 'user', content: user }],
    });
    return this.extractText(res);
  }

  /** Deterministic, transparent rule-based narrative (NOT AI) for Outcome Intelligence. */
  private ruleBasedOutcomeNarrative(signals: {
    construct: string;
    rciClassification: string;
    direction: string;
    nPoints: number;
  }): string {
    const low = signals.nPoints < 3 ? ' Few data points are available so far; interpret with caution.' : '';
    const byClass: Record<string, string> = {
      baseline: `Only a baseline measurement is available for ${signals.construct}; no trend can be assessed yet.`,
      'unknown-reliability': `The change observed in ${signals.construct} could not be reliably classified from the data available.`,
      'no-reliable-change': `No reliable change has been detected in ${signals.construct} based on the Reliable Change Index.`,
      'reliably-improved': `${signals.construct} shows a reliably improved trend (${signals.direction}) per the Reliable Change Index.`,
      'reliably-worsened': `${signals.construct} shows a reliably worsened trend (${signals.direction}) per the Reliable Change Index.`,
    };
    const base = byClass[signals.rciClassification] ?? `The trend for ${signals.construct} is ${signals.direction}.`;
    return `Rule-based assistive note (requires clinician review): ${base}${low}`;
  }

  /**
   * Real model call for Psychometric Interpretation (CLINICIAN_ONLY). The
   * score/severity band is ALREADY COMPUTED deterministically upstream — this
   * call never re-scores or re-bands. When the underlying score used
   * synthetic/demo calibration, the response MUST carry that caveat; a
   * completion that omits it when required is treated as incomplete and
   * triggers honest rule-based degradation.
   */
  private async callPsychometricModel(signals: {
    instrumentCode: string;
    severityBand: string | null;
    theta: number | null;
    se: number | null;
    synthetic: boolean;
  }): Promise<string> {
    const system =
      'You are a psychometric interpretation decision-support assistant inside a licensed psychology ' +
      'platform, for CLINICIAN use only. You ASSIST; a licensed clinician always interprets and decides. ' +
      'You are given an ALREADY-COMPUTED, deterministic score/severity band — never re-score, re-band, or ' +
      'contradict it. Write a concise (2-3 sentence) assistive interpretation. Never state or imply a ' +
      'diagnosis. If the score was produced using synthetic/demo calibration parameters, you MUST ' +
      'explicitly state that caveat and that the score should not be relied on clinically until backed by ' +
      'a validated calibration.';
    const user =
      `De-identified score signals:\n` +
      `- instrument: ${signals.instrumentCode}\n` +
      `- severity band: ${signals.severityBand ?? 'not yet banded'}\n` +
      `- theta estimate: ${signals.theta ?? 'n/a'}\n` +
      `- standard error: ${signals.se ?? 'n/a'}\n` +
      `- synthetic/demo calibration: ${signals.synthetic ? 'yes' : 'no'}\n\n` +
      `Write the clinician-facing assistive interpretation now.`;

    const res = await this.getClient().messages.create({
      model: this.model,
      max_tokens: 350,
      system,
      messages: [{ role: 'user', content: user }],
    });
    const text = this.extractText(res);
    if (signals.synthetic && !/synthetic|demo|uncalibrated/i.test(text)) {
      throw new Error('AI score interpretation omitted required synthetic-calibration caveat');
    }
    return text;
  }

  /** Deterministic, transparent rule-based interpretation (NOT AI) for Psychometric Interpretation. */
  private ruleBasedScoreInterpretation(signals: {
    instrumentCode: string;
    severityBand: string | null;
    theta: number | null;
    se: number | null;
    synthetic: boolean;
  }): string {
    const band = signals.severityBand ? signals.severityBand.toLowerCase() : 'not yet banded';
    const precision =
      signals.se != null ? ` (standard error ${signals.se.toFixed(2)}, wider intervals suggest more caution)` : '';
    const caveat = signals.synthetic
      ? ' SYNTHETIC/DEMO CALIBRATION: this score used uncalibrated demo item parameters and must not be relied on clinically until backed by a validated calibration.'
      : '';
    return (
      `Rule-based assistive note (requires clinician confirmation): the ${signals.instrumentCode} result ` +
      `bands as ${band}${precision}. Insufficient evidence for any diagnosis from a single score alone.` +
      caveat
    );
  }

  /**
   * Real model call for Crisis context-assembly. Risk DETECTION already
   * happened deterministically elsewhere (out of scope here) — this call
   * only assembles a brief situational summary for the human responder and
   * must never re-assess or reclassify risk.
   */
  private async callRiskContextModel(signals: {
    severity: string;
    riskType: string;
    openEscalations: number;
    hasActiveSafetyPlan: boolean;
    slaDueInMinutes: number;
  }): Promise<string> {
    const system =
      'You are a crisis-response context-assembly assistant inside a licensed psychology platform. Risk ' +
      'DETECTION already happened deterministically elsewhere and is NOT your job — you are given an ' +
      'ALREADY-FLAGGED risk situation and must only assemble a brief (2-3 sentence) situational summary ' +
      'to orient the human responder faster. You never decide the response, never re-assess risk level, ' +
      "and never replace the clinician/manager's judgment — state that the human responder decides and " +
      'acts. Do not invent facts beyond the signals given.';
    const user =
      `De-identified risk-context signals (risk already flagged by deterministic detection):\n` +
      `- severity: ${signals.severity}\n` +
      `- risk type: ${signals.riskType}\n` +
      `- other open escalations for this client: ${signals.openEscalations}\n` +
      `- active safety plan on file: ${signals.hasActiveSafetyPlan ? 'yes' : 'no'}\n` +
      `- SLA time remaining: ${signals.slaDueInMinutes} minute(s)\n\n` +
      `Write the brief situational summary now.`;

    const res = await this.getClient().messages.create({
      model: this.model,
      max_tokens: 300,
      system,
      messages: [{ role: 'user', content: user }],
    });
    return this.extractText(res);
  }

  /** Deterministic, transparent rule-based summary (NOT AI) for Crisis context-assembly — advisory only. */
  private ruleBasedRiskContext(signals: {
    severity: string;
    riskType: string;
    openEscalations: number;
    hasActiveSafetyPlan: boolean;
    slaDueInMinutes: number;
  }): string {
    const escalations =
      signals.openEscalations > 0
        ? `${signals.openEscalations} other open escalation(s) for this client. `
        : 'No other open escalations for this client. ';
    const plan = signals.hasActiveSafetyPlan ? 'An active safety plan is on file.' : 'No active safety plan is on file.';
    const sla =
      signals.slaDueInMinutes <= 0
        ? 'The response SLA has elapsed.'
        : `Approximately ${signals.slaDueInMinutes} minute(s) remain within the response SLA.`;
    return (
      `Rule-based situational summary (advisory only — human responder decides and acts): a ${signals.severity.toLowerCase()}-severity ` +
      `${signals.riskType} flag is open. ${escalations}${plan} ${sla}`
    );
  }

  private async logRecommendation(input: {
    tenantId: string;
    agent: AiAgent;
    input: unknown;
    output: unknown;
    confidence: number;
    linkedEntityType: string;
    linkedEntityId: string;
  }): Promise<string | undefined> {
    try {
      const model = await this.prisma.aIModelVersion.findFirst({ orderBy: { activatedAt: 'desc' } });
      const prompt = await this.prisma.promptVersion.findFirst({
        where: { agent: input.agent },
        orderBy: { activatedAt: 'desc' },
      });
      if (!model || !prompt) return undefined;
      const inputHash = createHash('sha256').update(JSON.stringify(input.input)).digest('hex');
      const rec = await this.prisma.aIRecommendation.create({
        data: {
          tenantId: input.tenantId,
          agent: input.agent,
          inputHash,
          output: input.output as any,
          confidence: input.confidence,
          modelVersionId: model.id,
          promptVersionId: prompt.id,
          humanDecision: HumanDecision.PENDING,
          linkedEntityType: input.linkedEntityType,
          linkedEntityId: input.linkedEntityId,
        },
      });

      // Real-time layer (SP3): the dashboard's PENDING human-decision queue
      // refreshes live. Only ids/refs/status are published — the AI output
      // itself never crosses the socket (PHI minimization).
      await this.bus.publish(Events.AIRecommendationCreated, input.tenantId, {
        recommendationId: rec.id,
        agent: input.agent,
        linkedEntityType: input.linkedEntityType,
        linkedEntityId: input.linkedEntityId,
      });

      return rec.id;
    } catch (err) {
      this.logger.warn(`could not log AI recommendation: ${(err as Error).message}`);
      return undefined;
    }
  }
}
