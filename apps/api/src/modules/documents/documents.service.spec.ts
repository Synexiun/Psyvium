import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '@vpsy/contracts';
import type { AuthPrincipal } from '@vpsy/contracts';
import { DocumentsService } from './documents.service';

/**
 * Wave C — Documents (context 23). Registers document METADATA only (no
 * real blob storage/virus-scan pipeline — see honesty note in
 * documents.service.ts). ABAC: a CLIENT principal may only read their own
 * (ownerType='client') documents; clinician/manager may read any client's.
 */

const clinician: AuthPrincipal = {
  userId: 'user_psy_a',
  tenantId: 'tenant_demo',
  roles: [Role.PSYCHOLOGIST],
  permissions: [],
};

const clientOwner: AuthPrincipal = {
  userId: 'user_client_1',
  tenantId: 'tenant_demo',
  roles: [Role.CLIENT],
  permissions: [],
};

const otherClient: AuthPrincipal = {
  userId: 'user_client_2',
  tenantId: 'tenant_demo',
  roles: [Role.CLIENT],
  permissions: [],
};

function makeService() {
  const prisma = {
    client: {
      findFirst: jest.fn().mockResolvedValue({ id: 'client_1', tenantId: 'tenant_demo', userId: 'user_client_1' }),
    },
    document: {
      create: jest.fn().mockResolvedValue({
        id: 'doc_1',
        ownerType: 'client',
        ownerId: 'client_1',
        category: 'intake-form',
        storageKey: 's3://bucket/key.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        virusScanStatus: 'pending',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      }),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
  };
  const audit = { record: jest.fn() };
  const bus = { publish: jest.fn() };
  const svc = new DocumentsService(prisma as any, audit as any, bus as any);
  return { svc, prisma, audit, bus };
}

describe('DocumentsService', () => {
  it('capabilityStatus documents virusScanStatus workflow notes', () => {
    const { svc } = makeService();
    const status = svc.capabilityStatus();
    expect(status.virusScanWorkflow.statuses).toContain('pending');
    expect(status.virusScanWorkflow.statuses).toContain('clean');
    expect(status.virusScanWorkflow.notes.length).toBeGreaterThan(10);
  });

  it('lists documents pending virus scan for the tenant', async () => {
    const { svc, prisma } = makeService();
    (prisma.document.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'doc_pending',
        ownerType: 'client',
        ownerId: 'client_1',
        category: 'intake-form',
        storageKey: 's3://bucket/key.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        virusScanStatus: 'pending',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
    ]);

    const result = await svc.listPendingVirusScan(clinician);
    expect(prisma.document.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ virusScanStatus: 'pending', tenantId: 'tenant_demo' }),
      }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.virusScanStatus).toBe('pending');
  });

  it('registers document metadata for an existing client and audits it', async () => {
    const { svc, audit, bus } = makeService();

    const result = await svc.create(clinician, {
      ownerType: 'client',
      ownerId: 'client_1',
      category: 'intake-form',
      storageKey: 's3://bucket/key.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
    });

    expect(result.storageKey).toBe('s3://bucket/key.pdf');
    expect(result.virusScanStatus).toBe('pending');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'document.registered' }));
    expect(bus.publish).toHaveBeenCalledWith('document.uploaded', 'tenant_demo', expect.any(Object));
  });

  it('rejects registration when ownerType=client but the client does not exist in this tenant', async () => {
    const { svc, prisma } = makeService();
    (prisma.client.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(
      svc.create(clinician, {
        ownerType: 'client',
        ownerId: 'client_missing',
        category: 'report',
        storageKey: 'k',
        mimeType: 'application/pdf',
        sizeBytes: 1,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lets a CLIENT list their own documents', async () => {
    const { svc, prisma } = makeService();
    (prisma.document.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'doc_1',
        ownerType: 'client',
        ownerId: 'client_1',
        category: 'intake-form',
        storageKey: 's3://bucket/key.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        virusScanStatus: 'pending',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
    ]);

    const result = await svc.listForClient(clientOwner, 'client_1');
    expect(result).toHaveLength(1);
  });

  it('blocks a CLIENT from listing another client’s documents', async () => {
    const { svc } = makeService();
    await expect(svc.listForClient(otherClient, 'client_1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks a CLIENT from reading another client’s document by id', async () => {
    const { svc, prisma } = makeService();
    (prisma.document.findFirst as jest.Mock).mockResolvedValue({
      id: 'doc_1',
      ownerType: 'client',
      ownerId: 'client_1',
      category: 'intake-form',
      storageKey: 's3://bucket/key.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      virusScanStatus: 'pending',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });

    await expect(svc.getById(otherClient, 'doc_1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects getById when the document does not exist in this tenant', async () => {
    const { svc, prisma } = makeService();
    (prisma.document.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(svc.getById(clinician, 'doc_missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});
