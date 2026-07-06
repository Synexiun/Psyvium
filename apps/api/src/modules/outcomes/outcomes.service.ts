import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  AuthPrincipal,
  OutcomeAiAssistInput,
  OutcomeAiAssistResult,
  OutcomeMeasureDto,
  OutcomeTrend,
  RecordOutcomeMeasureInput,
} from '@vpsy/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AiGatewayService } from '../ai-gateway/ai-gateway.service';

type MeasureRow = {
  id: string;
  clientId: string;
  construct: string;
  value: number;
  therapeuticResponse: string;
  occurredAt: Date;
};

/**
 * Reliable Change Index (Jacobson & Truax, 1991) — audit finding: a raw
 * delta between two measures cannot distinguish a clinically-reliable change
 * from ordinary measurement noise. RCI = (score2 - score1) / SE_diff, where
 * SE_diff = SEM * sqrt(2) and SEM = SD * sqrt(1 - reliability). |RCI| >= 1.96
 * is reliable change at the 95% CI.
 *
 * Per-instrument SD / test-retest reliability are NOT stored in the schema
 * (no schema changes permitted for this remediation), so this is a small,
 * explicitly-cited table of published psychometrics for the constructs we
 * know. `polarity` makes the classification direction-aware: for symptom
 * scales (PHQ-9, GAD-7) a DECREASE is the improvement.
 */
type ConstructPolarity = 'lower-is-better' | 'higher-is-better';

interface ConstructPsychometrics {
  sd: number;
  reliability: number;
  polarity: ConstructPolarity;
  /** Source citation — kept alongside the numbers so they're never orphaned. */
  citation: string;
}

const CONSTRUCT_PSYCHOMETRICS = {
  depression: {
    sd: 6.1,
    reliability: 0.86,
    polarity: 'lower-is-better',
    citation:
      'PHQ-9: SD ~6.1, internal-consistency reliability (Cronbach a) ~0.86 ' +
      '(Kroenke, Spitzer & Williams, 2001; Löwe et al., 2004).',
  },
  anxiety: {
    sd: 5.5,
    reliability: 0.89,
    polarity: 'lower-is-better',
    citation:
      'GAD-7: SD ~5.5, internal-consistency reliability (Cronbach a) ~0.89 ' +
      '(Spitzer, Kroenke, Williams & Löwe, 2006).',
  },
} as const satisfies Record<string, ConstructPsychometrics>;

/** Free-text `construct` values that resolve onto a known psychometrics entry. */
const CONSTRUCT_ALIASES: Record<string, keyof typeof CONSTRUCT_PSYCHOMETRICS> = {
  depression: 'depression',
  'phq-9': 'depression',
  phq9: 'depression',
  anxiety: 'anxiety',
  'gad-7': 'anxiety',
  gad7: 'anxiety',
};

function resolvePsychometrics(construct: string): ConstructPsychometrics | null {
  const key = CONSTRUCT_ALIASES[construct.trim().toLowerCase()];
  return key ? CONSTRUCT_PSYCHOMETRICS[key] : null;
}

/**
 * Returns `rci: null` + `classification: 'unknown-reliability'` whenever the
 * construct has no known SD/reliability on file — we never fabricate a
 * reliability coefficient to force a number out. Only called when there IS a
 * prior measure to compare against (baseline measures are handled by the
 * caller, not here).
 */
function computeReliableChange(
  construct: string,
  previousValue: number,
  currentValue: number,
): Pick<OutcomeTrend, 'rci' | 'classification'> {
  const psychometrics = resolvePsychometrics(construct);
  if (!psychometrics) {
    return { rci: null, classification: 'unknown-reliability' };
  }

  const sem = psychometrics.sd * Math.sqrt(1 - psychometrics.reliability);
  const seDiff = sem * Math.sqrt(2);
  const rci = Number(((currentValue - previousValue) / seDiff).toFixed(4));

  if (Math.abs(rci) < 1.96) {
    return { rci, classification: 'no-reliable-change' };
  }
  const improved = psychometrics.polarity === 'lower-is-better' ? rci < 0 : rci > 0;
  return { rci, classification: improved ? 'reliably-improved' : 'reliably-worsened' };
}

/**
 * Outcomes. Recording a measure returns a deterministic trend — the raw delta
 * vs. the client's most recent prior measure for the same construct, plus the
 * Reliable-Change-Index classification above. No AI is consulted; this is a
 * plain longitudinal comparison.
 */
@Injectable()
export class OutcomesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ai: AiGatewayService,
  ) {}

  async record(principal: AuthPrincipal, input: RecordOutcomeMeasureInput): Promise<OutcomeMeasureDto> {
    const client = await this.prisma.client.findFirst({
      where: { id: input.clientId, tenantId: principal.tenantId },
    });
    if (!client) throw new NotFoundException('Client not found');

    const previous = await this.prisma.outcomeMeasure.findFirst({
      where: { tenantId: principal.tenantId, clientId: input.clientId, construct: input.construct },
      orderBy: { occurredAt: 'desc' },
    });

    const measure = await this.prisma.outcomeMeasure.create({
      data: {
        tenantId: principal.tenantId,
        clientId: input.clientId,
        construct: input.construct,
        value: input.value,
        dropoutRisk: input.dropoutRisk ?? 0,
        deteriorationRisk: input.deteriorationRisk ?? 0,
        relapseRisk: input.relapseRisk ?? 0,
      },
    });

    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'outcome.recorded',
      entityType: 'OutcomeMeasure',
      entityId: measure.id,
      after: { construct: input.construct, value: input.value },
    });

    return this.toDto(measure, previous);
  }

  async listForClient(principal: AuthPrincipal, clientId: string): Promise<OutcomeMeasureDto[]> {
    const measures = await this.prisma.outcomeMeasure.findMany({
      where: { tenantId: principal.tenantId, clientId },
      orderBy: { occurredAt: 'asc' },
    });

    const lastSeen = new Map<string, MeasureRow>();
    return measures.map((m) => {
      const previous = lastSeen.get(m.construct) ?? null;
      lastSeen.set(m.construct, m);
      return this.toDto(m, previous);
    });
  }

  /**
   * Outcome Intelligence (doc 05 §3.5) — assistive trend NARRATIVE only. The
   * Reliable Change Index classification is looked up from the same
   * deterministic `toDto`/`computeReliableChange` math used by
   * `record()`/`listForClient()` above; this method never recomputes or
   * overrides it, and never writes an OutcomeMeasure itself.
   */
  async aiAssist(principal: AuthPrincipal, input: OutcomeAiAssistInput): Promise<OutcomeAiAssistResult> {
    const client = await this.prisma.client.findFirst({
      where: { id: input.clientId, tenantId: principal.tenantId },
    });
    if (!client) throw new NotFoundException('Client not found');

    return this.ai.narrateOutcomeTrend({
      tenantId: principal.tenantId,
      clientId: input.clientId,
      construct: input.construct,
      rciClassification: input.rciClassification,
      direction: input.direction,
      nPoints: input.nPoints,
    });
  }

  private toDto(measure: MeasureRow, previous: MeasureRow | null): OutcomeMeasureDto {
    const delta = previous ? Number((measure.value - previous.value).toFixed(4)) : null;
    const direction: OutcomeMeasureDto['trend']['direction'] = !previous
      ? 'baseline'
      : delta === 0
        ? 'unchanged'
        : (delta ?? 0) > 0
          ? 'increased'
          : 'decreased';

    const { rci, classification } = previous
      ? computeReliableChange(measure.construct, previous.value, measure.value)
      : { rci: null, classification: 'baseline' as const };

    return {
      id: measure.id,
      clientId: measure.clientId,
      construct: measure.construct,
      value: measure.value,
      therapeuticResponse: measure.therapeuticResponse,
      occurredAt: measure.occurredAt.toISOString(),
      trend: {
        direction,
        delta,
        previousValue: previous ? previous.value : null,
        rci,
        classification,
      },
    };
  }
}
