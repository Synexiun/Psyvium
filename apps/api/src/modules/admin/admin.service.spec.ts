import { NotFoundException } from '@nestjs/common';
import { Role } from '@vpsy/contracts';
import type { AuthPrincipal } from '@vpsy/contracts';
import { AdminService } from './admin.service';

/**
 * Wave E — Admin Configuration (contexts 2/27): tenant profile, clinic
 * network, and the EU-AI-Act kill-switch feature-flag seam. Gated by
 * `Permission.ADMIN_CONFIG` at the controller (ADMIN-only in rbac.ts — no
 * service-layer role check needed here, unlike RegistryService).
 */

const admin: AuthPrincipal = {
  userId: 'user_admin',
  tenantId: 'tenant_demo',
  roles: [Role.ADMIN],
  permissions: [],
};

function makeService() {
  const tenantRow = {
    id: 'tenant_demo',
    name: 'Demo Tenant',
    countryCode: 'US',
    residencyRegion: 'us-east',
    status: 'active',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
  const clinicRow = {
    id: 'clinic_1',
    tenantId: 'tenant_demo',
    name: 'Main Clinic',
    type: 'VIRTUAL',
    timezone: 'UTC',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
  const flagRow = { id: 'flag_1', key: 'AI_ASSISTED_ANALYSIS', enabled: true, updatedAt: new Date('2026-01-01T00:00:00Z') };

  const prisma = {
    tenant: {
      findUnique: jest.fn().mockResolvedValue(tenantRow),
      update: jest.fn().mockResolvedValue(tenantRow),
    },
    clinic: {
      create: jest.fn().mockResolvedValue(clinicRow),
      findMany: jest.fn().mockResolvedValue([clinicRow]),
      findFirst: jest.fn().mockResolvedValue(clinicRow),
      update: jest.fn().mockResolvedValue(clinicRow),
    },
    featureFlag: {
      findMany: jest.fn().mockResolvedValue([flagRow]),
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue(flagRow),
    },
  };
  const audit = { record: jest.fn() };
  const bus = { publish: jest.fn() };
  const flags = {
    listForTenant: jest.fn().mockResolvedValue([
      {
        id: flagRow.id,
        key: flagRow.key,
        enabled: flagRow.enabled,
        updatedAt: flagRow.updatedAt.toISOString(),
      },
    ]),
    isEnabled: jest.fn().mockResolvedValue(true),
  };
  const svc = new AdminService(prisma as any, audit as any, bus as any, flags as any);
  return { svc, prisma, audit, bus, flags, tenantRow, clinicRow, flagRow };
}

describe('AdminService — Tenant', () => {
  it('reads the current tenant', async () => {
    const { svc, prisma } = makeService();

    const result = await svc.getTenant(admin);

    expect(prisma.tenant.findUnique).toHaveBeenCalledWith({ where: { id: 'tenant_demo' } });
    expect(result.id).toBe('tenant_demo');
  });

  it('rejects reading a tenant that does not exist', async () => {
    const { svc, prisma } = makeService();
    (prisma.tenant.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(svc.getTenant(admin)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('patches tenant fields and audits before/after', async () => {
    const { svc, prisma, audit } = makeService();
    (prisma.tenant.update as jest.Mock).mockResolvedValue({
      id: 'tenant_demo',
      name: 'Renamed Tenant',
      countryCode: 'CA',
      residencyRegion: 'ca-central',
      status: 'active',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-02-01T00:00:00Z'),
    });

    const result = await svc.patchTenant(admin, { name: 'Renamed Tenant', countryCode: 'CA', residencyRegion: 'ca-central' });

    expect(result.name).toBe('Renamed Tenant');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'admin.tenant.updated' }));
  });
});

describe('AdminService — Clinics', () => {
  it('creates a Clinic and audits it', async () => {
    const { svc, prisma, audit } = makeService();

    const result = await svc.createClinic(admin, { name: 'Main Clinic', type: 'VIRTUAL', timezone: 'UTC' });

    expect(result.name).toBe('Main Clinic');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'admin.clinic.created' }));
  });

  it('lists Clinics for the tenant', async () => {
    const { svc, prisma } = makeService();

    const result = await svc.listClinics(admin);

    expect(prisma.clinic.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 'tenant_demo' } }));
    expect(result).toHaveLength(1);
  });

  it('patches a Clinic and audits before/after', async () => {
    const { svc, prisma, audit } = makeService();
    (prisma.clinic.update as jest.Mock).mockResolvedValue({
      id: 'clinic_1',
      tenantId: 'tenant_demo',
      name: 'Renamed Clinic',
      type: 'HYBRID',
      timezone: 'America/New_York',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-02-01T00:00:00Z'),
    });

    const result = await svc.patchClinic(admin, 'clinic_1', { name: 'Renamed Clinic', type: 'HYBRID' });

    expect(result.name).toBe('Renamed Clinic');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'admin.clinic.updated' }));
  });

  it('rejects patching a Clinic not found in this tenant', async () => {
    const { svc, prisma } = makeService();
    (prisma.clinic.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(svc.patchClinic(admin, 'missing', { name: 'x' })).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('AdminService — Feature flags (EU-AI-Act kill-switch seam)', () => {
  it('lists feature flags for the tenant via FeatureFlagsService', async () => {
    const { svc, flags } = makeService();

    const result = await svc.listFeatureFlags(admin);

    expect(flags.listForTenant).toHaveBeenCalledWith('tenant_demo');
    expect(result).toHaveLength(1);
    expect(result[0]!.key).toBe('AI_ASSISTED_ANALYSIS');
  });

  it('upserts (creates) a new flag and audits the write', async () => {
    const { svc, prisma, audit, bus } = makeService();

    const result = await svc.upsertFeatureFlag(admin, { key: 'AI_ASSISTED_ANALYSIS', enabled: false });

    expect(prisma.featureFlag.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId_key: { tenantId: 'tenant_demo', key: 'AI_ASSISTED_ANALYSIS' } },
        create: { tenantId: 'tenant_demo', key: 'AI_ASSISTED_ANALYSIS', enabled: false },
        update: { enabled: false },
      }),
    );
    expect(result.key).toBe('AI_ASSISTED_ANALYSIS');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'admin.feature_flag.upserted', before: null }),
    );
    expect(bus.publish).toHaveBeenCalledWith(
      'admin.config_changed',
      'tenant_demo',
      expect.objectContaining({ entity: 'FeatureFlag', key: 'AI_ASSISTED_ANALYSIS' }),
    );
  });

  it('upserts (flips) an existing flag and audits before/after enabled state', async () => {
    const { svc, prisma, audit } = makeService();
    (prisma.featureFlag.findUnique as jest.Mock).mockResolvedValue({ id: 'flag_1', key: 'AI_ASSISTED_ANALYSIS', enabled: true, updatedAt: new Date() });
    (prisma.featureFlag.upsert as jest.Mock).mockResolvedValue({ id: 'flag_1', key: 'AI_ASSISTED_ANALYSIS', enabled: false, updatedAt: new Date() });

    const result = await svc.upsertFeatureFlag(admin, { key: 'AI_ASSISTED_ANALYSIS', enabled: false });

    expect(result.enabled).toBe(false);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'admin.feature_flag.upserted', before: { enabled: true }, after: expect.objectContaining({ enabled: false }) }),
    );
  });
});
