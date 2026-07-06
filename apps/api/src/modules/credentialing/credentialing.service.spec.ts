import { ForbiddenException } from '@nestjs/common';
import { CredentialingService } from './credentialing.service';

/**
 * Phase 2 DoD (docs/technical/13-roadmap-and-phases.md): "Clinical writes
 * blocked when license inactive or jurisdiction/scope mismatched (ABAC
 * proven)." These tests pin `assertClinicalEligibility`, the check
 * `ClinicalWriteGuard` calls on every clinical write.
 */
describe('CredentialingService.assertClinicalEligibility', () => {
  const verifiedActive = {
    id: 'cred_1',
    psychologistId: 'psy_1',
    licenseNumber: 'NY-PSY-1',
    jurisdiction: 'US-NY',
    issuingBody: 'NY State Board',
    expiresAt: null as Date | null,
    verificationStatus: 'verified',
    malpracticeStatus: 'active',
    createdAt: new Date(),
  };

  function makeService(psychologist: { userId: string; credentials: Array<typeof verifiedActive> } | null) {
    const prisma = {
      psychologist: {
        findFirst: jest.fn().mockResolvedValue(psychologist),
      },
    };
    const audit = { record: jest.fn() };
    return new CredentialingService(prisma as any, audit as any);
  }

  it('allows a verified, active, jurisdiction-matched credential', async () => {
    const svc = makeService({ userId: 'user_psy_a', credentials: [verifiedActive] });
    await expect(svc.assertClinicalEligibility('user_psy_a', 'US-NY')).resolves.toBeUndefined();
  });

  it('blocks when no credential is verified', async () => {
    const svc = makeService({
      userId: 'user_psy_a',
      credentials: [{ ...verifiedActive, verificationStatus: 'pending' }],
    });
    await expect(svc.assertClinicalEligibility('user_psy_a', 'US-NY')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks when the credential has expired', async () => {
    const svc = makeService({
      userId: 'user_psy_a',
      credentials: [{ ...verifiedActive, expiresAt: new Date(Date.now() - 86_400_000) }],
    });
    await expect(svc.assertClinicalEligibility('user_psy_a', 'US-NY')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks when malpractice status is not active', async () => {
    const svc = makeService({
      userId: 'user_psy_a',
      credentials: [{ ...verifiedActive, malpracticeStatus: 'lapsed' }],
    });
    await expect(svc.assertClinicalEligibility('user_psy_a', 'US-NY')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks on jurisdiction mismatch even with an otherwise valid credential', async () => {
    const svc = makeService({ userId: 'user_psy_a', credentials: [verifiedActive] });
    await expect(svc.assertClinicalEligibility('user_psy_a', 'US-CA')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks when the principal has no jurisdiction claim at all', async () => {
    const svc = makeService({ userId: 'user_psy_a', credentials: [verifiedActive] });
    await expect(svc.assertClinicalEligibility('user_psy_a', undefined)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks when the user has no psychologist/credential profile', async () => {
    const svc = makeService(null);
    await expect(svc.assertClinicalEligibility('user_no_profile', 'US-NY')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows a non-expiring credential (expiresAt null) that is otherwise valid', async () => {
    const svc = makeService({ userId: 'user_psy_a', credentials: [{ ...verifiedActive, expiresAt: null }] });
    await expect(svc.assertClinicalEligibility('user_psy_a', 'US-NY')).resolves.toBeUndefined();
  });

  it('allows when at least one of several credentials qualifies', async () => {
    const svc = makeService({
      userId: 'user_psy_a',
      credentials: [
        { ...verifiedActive, jurisdiction: 'US-CA', verificationStatus: 'pending' },
        verifiedActive,
      ],
    });
    await expect(svc.assertClinicalEligibility('user_psy_a', 'US-NY')).resolves.toBeUndefined();
  });
});
