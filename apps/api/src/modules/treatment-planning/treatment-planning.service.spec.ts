import { NotFoundException } from '@nestjs/common';
import type { AuthPrincipal } from '@vpsy/contracts';
import { createTreatmentPlanSchema } from '@vpsy/contracts';
import { TreatmentPlanningService } from './treatment-planning.service';

/**
 * Wave C — Treatment-Plan Support wiring (docs/technical/05-ai-clinical-layer.md
 * §3.3). `aiAssist` must forward ONLY severity band / specialty / outcome-trend
 * signals to the AI Gateway (never history, hypotheses, or client identifiers)
 * and must never create, activate, or supersede a TreatmentPlan.
 *
 * Clinical-Rigor wave (audit finding #4) — SMART-goal enforcement and the
 * Joint-Commission review-cadence default / overdue-review tracking.
 */

const principal: AuthPrincipal = {
  userId: 'user_psy_a',
  tenantId: 'tenant_demo',
  roles: [],
  permissions: [],
};

function makeService() {
  const prisma: any = {
    client: { findFirst: jest.fn().mockResolvedValue({ id: 'client_1', tenantId: 'tenant_demo' }) },
    treatmentPlan: {
      create: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    outcomeMeasure: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  // create() runs inside `this.prisma.$transaction(async (tx) => ...)` — hand
  // the callback the same mock object so `tx.treatmentPlan.*` calls land on
  // the spies above.
  prisma.$transaction = jest.fn((cb: (tx: unknown) => unknown) => cb(prisma));
  const audit = { record: jest.fn() };
  const bus = { publish: jest.fn() };
  const ai = {
    suggestTreatmentPlan: jest.fn().mockResolvedValue({
      suggestions: {
        goalSuggestions: ['g1'],
        interventionSuggestions: ['CBT: rationale'],
        measurementCadenceSuggestion: 'every 3 sessions',
      },
      source: 'rule-based',
      aiConfigured: false,
      recommendationId: 'rec_1',
    }),
  };
  const svc = new TreatmentPlanningService(prisma as any, audit as any, bus as any, ai as any);
  return { svc, prisma, audit, bus, ai };
}

describe('TreatmentPlanningService.aiAssist', () => {
  it('forwards only de-identified severity/specialty/outcome-trend signals to the AI Gateway', async () => {
    const { svc, ai } = makeService();

    const result = await svc.aiAssist(principal, {
      clientId: 'client_1',
      severityBand: 'SEVERE',
      specialty: 'anxiety disorders',
      outcomeTrend: 'declining',
    });

    expect(ai.suggestTreatmentPlan).toHaveBeenCalledWith({
      tenantId: 'tenant_demo',
      clientId: 'client_1',
      severityBand: 'SEVERE',
      specialty: 'anxiety disorders',
      outcomeTrend: 'declining',
    });
    // No client history, working hypotheses, or free-text field is part of the call above.
    expect(result.source).toBe('rule-based');
    expect(result.recommendationId).toBe('rec_1');
  });

  it('never creates, activates, or supersedes a TreatmentPlan', async () => {
    const { svc, prisma } = makeService();
    await svc.aiAssist(principal, {
      clientId: 'client_1',
      severityBand: 'LOW',
      specialty: 'general',
      outcomeTrend: 'insufficient-data',
    });
    expect(prisma.treatmentPlan.create).not.toHaveBeenCalled();
    expect(prisma.treatmentPlan.updateMany).not.toHaveBeenCalled();
  });

  it('rejects when the client does not exist in this tenant', async () => {
    const { svc, prisma } = makeService();
    (prisma.client.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(
      svc.aiAssist(principal, {
        clientId: 'client_missing',
        severityBand: 'LOW',
        specialty: 'general',
        outcomeTrend: 'stable',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('createTreatmentPlanSchema — SMART-goal enforcement (audit finding #4)', () => {
  const validGoal = { description: 'Reduce panic attack frequency', targetMetric: 'panic attacks/week', baseline: 5, target: 0 };

  it('rejects a goal that only has a description (not measurable)', () => {
    const result = createTreatmentPlanSchema.safeParse({
      clientId: 'client_1',
      goals: [{ description: 'Feel better' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a goal missing any one of targetMetric/baseline/target', () => {
    for (const omit of ['targetMetric', 'baseline', 'target'] as const) {
      const goal = { ...validGoal } as Record<string, unknown>;
      delete goal[omit];
      const result = createTreatmentPlanSchema.safeParse({ clientId: 'client_1', goals: [goal] });
      expect(result.success).toBe(false);
    }
  });

  it('accepts a fully-specified SMART goal', () => {
    const result = createTreatmentPlanSchema.safeParse({ clientId: 'client_1', goals: [validGoal] });
    expect(result.success).toBe(true);
  });
});

describe('TreatmentPlanningService.create — review-cadence default', () => {
  const goal = { description: 'Reduce panic attack frequency', targetMetric: 'panic attacks/week', baseline: 5, target: 0 };

  it('defaults reviewDate to +90 days (Joint Commission cycle) when the caller omits it', async () => {
    const { svc, prisma } = makeService();
    prisma.treatmentPlan.create.mockImplementation((args: any) =>
      Promise.resolve({ id: 'plan_1', version: 1, createdAt: new Date(), ...args.data, goals: [] }),
    );

    const before = Date.now();
    const plan = await svc.create(principal, {
      clientId: 'client_1',
      problemList: [],
      sessionFrequency: 'weekly',
      measurementSchedule: {},
      goals: [goal],
    } as any);
    const after = Date.now();

    expect(plan.reviewDate).not.toBeNull();
    const reviewMs = new Date(plan.reviewDate as string).getTime();
    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
    expect(reviewMs).toBeGreaterThanOrEqual(before + ninetyDaysMs - 5_000);
    expect(reviewMs).toBeLessThanOrEqual(after + ninetyDaysMs + 5_000);
  });

  it('honors an explicit reviewDate when the caller supplies one', async () => {
    const { svc, prisma } = makeService();
    prisma.treatmentPlan.create.mockImplementation((args: any) =>
      Promise.resolve({ id: 'plan_1', version: 1, createdAt: new Date(), ...args.data, goals: [] }),
    );

    const explicit = '2027-01-01T00:00:00.000Z';
    const plan = await svc.create(principal, {
      clientId: 'client_1',
      problemList: [],
      sessionFrequency: 'weekly',
      measurementSchedule: {},
      reviewDate: explicit,
      goals: [goal],
    } as any);

    expect(plan.reviewDate).toBe(explicit);
  });
});

describe('TreatmentPlanningService.listOverdueReviews (audit finding #4)', () => {
  it('queries active, tenant-scoped plans whose reviewDate has passed', async () => {
    const { svc, prisma } = makeService();
    const overdue = {
      id: 'plan_overdue',
      clientId: 'client_1',
      problemList: [],
      sessionFrequency: 'weekly',
      riskPlan: null,
      reviewDate: new Date('2020-01-01T00:00:00.000Z'),
      status: 'active',
      version: 1,
      clientAcknowledgedAt: null,
      clientAcknowledgedBy: null,
      createdAt: new Date('2019-01-01T00:00:00.000Z'),
      goals: [],
    };
    prisma.treatmentPlan.findMany.mockResolvedValue([overdue]);

    const result = await svc.listOverdueReviews(principal);

    expect(prisma.treatmentPlan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'tenant_demo',
          status: 'active',
          reviewDate: { lt: expect.any(Date) },
        }),
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('plan_overdue');
  });
});

describe('TreatmentPlanningService.acknowledge — client collaborative acknowledgment', () => {
  const activePlan = {
    id: 'plan_1',
    clientId: 'client_1',
    problemList: [],
    sessionFrequency: 'weekly',
    riskPlan: null,
    reviewDate: new Date('2026-10-01T00:00:00.000Z'),
    status: 'active',
    version: 1,
    clientAcknowledgedAt: null as Date | null,
    clientAcknowledgedBy: null as string | null,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    goals: [],
  };

  it('records acknowledgment on an active plan', async () => {
    const { svc, prisma, audit } = makeService();
    prisma.treatmentPlan.findFirst.mockResolvedValue({ ...activePlan });
    prisma.treatmentPlan.update.mockImplementation(({ data }: any) =>
      Promise.resolve({
        ...activePlan,
        clientAcknowledgedAt: data.clientAcknowledgedAt,
        clientAcknowledgedBy: data.clientAcknowledgedBy,
      }),
    );

    const dto = await svc.acknowledge(principal, 'plan_1');

    expect(dto.clientAcknowledgedAt).not.toBeNull();
    expect(dto.clientAcknowledgedBy).toBe(principal.userId);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'plan.client_acknowledged', entityId: 'plan_1' }),
    );
  });

  it('is idempotent when the plan is already acknowledged', async () => {
    const { svc, prisma, audit } = makeService();
    const ackedAt = new Date('2026-07-02T12:00:00.000Z');
    prisma.treatmentPlan.findFirst.mockResolvedValue({
      ...activePlan,
      clientAcknowledgedAt: ackedAt,
      clientAcknowledgedBy: 'user_client_1',
    });

    const dto = await svc.acknowledge(principal, 'plan_1');

    expect(prisma.treatmentPlan.update).not.toHaveBeenCalled();
    expect(dto.clientAcknowledgedAt).toBe(ackedAt.toISOString());
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe('TreatmentPlanningService.mbcSchedule — measurement-based care cadence', () => {
  it('recommends cadence from active plan goal targetMetrics + last measures', async () => {
    const { svc, prisma } = makeService();
    prisma.treatmentPlan.findFirst.mockResolvedValue({
      id: 'plan_1',
      sessionFrequency: 'weekly',
      goals: [
        { targetMetric: 'depression' },
        { targetMetric: 'anxiety' },
        { targetMetric: null },
      ],
    });
    prisma.outcomeMeasure.findMany.mockResolvedValue([
      { construct: 'depression', occurredAt: new Date('2026-07-01T00:00:00.000Z') },
    ]);

    const result = await svc.mbcSchedule(principal, 'client_1');

    expect(result.recommendations).toHaveLength(2);
    expect(result.recommendations.map((r) => r.construct).sort()).toEqual(['anxiety', 'depression']);
    expect(result.algorithm.family).toBe('mbc.schedule');
  });

  it('rejects when the client is not in this tenant', async () => {
    const { svc, prisma } = makeService();
    prisma.client.findFirst.mockResolvedValue(null);

    await expect(svc.mbcSchedule(principal, 'client_missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});
