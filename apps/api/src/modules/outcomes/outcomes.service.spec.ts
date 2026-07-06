import { NotFoundException } from '@nestjs/common';
import type { AuthPrincipal } from '@vpsy/contracts';
import { OutcomesService } from './outcomes.service';

/**
 * Clinical-Rigor wave (audit finding: raw delta != reliable change). Verifies
 * the Reliable Change Index (Jacobson & Truax, 1991) against hand-computed
 * PHQ-9 examples, direction-aware classification, and the honest
 * 'unknown-reliability' fallback for constructs with no known psychometrics.
 */

const principal: AuthPrincipal = {
  userId: 'user_psy_a',
  tenantId: 'tenant_demo',
  roles: [],
  permissions: [],
};

function makeService() {
  const prisma = {
    client: { findFirst: jest.fn().mockResolvedValue({ id: 'client_1', tenantId: 'tenant_demo' }) },
    outcomeMeasure: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const audit = { record: jest.fn() };
  const svc = new OutcomesService(prisma as any, audit as any);
  return { svc, prisma, audit };
}

function measureRow(overrides: Partial<{ id: string; construct: string; value: number; occurredAt: Date }> = {}) {
  return {
    id: overrides.id ?? 'measure_prev',
    clientId: 'client_1',
    construct: overrides.construct ?? 'depression',
    value: overrides.value ?? 0,
    therapeuticResponse: 'unknown',
    occurredAt: overrides.occurredAt ?? new Date('2026-01-01T00:00:00.000Z'),
  };
}

describe('OutcomesService — Reliable Change Index', () => {
  it('rejects when the client does not exist in this tenant', async () => {
    const { svc, prisma } = makeService();
    (prisma.client.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(
      svc.record(principal, { clientId: 'client_missing', construct: 'depression', value: 6 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('baseline measure (no prior): rci is null, classification is "baseline"', async () => {
    const { svc, prisma } = makeService();
    prisma.outcomeMeasure.findFirst.mockResolvedValue(null);
    prisma.outcomeMeasure.create.mockResolvedValue(measureRow({ id: 'm1', value: 12 }));

    const result = await svc.record(principal, { clientId: 'client_1', construct: 'depression', value: 12 });

    expect(result.trend.direction).toBe('baseline');
    expect(result.trend.rci).toBeNull();
    expect(result.trend.classification).toBe('baseline');
  });

  it('PHQ-9 (depression) 12 -> 6: SEM~2.28, SE_diff~3.23, RCI~-1.86 -> no-reliable-change', async () => {
    const { svc, prisma } = makeService();
    prisma.outcomeMeasure.findFirst.mockResolvedValue(measureRow({ id: 'm_prev', construct: 'depression', value: 12 }));
    prisma.outcomeMeasure.create.mockResolvedValue(measureRow({ id: 'm_cur', construct: 'depression', value: 6 }));

    const result = await svc.record(principal, { clientId: 'client_1', construct: 'depression', value: 6 });

    expect(result.trend.delta).toBeCloseTo(-6, 4);
    expect(result.trend.rci).toBeCloseTo(-1.8589, 3);
    expect(result.trend.classification).toBe('no-reliable-change');
  });

  it('PHQ-9 (depression) 15 -> 6: RCI~-2.79 -> reliably-improved (lower-is-better polarity)', async () => {
    const { svc, prisma } = makeService();
    prisma.outcomeMeasure.findFirst.mockResolvedValue(measureRow({ id: 'm_prev', construct: 'depression', value: 15 }));
    prisma.outcomeMeasure.create.mockResolvedValue(measureRow({ id: 'm_cur', construct: 'depression', value: 6 }));

    const result = await svc.record(principal, { clientId: 'client_1', construct: 'depression', value: 6 });

    expect(result.trend.delta).toBeCloseTo(-9, 4);
    expect(result.trend.rci).toBeCloseTo(-2.7883, 3);
    expect(result.trend.classification).toBe('reliably-improved');
  });

  it('GAD-7 (anxiety) worsening 5 -> 15 -> reliably-worsened (increase is worse on a symptom scale)', async () => {
    const { svc, prisma } = makeService();
    prisma.outcomeMeasure.findFirst.mockResolvedValue(measureRow({ id: 'm_prev', construct: 'anxiety', value: 5 }));
    prisma.outcomeMeasure.create.mockResolvedValue(measureRow({ id: 'm_cur', construct: 'anxiety', value: 15 }));

    const result = await svc.record(principal, { clientId: 'client_1', construct: 'anxiety', value: 15 });

    expect(result.trend.rci).toBeGreaterThan(1.96);
    expect(result.trend.classification).toBe('reliably-worsened');
  });

  it('unknown construct: honest null rci + "unknown-reliability" — never fabricates a reliability', async () => {
    const { svc, prisma } = makeService();
    prisma.outcomeMeasure.findFirst.mockResolvedValue(measureRow({ id: 'm_prev', construct: 'wellbeing-index', value: 40 }));
    prisma.outcomeMeasure.create.mockResolvedValue(measureRow({ id: 'm_cur', construct: 'wellbeing-index', value: 55 }));

    const result = await svc.record(principal, { clientId: 'client_1', construct: 'wellbeing-index', value: 55 });

    expect(result.trend.rci).toBeNull();
    expect(result.trend.classification).toBe('unknown-reliability');
  });

  it('listForClient computes RCI sequentially across a longitudinal series for the same construct', async () => {
    const { svc, prisma } = makeService();
    prisma.outcomeMeasure.findMany.mockResolvedValue([
      measureRow({ id: 'm1', construct: 'depression', value: 15, occurredAt: new Date('2026-01-01') }),
      measureRow({ id: 'm2', construct: 'depression', value: 12, occurredAt: new Date('2026-02-01') }),
      measureRow({ id: 'm3', construct: 'depression', value: 6, occurredAt: new Date('2026-03-01') }),
    ]);

    const results = await svc.listForClient(principal, 'client_1');

    expect(results[0].trend.classification).toBe('baseline');
    expect(results[1].trend.rci).toBeCloseTo(-0.9294, 3); // 15 -> 12 vs. the immediately-prior measure
    expect(results[1].trend.classification).toBe('no-reliable-change');
    expect(results[2].trend.rci).toBeCloseTo(-1.8589, 3); // 12 -> 6 vs. the immediately-prior measure
    expect(results[2].trend.classification).toBe('no-reliable-change');
  });
});
