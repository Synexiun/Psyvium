import { ConflictException, NotFoundException } from '@nestjs/common';
import { Role, type AuthPrincipal } from '@vpsy/contracts';
import { MatchingService } from './matching.service';

/**
 * Manager triage safety: reject (PROPOSED → CLOSED) and hold (PROPOSED stays,
 * note + on_hold audit). Only PROPOSED rows may be triaged this way; concurrent
 * CAS prevents double-decision races.
 */

const manager: AuthPrincipal = {
  userId: 'user_manager',
  tenantId: 'tenant_demo',
  roles: [Role.MANAGER],
  permissions: ['assignment:approve', 'assignment:read'],
};

const proposedRow = {
  id: 'assignment_1',
  tenantId: 'tenant_demo',
  clientId: 'client_1',
  psychologistId: null as string | null,
  status: 'PROPOSED',
  proposedBy: 'AI',
  approvedBy: null as string | null,
  managerNote: null as string | null,
  candidates: [],
  rank: 0,
  createdAt: new Date('2026-07-01T00:00:00Z'),
  updatedAt: new Date('2026-07-01T00:00:00Z'),
  deletedAt: null as Date | null,
};

function makeService(overrides: {
  findFirst?: unknown;
  updateManyCount?: number;
  findFirstOrThrow?: unknown;
} = {}) {
  let lastUpdateData: Record<string, unknown> | undefined;
  const prisma = {
    assignment: {
      findFirst: jest.fn().mockResolvedValue(
        overrides.findFirst === undefined ? proposedRow : overrides.findFirst,
      ),
      updateMany: jest.fn().mockImplementation(async ({ data }: { data?: Record<string, unknown> }) => {
        lastUpdateData = data;
        return { count: overrides.updateManyCount ?? 1 };
      }),
      findFirstOrThrow: jest.fn().mockImplementation(async () => {
        if (overrides.findFirstOrThrow !== undefined) return overrides.findFirstOrThrow;
        return {
          ...proposedRow,
          ...lastUpdateData,
        };
      }),
      update: jest.fn(),
    },
  };
  const audit = { record: jest.fn() };
  const bus = { publish: jest.fn(), subscribe: jest.fn() };
  const ai = { rankCandidates: jest.fn() };
  const svc = new MatchingService(prisma as any, ai as any, audit as any, bus as any);
  return { svc, prisma, audit, bus };
}

describe('MatchingService.reject', () => {
  it('moves PROPOSED → CLOSED with critical audit and AssignmentRejected event', async () => {
    const { svc, prisma, audit, bus } = makeService();

    const result = await svc.reject(manager, {
      assignmentId: 'assignment_1',
      reason: 'No credentialed clinician available in client jurisdiction',
    });

    expect(result.status).toBe('CLOSED');
    expect(prisma.assignment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'PROPOSED' }),
        data: expect.objectContaining({ status: 'CLOSED' }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'assignment.rejected',
        critical: true,
        before: { status: 'PROPOSED' },
        after: expect.objectContaining({ status: 'CLOSED' }),
      }),
    );
    expect(bus.publish).toHaveBeenCalledWith(
      'assignment.rejected',
      'tenant_demo',
      expect.objectContaining({ assignmentId: 'assignment_1', clientId: 'client_1' }),
    );
  });

  it('refuses reject when assignment is not PROPOSED', async () => {
    const { svc, audit } = makeService({
      findFirst: { ...proposedRow, status: 'APPROVED' },
    });

    await expect(
      svc.reject(manager, { assignmentId: 'assignment_1', reason: 'too late' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('404s when assignment is missing', async () => {
    const { svc } = makeService({ findFirst: null });
    await expect(
      svc.reject(manager, { assignmentId: 'missing', reason: 'n/a' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('conflicts when a concurrent manager already decided (CAS count=0)', async () => {
    const { svc } = makeService({ updateManyCount: 0 });
    await expect(
      svc.reject(manager, { assignmentId: 'assignment_1', reason: 'race' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('MatchingService.hold', () => {
  it('keeps PROPOSED, stamps ON_HOLD note, audits status on_hold', async () => {
    const { svc, prisma, audit, bus } = makeService();

    const result = await svc.hold(manager, {
      assignmentId: 'assignment_1',
      reason: 'Awaiting additional screening results',
    });

    expect(prisma.assignment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          managerNote: expect.stringContaining('[ON_HOLD]'),
        }),
      }),
    );
    expect(result.holdStatus).toBe('on_hold');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'assignment.held',
        critical: true,
        after: expect.objectContaining({ status: 'on_hold' }),
      }),
    );
    expect(bus.publish).toHaveBeenCalledWith(
      'assignment.held',
      'tenant_demo',
      expect.objectContaining({ assignmentId: 'assignment_1' }),
    );
  });
});
