import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@vpsy/database';
import type { AuthPrincipal, ComputePayoutInput, DecidePayoutInput, PayoutDto } from '@vpsy/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { EventBus, Events } from '../../common/events/event-bus.service';
import { AccountingService } from './accounting.service';

/**
 * Revenue Share / Payouts (`docs/technical/13-roadmap-and-phases.md`, context
 * 26, Phase 6 — "Clinician/clinic payouts, atomic + reconciled"; and
 * `docs/business/05-monetization-and-contracts.md` §2 "Composite contracts" /
 * §8 "Contract-Engine Design Requirements"). Attribution is simplified per
 * the Phase 6 contract: all PAID invoices for clients under an
 * APPROVED/ACTIVE Assignment to the psychologist, captured within the
 * period, form the revenue base.
 *
 * That revenue base is then **composed** across every stacked share on the
 * psychologist's active Contract's `RevenueShareRule` row(s) — NOT inventing
 * columns on `Contract` itself. Schema source of truth
 * (`packages/database/prisma/schema.prisma` → `RevenueShareRule`):
 *   - `pct`                 clinician base share
 *   - `seniorOverridePct`   senior-override entitlement of *this* psychologist
 *   - `supervisorSharePct`  amount owed to `Contract.supervisorId` (if set)
 *   - `clinicSharePct`      clinic-retained margin (recorded in rulesApplied only)
 *   - `referralSharePct`    external referral share
 *   - `countryRules`        per-country overrides keyed by tenant ISO code
 * Honoring those fields (rather than a flat single-percentage read) is what
 * makes the "12+ models, composable" claim in the business docs real.
 *
 * Bookkeeping model for a single `computePayout` call:
 *  - The **clinician's own Payout** (`computedAmount`, the DTO field) is the
 *    clinician's base share *plus* their senior-override share — both are
 *    entitlements of the psychologist this Contract belongs to.
 *  - The **supervisor's share** and **referral share** are amounts owed to a
 *    *different* party (the contract's `supervisorId`, or an external
 *    referral source); they are posted to the ledger as their own balanced
 *    Clinician-Payable entries (tagged to this Payout for traceability) but
 *    are *not* added into this psychologist's own `computedAmount` — no new
 *    Payout row is created for them since we don't have a reliable
 *    counterpart identity/Payout-per-payee model in scope here.
 *  - The **clinic's share** is revenue the clinic simply retains — it was
 *    already recognized as revenue when the invoice was paid, so no further
 *    ledger movement is needed; it is recorded in `rulesApplied` only, for
 *    transparency.
 *  - Every dollar of the stack — clinician, senior override, supervisor,
 *    clinic, referral — is broken out and preserved verbatim in the
 *    `rulesApplied` Json column so the clinician's itemized statement
 *    (design requirement in `05-monetization-and-contracts.md` §8) can be
 *    rendered from that single record without a contract/schema change.
 */

const DEFAULT_REVENUE_SHARE_PCT = 50;

/** The five stackable share percentages a RevenueShareRule composes. */
type ShareBreakdown = {
  pct: number;
  seniorOverridePct: number;
  supervisorSharePct: number;
  clinicSharePct: number;
  referralSharePct: number;
};

type RevenueShareRuleLike = {
  basis?: string;
  pct: number;
  seniorOverridePct?: number | null;
  supervisorSharePct?: number | null;
  clinicSharePct?: number | null;
  referralSharePct?: number | null;
  countryRules?: Prisma.JsonValue | null;
};

type PayoutRow = {
  id: string;
  psychologistId: string;
  periodStart: Date;
  periodEnd: Date;
  computedAmount: Prisma.Decimal;
  currency: string;
  status: string;
  computedBy?: string | null;
  approvedBy?: string | null;
  approvedAt?: Date | null;
  decisionNote?: string | null;
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

    const countryCode = await this.resolveTenantCountryCode(principal.tenantId, rule);
    const breakdown = this.resolveShareBreakdown(rule, countryCode);

    // MONEY RULE: every rate above is a Float by schema design (a percentage,
    // not a monetary amount) — each is lifted into Decimal *before* touching
    // the money value so every multiplication happens in Decimal space, never
    // JS floats.
    const clinicianOwnShare = this.applyPct(paidTotal, breakdown.pct);
    const seniorOverrideShare = this.applyPct(paidTotal, breakdown.seniorOverridePct);
    const supervisorShare = this.applyPct(paidTotal, breakdown.supervisorSharePct);
    const clinicShare = this.applyPct(paidTotal, breakdown.clinicSharePct);
    const referralShare = this.applyPct(paidTotal, breakdown.referralSharePct);

    // The clinician's own Payout is their base share plus any senior-override
    // share — both are entitlements of *this* contract's psychologist.
    const computedAmount = clinicianOwnShare.plus(seniorOverrideShare);

    const rulesApplied = {
      basis: rule?.basis ?? 'REVENUE',
      contractId: contract?.id ?? null,
      countryCode,
      paidTotal: paidTotal.toFixed(4),
      breakdown,
      shares: {
        clinician: clinicianOwnShare.toFixed(4),
        seniorOverride: seniorOverrideShare.toFixed(4),
        supervisor: supervisorShare.toFixed(4),
        clinic: clinicShare.toFixed(4),
        referral: referralShare.toFixed(4),
      },
    };

    const payout = await this.prisma.$transaction(async (tx) => {
      const created = await tx.payout.create({
        data: {
          tenantId: principal.tenantId,
          psychologistId: psychologist.id,
          periodStart,
          periodEnd,
          computedAmount,
          currency: 'USD',
          rulesApplied,
          status: 'COMPUTED',
          // Dual control: the approver must be a DIFFERENT user (decidePayout).
          computedBy: principal.userId,
        },
      });
      if (computedAmount.greaterThan(0)) {
        await this.accounting.postBalancedEntry(tx, {
          tenantId: principal.tenantId,
          debitAccountCode: '5000', // Clinician Costs
          creditAccountCode: '2000', // Clinician Payable
          amount: computedAmount,
          memo: `Payout ${created.id} — clinician share (base ${breakdown.pct}% + senior override ${breakdown.seniorOverridePct}%) — ${psychologist.id}`,
          payoutId: created.id,
        });
      }
      if (supervisorShare.greaterThan(0)) {
        await this.accounting.postBalancedEntry(tx, {
          tenantId: principal.tenantId,
          debitAccountCode: '5000', // Clinician Costs
          creditAccountCode: '2000', // Clinician Payable (owed to the supervisor, not the supervisee)
          amount: supervisorShare,
          memo: `Payout ${created.id} — supervisor share (${breakdown.supervisorSharePct}%) — supervisor ${contract?.supervisorId ?? 'unassigned'}`,
          payoutId: created.id,
        });
      }
      if (referralShare.greaterThan(0)) {
        await this.accounting.postBalancedEntry(tx, {
          tenantId: principal.tenantId,
          debitAccountCode: '5000', // Clinician Costs
          creditAccountCode: '2000', // Clinician Payable (owed to the referral source)
          amount: referralShare,
          memo: `Payout ${created.id} — referral share (${breakdown.referralSharePct}%)`,
          payoutId: created.id,
        });
      }
      // clinicShare is retained margin: it was already recognized as revenue
      // when the invoice was paid, so it needs no further ledger movement —
      // it is preserved in `rulesApplied` above for itemized transparency.
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
        rulesApplied,
      },
    });
    await this.bus.publish(Events.PayoutComputed, principal.tenantId, {
      payoutId: payout.id,
      psychologistId: psychologist.id,
      computedAmount: computedAmount.toFixed(4),
    });

    return this.toPayoutDto({ ...payout, psychologist } as unknown as PayoutRow);
  }

  /**
   * Dual-control decision gate (audit G2 "Payouts: approval"): a COMPUTED
   * payout is approved or rejected by a human — and the approver must be a
   * DIFFERENT user than the one who computed it (no self-approval of one's
   * own computation run). Compare-and-swap so two concurrent decisions
   * cannot both land. Approval is what a future bank-rail disbursement
   * requires; rejection needs a note so the statement trail explains itself.
   */
  async decidePayout(principal: AuthPrincipal, payoutId: string, input: DecidePayoutInput): Promise<PayoutDto> {
    const payout = await this.prisma.payout.findFirst({
      where: { id: payoutId, tenantId: principal.tenantId, deletedAt: null },
      include: { psychologist: { include: { user: true } } },
    });
    if (!payout) throw new NotFoundException('Payout not found');
    if (payout.status !== 'COMPUTED') {
      throw new ConflictException(`Only COMPUTED payouts can be decided (current status=${payout.status})`);
    }

    // Dual control — even for APPROVED-only; a rejection may be self-issued
    // (walking back your own computation is safe; blessing it is not).
    if (input.decision === 'APPROVED' && payout.computedBy === principal.userId) {
      await this.audit.record({
        tenantId: principal.tenantId,
        actorId: principal.userId,
        action: 'payout.self_approval_refused',
        entityType: 'Payout',
        entityId: payoutId,
        after: { computedBy: payout.computedBy },
        critical: true,
      });
      throw new ForbiddenException(
        'Dual control: a payout cannot be approved by the same user who computed it.',
      );
    }

    const claimed = await this.prisma.payout.updateMany({
      where: { id: payoutId, tenantId: principal.tenantId, status: 'COMPUTED' },
      data: {
        status: input.decision,
        approvedBy: input.decision === 'APPROVED' ? principal.userId : null,
        approvedAt: input.decision === 'APPROVED' ? new Date() : null,
        decisionNote: input.note ?? null,
      },
    });
    if (claimed.count !== 1) {
      throw new ConflictException('Payout was already decided by another action');
    }

    const updated = await this.prisma.payout.findFirstOrThrow({
      where: { id: payoutId, tenantId: principal.tenantId },
      include: { psychologist: { include: { user: true } } },
    });

    // Money-governance event: never silently lost.
    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: input.decision === 'APPROVED' ? 'payout.approved' : 'payout.rejected',
      entityType: 'Payout',
      entityId: payoutId,
      before: { status: 'COMPUTED', computedBy: payout.computedBy },
      after: {
        status: updated.status,
        amount: updated.computedAmount.toFixed(4),
        ...(input.note ? { note: input.note } : {}),
      },
      critical: true,
    });
    await this.bus.publish(
      input.decision === 'APPROVED' ? Events.PayoutApproved : Events.PayoutRejected,
      principal.tenantId,
      { payoutId, psychologistId: updated.psychologistId, amount: updated.computedAmount.toFixed(4) },
    );

    return this.toPayoutDto(updated as unknown as PayoutRow);
  }

  /**
   * Disbursement precondition used by the controller: the payout must exist
   * and be APPROVED before the (still honest-503) bank-rail step is even
   * considered — the dual-control gate orders ahead of the adapter seam.
   */
  async assertDisbursable(principal: AuthPrincipal, payoutId: string): Promise<void> {
    const payout = await this.prisma.payout.findFirst({
      where: { id: payoutId, tenantId: principal.tenantId, deletedAt: null },
      select: { status: true },
    });
    if (!payout) throw new NotFoundException('Payout not found');
    if (payout.status !== 'APPROVED') {
      throw new ConflictException(
        `Payout must be APPROVED before disbursement (current status=${payout.status}). ` +
          'Dual control: approval by a different user than the computer is required first.',
      );
    }
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
   * Lifts a percentage rate into Decimal space before it ever touches a
   * money value, so the multiplication itself never runs through JS floats.
   */
  private applyPct(amount: Prisma.Decimal, pct: number): Prisma.Decimal {
    return amount.times(new Prisma.Decimal(pct)).dividedBy(100);
  }

  /**
   * Composes the full stacked breakdown from a RevenueShareRule (or the
   * flat default when no rule/contract exists), applying a country override
   * from `countryRules` where the tenant's country matches. Fails safe:
   * throws a clear `BadRequestException` rather than posting a mis-computed
   * payout when the rule is malformed or the stack exceeds 100%.
   */
  private resolveShareBreakdown(
    rule: RevenueShareRuleLike | undefined,
    countryCode: string | null,
  ): ShareBreakdown {
    const base: ShareBreakdown = {
      pct: rule?.pct ?? DEFAULT_REVENUE_SHARE_PCT,
      seniorOverridePct: rule?.seniorOverridePct ?? 0,
      supervisorSharePct: rule?.supervisorSharePct ?? 0,
      clinicSharePct: rule?.clinicSharePct ?? 0,
      referralSharePct: rule?.referralSharePct ?? 0,
    };

    const override = this.extractCountryOverride(rule?.countryRules, countryCode);
    const merged: ShareBreakdown = {
      pct: override?.pct ?? base.pct,
      seniorOverridePct: override?.seniorOverridePct ?? base.seniorOverridePct,
      supervisorSharePct: override?.supervisorSharePct ?? base.supervisorSharePct,
      clinicSharePct: override?.clinicSharePct ?? base.clinicSharePct,
      referralSharePct: override?.referralSharePct ?? base.referralSharePct,
    };

    for (const [key, value] of Object.entries(merged) as [keyof ShareBreakdown, unknown][]) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new BadRequestException(
          `Malformed RevenueShareRule: "${key}" must be a non-negative number (got ${JSON.stringify(value)})`,
        );
      }
    }

    const total =
      merged.pct + merged.seniorOverridePct + merged.supervisorSharePct + merged.clinicSharePct + merged.referralSharePct;
    if (total > 100) {
      throw new BadRequestException(
        `Malformed RevenueShareRule: stacked shares total ${total}% exceeds 100% ` +
          `(clinician ${merged.pct}% + senior override ${merged.seniorOverridePct}% + ` +
          `supervisor ${merged.supervisorSharePct}% + clinic ${merged.clinicSharePct}% + ` +
          `referral ${merged.referralSharePct}%)`,
      );
    }

    return merged;
  }

  /** Reads a per-country override from `RevenueShareRule.countryRules`, if present and well-formed. */
  private extractCountryOverride(
    countryRules: Prisma.JsonValue | null | undefined,
    countryCode: string | null,
  ): Partial<ShareBreakdown> | null {
    if (!countryCode || countryRules == null) return null;
    if (typeof countryRules !== 'object' || Array.isArray(countryRules)) return null;
    const entry = (countryRules as Record<string, unknown>)[countryCode];
    if (entry == null) return null;
    if (typeof entry !== 'object' || Array.isArray(entry)) {
      throw new BadRequestException(
        `Malformed RevenueShareRule.countryRules["${countryCode}"]: expected an object of share overrides`,
      );
    }
    return entry as Partial<ShareBreakdown>;
  }

  /**
   * Only resolves the tenant's country when the rule actually carries a
   * `countryRules` override — avoids an unnecessary lookup for the (common)
   * flat/no-country-rule case.
   */
  private async resolveTenantCountryCode(
    tenantId: string,
    rule: RevenueShareRuleLike | undefined,
  ): Promise<string | null> {
    const countryRules = rule?.countryRules;
    const hasCountryRules =
      countryRules != null &&
      typeof countryRules === 'object' &&
      !Array.isArray(countryRules) &&
      Object.keys(countryRules as object).length > 0;
    if (!hasCountryRules) return null;

    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { countryCode: true } });
    return tenant?.countryCode ?? null;
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
      computedBy: payout.computedBy ?? null,
      approvedBy: payout.approvedBy ?? null,
      approvedAt: payout.approvedAt ? payout.approvedAt.toISOString() : null,
      decisionNote: payout.decisionNote ?? null,
      createdAt: payout.createdAt.toISOString(),
    };
  }
}
