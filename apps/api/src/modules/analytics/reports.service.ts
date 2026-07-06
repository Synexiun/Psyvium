import { Injectable } from '@nestjs/common';
import { Prisma } from '@vpsy/database';
import type { AuthPrincipal, ExecutiveReportDto, ManagerReportDto } from '@vpsy/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';

/**
 * Reports (`docs/technical/13-roadmap-and-phases.md`, context 27, Phase 6 —
 * "Operational + clinical reporting, exports"). Computes two live, tenant-
 * scoped reports directly from source-of-truth rows — nothing here is
 * pre-aggregated or cached, so the report always reflects the current state
 * of the ledger/clinical pipeline at request time.
 *
 * MONEY RULE (matches `finance/accounting.service.ts`): every revenue figure
 * is computed as a `Prisma.Decimal` and serialized as a decimal string —
 * never a JS float.
 *
 * Every report generation is persisted as a `Report` row (Group F,
 * `docs/technical/02-data-model.md`) and audited via `report.generated` —
 * reports are reads, so no domain event is published.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** EXECUTIVE + MANAGER: tenant-wide revenue, client, clinician, and outcome snapshot. */
  async getExecutiveReport(principal: AuthPrincipal): Promise<ExecutiveReportDto> {
    const tenantId = principal.tenantId;
    const zero = new Prisma.Decimal(0);

    const [paidAgg, outstandingAgg, payoutsPendingAgg, clientsTotal, clientsActive, clinicianAgg, outcomeAgg] =
      await Promise.all([
        this.prisma.invoice.aggregate({ where: { tenantId, status: 'PAID' }, _sum: { amount: true } }),
        this.prisma.invoice.aggregate({ where: { tenantId, status: 'OPEN' }, _sum: { amount: true } }),
        this.prisma.payout.aggregate({
          where: { tenantId, status: { in: ['PENDING', 'COMPUTED'] } },
          _sum: { computedAmount: true },
        }),
        this.prisma.client.count({ where: { tenantId } }),
        this.prisma.client.count({ where: { tenantId, status: 'active' } }),
        this.prisma.psychologist.aggregate({ where: { tenantId }, _count: true, _avg: { outcomeIndex: true } }),
        this.prisma.outcomeMeasure.aggregate({ where: { tenantId }, _count: true, _avg: { value: true } }),
      ]);

    const generatedAt = new Date();
    const dto: ExecutiveReportDto = {
      generatedAt: generatedAt.toISOString(),
      currency: 'USD',
      revenue: {
        paidTotal: (paidAgg._sum.amount ?? zero).toFixed(4),
        outstanding: (outstandingAgg._sum.amount ?? zero).toFixed(4),
        payoutsPending: (payoutsPendingAgg._sum.computedAmount ?? zero).toFixed(4),
      },
      clients: {
        total: clientsTotal,
        active: clientsActive,
      },
      clinicians: {
        count: clinicianAgg._count,
        avgOutcomeIndex: clinicianAgg._avg.outcomeIndex ?? 0,
      },
      outcomes: {
        measureCount: outcomeAgg._count,
        avgValue: outcomeAgg._avg.value ?? null,
      },
    };

    await this.persistAndAudit(principal, 'executive', generatedAt);
    return dto;
  }

  /** MANAGER: tenant-wide operational snapshot — intake pipeline, assignments, risk board, agenda. */
  async getManagerReport(principal: AuthPrincipal): Promise<ManagerReportDto> {
    const tenantId = principal.tenantId;
    const now = new Date();

    const [intakesTotal, severityGroups, proposedCount, approvedCount, openEscalations, openFlags, upcoming, noShows] =
      await Promise.all([
        this.prisma.intake.count({ where: { tenantId } }),
        this.prisma.screeningResult.groupBy({
          by: ['severityBand'],
          where: { tenantId },
          _count: { severityBand: true },
        }),
        this.prisma.assignment.count({ where: { tenantId, status: 'PROPOSED' } }),
        this.prisma.assignment.count({ where: { tenantId, status: 'APPROVED' } }),
        this.prisma.escalation.count({ where: { tenantId, resolvedAt: null } }),
        this.prisma.riskFlag.count({ where: { tenantId, status: { not: 'RESOLVED' } } }),
        this.prisma.appointment.count({
          where: { tenantId, startsAt: { gte: now }, status: { in: ['BOOKED', 'CONFIRMED'] } },
        }),
        this.prisma.appointment.count({ where: { tenantId, status: 'NO_SHOW' } }),
      ]);

    const bySeverity = { LOW: 0, MODERATE: 0, HIGH: 0, SEVERE: 0 };
    for (const g of severityGroups as Array<{ severityBand: keyof typeof bySeverity; _count: { severityBand: number } }>) {
      bySeverity[g.severityBand] = g._count.severityBand;
    }

    const generatedAt = now;
    const dto: ManagerReportDto = {
      generatedAt: generatedAt.toISOString(),
      intakes: {
        total: intakesTotal,
        bySeverity,
      },
      assignments: {
        proposed: proposedCount,
        approved: approvedCount,
      },
      risk: {
        openEscalations,
        openFlags,
      },
      appointments: {
        upcoming,
        noShows,
      },
    };

    await this.persistAndAudit(principal, 'manager', generatedAt);
    return dto;
  }

  /** Persists a `Report` row (Group F) and records the `report.generated` audit event. */
  private async persistAndAudit(
    principal: AuthPrincipal,
    scope: 'executive' | 'manager',
    generatedAt: Date,
  ): Promise<void> {
    const report = await this.prisma.report.create({
      data: {
        tenantId: principal.tenantId,
        type: `${scope}_report`,
        scope,
        parameters: {},
        generatedAt,
      },
    });

    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'report.generated',
      entityType: 'Report',
      entityId: report.id,
      after: { scope, generatedAt: generatedAt.toISOString() },
    });
  }
}
