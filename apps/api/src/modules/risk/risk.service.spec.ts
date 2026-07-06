import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AuthPrincipal } from '@vpsy/contracts';
import { RiskService } from './risk.service';

/**
 * Phase 4 DoD (docs/technical/13-roadmap-and-phases.md): "Break-glass access
 * flow audited + alerts DPO" and the CORE PRINCIPLE that risk escalation
 * resolution is always a human decision, never automated. These tests pin
 * the three safety-critical behaviors of RiskService.
 */

const principal: AuthPrincipal = {
  userId: 'user_psy_a',
  tenantId: 'tenant_demo',
  roles: [],
  permissions: [],
};

const escalationRow = {
  id: 'esc_1',
  riskFlagId: 'flag_1',
  openedAt: new Date('2026-01-01T00:00:00Z'),
  assignedTo: null as string | null,
  resolvedAt: null as Date | null,
  resolution: null as string | null,
  slaBreached: false,
  riskFlag: {
    id: 'flag_1',
    clientId: 'client_1',
    type: 'SUICIDAL_IDEATION',
    severity: 'SEVERE',
    source: 'SCREENING',
    evidence: 'Endorsed active ideation on intake safety screen',
    status: 'ESCALATED',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    client: { user: { fullName: 'Alex Chen' } },
  },
};

function makeService(overrides: Partial<Record<string, unknown>> = {}) {
  const prisma = {
    escalation: {
      findFirst: jest.fn().mockResolvedValue(escalationRow),
      update: jest.fn(),
    },
    riskFlag: {
      update: jest.fn(),
    },
    client: {
      findFirst: jest.fn().mockResolvedValue({ id: 'client_1', tenantId: 'tenant_demo' }),
    },
    safetyPlan: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    },
    breakGlassGrant: {
      create: jest.fn(),
    },
    $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(prismaTx)),
    ...overrides,
  };
  const prismaTx = {
    escalation: {
      update: jest.fn().mockImplementation(({ data }: any) => ({
        ...escalationRow,
        ...data,
        riskFlag: escalationRow.riskFlag,
      })),
    },
    riskFlag: { update: jest.fn() },
  };
  const audit = { record: jest.fn() };
  const bus = { publish: jest.fn() };
  const svc = new RiskService(prisma as any, audit as any, bus as any);
  return { svc, prisma, audit, bus, prismaTx };
}

describe('RiskService.resolveEscalation', () => {
  it('rejects when no human principal is present — AI/automation can never resolve an escalation', async () => {
    const { svc, prisma, audit } = makeService();
    await expect(
      svc.resolveEscalation({ tenantId: 'tenant_demo' } as AuthPrincipal, 'esc_1', {
        resolution: 'Auto-resolved by risk-triage agent',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.escalation.findFirst).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('sets resolvedAt + resolution and records an audit event for a real human principal', async () => {
    const { svc, audit, bus } = makeService();
    const result = await svc.resolveEscalation(principal, 'esc_1', {
      resolution: 'Contacted client by phone; safety plan reviewed; no acute risk, follow-up booked.',
    });

    expect(result.resolvedAt).not.toBeNull();
    expect(result.resolution).toBe(
      'Contacted client by phone; safety plan reviewed; no acute risk, follow-up booked.',
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'escalation.resolved', actorId: 'user_psy_a' }),
    );
    expect(bus.publish).toHaveBeenCalledWith(
      'escalation.resolved',
      'tenant_demo',
      expect.objectContaining({ escalationId: 'esc_1' }),
    );
  });

  it('rejects re-resolving an already-resolved escalation', async () => {
    const { svc } = makeService({
      escalation: {
        findFirst: jest.fn().mockResolvedValue({ ...escalationRow, resolvedAt: new Date() }),
        update: jest.fn(),
      },
    });
    await expect(svc.resolveEscalation(principal, 'esc_1', { resolution: 'Second attempt' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rejects when the escalation does not exist in this tenant', async () => {
    const { svc } = makeService({ escalation: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() } });
    await expect(svc.resolveEscalation(principal, 'esc_missing', { resolution: 'x'.repeat(10) })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('RiskService.breakGlass', () => {
  it('creates a grant with exactly a 1-hour expiry and records a HIGH-priority audit + DPO-alert event', async () => {
    const { svc, prisma, audit, bus } = makeService();
    (prisma.breakGlassGrant.create as jest.Mock).mockImplementation(({ data }: any) => ({ ...data, id: 'grant_1' }));

    const result = await svc.breakGlass(principal, {
      clientId: 'client_1',
      reason: 'Client unreachable after a SEVERE risk flag; welfare check required immediately.',
    });

    const grantedAt = new Date(result.grantedAt).getTime();
    const expiresAt = new Date(result.expiresAt).getTime();
    expect(expiresAt - grantedAt).toBe(60 * 60 * 1000);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'breakglass.invoked',
        actorId: 'user_psy_a',
        after: expect.objectContaining({ severity: 'HIGH' }),
      }),
    );
    expect(bus.publish).toHaveBeenCalledWith(
      'breakglass.invoked',
      'tenant_demo',
      expect.objectContaining({ grantId: 'grant_1', clientId: 'client_1' }),
    );
  });

  it('rejects a break-glass request without a client', async () => {
    const { svc } = makeService({ client: { findFirst: jest.fn().mockResolvedValue(null) } });
    await expect(
      svc.breakGlass(principal, { clientId: 'nope', reason: 'A' + 'x'.repeat(20) }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('RiskService.createSafetyPlan', () => {
  const input = {
    clientId: 'client_1',
    warningSigns: ['Isolating from friends'],
    copingStrategies: ['Call support contact'],
    supportContacts: [] as string[],
    professionalContacts: [] as string[],
  };

  it('starts at version 1 for a client with no prior plan', async () => {
    const { svc, prisma } = makeService();
    (prisma.safetyPlan.create as jest.Mock).mockImplementation(({ data }: any) => ({
      ...data,
      id: 'plan_1',
      createdAt: new Date(),
      supportContacts: data.supportContacts,
      professionalContacts: data.professionalContacts,
    }));

    const plan = await svc.createSafetyPlan(principal, input);
    expect(plan.version).toBe(1);
  });

  it('increments the version on the second plan for the same client (append-only, never mutated)', async () => {
    const { svc, prisma } = makeService();
    (prisma.safetyPlan.findFirst as jest.Mock).mockResolvedValue({ id: 'plan_1', version: 1 });
    (prisma.safetyPlan.create as jest.Mock).mockImplementation(({ data }: any) => ({
      ...data,
      id: 'plan_2',
      createdAt: new Date(),
      supportContacts: data.supportContacts,
      professionalContacts: data.professionalContacts,
    }));

    const plan = await svc.createSafetyPlan(principal, input);
    expect(plan.version).toBe(2);
    expect(prisma.safetyPlan.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ version: 2 }) }),
    );
  });
});
