import { Prisma } from '@vpsy/database';
import type { AuthPrincipal } from '@vpsy/contracts';
import { ReportsService } from './reports.service';

/**
 * Phase 6 DoD (docs/technical/13-roadmap-and-phases.md, ctx 27 Reports):
 * reports are computed LIVE from real rows — revenue figures must be exact
 * `Prisma.Decimal` sums (matching the Finance module's MONEY RULE), and the
 * manager report's intake-severity breakdown must reflect the real
 * `ScreeningResult.severityBand` distribution.
 */

const principal: AuthPrincipal = {
  userId: 'user_manager',
  tenantId: 'tenant_demo',
  roles: [],
  permissions: [],
};

function makePrisma(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    invoice: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: new Prisma.Decimal(0) } }),
    },
    payout: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { computedAmount: new Prisma.Decimal(0) } }),
    },
    client: {
      count: jest.fn().mockResolvedValue(0),
    },
    psychologist: {
      aggregate: jest.fn().mockResolvedValue({ _count: 0, _avg: { outcomeIndex: null } }),
    },
    outcomeMeasure: {
      aggregate: jest.fn().mockResolvedValue({ _count: 0, _avg: { value: null } }),
    },
    intake: {
      count: jest.fn().mockResolvedValue(0),
    },
    screeningResult: {
      groupBy: jest.fn().mockResolvedValue([]),
    },
    assignment: {
      count: jest.fn().mockResolvedValue(0),
    },
    escalation: {
      count: jest.fn().mockResolvedValue(0),
    },
    riskFlag: {
      count: jest.fn().mockResolvedValue(0),
    },
    appointment: {
      count: jest.fn().mockResolvedValue(0),
    },
    report: {
      create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'report_1', ...data })),
    },
    ...overrides,
  };
}

describe('ReportsService.getExecutiveReport', () => {
  it('computes revenue as exact Decimal sums of paid/open invoices and pending payouts', async () => {
    const prisma = makePrisma({
      invoice: {
        aggregate: jest
          .fn()
          .mockResolvedValueOnce({ _sum: { amount: new Prisma.Decimal('540.1000') } }) // PAID
          .mockResolvedValueOnce({ _sum: { amount: new Prisma.Decimal('180.0000') } }), // OPEN
      },
      payout: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { computedAmount: new Prisma.Decimal('96.5000') } }),
      },
      client: { count: jest.fn().mockResolvedValueOnce(10).mockResolvedValueOnce(7) },
      psychologist: { aggregate: jest.fn().mockResolvedValue({ _count: 2, _avg: { outcomeIndex: 78 } }) },
      outcomeMeasure: { aggregate: jest.fn().mockResolvedValue({ _count: 3, _avg: { value: 12.5 } }) },
    });
    const audit = { record: jest.fn() };
    const svc = new ReportsService(prisma as any, audit as any);

    const report = await svc.getExecutiveReport(principal);

    expect(report.currency).toBe('USD');
    expect(report.revenue.paidTotal).toBe('540.1000');
    expect(report.revenue.outstanding).toBe('180.0000');
    expect(report.revenue.payoutsPending).toBe('96.5000');
    expect(typeof report.revenue.paidTotal).toBe('string');
    expect(report.clients).toEqual({ total: 10, active: 7 });
    expect(report.clinicians).toEqual({ count: 2, avgOutcomeIndex: 78 });
    expect(report.outcomes).toEqual({ measureCount: 3, avgValue: 12.5 });

    expect(prisma.report.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ scope: 'executive', tenantId: 'tenant_demo' }) }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'report.generated', after: expect.objectContaining({ scope: 'executive' }) }),
    );
  });

  it('falls back to zero-valued Decimal totals with no PAID invoices/payouts on file', async () => {
    const prisma = makePrisma();
    const audit = { record: jest.fn() };
    const svc = new ReportsService(prisma as any, audit as any);

    const report = await svc.getExecutiveReport(principal);

    expect(report.revenue.paidTotal).toBe('0.0000');
    expect(report.revenue.outstanding).toBe('0.0000');
    expect(report.revenue.payoutsPending).toBe('0.0000');
    expect(report.outcomes.avgValue).toBeNull();
  });
});

describe('ReportsService.getManagerReport', () => {
  it('maps ScreeningResult.severityBand groups onto the four-band breakdown exactly', async () => {
    const prisma = makePrisma({
      intake: { count: jest.fn().mockResolvedValue(42) },
      screeningResult: {
        groupBy: jest.fn().mockResolvedValue([
          { severityBand: 'LOW', _count: { severityBand: 5 } },
          { severityBand: 'SEVERE', _count: { severityBand: 2 } },
        ]),
      },
      assignment: { count: jest.fn().mockResolvedValueOnce(3).mockResolvedValueOnce(9) },
      escalation: { count: jest.fn().mockResolvedValue(1) },
      riskFlag: { count: jest.fn().mockResolvedValue(4) },
      appointment: { count: jest.fn().mockResolvedValueOnce(6).mockResolvedValueOnce(2) },
    });
    const audit = { record: jest.fn() };
    const svc = new ReportsService(prisma as any, audit as any);

    const report = await svc.getManagerReport(principal);

    expect(report.intakes.total).toBe(42);
    // Only LOW and SEVERE had rows; MODERATE/HIGH must default to 0, not be absent.
    expect(report.intakes.bySeverity).toEqual({ LOW: 5, MODERATE: 0, HIGH: 0, SEVERE: 2 });
    expect(report.intakes.bySeverity.MODERATE).toBe(0);
    expect(report.intakes.bySeverity.HIGH).toBe(0);
    expect(report.assignments).toEqual({ proposed: 3, approved: 9 });
    expect(report.risk).toEqual({ openEscalations: 1, openFlags: 4 });
    expect(report.appointments).toEqual({ upcoming: 6, noShows: 2 });

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'report.generated', after: expect.objectContaining({ scope: 'manager' }) }),
    );
  });
});
