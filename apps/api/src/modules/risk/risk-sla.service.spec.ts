import { RiskSlaService } from './risk-sla.service';

/**
 * Real SLA + on-call fallback (docs/10-10-PROGRAM.md WAVE CR item 3). Two
 * deterministic, never-AI-consulted behaviors under test:
 *  1. `breachOverdue` marks unresolved past-`slaDueAt` escalations as
 *     breached, audits it (fail-closed) and publishes the breach event.
 *  2. `autoAssignUnassignedSevere` routes an unassigned SEVERE escalation
 *     older than 15 minutes to the tenant's least-loaded accepting-clients
 *     psychologist — a manager can always reassign afterward, but a SEVERE
 *     case must never simply sit unowned.
 *
 * Uses jest fake timers to control "now" deterministically rather than
 * sleeping in real time.
 */

const TENANT_ID = 'tenant_demo';

function makeService(overrides: {
  escalations?: any[];
  psychologists?: any[];
} = {}) {
  const updatedEscalations: any[] = [];

  const escalationFindMany = jest.fn().mockImplementation(({ where }: any) => {
    const rows = overrides.escalations ?? [];
    return rows.filter((r) => {
      if (where.slaBreached !== undefined && r.slaBreached !== where.slaBreached) return false;
      if (where.resolvedAt === null && r.resolvedAt !== null) return false;
      if (where.assignedTo === null && r.assignedTo !== null) return false;
      if (where.slaDueAt && r.slaDueAt && !(r.slaDueAt.getTime() < where.slaDueAt.lt.getTime())) return false;
      if (where.openedAt && r.openedAt && !(r.openedAt.getTime() < where.openedAt.lt.getTime())) return false;
      if (where.riskFlag?.severity && r.riskFlag.severity !== where.riskFlag.severity) return false;
      return true;
    });
  });

  const prisma = {
    tenant: { findMany: jest.fn().mockResolvedValue([{ id: TENANT_ID }]) },
    escalation: {
      findMany: escalationFindMany,
      update: jest.fn().mockImplementation(({ where, data }: any) => {
        updatedEscalations.push({ id: where.id, ...data });
        return { id: where.id, ...data };
      }),
    },
    psychologist: {
      findFirst: jest.fn().mockImplementation(() => {
        const list = (overrides.psychologists ?? []).slice().sort((a, b) => a.currentCaseload - b.currentCaseload);
        return list[0] ?? null;
      }),
    },
  };

  const audit = { record: jest.fn() };
  const bus = { publish: jest.fn() };
  const svc = new RiskSlaService(prisma as any, audit as any, bus as any);
  return { svc, prisma, audit, bus, updatedEscalations };
}

describe('RiskSlaService.sweep — SLA breach', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(new Date('2026-07-06T12:00:00Z')));
  afterEach(() => jest.useRealTimers());

  it('marks an unresolved past-due escalation slaBreached, audits (critical) and publishes the breach event', async () => {
    const overdue = {
      id: 'esc_overdue',
      riskFlagId: 'flag_1',
      openedAt: new Date('2026-07-06T10:00:00Z'),
      slaDueAt: new Date('2026-07-06T11:00:00Z'), // 1h in the past
      slaBreached: false,
      resolvedAt: null,
      assignedTo: 'user_psy_a',
      riskFlag: { severity: 'HIGH', clientId: 'client_1' },
    };
    const { svc, prisma, audit, bus, updatedEscalations } = makeService({ escalations: [overdue] });

    await svc.sweep();

    expect(updatedEscalations).toContainEqual(expect.objectContaining({ id: 'esc_overdue', slaBreached: true }));
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'escalation.sla_breached', tenantId: TENANT_ID, critical: true }),
    );
    expect(bus.publish).toHaveBeenCalledWith(
      'escalation.sla_breached',
      TENANT_ID,
      expect.objectContaining({ escalationId: 'esc_overdue', clientId: 'client_1' }),
    );
    void prisma;
  });

  it('does not touch an escalation whose slaDueAt has not passed yet', async () => {
    const notYetDue = {
      id: 'esc_future',
      riskFlagId: 'flag_2',
      openedAt: new Date('2026-07-06T11:50:00Z'),
      slaDueAt: new Date('2026-07-06T12:50:00Z'), // still 50 min away
      slaBreached: false,
      resolvedAt: null,
      assignedTo: null,
      riskFlag: { severity: 'SEVERE', clientId: 'client_2' },
    };
    const { svc, audit } = makeService({ escalations: [notYetDue] });

    await svc.sweep();

    expect(audit.record).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'escalation.sla_breached' }),
    );
  });
});

describe('RiskSlaService.sweep — on-call auto-assign least-loaded', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(new Date('2026-07-06T12:00:00Z')));
  afterEach(() => jest.useRealTimers());

  it('auto-assigns an unassigned SEVERE escalation older than 15 minutes to the least-loaded accepting psychologist', async () => {
    const staleServere = {
      id: 'esc_severe_stale',
      riskFlagId: 'flag_3',
      openedAt: new Date('2026-07-06T11:40:00Z'), // 20 min old — past the 15-min cutoff
      slaDueAt: new Date('2026-07-06T12:40:00Z'),
      slaBreached: false,
      resolvedAt: null,
      assignedTo: null,
      riskFlag: { severity: 'SEVERE', clientId: 'client_3' },
    };
    const psychologists = [
      { userId: 'user_psy_busy', currentCaseload: 12, acceptingClients: true, deletedAt: null },
      { userId: 'user_psy_light', currentCaseload: 3, acceptingClients: true, deletedAt: null },
    ];
    const { svc, audit, bus, updatedEscalations } = makeService({
      escalations: [staleServere],
      psychologists,
    });

    await svc.sweep();

    expect(updatedEscalations).toContainEqual(
      expect.objectContaining({ id: 'esc_severe_stale', assignedTo: 'user_psy_light' }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'escalation.auto_assigned', critical: true }),
    );
    expect(bus.publish).toHaveBeenCalledWith(
      'escalation.assigned',
      TENANT_ID,
      expect.objectContaining({ escalationId: 'esc_severe_stale', assignedTo: 'user_psy_light' }),
    );
  });

  it('does not auto-assign a SEVERE escalation younger than 15 minutes', async () => {
    const freshSevere = {
      id: 'esc_severe_fresh',
      riskFlagId: 'flag_4',
      openedAt: new Date('2026-07-06T11:50:00Z'), // 10 min old
      slaDueAt: new Date('2026-07-06T12:50:00Z'),
      slaBreached: false,
      resolvedAt: null,
      assignedTo: null,
      riskFlag: { severity: 'SEVERE', clientId: 'client_4' },
    };
    const { svc, audit } = makeService({
      escalations: [freshSevere],
      psychologists: [{ userId: 'user_psy_light', currentCaseload: 1, acceptingClients: true, deletedAt: null }],
    });

    await svc.sweep();

    expect(audit.record).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'escalation.auto_assigned' }));
  });

  it('leaves a SEVERE escalation unassigned (and logs, does not throw) when no on-call psychologist is available', async () => {
    const staleServere = {
      id: 'esc_severe_stale2',
      riskFlagId: 'flag_5',
      openedAt: new Date('2026-07-06T11:00:00Z'),
      slaDueAt: new Date('2026-07-06T12:00:00Z'),
      slaBreached: false,
      resolvedAt: null,
      assignedTo: null,
      riskFlag: { severity: 'SEVERE', clientId: 'client_5' },
    };
    const { svc, audit, updatedEscalations } = makeService({ escalations: [staleServere], psychologists: [] });

    await expect(svc.sweep()).resolves.toBeUndefined();
    expect(updatedEscalations).toHaveLength(0);
    expect(audit.record).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'escalation.auto_assigned' }));
  });
});

describe('RiskSlaService.sweep — tenant isolation', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(new Date('2026-07-06T12:00:00Z')));
  afterEach(() => jest.useRealTimers());

  it('continues sweeping remaining tenants when one tenant iteration throws', async () => {
    const { svc, prisma, audit } = makeService({ escalations: [] });
    (prisma.tenant.findMany as jest.Mock).mockResolvedValue([{ id: 'tenant_bad' }, { id: TENANT_ID }]);
    let call = 0;
    (prisma.escalation.findMany as jest.Mock).mockImplementation(() => {
      call += 1;
      if (call === 1) throw new Error('simulated per-tenant failure');
      return [];
    });

    await expect(svc.sweep()).resolves.toBeUndefined();
    void audit;
  });
});
