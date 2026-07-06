import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AuthPrincipal, RecordWearableMetricInput } from '@vpsy/contracts';
import { WearablesService } from './wearables.service';

/**
 * Doc 09 §5 (P0 clinical-safety): "The ingestion consent gate rejects any
 * point whose category lacks an active grant (`consent_id` is mandatory on
 * every row — unconsented data physically cannot be stored)." These tests
 * pin that WearablesService.ingest enforces the gate against the *live*
 * Consent row (not just the device's stored consentId pointer), since
 * revocation must stop ingestion immediately.
 */

const principal: AuthPrincipal = {
  userId: 'user_client',
  tenantId: 'tenant_demo',
  roles: [],
  permissions: [],
};

const clientRow = { id: 'client_1', tenantId: 'tenant_demo', deletedAt: null };

const deviceRow = {
  id: 'device_1',
  tenantId: 'tenant_demo',
  clientId: 'client_1',
  consentId: 'consent_1',
  deletedAt: null,
};

const activeConsentRow = {
  id: 'consent_1',
  clientId: 'client_1',
  type: 'DATA_PROCESSING',
  version: '1.0.0',
  revokedAt: null,
};

const input: RecordWearableMetricInput = {
  clientId: 'client_1',
  deviceId: 'device_1',
  kind: 'hrv',
  value: 65,
  unit: 'ms',
  recordedAt: '2026-07-01T07:00:00.000Z',
};

function makeService(overrides: Partial<Record<string, unknown>> = {}) {
  const prisma = {
    client: {
      findFirst: jest.fn().mockResolvedValue(clientRow),
    },
    wearableDevice: {
      findFirst: jest.fn().mockResolvedValue(deviceRow),
      findMany: jest.fn().mockResolvedValue([deviceRow]),
      update: jest.fn().mockResolvedValue({ ...deviceRow, lastSyncAt: new Date() }),
    },
    consent: {
      findFirst: jest.fn().mockResolvedValue(activeConsentRow),
    },
    wearableMetric: {
      create: jest.fn().mockImplementation(({ data }: any) => ({
        id: 'metric_1',
        deviceId: data.deviceId,
        kind: data.kind,
        value: data.value,
        unit: data.unit ?? null,
        recordedAt: data.recordedAt,
      })),
      findMany: jest.fn().mockResolvedValue([]),
    },
    ...overrides,
  };
  const audit = { record: jest.fn() };
  const svc = new WearablesService(prisma as any, audit as any);
  return { svc, prisma, audit };
}

describe('WearablesService.ingest — consent gate (doc 09 §5, P0 clinical-safety)', () => {
  it('rejects ingestion when the device/point has no active, non-revoked consent grant', async () => {
    const { svc, prisma, audit } = makeService({
      consent: { findFirst: jest.fn().mockResolvedValue(null) },
    });

    await expect(svc.ingest(principal, input)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.wearableMetric.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('rejects ingestion when the consent grant behind the device has been revoked', async () => {
    const { svc, prisma, audit } = makeService({
      // The service re-queries the live Consent row with revokedAt: null,
      // so a revoked grant simply never matches — mirroring ConsentService's
      // own pattern (see consent.service.spec.ts).
      consent: { findFirst: jest.fn().mockResolvedValue(null) },
    });

    await expect(svc.ingest(principal, input)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.wearableMetric.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('rejects ingestion when the device itself has no consentId on file', async () => {
    const { svc, prisma } = makeService({
      wearableDevice: {
        findFirst: jest.fn().mockResolvedValue({ ...deviceRow, consentId: null }),
        findMany: jest.fn().mockResolvedValue([{ ...deviceRow, consentId: null }]),
        update: jest.fn(),
      },
      consent: { findFirst: jest.fn().mockResolvedValue(null) },
    });

    await expect(svc.ingest(principal, input)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.wearableMetric.create).not.toHaveBeenCalled();
  });

  it('succeeds and stamps the metric with the active consentId when a valid grant exists', async () => {
    const { svc, prisma, audit } = makeService();

    const result = await svc.ingest(principal, input);

    expect(result.id).toBe('metric_1');
    expect(prisma.consent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'consent_1', clientId: 'client_1', revokedAt: null }),
      }),
    );
    expect(prisma.wearableMetric.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ consentId: 'consent_1' }) }),
    );
    expect(prisma.wearableDevice.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'device_1' } }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'wearable.metric.ingested', entityId: 'metric_1' }),
    );
  });

  it('rejects with NotFoundException when the client does not exist in this tenant', async () => {
    const { svc, prisma } = makeService({ client: { findFirst: jest.fn().mockResolvedValue(null) } });
    await expect(svc.ingest(principal, input)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.wearableDevice.findFirst).not.toHaveBeenCalled();
  });
});
