import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard — server-side session and identity state', () => {
  const previousSecret = process.env.JWT_ACCESS_SECRET;

  beforeAll(() => {
    process.env.JWT_ACCESS_SECRET = 'test-access-secret-at-least-16-chars';
  });

  afterAll(() => {
    if (previousSecret === undefined) delete process.env.JWT_ACCESS_SECRET;
    else process.env.JWT_ACCESS_SECRET = previousSecret;
  });

  function harness(
    sessionOverrides: Record<string, unknown> = {},
    payloadOverrides: Record<string, unknown> = {},
    requestOverrides: Record<string, unknown> = {},
  ) {
    const request: Record<string, any> = {
      headers: { authorization: 'Bearer access-token' },
      url: '/api/v1/clients/me',
      originalUrl: '/api/v1/clients/me',
      ...requestOverrides,
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    const payload = {
      typ: 'access',
      sub: 'user_1',
      tenantId: 'tenant_1',
      sid: 'session_1',
      ver: 2,
      roles: ['CLIENT'],
      permissions: ['intake:write'],
      ...payloadOverrides,
    };
    const jwt = { verifyAsync: jest.fn().mockResolvedValue(payload) };
    const session = {
      id: 'session_1',
      user: {
        deletedAt: null,
        status: 'ACTIVE',
        authVersion: 2,
        tenant: { status: 'active' },
      },
      ...sessionOverrides,
    };
    const prisma = { refreshSession: { findFirst: jest.fn().mockResolvedValue(session) } };
    const guard = new JwtAuthGuard(jwt as never, prisma as never);
    return { guard, context, request, prisma };
  }

  it('accepts only an unrevoked session whose user, tenant and auth version remain active', async () => {
    const { guard, context, request, prisma } = harness();

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(prisma.refreshSession.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'session_1',
        tenantId: 'tenant_1',
        userId: 'user_1',
        revokedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
      include: { user: { include: { tenant: true } } },
    });
    expect(request.principal).toEqual(
      expect.objectContaining({ userId: 'user_1', tenantId: 'tenant_1', roles: ['CLIENT'] }),
    );
  });

  it.each([
    ['missing/revoked session', null],
    ['suspended user', { id: 'session_1', user: { deletedAt: null, status: 'SUSPENDED', authVersion: 2, tenant: { status: 'active' } } }],
    ['inactive tenant', { id: 'session_1', user: { deletedAt: null, status: 'ACTIVE', authVersion: 2, tenant: { status: 'suspended' } } }],
    ['invalidated auth version', { id: 'session_1', user: { deletedAt: null, status: 'ACTIVE', authVersion: 3, tenant: { status: 'active' } } }],
  ])('rejects %s immediately', async (_label, session) => {
    const { guard, context, prisma } = harness();
    prisma.refreshSession.findFirst.mockResolvedValue(session);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a refresh token presented as an access token before touching session state', async () => {
    const { guard, context, prisma } = harness({}, { typ: 'refresh' });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.refreshSession.findFirst).not.toHaveBeenCalled();
  });

  it('blocks clinical routes when mfaEnrollmentRequired is set, but allows MFA enrollment', async () => {
    const blocked = harness({}, { mfaEnrollmentRequired: true });
    await expect(blocked.guard.canActivate(blocked.context)).rejects.toBeInstanceOf(ForbiddenException);

    const allowed = harness(
      {},
      { mfaEnrollmentRequired: true },
      { url: '/api/v1/auth/mfa/enroll', originalUrl: '/api/v1/auth/mfa/enroll' },
    );
    await expect(allowed.guard.canActivate(allowed.context)).resolves.toBe(true);
  });
});
