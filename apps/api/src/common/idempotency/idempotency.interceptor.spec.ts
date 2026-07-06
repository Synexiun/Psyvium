import { ConflictException, type ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { InMemoryIdempotencyStore } from './in-memory-idempotency.store';

/**
 * doc `04-api-design.md` §8: "Same key + same request body ⇒ the original
 * response is replayed" and "a double-tap on 'Charge card' never
 * double-charges." These tests pin that guarantee at the interceptor level
 * with a mocked handler, so the assertion is "the handler ran exactly once"
 * rather than trusting a downstream service's own idempotency.
 */

function makeContext(overrides: { headers?: Record<string, string>; body?: unknown; principal?: unknown } = {}) {
  const req = {
    headers: overrides.headers ?? { 'idempotency-key': 'idem-key-1' },
    body: overrides.body ?? { invoiceId: 'invoice_1', method: 'card' },
    principal: 'principal' in overrides ? overrides.principal : { tenantId: 'tenant_demo', userId: 'user_1' },
  };
  const res = { statusCode: 201, setHeader: jest.fn(), status: jest.fn() };
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    getClass: () => ({ name: 'FinanceController' }),
    getHandler: () => ({ name: 'payInvoice' }),
  } as unknown as ExecutionContext;
}

describe('IdempotencyInterceptor', () => {
  it('proceeds normally (no replay protection) when no Idempotency-Key is present', async () => {
    const interceptor = new IdempotencyInterceptor(new InMemoryIdempotencyStore());
    const handler = { handle: jest.fn(() => of({ ok: true })) };

    const result = await firstValueFrom(await interceptor.intercept(makeContext({ headers: {} }), handler));
    expect(result).toEqual({ ok: true });
    expect(handler.handle).toHaveBeenCalledTimes(1);
  });

  it('runs the handler once, then replays the cached response verbatim on a duplicate key + identical body', async () => {
    const store = new InMemoryIdempotencyStore();
    const interceptor = new IdempotencyInterceptor(store);
    const handler = { handle: jest.fn(() => of({ id: 'payment_1', status: 'captured', amount: '180.0000' })) };

    const firstCtx = makeContext();
    const firstResult = await firstValueFrom(await interceptor.intercept(firstCtx, handler));
    expect(firstResult).toEqual({ id: 'payment_1', status: 'captured', amount: '180.0000' });
    expect(handler.handle).toHaveBeenCalledTimes(1);

    // Duplicate submit: same tenant, same route, same key, same body.
    const secondCtx = makeContext();
    const secondResult = await firstValueFrom(await interceptor.intercept(secondCtx, handler));

    expect(secondResult).toEqual(firstResult);
    // The critical assertion: the handler (which would charge the card /
    // administer the assessment / create the intake record) did NOT run again.
    expect(handler.handle).toHaveBeenCalledTimes(1);

    const secondRes = (secondCtx.switchToHttp().getResponse as any)();
    expect(secondRes.setHeader).toHaveBeenCalledWith('Idempotent-Replayed', 'true');
  });

  it('rejects key reuse with a different request body as a replay mismatch (409)', async () => {
    const store = new InMemoryIdempotencyStore();
    const interceptor = new IdempotencyInterceptor(store);
    const handler = { handle: jest.fn(() => of({ id: 'payment_1' })) };

    await firstValueFrom(await interceptor.intercept(makeContext(), handler));

    const mismatchedCtx = makeContext({ body: { invoiceId: 'invoice_2', method: 'card' } });
    await expect(interceptor.intercept(mismatchedCtx, handler)).rejects.toBeInstanceOf(ConflictException);
    expect(handler.handle).toHaveBeenCalledTimes(1);
  });

  it('scopes replay by tenant — the same key from a different tenant is treated as a fresh request', async () => {
    const store = new InMemoryIdempotencyStore();
    const interceptor = new IdempotencyInterceptor(store);
    const handler = { handle: jest.fn(() => of({ id: 'payment_1' })) };

    await firstValueFrom(await interceptor.intercept(makeContext(), handler));
    await firstValueFrom(
      await interceptor.intercept(makeContext({ principal: { tenantId: 'tenant_other', userId: 'user_2' } }), handler),
    );

    expect(handler.handle).toHaveBeenCalledTimes(2);
  });
});

describe('InMemoryIdempotencyStore locking', () => {
  it('denies a second lock acquisition while the first request is still in flight', async () => {
    const store = new InMemoryIdempotencyStore();

    expect(await store.acquireLock('k1', 5_000)).toBe(true);
    expect(await store.acquireLock('k1', 5_000)).toBe(false);

    await store.releaseLock('k1');
    expect(await store.acquireLock('k1', 5_000)).toBe(true);
  });
});
