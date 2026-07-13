import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role, type AuthPrincipal } from '@vpsy/contracts';
import { ClinicalAccessService } from './clinical-access.service';

const principal = (roles: Role[], userId = 'user_1'): AuthPrincipal => ({
  userId,
  tenantId: 'tenant_1',
  roles,
  permissions: [],
});

describe('ClinicalAccessService', () => {
  const prisma = {
    client: { findFirst: jest.fn() },
    assignment: { findFirst: jest.fn(), findMany: jest.fn() },
    breakGlassGrant: { findFirst: jest.fn(), findMany: jest.fn() },
  } as any;
  const service = new ClinicalAccessService(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.client.findFirst.mockResolvedValue({ id: 'client_1', userId: 'client_user' });
    prisma.assignment.findFirst.mockResolvedValue(null);
    prisma.breakGlassGrant.findFirst.mockResolvedValue(null);
    prisma.assignment.findMany.mockResolvedValue([]);
    prisma.breakGlassGrant.findMany.mockResolvedValue([]);
  });

  it('allows a client to access only their own record', async () => {
    await expect(service.assertCanAccessClient(principal([Role.CLIENT], 'client_user'), 'client_1')).resolves.toBeUndefined();
    await expect(service.assertCanAccessClient(principal([Role.CLIENT], 'other_user'), 'client_1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('allows the active assigned psychologist', async () => {
    prisma.assignment.findFirst.mockResolvedValue({ id: 'assignment_1' });
    await expect(service.assertCanAccessClient(principal([Role.PSYCHOLOGIST]), 'client_1')).resolves.toBeUndefined();
    expect(prisma.assignment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ clientId: 'client_1', tenantId: 'tenant_1' }),
      }),
    );
  });

  it('treats an unexpired break-glass grant as temporary access', async () => {
    prisma.breakGlassGrant.findFirst.mockResolvedValue({ id: 'grant_1' });
    await expect(service.assertCanAccessClient(principal([Role.PSYCHOLOGIST]), 'client_1')).resolves.toBeUndefined();
  });

  it('allows managers but not administrative or finance roles to read clinical data', async () => {
    await expect(service.assertCanAccessClient(principal([Role.MANAGER]), 'client_1')).resolves.toBeUndefined();
    await expect(service.assertCanAccessClient(principal([Role.ADMIN]), 'client_1')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.assertCanAccessClient(principal([Role.FINANCE]), 'client_1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not reveal a missing or cross-tenant client', async () => {
    prisma.client.findFirst.mockResolvedValue(null);
    await expect(service.assertCanAccessClient(principal([Role.MANAGER]), 'foreign_client')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('builds a finite psychologist board scope from assignments and active break-glass grants', async () => {
    prisma.assignment.findMany.mockResolvedValue([{ clientId: 'client_1' }]);
    prisma.breakGlassGrant.findMany.mockResolvedValue([{ clientId: 'client_2' }]);
    await expect(service.listAccessibleClientIds(principal([Role.PSYCHOLOGIST]))).resolves.toEqual([
      'client_1',
      'client_2',
    ]);
  });
});
