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

  it('is unaffected by a missing/revoked AI_ASSISTED_ANALYSIS consent — that type is never required for intake', async () => {
    const svc = makeService([
      { type: 'TELEPSYCHOLOGY', version: currentTelepsychologyVersion, revokedAt: null },
      { type: 'DATA_PROCESSING', version: currentDataProcessingVersion, revokedAt: null },
    ]);
    await expect(svc.assertRequiredConsents('client_1')).resolves.toBeUndefined();
  });
});

/**
 * WAVE CR — AI-consent gate (APA AI guidance 2025 / GDPR Art.22). Unlike
 * `assertRequiredConsents`, `hasActiveAiConsent` never throws — it is a
 * boolean check consumed by `AiGatewayService` to decide whether a real
 * model call is permitted for a given client.
 */
describe('ConsentService.hasActiveAiConsent', () => {
  function makeService(consent: { type: string; version: string; revokedAt: Date | null } | null) {
    const prisma = {
      consent: {
        findFirst: jest.fn().mockResolvedValue(consent),
      },
    };
    const audit = { record: jest.fn() };
    return { svc: new ConsentService(prisma as any, audit as any), prisma };
  }

  it('returns true for a non-revoked, current-version AI_ASSISTED_ANALYSIS grant', async () => {
    const { svc, prisma } = makeService({ type: 'AI_ASSISTED_ANALYSIS', version: '1.0.0', revokedAt: null });
    await expect(svc.hasActiveAiConsent('client_1')).resolves.toBe(true);
    expect(prisma.consent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ clientId: 'client_1', type: 'AI_ASSISTED_ANALYSIS', revokedAt: null }),
      }),
    );
  });

  it('returns false when no AI_ASSISTED_ANALYSIS consent exists', async () => {
    const { svc } = makeService(null);
    await expect(svc.hasActiveAiConsent('client_1')).resolves.toBe(false);
  });

  it('returns false when the consent was revoked (query excludes revoked rows)', async () => {
    // revokedAt: null is baked into the query itself, so a revoked grant
    // simply never comes back from prisma — mirrors assertRequiredConsents.
    const { svc } = makeService(null);
    await expect(svc.hasActiveAiConsent('client_1')).resolves.toBe(false);
  });
});
