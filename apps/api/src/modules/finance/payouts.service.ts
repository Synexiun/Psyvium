import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@vpsy/database';
import type { AuthPrincipal, ComputePayoutInput, PayoutDto } from '@vpsy/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { EventBus, Events } from '../../common/events/event-bus.service';
import { AccountingService } from './accounting.service';

/**
 * Revenue Share / Payouts (`docs/technical/13-roadmap-and-phases.md`, context
 * 26, Phase 6 — "Clinician/clinic payouts, atomic + reconciled"). Attribution
 * is simplified per the Phase 6 contract: all PAID invoices for clients under
 * an APPROVED/ACTIVE Assignment to the psychologist, captured within the
 * period, share-multiplied by the psychologist's active Contract's
 * RevenueShareRule.pct (falling back to a sensible default when none exists).
 */

const DEFAULT_REVENUE_SHARE_PCT = 50;

type PsychologistRow = { id: string; user: { fullName: string } };
type PayoutRow = {
  id: string;
  psychologistId: string;
  periodStart: Date;
  periodEnd: Date;
  computedAmount: Prisma.Decimal;
  currency: string;
  status: string;
  createdAt: Date;
  psychologist: { user: { fullName: string } };
};

@Injectable()
export class PayoutsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly bus: EventBus,
    private readonly accounting: AccountingService,
  ) {}

  async computePayout(principal: AuthPrincipal, input: ComputePayoutInput): Promise<PayoutDto> {
    const psychologist = await this.prisma.psychologist.findFirst({
      where: { id: input.psychologistId, tenantId: principal.tenantId },
      include: { user: true },
    });
    if (!psychologist) throw new NotFoundException('Psychologist not found');

    const periodStart = new Date(input.periodStart);
    const periodEnd = new Date(input.periodEnd);

    const paidTotal = await this.sumPaidInvoicesForPsychologist(
      principal.tenantId,
      psychologist.id,
      periodStart,
      periodEnd,
    );

    const contract = await this.prisma.contract.findFirst({
      where: { tenantId: principal.tenantId, psychologistId: psychologist.id, status: 'active' },
      include: { revenueShareRules: true },
      orderBy: { effectiveFrom: 'desc' },
    });
    const rule = contract?.revenueShareRules[0];
    const pct = rule?.pct ?? DEFAULT_REVENUE_SHARE_PCT;
    // MONEY RULE: the rate (`pct`) is a Float by schema design (a percentage,
    // not a monetary amount) — it is lifted into Decimal *before* touching
    // the money value so the multiplication itself never uses JS floats.
    const computedAmount = paidTotal.times(new Prisma.Decimal(pct)).dividedBy(100);

    const payout = await this.prisma.$transaction(async (tx) => {
      const created = await tx.payout.create({
        data: {
          tenantId: principal.tenantId,
          psychologistId: psychologist.id,
          periodStart,
          periodEnd,
          computedAmount,
          currency: 'USD',
          rulesApplied: { pct, basis: rule?.basis ?? 'REVENUE', contractId: contract?.id ?? null },
          status: 'COMPUTED',
        },
      });
      if (computedAmount.greaterThan(0)) {
        await this.accounting.postBalancedEntry(tx, {
          tenantId: principal.tenantId,
          debitAccountCode: '5000', // Clinician Costs
          creditAccountCode: '2000', // Clinician Payable
          amount: computedAmount,
          memo: `Payout ${created.id} — ${psychologist.id}`,
          payoutId: created.id,
        });
      }
      return created;
    });

    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'payout.computed',
      entityType: 'Payout',
      entityId: payout.id,
      after: {
        psychologistId: psychologist.id,
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        computedAmount: computedAmount.toFixed(4),
        pct,
      },
    });
    await this.bus.publish(Events.PayoutComputed, principal.tenantId, {
      payoutId: payout.id,
      psychologistId: psychologist.id,
      computedAmount: computedAmount.toFixed(4),
    });

    return this.toPayoutDto({ ...payout, psychologist } as unknown as PayoutRow);
  }

  async listPayouts(principal: AuthPrincipal): Promise<PayoutDto[]> {
    const payouts = await this.prisma.payout.findMany({
      where: { tenantId: principal.tenantId },
      include: { psychologist: { include: { user: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return payouts.map((p) => this.toPayoutDto(p as unknown as PayoutRow));
  }

  /**
   * Simplified attribution: sum the `amount` of PAID invoices for clients
   * under an APPROVED/ACTIVE Assignment to this psychologist, whose payment
   * was captured within [periodStart, periodEnd].
   */
  private async sumPaidInvoicesForPsychologist(
    tenantId: string,
    psychologistId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<Prisma.Decimal> {
    const assignments = await this.prisma.assignment.findMany({
      where: { tenantId, psychologistId, status: { in: ['APPROVED', 'ACTIVE'] } },
      select: { clientId: true },
    });
    const clientIds = [...new Set(assignments.map((a) => a.clientId))];
    if (clientIds.length === 0) return new Prisma.Decimal(0);

    const paidInvoices = await this.prisma.invoice.findMany({
      where: {
        tenantId,
        clientId: { in: clientIds },
        status: 'PAID',
        payments: { some: { capturedAt: { gte: periodStart, lte: periodEnd } } },
      },
      select: { amount: true },
    });

    return paidInvoices.reduce((sum, inv) => sum.plus(inv.amount), new Prisma.Decimal(0));
  }

  private toPayoutDto(payout: PayoutRow): PayoutDto {
    return {
      id: payout.id,
      psychologistId: payout.psychologistId,
      psychologistName: payout.psychologist.user.fullName,
      periodStart: payout.periodStart.toISOString(),
      periodEnd: payout.periodEnd.toISOString(),
      computedAmount: payout.computedAmount.toFixed(4),
      currency: payout.currency,
      status: payout.status as PayoutDto['status'],
      createdAt: payout.createdAt.toISOString(),
    };
  }
}
