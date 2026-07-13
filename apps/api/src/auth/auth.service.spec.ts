import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { createHash } from 'node:crypto';

jest.mock('otplib', () => ({
  generateSecret: jest.fn(() => 'MOCKBASE32SECRET'),
  generateURI: jest.fn(() => 'otpauth://totp/VPSY%20OS:a@b.c?secret=MOCKBASE32SECRET'),
  verify: jest.fn(() => ({ valid: false })),
}));

import { AuthService } from './auth.service';

const TENANT_ID = 'tenant_1';
const USER_ID = 'user_1';
const previousAccessSecret = process.env.JWT_ACCESS_SECRET;
const previousRefreshSecret = process.env.JWT_REFRESH_SECRET;

beforeAll(() => {
  process.env.JWT_ACCESS_SECRET = 'test-access-secret-at-least-16-chars';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-at-least-16-chars';
});

afterAll(() => {
  if (previousAccessSecret === undefined) delete process.env.JWT_ACCESS_SECRET;
  else process.env.JWT_ACCESS_SECRET = previousAccessSecret;
  if (previousRefreshSecret === undefined) delete process.env.JWT_REFRESH_SECRET;
  else process.env.JWT_REFRESH_SECRET = previousRefreshSecret;
});

function tokenUser(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    tenantId: TENANT_ID,
    email: 'client@example.com',
    hashedPassword: 'hash',
    fullName: 'Client One',
    status: 'ACTIVE',
    deletedAt: null,
    authVersion: 0,
    mfaEnabled: false,
    mfaSecret: null,
    mfaPendingSecret: null,
    tenant: { id: TENANT_ID, status: 'active' },
    roleAssignments: [
      {
        clinicId: null,
        jurisdiction: null,
        role: { name: 'CLIENT', permissions: [] },
      },
    ],
    ...overrides,
  };
}

function makeHarness() {
  const prisma: Record<string, any> = {
    tenant: { findMany: jest.fn() },
    role: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'role_client', name: 'CLIENT' }) },
    user: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
    },
    client: { create: jest.fn() },
    roleAssignment: { create: jest.fn() },
    refreshSession: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    passwordResetToken: {
      create: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  prisma.$transaction = jest.fn(async (callback: (tx: typeof prisma) => unknown) => callback(prisma));

  const jwt = {
    signAsync: jest.fn(async (payload: Record<string, unknown>): Promise<string> =>
      payload.typ === 'refresh' ? 'refresh-token' : 'access-token',
    ),
    verifyAsync: jest.fn(),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const email = {
    isLive: false,
    sendPasswordReset: jest.fn().mockResolvedValue({ delivered: false, provider: 'console' }),
    send: jest.fn(),
  };
  const cipher = {
    isActive: true,
    encryptString: jest.fn(async (value: string) => `encrypted:${value}`),
    decryptString: jest.fn(async (value: string) => value.replace(/^encrypted:/, '')),
  };
  const svc = new AuthService(prisma as never, jwt as never, audit as never, cipher as never, email as never);
  return { svc, prisma, jwt, audit, cipher, email };
}

describe('AuthService — tenant-aware onboarding', () => {
  it('atomically creates User, CLIENT assignment, and Client under an explicitly eligible tenant', async () => {
    const { svc, prisma } = makeHarness();
    prisma.tenant.findMany.mockResolvedValue([{ id: TENANT_ID }]);
    prisma.user.create.mockResolvedValue({ id: USER_ID });
    prisma.user.findUniqueOrThrow.mockResolvedValue(tokenUser());

    const result = await svc.register({
      email: ' CLIENT@Example.com ',
      password: 'correct horse battery staple',
      fullName: 'Client One',
      locale: 'en',
      timezone: 'UTC',
      tenantSlug: 'clinic-one',
    });

    expect(prisma.tenant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ slug: 'clinic-one', selfRegistrationEnabled: true }) }),
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tenantId: TENANT_ID, email: 'client@example.com' }),
    });
    expect(prisma.roleAssignment.create).toHaveBeenCalledWith({
      data: { userId: USER_ID, roleId: 'role_client' },
    });
    expect(prisma.client.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: USER_ID, tenantId: TENANT_ID }),
    });
    expect(result.principal).toEqual(expect.objectContaining({ userId: USER_ID, tenantId: TENANT_ID }));
    expect(prisma.refreshSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: USER_ID, tenantId: TENANT_ID, tokenHash: expect.any(String) }),
    });
  });

  it('rejects omitted tenant routing when more than one tenant accepts registration', async () => {
    const { svc, prisma } = makeHarness();
    prisma.tenant.findMany.mockResolvedValue([{ id: 't1' }, { id: 't2' }]);
    await expect(
      svc.register({
        email: 'client@example.com',
        password: 'correct horse battery staple',
        fullName: 'Client One',
        locale: 'en',
        timezone: 'UTC',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });
});

describe('AuthService — tenant-safe login and active state', () => {
  it('never chooses an arbitrary account when an email exists in multiple tenants', async () => {
    const { svc, prisma } = makeHarness();
    prisma.user.findMany.mockResolvedValue([tokenUser(), tokenUser({ id: 'user_2', tenantId: 'tenant_2' })]);

    await expect(svc.login({ email: 'client@example.com', password: 'password1' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.refreshSession.create).not.toHaveBeenCalled();
  });

  it('scopes login to active users and active tenants, including tenantSlug when supplied', async () => {
    const { svc, prisma } = makeHarness();
    prisma.user.findMany.mockResolvedValue([]);

    await expect(
      svc.login({ email: 'client@example.com', password: 'password1', tenantSlug: 'clinic-one' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        email: { equals: 'client@example.com', mode: 'insensitive' },
        deletedAt: null,
        status: 'ACTIVE',
        tenant: { status: 'active', slug: 'clinic-one' },
      },
      take: 2,
    });
  });

  it('creates a server-side session after valid credentials', async () => {
    const { svc, prisma } = makeHarness();
    const password = 'correct horse battery staple';
    const user = tokenUser({ hashedPassword: await argon2.hash(password) });
    prisma.user.findMany.mockResolvedValue([user]);
    prisma.user.findUniqueOrThrow.mockResolvedValue(user);

    const result = await svc.login({ email: 'CLIENT@example.com', password });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { lastLoginAt: expect.any(Date) },
    });
    expect(result.refreshToken).toBe('refresh-token');
    expect(result.refreshExpiresIn).toBeGreaterThan(result.expiresIn);
    expect(prisma.refreshSession.create).toHaveBeenCalledTimes(1);
  });
});

describe('AuthService — refresh rotation and revocation', () => {
  const oldToken = 'old-refresh-token';
  const oldHash = createHash('sha256').update(oldToken).digest('hex');
  const claims = { typ: 'refresh', sub: USER_ID, tenantId: TENANT_ID, sid: 'session_old', fid: 'family_1' };

  it('rotates once, revokes the old row, and persists only the next token digest', async () => {
    const { svc, prisma, jwt } = makeHarness();
    jwt.verifyAsync.mockResolvedValue(claims);
    jwt.signAsync.mockImplementation(async (payload: Record<string, unknown>) =>
      payload.typ === 'refresh' ? 'new-refresh-token' : 'new-access-token',
    );
    prisma.refreshSession.findUnique.mockResolvedValue({
      id: claims.sid,
      tenantId: TENANT_ID,
      userId: USER_ID,
      familyId: claims.fid,
      tokenHash: oldHash,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user: tokenUser(),
    });
    prisma.refreshSession.updateMany.mockResolvedValue({ count: 1 });

    const result = await svc.refresh(oldToken);

    expect(result.refreshToken).toBe('new-refresh-token');
    expect(prisma.refreshSession.updateMany).toHaveBeenCalledWith({
      where: { id: claims.sid, tokenHash: oldHash, revokedAt: null },
      data: { revokedAt: expect.any(Date), lastUsedAt: expect.any(Date), replacedById: expect.any(String) },
    });
    const createData = prisma.refreshSession.create.mock.calls[0][0].data;
    expect(createData.familyId).toBe(claims.fid);
    expect(createData.tokenHash).toBe(createHash('sha256').update('new-refresh-token').digest('hex'));
    expect(JSON.stringify(createData)).not.toContain('new-refresh-token');
  });

  it('detects reuse of a replaced token, revokes the whole family, and invalidates access tokens', async () => {
    const { svc, prisma, jwt, audit } = makeHarness();
    jwt.verifyAsync.mockResolvedValue(claims);
    prisma.refreshSession.findUnique.mockResolvedValue({
      id: claims.sid,
      tenantId: TENANT_ID,
      userId: USER_ID,
      familyId: claims.fid,
      tokenHash: oldHash,
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      user: tokenUser(),
    });
    prisma.refreshSession.updateMany.mockResolvedValue({ count: 2 });

    await expect(svc.refresh(oldToken)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.refreshSession.updateMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT_ID, userId: USER_ID, familyId: claims.fid, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { authVersion: { increment: 1 } },
    });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'auth.refresh_reuse_detected', critical: true }));
  });

  it('revokes the exact current session on logout without storing the bearer token', async () => {
    const { svc, prisma, jwt } = makeHarness();
    jwt.verifyAsync.mockResolvedValue(claims);
    prisma.refreshSession.updateMany.mockResolvedValue({ count: 1 });

    await svc.logout(oldToken);

    expect(prisma.refreshSession.updateMany).toHaveBeenCalledWith({
      where: {
        id: claims.sid,
        userId: USER_ID,
        tenantId: TENANT_ID,
        tokenHash: oldHash,
        revokedAt: null,
      },
      data: { revokedAt: expect.any(Date) },
    });
  });
});

describe('AuthService — MFA enrollment lifecycle', () => {
  const otplib = jest.requireMock('otplib') as { verify: jest.Mock };

  beforeEach(() => otplib.verify.mockReturnValue({ valid: false }));

  it('stores a new secret as pending and encrypted without replacing the active factor', async () => {
    const { svc, prisma } = makeHarness();
    prisma.user.findUnique.mockResolvedValue(
      tokenUser({ mfaEnabled: false, mfaSecret: null, mfaPendingSecret: null }),
    );

    const response = await svc.mfaEnroll(USER_ID);

    expect(response.secret).toBe('MOCKBASE32SECRET');
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { mfaPendingSecret: 'encrypted:MOCKBASE32SECRET' },
    });
  });

  it('requires proof of the active factor before beginning rotation', async () => {
    const { svc, prisma } = makeHarness();
    prisma.user.findUnique.mockResolvedValue(
      tokenUser({ mfaEnabled: true, mfaSecret: 'encrypted:ACTIVESECRET' }),
    );

    await expect(svc.mfaEnroll(USER_ID)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('promotes only a possession-verified pending secret and re-issues full-access tokens', async () => {
    const { svc, prisma } = makeHarness();
    const pendingUser = tokenUser({
      mfaEnabled: false,
      mfaSecret: null,
      mfaPendingSecret: 'encrypted:PENDINGSECRET',
      roleAssignments: [
        { clinicId: null, jurisdiction: null, role: { name: 'PSYCHOLOGIST', permissions: [] } },
      ],
    });
    prisma.user.findUnique.mockResolvedValue(pendingUser);
    // issueTokens reloads the user after mfaEnabled is flipped true.
    prisma.user.findUniqueOrThrow.mockResolvedValue({ ...pendingUser, mfaEnabled: true, mfaSecret: 'encrypted:PENDINGSECRET' });
    otplib.verify.mockReturnValue({ valid: true });

    const tokens = await svc.mfaVerify(USER_ID, '123456');
    expect(tokens.accessToken).toBe('access-token');
    expect(tokens.principal?.mfaEnrollmentRequired).toBe(false);
    expect(tokens.recoveryCodes).toHaveLength(8);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: expect.objectContaining({
        mfaEnabled: true,
        mfaSecret: 'encrypted:PENDINGSECRET',
        mfaPendingSecret: null,
        mfaRecoveryHashes: expect.any(Array),
      }),
    });
    expect(prisma.refreshSession.updateMany).toHaveBeenCalled();
    expect(prisma.refreshSession.create).toHaveBeenCalled();
  });

  it('marks mfaEnrollmentRequired on tokens for mandatory roles without TOTP', async () => {
    const { svc, prisma } = makeHarness();
    const password = 'correct horse battery staple';
    const user = tokenUser({
      hashedPassword: await argon2.hash(password),
      mfaEnabled: false,
      roleAssignments: [
        { clinicId: null, jurisdiction: null, role: { name: 'MANAGER', permissions: [] } },
      ],
    });
    prisma.user.findMany.mockResolvedValue([user]);
    prisma.user.findUniqueOrThrow.mockResolvedValue(user);

    const tokens = await svc.login({ email: 'client@example.com', password });
    expect(tokens.principal?.mfaEnrollmentRequired).toBe(true);
  });
});

describe('AuthService — password reset', () => {
  it('does not enumerate accounts when email is unknown', async () => {
    const { svc, prisma } = makeHarness();
    prisma.user.findMany.mockResolvedValue([]);
    const result = await svc.requestPasswordReset({ email: 'nobody@example.com' });
    expect(result).toEqual({ ok: true });
    expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
  });

  it('issues a digest-only token for a known account (dev returns raw once)', async () => {
    const { svc, prisma } = makeHarness();
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    prisma.user.findMany.mockResolvedValue([tokenUser()]);

    const result = await svc.requestPasswordReset({ email: 'client@example.com' });
    expect(result.ok).toBe(true);
    expect(result.devResetToken).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(prisma.passwordResetToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: USER_ID,
        tenantId: TENANT_ID,
        tokenHash: expect.any(String),
      }),
    });
    process.env.NODE_ENV = prev;
  });

  it('completes a valid reset, revokes sessions, and bumps authVersion', async () => {
    const { svc, prisma } = makeHarness();
    const user = tokenUser();
    prisma.passwordResetToken.findUnique.mockResolvedValue({
      id: 'prt_1',
      tenantId: TENANT_ID,
      userId: USER_ID,
      tokenHash: 'abc',
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user: { ...user, tenant: { status: 'active' } },
    });
    prisma.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      svc.completePasswordReset({ token: 'raw-token-value-at-least-20', newPassword: 'new-secure-password' }),
    ).resolves.toEqual({ ok: true });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: expect.objectContaining({ hashedPassword: expect.any(String), authVersion: { increment: 1 } }),
    });
    expect(prisma.refreshSession.updateMany).toHaveBeenCalled();
  });
});
