import { ForbiddenException } from '@nestjs/common';
import { assertActiveInstrumentLicense } from './instrument-license';

describe('assertActiveInstrumentLicense (doc 07 §2)', () => {
  const licensedQ = { id: 'q_lic', code: 'MMPI-2', licensing: 'LICENSED' };
  const publicQ = { id: 'q_phq', code: 'PHQ9', licensing: 'PUBLIC_DOMAIN' };

  function prismaWithGrant(grant: { status: string; expiresAt: Date | null } | null) {
    return {
      instrumentLicenseGrant: {
        findUnique: jest.fn().mockResolvedValue(grant),
      },
    };
  }

  it('allows PUBLIC_DOMAIN without any grant lookup', async () => {
    const prisma = prismaWithGrant(null);
    await expect(
      assertActiveInstrumentLicense(prisma, 'tenant_demo', publicQ),
    ).resolves.toBeUndefined();
    expect(prisma.instrumentLicenseGrant.findUnique).not.toHaveBeenCalled();
  });

  it('403 LICENSE_REQUIRED when no grant exists for a LICENSED instrument', async () => {
    const prisma = prismaWithGrant(null);
    await expect(
      assertActiveInstrumentLicense(prisma, 'tenant_demo', licensedQ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      assertActiveInstrumentLicense(prisma, 'tenant_demo', licensedQ),
    ).rejects.toThrow(/LICENSE_REQUIRED/);
  });

  it('403 when grant is REVOKED', async () => {
    const prisma = prismaWithGrant({ status: 'REVOKED', expiresAt: null });
    await expect(
      assertActiveInstrumentLicense(prisma, 'tenant_demo', licensedQ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('403 when grant is expired', async () => {
    const prisma = prismaWithGrant({
      status: 'ACTIVE',
      expiresAt: new Date('2020-01-01T00:00:00Z'),
    });
    await expect(
      assertActiveInstrumentLicense(prisma, 'tenant_demo', licensedQ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows ACTIVE unexpired grant for LICENSED instrument', async () => {
    const prisma = prismaWithGrant({
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    await expect(
      assertActiveInstrumentLicense(prisma, 'tenant_demo', licensedQ),
    ).resolves.toBeUndefined();
  });

  it('allows ACTIVE grant with null expiresAt (no end date)', async () => {
    const prisma = prismaWithGrant({ status: 'ACTIVE', expiresAt: null });
    await expect(
      assertActiveInstrumentLicense(prisma, 'tenant_demo', {
        id: 'q_prop',
        code: 'CUSTOM',
        licensing: 'PROPRIETARY',
      }),
    ).resolves.toBeUndefined();
  });
});
