import type { AuthPrincipal } from '@vpsy/contracts';
import { Role } from '@vpsy/contracts';
import { Prisma } from '@vpsy/database';
import { PayoutsService } from './payouts.service';

/**
 * Phase 6 DoD (docs/technical/13-roadmap-and-phases.md, ctx 26 Revenue Share
 * / Payouts): computedAmount = paidTotal × pct as exact Decimal arithmetic,
 * posted atomically alongside a balanced ledger entry.
 */

const managerPrincipal: AuthPrincipal = {
  userId: 'user_manager',
  tenantId: 'tenant_demo',
  roles: [Role.MANAGER],
  permissions: [],
};

const psychologistRow = { id: 'psy_1', tenantId: 'tenant_demo', user: { fullName: 'Dr. Elena Rivera' } };

function makeService(overrides: Partial<Record<string, unknown>> = {}) {
  const prismaTx = {
    payout: {
      create: jest.fn(async ({ data }: any) => ({
        id: 'payout_1',
        createdAt: new Date('2026-07-01T00:00:00Z'),
        ...data,
      })),
    },
  };

  const prisma = {
    psychologist: { findFirst: jest.fn().mockResolvedValue(psychologistRow) },
    assignment: { findMany: jest.fn().mockResolvedValue([{ clientId: 'client_1' }]) },
    invoice: {
      findMany: jest.fn().mockResolvedValue([{ amount: new Prisma.Decimal('180.0000') }]),
    },
    contract: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'contract_1',
        revenueShareRules: [{ pct: 60, basis: 'REVENUE' }],
      }),
    },
    payout: { findMany: jest.fn() },
    $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(prismaTx)),
    ...overrides,
  };
  const audit = { record: jest.fn() };
  const bus = { publish: jest.fn() };
  const accounting = { postBalancedEntry: jest.fn() };
  const svc = new PayoutsService(prisma as any, audit as any, bus as any, accounting as any);
  return { svc, prisma, audit, bus, accounting, prismaTx };
}

const period = { periodStart: '2026-06-01T00:00:00.000Z', periodEnd: '2026-06-30T00:00:00.000Z' };

describe('PayoutsService.computePayout', () => {
  it('computes computedAmount = paidTotal × RevenueShareRule.pct as an exact Decimal', async () => {
    const { svc, prismaTx, accounting, bus } = makeService();

    const result = await svc.computePayout(managerPrincipal, { psychologistId: 'psy_1', ...period });

    // 180.00 paid total × 60% => 108.00, exactly.
    expect(result.computedAmount).toBe('108.0000');
    expect(result.status).toBe('COMPUTED');
    expect(typeof result.computedAmount).toBe('string');
    expect(prismaTx.payout.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'COMPUTED' }) }),
    );
    expect(accounting.postBalancedEntry).toHaveBeenCalledWith(
      prismaTx,
      expect.objectContaining({ debitAccountCode: '5000', creditAccountCode: '2000', payoutId: 'payout_1' }),
    );
    expect(bus.publish).toHaveBeenCalledWith(
      'payout.computed',
      'tenant_demo',
      expect.objectContaining({ payoutId: 'payout_1', computedAmount: '108.0000' }),
    );
  });

  it('falls back to a default 50% share when no RevenueShareRule exists', async () => {
    const { svc } = makeService({ contract: { findFirst: jest.fn().mockResolvedValue(null) } });

    const result = await svc.computePayout(managerPrincipal, { psychologistId: 'psy_1', ...period });

    // 180.00 paid total × 50% default => 90.00
    expect(result.computedAmount).toBe('90.0000');
  });

  it('attributes zero when the psychologist has no assigned clients', async () => {
    const { svc, accounting } = makeService({ assignment: { findMany: jest.fn().mockResolvedValue([]) } });

    const result = await svc.computePayout(managerPrincipal, { psychologistId: 'psy_1', ...period });

    expect(result.computedAmount).toBe('0.0000');
    // No money moves — skip the ledger posting entirely.
    expect(accounting.postBalancedEntry).not.toHaveBeenCalled();
  });
});
