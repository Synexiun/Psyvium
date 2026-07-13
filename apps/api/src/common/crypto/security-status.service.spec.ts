import { SecurityStatusService } from './security-status.service';

describe('SecurityStatusService', () => {
  it('aggregates restore-drill probes', async () => {
    const cipher = {
      isActive: true,
      activeKeyId: 'v1',
      whenReady: async () => undefined,
    };
    const reencrypt = {
      status: async () => ({
        cipherActive: true,
        activeKeyId: 'v1',
        backgroundEnabled: false,
        sealPlaintextDefault: false,
        tables: ['sessionNote'],
      }),
    };
    const siem = {
      isConfigured: true,
      webhookConfigured: true,
      localConfigured: false,
      s3Configured: false,
    };
    const audit = {
      verifyChain: jest.fn().mockResolvedValue({
        ok: true,
        checked: 3,
        tipHash: 'abc',
        tipId: 'e1',
      }),
    };

    process.env.VPSY_DOCUMENT_BLOB_BACKEND = 'local';
    process.env.VPSY_DOCUMENT_VIRUS_SCAN = 'true';

    const svc = new SecurityStatusService(
      cipher as any,
      reencrypt as any,
      siem as any,
      audit as any,
    );
    const status = await svc.status({
      tenantId: 'tenant_1',
      userId: 'u1',
      roles: [],
      permissions: [],
    } as any);

    expect(status.fieldCipher.active).toBe(true);
    expect(status.auditChain.ok).toBe(true);
    expect(status.documents.mode).toBe('blob');
    expect(status.restoreDrill.automatedPass).toBeGreaterThanOrEqual(3);
    expect(status.restoreDrill.items.some((i) => i.id === 'backup-exists' && i.status === 'manual')).toBe(
      true,
    );
  });
});
