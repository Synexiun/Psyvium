import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerException, ThrottlerStorageService, type ThrottlerModuleOptions } from '@nestjs/throttler';
import { PrincipalThrottlerGuard } from './principal-throttler.guard';

/**
 * doc `04-api-design.md` §9: "Token-bucket per principal ... 429 on
 * Retry-After." This exercises the REAL `@nestjs/throttler` guard machinery
 * (not a hand-rolled counter) with our custom tracker wired in, using the
 * library's own in-memory storage so the test needs no network/Redis — it is
 * the identical code path the Redis-backed storage plugs into, just with a
 * different `ThrottlerStorage` implementation.
 */

function makeContext(req: Record<string, unknown>): ExecutionContext {
  const res = { header: jest.fn() };
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    getClass: () => ({ name: 'TestController' }),
    getHandler: () => ({ name: 'testRoute' }),
  } as unknown as ExecutionContext;
}

function makeGuard(options: ThrottlerModuleOptions, jwt: { verifyAsync: jest.Mock } = { verifyAsync: jest.fn() }) {
  const storage = new ThrottlerStorageService();
  const reflector = new Reflector();
  const guard = new PrincipalThrottlerGuard(options, storage, reflector, jwt as any);
  return { guard, jwt };
}

describe('PrincipalThrottlerGuard', () => {
  it('allows requests up to the limit, then throws a 429 ThrottlerException once exceeded', async () => {
    const { guard } = makeGuard({ throttlers: [{ ttl: 60_000, limit: 3 }] });
    await guard.onModuleInit();

    const req = { ip: '203.0.113.7', headers: {} };

    for (let i = 0; i < 3; i++) {
      await expect(guard.canActivate(makeContext(req))).resolves.toBe(true);
    }
    // 4th request in the same window, same tracker (IP) ⇒ blocked.
    await expect(guard.canActivate(makeContext(req))).rejects.toBeInstanceOf(ThrottlerException);
    // ThrottlerException carries HTTP 429 (see @nestjs/throttler's throttler.exception.ts).
    await expect(guard.canActivate(makeContext(req))).rejects.toMatchObject({ status: 429 });
  });

  it('does not let one IP exhaust another IP\'s bucket', async () => {
    const { guard } = makeGuard({ throttlers: [{ ttl: 60_000, limit: 1 }] });
    await guard.onModuleInit();

    await expect(guard.canActivate(makeContext({ ip: '203.0.113.1', headers: {} }))).resolves.toBe(true);
    // A different IP still gets its own fresh bucket.
    await expect(guard.canActivate(makeContext({ ip: '203.0.113.2', headers: {} }))).resolves.toBe(true);
    // But the first IP is now over its limit.
    await expect(guard.canActivate(makeContext({ ip: '203.0.113.1', headers: {} }))).rejects.toBeInstanceOf(
      ThrottlerException,
    );
  });

  it('keys an authenticated request by tenant+user (not IP) once a principal is attached', async () => {
    const { guard, jwt } = makeGuard({ throttlers: [{ ttl: 60_000, limit: 100 }] });

    const tracker = await (guard as any).getTracker({
      ip: '203.0.113.7',
      headers: {},
      principal: { tenantId: 'tenant_a', userId: 'user_1' },
    });

    expect(tracker).toBe('principal:tenant_a:user_1');
    // Reuses the already-attached principal — no need to re-verify the JWT.
    expect(jwt.verifyAsync).not.toHaveBeenCalled();
  });

  it('falls back to IP when no bearer token is present, and again if the token fails verification', async () => {
    const { guard, jwt } = makeGuard({ throttlers: [{ ttl: 60_000, limit: 100 }] });

    const noHeader = await (guard as any).getTracker({ ip: '203.0.113.9', headers: {} });
    expect(noHeader).toBe('ip:203.0.113.9');

    jwt.verifyAsync.mockRejectedValueOnce(new Error('invalid signature'));
    const badToken = await (guard as any).getTracker({
      ip: '203.0.113.9',
      headers: { authorization: 'Bearer garbage' },
    });
    expect(badToken).toBe('ip:203.0.113.9');
  });
});
