import { Global, Module } from '@nestjs/common';
import { IDEMPOTENCY_STORE } from './idempotency-store.interface';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { InMemoryIdempotencyStore } from './in-memory-idempotency.store';
import { RedisIdempotencyStore } from './redis-idempotency.store';

/**
 * Cross-cutting idempotency support (doc `04-api-design.md` §8). `@Global()`
 * so that `IdempotencyInterceptor` — applied per-route via
 * `@UseInterceptors(IdempotencyInterceptor)` on `finance.controller.ts#payInvoice`,
 * `psychometrics.controller.ts#administer`, and `intake.controller.ts#submit`
 * — resolves through Nest's DI from any feature module without each of those
 * modules needing to import this one directly.
 *
 * Store selection mirrors `RateLimitModule`: Redis when `REDIS_URL` is set
 * (shared across replicas), otherwise an honest, explicitly-logged in-memory
 * fallback (see `InMemoryIdempotencyStore`).
 */
@Global()
@Module({
  providers: [
    {
      provide: IDEMPOTENCY_STORE,
      useFactory: () => {
        const redisUrl = process.env.REDIS_URL;
        return redisUrl ? new RedisIdempotencyStore(redisUrl) : new InMemoryIdempotencyStore();
      },
    },
    IdempotencyInterceptor,
  ],
  exports: [IDEMPOTENCY_STORE, IdempotencyInterceptor],
})
export class IdempotencyModule {}
