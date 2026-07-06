import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '@vpsy/contracts';
import type { AuthPrincipal } from '@vpsy/contracts';
import { RegistryService } from './registry.service';

/**
 * Wave E — Client Registry / Psychologist Registry (contexts 3/4). The admin
 * write surface for person master records: MANAGER/ADMIN only (see the
 * permission-gap note in packages/contracts/src/dto/registry.ts). Every
 * mutating method — and list, since it's a tenant-wide PII enumeration
 * surface — is guarded by `assertRegistryWriter`, tested directly here
 * (independent of the controller's `Permission.CRM_WRITE` guard) exactly as
 * `intervention.service.spec.ts` unit-tests role rejection at the service
 * layer.
 */

const manager: AuthPrincipal = {
  userId: 'user_manager',
  tenantId: 'tenant_demo',
  roles: [Role.MANAGER],
  permissions: [],
};

const admin: AuthPrincipal = {
  userId: 'user_admin',
  tenantId: 'tenant_demo',
  roles: [Role.ADMIN],
  permissions: [],
};

const client: AuthPrincipal = {
  userId: 'user_client',
  tenantId: 'tenant_demo',
  roles: [Role.CLIENT],
  permissions: [],
};

const psychologistPrincipal: AuthPrincipal = {
  userId: 'user_psy_a',
  tenantId: 'tenant_demo',
  roles: [Role.PSYCHOLOGIST],
  permissions: [],
};

function makeClientRow(overrides: Partial<any> = {}) {
  return {
    id: 'client_1',
    userId: 'user_new_client',
    status: 'active',
    preferredLanguage: 'en',
    culturalContext: null,
    demographics: {},
    riskLevel: 'low',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
    user: { id: 'user_new_client', email: 'new.client@example.com', fullName: 'New Client', status: 'INVITED' },
    ...overrides,
  };
}

function makePsychologistRow(overrides: Partial<any> = {}) {
  return {
    id: 'psy_1',
    userId: 'user_new_psy',
    specialties: ['CBT'],
    languages: ['en'],
    bio: null,
    caseloadCap: 30,
    currentCaseload: 0,
    acceptingClients: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
    user: { id: 'user_new_psy', email: 'new.psy@example.com', fullName: 'New Psychologist', status: 'INVITED' },
    credentials: [],
    ...overrides,
  };
}

function makeService() {
  const clientRow = makeClientRow();
  const psychologistRow = makePsychologistRow();

  const prisma = {
    $transaction: jest.fn((fn: (tx: any) => Promise<any>) => fn(prisma)),
    user: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(clientRow.user),
    },
    role: { findUnique: jest.fn().mockResolvedValue({ id: 'role_1', name: 'CLIENT' }) },
    roleAssignment: { create: jest.fn().mockResolvedValue({}) },
    client: {
      create: jest.fn().mockResolvedValue(clientRow),
      findFirst: jest.fn().mockResolvedValue(clientRow),
      update: jest.fn().mockResolvedValue(clientRow),
      findMany: jest.fn().mockResolvedValue([clientRow]),
    },
    psychologist: {
      create: jest.fn().mockResolvedValue(psychologistRow),
      findFirst: jest.fn().mockResolvedValue(psychologistRow),
      update: jest.fn().mockResolvedValue(psychologistRow),
      findMany: jest.fn().mockResolvedValue([psychologistRow]),
    },
  };
  const audit = { record: jest.fn() };
  const bus = { publish: jest.fn() };
  const svc = new RegistryService(prisma as any, audit as any, bus as any);
  return { svc, prisma, audit, bus, clientRow, psychologistRow };
}

describe('RegistryService — Client Registry', () => {
  it('creates a Client + linked User (status INVITED, no email sent) and audits it', async () => {
    const { svc, prisma, audit, bus } = makeService();

    const result = await svc.createClient(manager, {
      email: 'new.client@example.com',
      fullName: 'New Client',
      locale: 'en',
      timezone: 'UTC',
      preferredLanguage: 'en',
      demographics: {},
    });

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'INVITED', email: 'new.client@example.com' }) }),
    );
    expect(result.email).toBe('new.client@example.com');
    expect(result.userStatus).toBe('INVITED');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'registry.client.created' }));
    expect(bus.publish).toHaveBeenCalledWith('client.registered', 'tenant_demo', expect.any(Object));
  });

  it('rejects Client creation when the email already exists in this tenant', async () => {
    const { svc, prisma } = makeService();
    (prisma.user.findFirst as jest.Mock).mockResolvedValue({ id: 'existing_user' });

    await expect(
      svc.createClient(manager, { email: 'dup@example.com', fullName: 'Dup', locale: 'en', timezone: 'UTC', preferredLanguage: 'en', demographics: {} }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('patches a Client and audits before/after', async () => {
    const { svc, prisma, audit } = makeService();

    const result = await svc.patchClient(manager, 'client_1', { preferredLanguage: 'es' });

    expect(prisma.client.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'client_1' }, data: expect.objectContaining({ preferredLanguage: 'es' }) }),
    );
    expect(result.id).toBe('client_1');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'registry.client.updated' }));
  });

  it('rejects patching a Client that does not exist (or is already deleted) in this tenant', async () => {
    const { svc, prisma } = makeService();
    (prisma.client.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(svc.patchClient(manager, 'missing', { preferredLanguage: 'es' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('soft-deletes a Client: sets deletedAt (row is never hard-deleted) and audits critical:true', async () => {
    const { svc, prisma, audit, clientRow } = makeService();
    const deletedAt = new Date('2026-02-01T00:00:00Z');
    (prisma.client.update as jest.Mock).mockResolvedValue({ ...clientRow, deletedAt });

    const result = await svc.softDeleteClient(admin, 'client_1');

    expect(prisma.client.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'client_1' }, data: { deletedAt: expect.any(Date) } }),
    );
    expect(result.deletedAt).toBe(deletedAt.toISOString());
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'registry.client.deleted', critical: true }),
    );
  });

  it('rejects deleting a Client that is already deleted', async () => {
    const { svc, prisma, clientRow } = makeService();
    (prisma.client.findFirst as jest.Mock).mockResolvedValue({ ...clientRow, deletedAt: new Date() });

    await expect(svc.softDeleteClient(admin, 'client_1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('lists Clients with cursor pagination: nextCursor is null when the page is not full', async () => {
    const { svc, prisma, clientRow } = makeService();
    (prisma.client.findMany as jest.Mock).mockResolvedValue([clientRow]);

    const result = await svc.listClients(manager, 25);

    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toBeNull();
  });

  it('lists Clients with cursor pagination: returns a nextCursor and trims to `take` when more rows exist', async () => {
    const { svc, prisma } = makeService();
    const rows = Array.from({ length: 3 }, (_, i) =>
      makeClientRow({ id: `client_${i}`, user: { id: `u_${i}`, email: `c${i}@example.com`, fullName: `C${i}`, status: 'ACTIVE' } }),
    );
    (prisma.client.findMany as jest.Mock).mockResolvedValue(rows); // take=2 -> fetch 3

    const result = await svc.listClients(manager, 2);

    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).toBe('client_1');
  });

  it('rejects a CLIENT principal with 403 on every Registry route (create/patch/delete/list)', async () => {
    const { svc } = makeService();

    await expect(
      svc.createClient(client, { email: 'x@example.com', fullName: 'X', locale: 'en', timezone: 'UTC', preferredLanguage: 'en', demographics: {} }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.patchClient(client, 'client_1', { preferredLanguage: 'es' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(svc.softDeleteClient(client, 'client_1')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.listClients(client, 25)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a PSYCHOLOGIST principal too (registry is MANAGER/ADMIN only, not clinician-authoring)', async () => {
    const { svc } = makeService();

    await expect(svc.listClients(psychologistPrincipal, 25)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('RegistryService — Psychologist Registry', () => {
  it('creates a Psychologist + linked User (status INVITED) and audits it', async () => {
    const { svc, prisma, audit, bus, psychologistRow } = makeService();
    (prisma.user.create as jest.Mock).mockResolvedValue(psychologistRow.user);
    (prisma.role.findUnique as jest.Mock).mockResolvedValue({ id: 'role_2', name: 'PSYCHOLOGIST' });

    const result = await svc.createPsychologist(admin, {
      email: 'new.psy@example.com',
      fullName: 'New Psychologist',
      locale: 'en',
      timezone: 'UTC',
      specialties: ['CBT'],
      languages: ['en'],
      caseloadCap: 30,
    });

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'INVITED' }) }),
    );
    expect(result.email).toBe('new.psy@example.com');
    expect(result.credentialSummary).toBeNull();
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'registry.psychologist.created' }));
    expect(bus.publish).toHaveBeenCalledWith('psychologist.onboarded', 'tenant_demo', expect.any(Object));
  });

  it('patches a Psychologist (caseloadCap/acceptingClients) and audits before/after', async () => {
    const { svc, prisma, audit } = makeService();

    const result = await svc.patchPsychologist(manager, 'psy_1', { caseloadCap: 40, acceptingClients: false });

    expect(prisma.psychologist.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'psy_1' }, data: expect.objectContaining({ caseloadCap: 40, acceptingClients: false }) }),
    );
    expect(result.id).toBe('psy_1');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'registry.psychologist.updated' }));
  });

  it('surfaces the latest Credential as a read-only summary', async () => {
    const { svc, prisma, psychologistRow } = makeService();
    (prisma.psychologist.create as jest.Mock).mockResolvedValue(psychologistRow);
    (prisma.user.create as jest.Mock).mockResolvedValue(psychologistRow.user);
    (prisma.psychologist.findFirst as jest.Mock).mockResolvedValue({
      ...psychologistRow,
      credentials: [
        { jurisdiction: 'CA', verificationStatus: 'verified', malpracticeStatus: 'clear', expiresAt: null },
      ],
    });
    (prisma.psychologist.update as jest.Mock).mockResolvedValue({
      ...psychologistRow,
      credentials: [
        { jurisdiction: 'CA', verificationStatus: 'verified', malpracticeStatus: 'clear', expiresAt: null },
      ],
    });

    const result = await svc.patchPsychologist(manager, 'psy_1', { bio: 'Updated bio' });

    expect(result.credentialSummary).toEqual(
      expect.objectContaining({ jurisdiction: 'CA', verificationStatus: 'verified' }),
    );
  });

  it('soft-deletes a Psychologist: sets deletedAt and audits critical:true', async () => {
    const { svc, prisma, audit, psychologistRow } = makeService();
    const deletedAt = new Date('2026-02-01T00:00:00Z');
    (prisma.psychologist.update as jest.Mock).mockResolvedValue({ ...psychologistRow, deletedAt });

    const result = await svc.softDeletePsychologist(admin, 'psy_1');

    expect(result.deletedAt).toBe(deletedAt.toISOString());
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'registry.psychologist.deleted', critical: true }),
    );
  });

  it('rejects deleting a Psychologist not found in this tenant', async () => {
    const { svc, prisma } = makeService();
    (prisma.psychologist.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(svc.softDeletePsychologist(admin, 'missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lists Psychologists with cursor pagination default page size', async () => {
    const { svc, prisma, psychologistRow } = makeService();
    (prisma.psychologist.findMany as jest.Mock).mockResolvedValue([psychologistRow]);

    const result = await svc.listPsychologists(admin, 25);

    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toBeNull();
  });

  it('rejects a CLIENT principal with 403 on the Psychologist Registry too', async () => {
    const { svc } = makeService();

    await expect(svc.listPsychologists(client, 25)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
