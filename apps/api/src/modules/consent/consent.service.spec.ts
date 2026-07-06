import { ConflictException } from '@nestjs/common';
import { REQUIRED_CONSENT_VERSIONS } from '@vpsy/contracts';
import { ConsentService } from './consent.service';

/**
 * Phase 2 DoD: "Consent versioning live; intake respects purpose scope."
 * Pins `assertRequiredConsents`, the gate `IntakeService.submit` calls
 * before an intake is ever created.
 */
describe('ConsentService.assertRequiredConsents', () => {
  function makeService(consents: Array<{ type: string; version: string; revokedAt: Date | null }>) {
    const prisma = {
      consent: {
        findMany: jest.fn().mockResolvedValue(consents),
      },
    };
    const audit = { record: jest.fn() };
    return new ConsentService(prisma as any, audit as any);
  }

  const currentTelepsychologyVersion = REQUIRED_CONSENT_VERSIONS.TELEPSYCHOLOGY!;
  const currentDataProcessingVersion = REQUIRED_CONSENT_VERSIONS.DATA_PROCESSING!;

  it('allows when all required consents are granted at the current version', async () => {
    const svc = makeService([
      { type: 'TELEPSYCHOLOGY', version: currentTelepsychologyVersion, revokedAt: null },
      { type: 'DATA_PROCESSING', version: currentDataProcessingVersion, revokedAt: null },
    ]);
    await expect(svc.assertRequiredConsents('client_1')).resolves.toBeUndefined();
  });

  it('blocks when a required consent is entirely missing', async () => {
    const svc = makeService([{ type: 'TELEPSYCHOLOGY', version: currentTelepsychologyVersion, revokedAt: null }]);
    await expect(svc.assertRequiredConsents('client_1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('blocks when a required consent is on a stale version', async () => {
    const svc = makeService([
      { type: 'TELEPSYCHOLOGY', version: '0.9.0', revokedAt: null },
      { type: 'DATA_PROCESSING', version: currentDataProcessingVersion, revokedAt: null },
    ]);
    await expect(svc.assertRequiredConsents('client_1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('blocks when a required consent was revoked (query excludes revoked rows)', async () => {
    // The service queries with revokedAt: null, so a revoked row simply
    // never appears among the candidates passed in here.
    const svc = makeService([{ type: 'DATA_PROCESSING', version: currentDataProcessingVersion, revokedAt: null }]);
    await expect(svc.assertRequiredConsents('client_1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('is unaffected by an unrelated non-required consent type', async () => {
    const svc = makeService([
      { type: 'TELEPSYCHOLOGY', version: currentTelepsychologyVersion, revokedAt: null },
      { type: 'DATA_PROCESSING', version: currentDataProcessingVersion, revokedAt: null },
      { type: 'RECORDING', version: '1.0.0', revokedAt: null },
    ]);
    await expect(svc.assertRequiredConsents('client_1')).resolves.toBeUndefined();
  });
});
