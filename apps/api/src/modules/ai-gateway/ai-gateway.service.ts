import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import {
  AiAgent,
  HumanDecision,
  type MatchCandidate,
  type SessionNoteDraftScaffold,
  type TreatmentPlanSuggestions,
} from '@vpsy/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EventBus, Events } from '../../common/events/event-bus.service';

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
 */
@Injectable()
export class AiGatewayService {
  private readonly logger = new Logger(AiGatewayService.name);
  private readonly apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.AI_GATEWAY_API_KEY ?? '';
  private client: Anthropic | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: EventBus,
  ) {}

  /** True when a real model can be called. */
  get aiConfigured(): boolean {
    return this.apiKey.length > 0;
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
    intakeId: string;
    presentingProblem: string; // received but NEVER forwarded to the model (PHI)
    severityBand: string;
    suggestedSpecialty: string;
    riskPresent: boolean;
  }): Promise<{ summary: string; source: 'ai' | 'rule-based'; aiConfigured: boolean; recommendationId?: string }> {
    let summary: string;
    let source: 'ai' | 'rule-based';

    if (this.aiConfigured) {
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
    }

    const recommendationId = await this.logRecommendation({
      tenantId: params.tenantId,
      agent: AiAgent.INTAKE,
      input: { severityBand: params.severityBand, presentingProblem: '[redacted-phi]' },
      output: { summary, source },
      confidence: source === 'ai' ? 0.6 : 0.4,
      linkedEntityType: 'Intake',
      linkedEntityId: params.intakeId,
    });
    return { summary, source, aiConfigured: this.aiConfigured, recommendationId };
  }

  /** Manager allocation agent — rank candidates. Manager remains final authority. */
  async rankCandidates(params: {
    tenantId: string;
    clientId: string;
    candidates: MatchCandidate[];
  }): Promise<{ ranked: MatchCandidate[]; recommendationId?: string }> {
    // Deterministic scoring rationale is computed by the Matching context;
    // the AI layer explains and can re-order, but never auto-assigns.
    const ranked = [...params.candidates].sort((a, b) => b.score - a.score);
    const recommendationId = await this.logRecommendation({
      tenantId: params.tenantId,
      agent: AiAgent.ALLOCATION,
      input: { clientId: params.clientId, candidateCount: params.candidates.length },
      output: { ranking: ranked.map((c) => ({ psychologistId: c.psychologistId, score: c.score })) },
      confidence: 0.7,
      linkedEntityType: 'Assignment',
      linkedEntityId: params.clientId,
    });
    return { ranked, recommendationId };
  }

  /** Session-Note Assistant (doc 05 §3.4) — draft SCAFFOLD only, never a fabricated note. */
  async summarizeSessionNote(params: {
    tenantId: string;
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
  }> {
    const signals = {
      sessionType: params.sessionType,
      presentingThemeCodes: params.presentingThemeCodes,
      riskPresent: params.riskPresent,
      planGoalIds: params.planGoalIds,
    };
    let draft: SessionNoteDraftScaffold;
    let source: 'ai' | 'rule-based';

    if (this.aiConfigured) {
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
    }

    const recommendationId = await this.logRecommendation({
      tenantId: params.tenantId,
      agent: AiAgent.SESSION_NOTE,
      input: signals,
      output: { draft, source },
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
  }> {
    const signals = {
      severityBand: params.severityBand,
      specialty: params.specialty,
      outcomeTrend: params.outcomeTrend,
    };
    let suggestions: TreatmentPlanSuggestions;
    let source: 'ai' | 'rule-based';

    if (this.aiConfigured) {
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
    }

    const recommendationId = await this.logRecommendation({
      tenantId: params.tenantId,
      agent: AiAgent.TREATMENT_PLAN,
      input: signals,
      output: { suggestions, source },
      confidence: source === 'ai' ? 0.6 : 0.4,
      linkedEntityType: 'Client',
      linkedEntityId: params.clientId,
    });

    return { suggestions, source, aiConfigured: this.aiConfigured, recommendationId };
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
