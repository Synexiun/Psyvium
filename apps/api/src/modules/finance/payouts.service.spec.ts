import type { AuthPrincipal } from '@vpsy/contracts';
import { Role } from '@vpsy/contracts';
import { Prisma } from '@vpsy/database';
import { PayoutsService } from './payouts.service';

/**
 * Phase 6 DoD (docs/technical/13-roadmap-and-phases.md, ctx 26 Revenue Share
 * / Payouts; docs/business/05-monetization-and-contracts.md §2/§8 "composite
 * contracts" / "composable rules"): the payout engine must COMPOSE the full
 * stacked RevenueShareRule — base `pct` plus `seniorOverridePct`,
 * `supervisorSharePct`, `clinicSharePct`, `referralSharePct`, honoring
 * `countryRules` overrides — as exact Decimal arithmetic, posted atomically
 * alongside balanced ledger entries. A flat single-percentage read is a
 * facade; every share must be composed.
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
        supervisorId: null,
        revenueShareRules: [{ pct: 60, basis: 'REVENUE' }],
      }),
    },
    tenant: { findUnique: jest.fn() },
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

const secondManager: AuthPrincipal = {
  userId: 'user_manager_2',
  tenantId: 'tenant_demo',
  roles: [Role.MANAGER],
  permissions: [],
};

/**
 * Dual-control decision gate (audit G2 "Payouts: approval"): approval must
 * come from a DIFFERENT user than the computer; rejection requires a note
 * (schema-enforced) and MAY be self-issued; CAS prevents double decisions;
 * disbursement requires APPROVED.
 */
describe('PayoutsService.decidePayout (dual control)', () => {
  function makeDecideService(payoutRow: Record<string, unknown> | null) {
    const base = payoutRow
      ? {
          id: 'payout_1',
          tenantId: 'tenant_demo',
          psychologistId: 'psy_1',
          periodStart: new Date('2026-06-01T00:00:00Z'),
          periodEnd: new Date('2026-06-30T00:00:00Z'),
          computedAmount: new Prisma.Decimal('108.0000'),
          currency: 'USD',
          status: 'COMPUTED',
          computedBy: 'user_manager',
          approvedBy: null,
          approvedAt: null,
          decisionNote: null,
          createdAt: new Date('2026-07-01T00:00:00Z'),
          psychologist: { user: { fullName: 'Dr. Elena Rivera' } },
          ...payoutRow,
        }
      : null;
    const prisma = {
      payout: {
        findFirst: jest.fn().mockResolvedValue(base),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirstOrThrow: jest.fn().mockImplementation(async () => ({
          ...base,
          status: 'APPROVED',
          approvedBy: 'user_manager_2',
          approvedAt: new Date('2026-07-02T00:00:00Z'),
        })),
      },
    };
    const audit = { record: jest.fn() };
    const bus = { publish: jest.fn() };
    const svc = new PayoutsService(prisma as any, audit as any, bus as any, { postBalancedEntry: jest.fn() } as any);
    return { svc, prisma, audit, bus };
  }

  it('DUAL CONTROL: refuses approval by the same user who computed the payout, with a critical audit', async () => {
    const { svc, prisma, audit } = makeDecideService({});

    await expect(
      svc.decidePayout(managerPrincipal, 'payout_1', { decision: 'APPROVED' }),
    ).rejects.toThrow(/dual control/i);

    expect(prisma.payout.updateMany).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'payout.self_approval_refused', critical: true }),
    );
  });

  it('approves via CAS when a DIFFERENT user decides, with critical audit + event', async () => {
    const { svc, prisma, audit, bus } = makeDecideService({});

    const result = await svc.decidePayout(secondManager, 'payout_1', { decision: 'APPROVED' });

    expect(result.status).toBe('APPROVED');
    expect(result.approvedBy).toBe('user_manager_2');
    expect(prisma.payout.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'COMPUTED' }),
        data: expect.objectContaining({ status: 'APPROVED', approvedBy: 'user_manager_2' }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'payout.approved', critical: true }),
    );
    expect(bus.publish).toHaveBeenCalledWith('payout.approved', 'tenant_demo', expect.any(Object));
  });

  it('allows SELF-rejection (walking back your own computation is safe; blessing it is not)', async () => {
    const { svc, prisma, audit } = makeDecideService({});
    (prisma.payout.findFirstOrThrow as jest.Mock).mockResolvedValue({
      id: 'payout_1',
      tenantId: 'tenant_demo',
      psychologistId: 'psy_1',
      periodStart: new Date('2026-06-01T00:00:00Z'),
      periodEnd: new Date('2026-06-30T00:00:00Z'),
      computedAmount: new Prisma.Decimal('108.0000'),
      currency: 'USD',
      status: 'REJECTED',
      computedBy: 'user_manager',
      decisionNote: 'wrong period boundaries',
      createdAt: new Date('2026-07-01T00:00:00Z'),
      psychologist: { user: { fullName: 'Dr. Elena Rivera' } },
    });

    const result = await svc.decidePayout(managerPrincipal, 'payout_1', {
      decision: 'REJECTED',
      note: 'wrong period boundaries',
    });

    expect(result.status).toBe('REJECTED');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'payout.rejected', critical: true }),
    );
  });

  it('rejects deciding a payout that is not COMPUTED', async () => {
    const { svc } = makeDecideService({ status: 'APPROVED' });

    await expect(
      svc.decidePayout(secondManager, 'payout_1', { decision: 'APPROVED' }),
    ).rejects.toThrow(/Only COMPUTED payouts/);
  });

  it('CAS: a concurrent second decision loses cleanly', async () => {
    const { svc, prisma } = makeDecideService({});
    (prisma.payout.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

    await expect(
      svc.decidePayout(secondManager, 'payout_1', { decision: 'APPROVED' }),
    ).rejects.toThrow(/already decided/);
  });

  it('assertDisbursable: only APPROVED payouts may reach the disbursement seam', async () => {
    const { svc, prisma } = makeDecideService({ status: 'COMPUTED' });
    (prisma.payout.findFirst as jest.Mock).mockResolvedValue({ status: 'COMPUTED' });
    await expect(svc.assertDisbursable(managerPrincipal, 'payout_1')).rejects.toThrow(/must be APPROVED/);

    (prisma.payout.findFirst as jest.Mock).mockResolvedValue({ status: 'APPROVED' });
    await expect(svc.assertDisbursable(managerPrincipal, 'payout_1')).resolves.toBeUndefined();

    (prisma.payout.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(svc.assertDisbursable(managerPrincipal, 'missing')).rejects.toThrow(/not found/i);
  });
});

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

  it('composes the full stacked breakdown (base + senior override + supervisor + clinic + referral) as exact Decimals', async () => {
    const { svc, prismaTx, accounting } = makeService({
      invoice: { findMany: jest.fn().mockResolvedValue([{ amount: new Prisma.Decimal('1000.0000') }]) },
      contract: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'contract_1',
          supervisorId: 'psy_supervisor',
          revenueShareRules: [
            {
              pct: 40,
              basis: 'REVENUE',
              seniorOverridePct: 5,
              supervisorSharePct: 10,
              clinicSharePct: 15,
              referralSharePct: 5,
              countryRules: {},
            },
          ],
        }),
      },
    });

    const result = await svc.computePayout(managerPrincipal, { psychologistId: 'psy_1', ...period });

    // 1000.00 revenue base:
    //   clinician 40%          => 400.0000
    //   senior override 5%     =>  50.0000
    //   -> clinician's own Payout (computedAmount) = 450.0000
    //   supervisor 10%         => 100.0000 (posted, owed to supervisor, NOT added to computedAmount)
    //   clinic 15%             => 150.0000 (retained margin, no ledger post)
    //   referral 5%            =>  50.0000 (posted, owed to referral source)
    expect(result.computedAmount).toBe('450.0000');

    expect(prismaTx.payout.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          rulesApplied: expect.objectContaining({
            breakdown: {
              pct: 40,
              seniorOverridePct: 5,
              supervisorSharePct: 10,
              clinicSharePct: 15,
              referralSharePct: 5,
            },
            shares: {
              clinician: '400.0000',
              seniorOverride: '50.0000',
              supervisor: '100.0000',
              clinic: '150.0000',
              referral: '50.0000',
            },
          }),
        }),
      }),
    );

    // Every ledger call is itself an exactly-balanced debit/credit pair
    // (postBalancedEntry always writes debit === credit === amount), so the
    // full posted set is balanced by construction. Assert the exact set of
    // amounts posted: clinician total, supervisor share, referral share —
    // and that clinic share (retained margin) never hits the ledger.
    expect(accounting.postBalancedEntry).toHaveBeenCalledTimes(3);
    const postedAmounts = (accounting.postBalancedEntry as jest.Mock).mock.calls
      .map(([, params]: [unknown, { amount: Prisma.Decimal }]) => params.amount.toFixed(4))
      .sort();
    expect(postedAmounts).toEqual(['100.0000', '450.0000', '50.0000'].sort());
    const supervisorCall = (accounting.postBalancedEntry as jest.Mock).mock.calls.find(([, params]: [unknown, { memo?: string }]) =>
      params.memo?.includes('supervisor'),
    );
    expect(supervisorCall).toBeDefined();
    const [, supervisorParams] = supervisorCall as [unknown, { debitAccountCode: string; creditAccountCode: string; amount: Prisma.Decimal }];
    expect(supervisorParams.debitAccountCode).toBe('5000');
    expect(supervisorParams.creditAccountCode).toBe('2000');
    expect(supervisorParams.amount.toFixed(4)).toBe('100.0000');
  });

  it('applies a per-country override from countryRules, keyed by the tenant country code', async () => {
    const { svc, prismaTx } = makeService({
      tenant: { findUnique: jest.fn().mockResolvedValue({ countryCode: 'US' }) },
      invoice: { findMany: jest.fn().mockResolvedValue([{ amount: new Prisma.Decimal('200.0000') }]) },
      contract: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'contract_1',
          supervisorId: null,
          revenueShareRules: [
            {
              pct: 50,
              basis: 'REVENUE',
              seniorOverridePct: 0,
              supervisorSharePct: 0,
              clinicSharePct: 0,
              referralSharePct: 0,
              countryRules: { US: { pct: 70 } },
            },
          ],
        }),
      },
    });

    const result = await svc.computePayout(managerPrincipal, { psychologistId: 'psy_1', ...period });

    // Country override replaces the base 50% with 70% for a US tenant.
    expect(result.computedAmount).toBe('140.0000');
    expect(prismaTx.payout.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          rulesApplied: expect.objectContaining({ countryCode: 'US', breakdown: expect.objectContaining({ pct: 70 }) }),
        }),
      }),
    );
  });

  it('rejects (and does not post) a composite rule whose stacked shares exceed 100%', async () => {
    const { svc, prismaTx, accounting } = makeService({
      contract: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'contract_1',
          supervisorId: null,
          revenueShareRules: [
            {
              pct: 60,
              basis: 'REVENUE',
              seniorOverridePct: 20,
              supervisorSharePct: 15,
              clinicSharePct: 10,
              referralSharePct: 5,
              countryRules: {},
            },
          ],
        }),
      },
    });

    await expect(svc.computePayout(managerPrincipal, { psychologistId: 'psy_1', ...period })).rejects.toThrow(
      /exceeds 100%/,
    );

    // Fail safe: no payout row and no ledger posting for a malformed rule.
    expect(prismaTx.payout.create).not.toHaveBeenCalled();
    expect(accounting.postBalancedEntry).not.toHaveBeenCalled();
  });

  it('rejects a malformed rule with a negative share', async () => {
    const { svc } = makeService({
      contract: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'contract_1',
          supervisorId: null,
          revenueShareRules: [
            {
              pct: 50,
              basis: 'REVENUE',
              seniorOverridePct: 0,
              supervisorSharePct: 0,
              clinicSharePct: -5,
              referralSharePct: 0,
              countryRules: {},
            },
          ],
        }),
      },
    });

    await expect(svc.computePayout(managerPrincipal, { psychologistId: 'psy_1', ...period })).rejects.toThrow(
      /non-negative number/,
    );
  });
});
