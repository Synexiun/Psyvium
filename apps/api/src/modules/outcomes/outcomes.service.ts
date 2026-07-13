import { Injectable, NotFoundException } from '@nestjs/common';
import {
  computeEscalationSlaDueAt,
  RiskSource,
  RiskType,
  SeverityBand,
  type AuthPrincipal,
  type OutcomeAiAssistInput,
  type OutcomeAiAssistResult,
  type OutcomeMeasureDto,
  type RecordOutcomeMeasureInput,
} from '@vpsy/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { EventBus, Events } from '../../common/events/event-bus.service';
import {
  ALGORITHM_VERSIONS,
  computeReliableChangeIndex,
  isSeverityEscalation,
  stampAlgorithm,
} from '../../common/clinical';
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
 * Outcomes. Recording a measure returns a deterministic trend — the raw delta
 * vs. the client's most recent prior measure for the same construct, plus the
 * Reliable-Change-Index classification (Jacobson & Truax, 1991) from the
 * shared clinical psychometrics registry. No AI is consulted; this is a
 * plain longitudinal comparison.
 */
@Injectable()
export class OutcomesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ai: AiGatewayService,
    private readonly bus: EventBus,
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

    const dto = this.toDto(measure, previous);

    // Reliable clinical deterioration must surface on the risk board — never silent.
    if (dto.trend.classification === 'reliably-worsened') {
      await this.raiseDeteriorationRisk(principal, input, measure.id, dto);
    }

    const rciStamp = stampAlgorithm(
      'outcomes.rci_jacobson_truax',
      ALGORITHM_VERSIONS.rci,
      'Jacobson & Truax (1991) Reliable Change Index; construct psychometrics from clinical registry.',
    );

    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'outcome.recorded',
      entityType: 'OutcomeMeasure',
      entityId: measure.id,
      after: {
        construct: input.construct,
        value: input.value,
        classification: dto.trend.classification,
        rci: dto.trend.rci,
        algorithm: rciStamp,
      },
      critical: dto.trend.classification === 'reliably-worsened',
    });

    return dto;
  }

  private async raiseDeteriorationRisk(
    principal: AuthPrincipal,
    input: RecordOutcomeMeasureInput,
    measureId: string,
    dto: OutcomeMeasureDto,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const openedAt = new Date();
      const rf = await tx.riskFlag.create({
        data: {
          tenantId: principal.tenantId,
          clientId: input.clientId,
          type: RiskType.CLINICAL_DETERIORATION,
          severity: SeverityBand.HIGH,
          source: RiskSource.CLINICIAN,
          evidence: `Reliable clinical deterioration on ${input.construct} (RCI=${dto.trend.rci ?? 'n/a'})`,
          evidenceDetail: {
            construct: input.construct,
            value: input.value,
            rci: dto.trend.rci,
            classification: dto.trend.classification,
            measureId,
          } as any,
          status: 'ESCALATED',
        },
      });
      const escalation = await tx.escalation.create({
        data: {
          tenantId: principal.tenantId,
          riskFlagId: rf.id,
          openedAt,
          slaDueAt: computeEscalationSlaDueAt(SeverityBand.HIGH, openedAt),
        },
      });

      const client = await tx.client.findFirst({
        where: { id: input.clientId },
        select: { riskLevel: true },
      });
      if (isSeverityEscalation(client?.riskLevel, SeverityBand.HIGH)) {
        await tx.client.update({
          where: { id: input.clientId },
          data: { riskLevel: SeverityBand.HIGH },
        });
      }

      await this.bus.publishDurable(tx, Events.RiskFlagRaised, principal.tenantId, {
        riskFlagId: rf.id,
        clientId: input.clientId,
      });
      await this.bus.publishDurable(tx, Events.EscalationRaised, principal.tenantId, {
        escalationId: escalation.id,
        riskFlagId: rf.id,
        clientId: input.clientId,
      });
    });
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
   * deterministic `toDto`/`computeReliableChangeIndex` math used by
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

    const rciResult = previous
      ? computeReliableChangeIndex(measure.construct, previous.value, measure.value)
      : null;

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
        rci: rciResult?.rci ?? null,
        classification: rciResult?.classification ?? 'baseline',
      },
    };
  }
}
