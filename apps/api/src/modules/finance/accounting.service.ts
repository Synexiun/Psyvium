import { Injectable } from '@nestjs/common';
import { Prisma } from '@vpsy/database';
import type { FinanceSummaryDto, LedgerEntryDto } from '@vpsy/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Accounting (`docs/technical/13-roadmap-and-phases.md`, context 25, Phase 6 —
 * "Ledger, NUMERIC money, financial reporting integrity"). Owns the chart of
 * accounts and the double-entry posting primitive every other Finance
 * sub-service (Payments, Payouts) calls from *inside its own* `$transaction`
 * so the money movement and the ledger entries commit atomically together.
 *
 * MONEY RULE: every amount here is a `Prisma.Decimal` — never a JS float.
 * Money serializes to the wire as a string (`.toFixed(4)`), never a number.
 */

type Tx = Prisma.TransactionClient;

/** Seeded chart of accounts (also self-healed here if a tenant is missing a node). */
export const CHART_OF_ACCOUNTS: Record<string, { name: string; type: string }> = {
  '1000': { name: 'Cash', type: 'asset' },
  '1100': { name: 'Accounts Receivable', type: 'asset' },
  '2000': { name: 'Clinician Payable', type: 'liability' },
  '4000': { name: 'Service Revenue', type: 'revenue' },
  '5000': { name: 'Clinician Costs', type: 'expense' },
};

type LedgerAccountRow = { id: string; code: string; name: string };
type LedgerEntryRow = {
  id: string;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
  memo: string | null;
  postedAt: Date;
  ledgerAccount: { code: string; name: string };
};

@Injectable()
export class AccountingService {
  constructor(private readonly prisma: PrismaService) {}

  /** Idempotently resolves (creating if absent) a chart-of-accounts node by code. */
  async resolveAccount(tx: Tx, tenantId: string, code: string): Promise<LedgerAccountRow> {
    const known = CHART_OF_ACCOUNTS[code];
    if (!known) throw new Error(`Unknown ledger account code: ${code}`);
    return tx.ledgerAccount.upsert({
      where: { tenantId_code: { tenantId, code } },
      update: {},
      create: { tenantId, code, name: known.name, type: known.type },
    });
  }

  /**
   * Posts a **balanced** double-entry pair (one debit line + one credit line,
   * same `amount`) inside the caller's transaction. Never call this outside
   * an existing `$transaction` for a money-moving operation — the ledger
   * write must commit or roll back atomically with the Payment/Payout it
   * documents.
   */
  async postBalancedEntry(
    tx: Tx,
    params: {
      tenantId: string;
      debitAccountCode: string;
      creditAccountCode: string;
      amount: Prisma.Decimal;
      memo?: string;
      invoiceId?: string;
      payoutId?: string;
    },
  ): Promise<void> {
    const { tenantId, debitAccountCode, creditAccountCode, amount, memo, invoiceId, payoutId } = params;
    const [debitAccount, creditAccount] = await Promise.all([
      this.resolveAccount(tx, tenantId, debitAccountCode),
      this.resolveAccount(tx, tenantId, creditAccountCode),
    ]);
    const zero = new Prisma.Decimal(0);

    await tx.accountingEntry.create({
      data: { tenantId, ledgerAccountId: debitAccount.id, debit: amount, credit: zero, invoiceId, payoutId, memo },
    });
    await tx.accountingEntry.create({
      data: { tenantId, ledgerAccountId: creditAccount.id, debit: zero, credit: amount, invoiceId, payoutId, memo },
    });
  }

  /** Recent ledger entries, newest first, joined to the account code/name. */
  async listLedger(tenantId: string): Promise<LedgerEntryDto[]> {
    const entries = await this.prisma.accountingEntry.findMany({
      where: { tenantId },
      include: { ledgerAccount: true },
      orderBy: { postedAt: 'desc' },
      take: 200,
    });
    return entries.map((e) => this.toLedgerEntryDto(e as unknown as LedgerEntryRow));
  }

  /** Tenant-wide finance snapshot — every money field a Decimal-computed string. */
  async getSummary(tenantId: string): Promise<FinanceSummaryDto> {
    const [openInvoiceCount, paidAgg, outstandingAgg, payoutsPendingAgg] = await Promise.all([
      this.prisma.invoice.count({ where: { tenantId, status: 'OPEN' } }),
      this.prisma.invoice.aggregate({ where: { tenantId, status: 'PAID' }, _sum: { amount: true } }),
      this.prisma.invoice.aggregate({ where: { tenantId, status: 'OPEN' }, _sum: { amount: true } }),
      this.prisma.payout.aggregate({
        where: { tenantId, status: { in: ['PENDING', 'COMPUTED'] } },
        _sum: { computedAmount: true },
      }),
    ]);

    const zero = new Prisma.Decimal(0);
    return {
      currency: 'USD',
      openInvoiceCount,
      paidTotal: (paidAgg._sum.amount ?? zero).toFixed(4),
      outstandingTotal: (outstandingAgg._sum.amount ?? zero).toFixed(4),
      payoutsPendingTotal: (payoutsPendingAgg._sum.computedAmount ?? zero).toFixed(4),
    };
  }

  private toLedgerEntryDto(entry: LedgerEntryRow): LedgerEntryDto {
    return {
      id: entry.id,
      accountCode: entry.ledgerAccount.code,
      accountName: entry.ledgerAccount.name,
      debit: entry.debit.toFixed(4),
      credit: entry.credit.toFixed(4),
      memo: entry.memo,
      postedAt: entry.postedAt.toISOString(),
    };
  }
}
