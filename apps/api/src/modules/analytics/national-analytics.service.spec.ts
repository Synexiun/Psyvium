import type { AuthPrincipal } from '@vpsy/contracts';
import { NationalAnalyticsService } from './national-analytics.service';

/**
 * Phase 6 DoD (docs/technical/13-roadmap-and-phases.md, ctx 28 National
 * Analytics): "National Analytics is aggregate + de-identified only; no
 * re-identification path." This is the single, load-bearing test that proves
 * the k-anonymity floor (5): any `PopulationMetric` row with `cohortSize < 5`
 * must never surface its real value — `value` is nulled and `suppressed` is
 * true — while rows at/above the floor pass their real value through.
 */

const principal: AuthPrincipal = {
  userId: 'user_gov',
  tenantId: 'tenant_demo',
  roles: [],
  permissions: [],
};

const rows = [
  { region: 'US-NY', metric: 'depression_prevalence_pct', value: 21.4, window: '2026-Q2', cohortSize: 48210 },
  { region: 'US-VT', metric: 'depression_prevalence_pct', value: 33.0, window: '2026-Q2', cohortSize: 3 }, // below floor
  { region: 'US-CA', metric: 'clinician_utilization_pct', value: 61.2, window: '2026-Q2', cohortSize: 20 },
];

function makePrisma() {
  return {
    populationMetric: {
      findMany: jest.fn().mockResolvedValue(rows),
    },
    report: {
      create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'report_national_1', ...data })),
    },
  };
}

describe('NationalAnalyticsService.getNationalAnalytics', () => {
  it('suppresses a below-floor cohort (value null, suppressed true) and returns real values at/above the floor', async () => {
    const prisma = makePrisma();
    const audit = { record: jest.fn() };
    const svc = new NationalAnalyticsService(prisma as any, audit as any);

    const result = await svc.getNationalAnalytics(principal);

    expect(result.kAnonymityFloor).toBe(5);

    const vt = result.metrics.find((m) => m.region === 'US-VT')!;
    expect(vt.cohortSize).toBe(3);
    expect(vt.suppressed).toBe(true);
    expect(vt.value).toBeNull();
    // The suppressed row's underlying real value (33.0) must never appear in
    // metric payloads. Exclude generatedAt — a wall-clock second of :33 would
    // otherwise false-fail this check.
    expect(JSON.stringify(result.metrics)).not.toContain('33');

    const ny = result.metrics.find((m) => m.region === 'US-NY')!;
    expect(ny.cohortSize).toBe(48210);
    expect(ny.suppressed).toBe(false);
    expect(ny.value).toBe(21.4);
    expect(ny.unit).toBe('%');

    const ca = result.metrics.find((m) => m.region === 'US-CA')!;
    expect(ca.cohortSize).toBe(20);
    expect(ca.suppressed).toBe(false);
    expect(ca.value).toBe(61.2);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'national.generated',
        after: expect.objectContaining({ kAnonymityFloor: 5, suppressedCount: 1 }),
      }),
    );
  });

  it('suppresses a cohort exactly at the boundary (cohortSize === floor - 1) and passes one exactly at the floor', async () => {
    const prisma = {
      populationMetric: {
        findMany: jest.fn().mockResolvedValue([
          { region: 'US-TX', metric: 'avg_outcome_improvement_pct', value: 40, window: '2026-Q2', cohortSize: 4 },
          { region: 'US-TX', metric: 'treatment_access_pct', value: 55, window: '2026-Q2', cohortSize: 5 },
        ]),
      },
      report: { create: jest.fn().mockResolvedValue({ id: 'r1' }) },
    };
    const audit = { record: jest.fn() };
    const svc = new NationalAnalyticsService(prisma as any, audit as any);

    const result = await svc.getNationalAnalytics(principal);

    const below = result.metrics.find((m) => m.metric === 'avg_outcome_improvement_pct')!;
    expect(below.suppressed).toBe(true);
    expect(below.value).toBeNull();

    const atFloor = result.metrics.find((m) => m.metric === 'treatment_access_pct')!;
    expect(atFloor.suppressed).toBe(false);
    expect(atFloor.value).toBe(55);
  });
});
