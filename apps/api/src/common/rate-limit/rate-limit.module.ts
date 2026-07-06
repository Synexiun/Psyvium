import { Logger, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrincipalThrottlerGuard } from './principal-throttler.guard';
import { RedisThrottlerStorage } from './redis-throttler-storage';

const logger = new Logger('RateLimitModule');

/**
 * Global cross-cutting rate limiting (doc `04-api-design.md` §9,
 * `06-security-and-rbac.md`). Default tier is a sensible baseline —
 * **100 requests/min per principal** (or per-IP while unauthenticated) — with
 * individual routes tightening it further via `@Throttle(...)` (see
 * `auth.controller.ts`, `risk.controller.ts`, `intake.controller.ts`).
 *
 * Storage: if `REDIS_URL` is configured, counters live in Redis and are
 * therefore correct across every API replica. If it is **not** configured,
 * this deliberately and loudly falls back to `@nestjs/throttler`'s bundled
 * in-memory store — correct for a single instance / local dev, but each
 * replica in a multi-instance deployment would then enforce the limit
 * independently (effectively `limit * replicaCount`). This is logged at boot
 * so it is never a silent downgrade; wire `REDIS_URL` before scaling out.
 */
@Module({
  imports: [
    JwtModule.register({}),
    ThrottlerModule.forRootAsync({
      useFactory: () => {
        const redisUrl = process.env.REDIS_URL;
        const throttlers = [{ ttl: 60_000, limit: 100 }];

        if (redisUrl) {
          logger.log('REDIS_URL is set — rate-limit counters are backed by Redis (multi-instance safe).');
          return { throttlers, storage: new RedisThrottlerStorage(redisUrl) };
        }

        logger.warn(
          'REDIS_URL is not set — rate limiting is ACTIVE but falls back to in-memory, per-process ' +
            'counters. This is fine for a single instance; on a multi-instance deployment each replica ' +
            'enforces the limit independently. Set REDIS_URL to activate shared, cluster-safe limiting.',
        );
        return { throttlers };
      },
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: PrincipalThrottlerGuard }],
})
export class RateLimitModule {}
