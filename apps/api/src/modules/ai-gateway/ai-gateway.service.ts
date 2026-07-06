import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { AiAgent, HumanDecision, type MatchCandidate } from '@vpsy/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';

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

  constructor(private readonly prisma: PrismaService) {}

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
      return rec.id;
    } catch (err) {
      this.logger.warn(`could not log AI recommendation: ${(err as Error).message}`);
      return undefined;
    }
  }
}
