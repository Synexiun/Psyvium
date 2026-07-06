import { UnauthorizedException } from '@nestjs/common';

// otplib transitively imports @scure/base (ESM), which ts-jest (CommonJS) can't
// parse. Mock it so this suite loads; the assertions below only need the enroll
// paths (first-time succeeds; rotate-without/with-invalid-code is rejected BEFORE
// a real TOTP check matters — the mock returns { valid: false }).
jest.mock('otplib', () => ({
  generateSecret: jest.fn(() => 'MOCKBASE32SECRET'),
  generateURI: jest.fn(() => 'otpauth://totp/VPSY%20OS:a@b.c?secret=MOCKBASE32SECRET'),
  verify: jest.fn(() => ({ valid: false })),
}));

import { AuthService } from './auth.service';

/**
 * MFA enrollment proof-of-possession (security review finding): rotating an
 * already-enabled MFA must require a valid current code, so a session holder
 * who lacks the device can't silently re-bind MFA to their own authenticator.
 */
describe('AuthService — MFA enrollment proof of possession', () => {
  const makeService = (user: Record<string, unknown>) => {
    const prisma = {
      user: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(user),
        update: jest.fn().mockResolvedValue(user),
      },
    };
    const jwt = {} as never;
    const audit = { record: jest.fn() } as never;
    return { svc: new AuthService(prisma as never, jwt, audit), prisma };
  };

  it('allows first-time enrollment (MFA not yet enabled) without a current code', async () => {
    const { svc } = makeService({ id: 'u1', email: 'a@b.c', mfaEnabled: false, mfaSecret: null });
    const res = await svc.mfaEnroll('u1');
    expect(res.secret).toBeTruthy();
    expect(res.otpauthUrl).toContain('otpauth://');
  });

  it('rejects rotating an already-enabled MFA when no current code is supplied', async () => {
    const { svc, prisma } = makeService({ id: 'u1', email: 'a@b.c', mfaEnabled: true, mfaSecret: 'JBSWY3DPEHPK3PXP' });
    await expect(svc.mfaEnroll('u1')).rejects.toBeInstanceOf(UnauthorizedException);
    // Critical: the secret must NOT have been overwritten.
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects rotating an already-enabled MFA with an invalid current code', async () => {
    const { svc, prisma } = makeService({ id: 'u1', email: 'a@b.c', mfaEnabled: true, mfaSecret: 'JBSWY3DPEHPK3PXP' });
    await expect(svc.mfaEnroll('u1', '000000')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
