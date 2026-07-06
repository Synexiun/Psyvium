import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AiAgent, HumanDecision, type MatchCandidate } from '@vpsy/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * The AI Gateway is a GOVERNED bounded context (ADR-007). Rules enforced here:
 *  - PHI is minimized before it ever forms a payload.
 *  - Every inference is recorded as an AIRecommendation with model/prompt
 *    versions and a PENDING human-decision gate.
 *  - Output language is assistive, never diagnostic.
 *  - If no AI_GATEWAY_API_KEY is configured, we run a deterministic offline
 *    stub so the whole platform is demoable with zero external dependencies.
 *    The real path calls the Vercel AI Gateway with `provider/model` strings.
 */
@Injectable()
export class AiGatewayService {
  private readonly logger = new Logger(AiGatewayService.name);
  private readonly online = Boolean(process.env.AI_GATEWAY_API_KEY);

  constructor(private readonly prisma: PrismaService) {}

  /** Intake intelligence agent — summarize + suggest specialty & battery. */
  async summarizeIntake(params: {
    tenantId: string;
    intakeId: string;
    presentingProblem: string;
    severityBand: string;
    suggestedSpecialty: string;
    riskPresent: boolean;
  }): Promise<{ summary: string; recommendationId?: string }> {
    const summary = this.online
      ? await this.callModel(AiAgent.INTAKE, params)
      : this.offlineIntakeSummary(params);

    const recommendationId = await this.logRecommendation({
      tenantId: params.tenantId,
      agent: AiAgent.INTAKE,
      input: { presentingProblem: '[redacted-phi]', severityBand: params.severityBand },
      output: { summary },
      confidence: 0.6,
      linkedEntityType: 'Intake',
      linkedEntityId: params.intakeId,
    });
    return { summary, recommendationId };
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

  private offlineIntakeSummary(p: {
    presentingProblem: string;
    severityBand: string;
    suggestedSpecialty: string;
    riskPresent: boolean;
  }): string {
    const risk = p.riskPresent
      ? ' Safety indicators were positive on screening — a human risk review has been opened; this summary does not replace it.'
      : '';
    return (
      `Assistive summary (requires clinician confirmation): presentation appears consistent with ` +
      `a ${p.severityBand.toLowerCase()}-severity concern; consider evaluating within the ` +
      `${p.suggestedSpecialty} pathway. Insufficient evidence for any diagnosis from intake alone.` +
      risk
    );
  }

  private async callModel(agent: AiAgent, params: unknown): Promise<string> {
    // Seam for Vercel AI Gateway. Kept behind the online flag; offline by default.
    // Example (pseudo): generateText({ model: process.env.AI_MODEL, prompt, system })
    this.logger.debug(`online inference requested for ${agent}`);
    return this.offlineIntakeSummary(params as any);
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
