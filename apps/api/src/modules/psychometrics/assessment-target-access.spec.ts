import { ForbiddenException } from '@nestjs/common';
import { Role, type AuthPrincipal } from '@vpsy/contracts';
import { assertAuthorizedAssessmentTarget } from './assessment-target-access';

const basePrincipal: AuthPrincipal = {
  userId: 'user_1',
  tenantId: 'tenant_1',
  roles: [],
  permissions: [],
};

function harness(options: { psychologistId?: string | null; assignmentId?: string | null } = {}) {
  const prisma = {
    psychologist: {
      findFirst: jest.fn().mockResolvedValue(
        options.psychologistId === undefined
          ? { id: 'psychologist_1' }
          : options.psychologistId
            ? { id: options.psychologistId }
            : null,
      ),
    },
    assignment: {
      findFirst: jest.fn().mockResolvedValue(
        options.assignmentId === undefined
          ? { id: 'assignment_1' }
          : options.assignmentId
            ? { id: options.assignmentId }
            : null,
      ),
    },
  };
  return prisma;
}

describe('assessment target access', () => {
  it('allows a client to administer their own assessment without a clinician lookup', async () => {
    const prisma = harness();
    const principal = { ...basePrincipal, userId: 'client_user', roles: [Role.CLIENT] };

    await expect(
      assertAuthorizedAssessmentTarget(prisma, principal, { id: 'client_1', userId: 'client_user' }),
    ).resolves.toBeUndefined();
    expect(prisma.psychologist.findFirst).not.toHaveBeenCalled();
    expect(prisma.assignment.findFirst).not.toHaveBeenCalled();
  });

  it('blocks a client targeting another client', async () => {
    const prisma = harness({ psychologistId: null });
    const principal = { ...basePrincipal, userId: 'intruder', roles: [Role.CLIENT] };

    await expect(
      assertAuthorizedAssessmentTarget(prisma, principal, { id: 'client_1', userId: 'owner' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows an active psychologist with an approved/active assignment to the target', async () => {
    const prisma = harness();
    const principal = { ...basePrincipal, userId: 'psychologist_user', roles: [Role.PSYCHOLOGIST] };

    await expect(
      assertAuthorizedAssessmentTarget(prisma, principal, { id: 'client_1', userId: 'client_user' }),
    ).resolves.toBeUndefined();
    expect(prisma.assignment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'tenant_1',
          clientId: 'client_1',
          psychologistId: 'psychologist_1',
          status: { in: ['APPROVED', 'ACTIVE'] },
        }),
      }),
    );
  });

  it('blocks a psychologist who is not assigned to the target', async () => {
    const prisma = harness({ assignmentId: null });
    const principal = { ...basePrincipal, roles: [Role.PSYCHOLOGIST] };

    await expect(
      assertAuthorizedAssessmentTarget(prisma, principal, { id: 'client_1', userId: 'client_user' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('fails closed for a principal without a supported target relationship', async () => {
    const prisma = harness();

    await expect(
      assertAuthorizedAssessmentTarget(prisma, basePrincipal, { id: 'client_1', userId: 'client_user' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
