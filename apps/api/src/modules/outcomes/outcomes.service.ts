import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthPrincipal, OutcomeMeasureDto, RecordOutcomeMeasureInput } from '@vpsy/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';

type MeasureRow = {
  id: string;
  clientId: string;
  construct: string;
  value: number;
  therapeuticResponse: string;
  occurredAt: Date;
};

/**
 * Outcomes. Recording a measure returns a deterministic trend — the delta vs.
 * the client's most recent prior measure for the same construct. No AI is
 * consulted; this is a plain longitudinal comparison.
 */
@Injectable()
export class OutcomesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
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

  private toDto(measure: MeasureRow, previous: MeasureRow | null): OutcomeMeasureDto {
    const delta = previous ? Number((measure.value - previous.value).toFixed(4)) : null;
    const direction: OutcomeMeasureDto['trend']['direction'] = !previous
      ? 'baseline'
      : delta === 0
        ? 'unchanged'
        : (delta ?? 0) > 0
          ? 'increased'
          : 'decreased';

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
      },
    };
  }
}
