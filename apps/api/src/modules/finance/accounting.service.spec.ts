import { Prisma } from '@vpsy/database';
import { AccountingService } from './accounting.service';

/**
 * Phase 6 DoD (docs/technical/13-roadmap-and-phases.md, ctx 25 Accounting):
 * "Money handled with NUMERIC, atomic writes, reconciliation, and audit."
 * `postBalancedEntry` is the single primitive every money-moving Finance
 * sub-service calls — it must always post a debit line and a credit line
 * that sum to the same amount (double-entry balance).
 */

function makeTx() {
  const accounts = new Map<string, { id: string; code: string; name: string }>();
  const entries: Array<{ debit: Prisma.Decimal; credit: Prisma.Decimal; ledgerAccountId: string }> = [];
  const tx = {
    ledgerAccount: {
      upsert: jest.fn(async ({ where, create }: any) => {
        const key = `${where.tenantId_code.tenantId}:${where.tenantId_code.code}`;
        if (!accounts.has(key)) {
          accounts.set(key, { id: key, code: create.code, name: create.name });
        }
        return accounts.get(key)!;
      }),
    },
    accountingEntry: {
      create: jest.fn(async ({ data }: any) => {
        entries.push(data);
        return { id: `entry_${entries.length}`, ...data };
      }),
    },
  };
  return { tx, entries };
}

describe('AccountingService.postBalancedEntry', () => {
  it('posts a debit line and a credit line whose totals balance exactly', async () => {
    const svc = new AccountingService({} as any);
    const { tx, entries } = makeTx();

    await svc.postBalancedEntry(tx as any, {
      tenantId: 'tenant_demo',
      debitAccountCode: '1000',
      creditAccountCode: '4000',
      amount: new Prisma.Decimal('180.0000'),
      invoiceId: 'invoice_1',
    });

    expect(entries).toHaveLength(2);
    const totalDebit = entries.reduce((sum, e) => sum.plus(e.debit), new Prisma.Decimal(0));
    const totalCredit = entries.reduce((sum, e) => sum.plus(e.credit), new Prisma.Decimal(0));
    expect(totalDebit.equals(totalCredit)).toBe(true);
    expect(totalDebit.toFixed(4)).toBe('180.0000');
  });

  it('self-heals (creates) a missing chart-of-accounts node for a known code', async () => {
    const svc = new AccountingService({} as any);
    const { tx } = makeTx();

    await svc.postBalancedEntry(tx as any, {
      tenantId: 'tenant_new',
      debitAccountCode: '5000',
      creditAccountCode: '2000',
      amount: new Prisma.Decimal('10.0000'),
    });

    expect(tx.ledgerAccount.upsert).toHaveBeenCalledTimes(2);
  });

  it('rejects an unknown ledger account code', async () => {
    const svc = new AccountingService({} as any);
    const { tx } = makeTx();

    await expect(
      svc.postBalancedEntry(tx as any, {
        tenantId: 'tenant_demo',
        debitAccountCode: '9999',
        creditAccountCode: '4000',
        amount: new Prisma.Decimal(10),
      }),
    ).rejects.toThrow('Unknown ledger account code');
  });
});
