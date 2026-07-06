import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import Redis from 'ioredis';

// `@nestjs/throttler`'s public barrel (`dist/index.d.ts`) does not re-export
// `ThrottlerStorageRecord` even though `ThrottlerStorage#increment` returns
// it — so it is redeclared here structurally (same shape the interface
// expects) rather than reaching into the package's internal dist path.
interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

/**
 * Redis-backed `ThrottlerStorage` (doc `04-api-design.md` §9: "Token-bucket per
 * principal ... enforced at the gateway with Redis").
 *
 * Why this exists: `@nestjs/throttler`'s bundled `ThrottlerStorageService` is an
 * in-memory `Map` — fine for a single process, but on any multi-instance
 * deployment each replica would count hits independently, silently multiplying
 * the effective limit by the replica count. This class shares counters across
 * all API instances via Redis so the limit is real regardless of how many pods
 * are running.
 *
 * Only instantiated by `RateLimitModule` when `REDIS_URL` is set (see that
 * file) — never constructed otherwise, so there is no half-configured state.
 *
 * Semantics mirror the bundled in-memory implementation: once `totalHits`
 * exceeds `limit` inside the current `ttl` window, the key is "blocked" for
 * `blockDuration` (defaulting to `ttl`), so a caller who bursts past the limit
 * is held for a full window rather than immediately allowed again next tick.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage, OnApplicationShutdown {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private readonly client: Redis;

  constructor(redisUrl: string) {
    this.client = new Redis(redisUrl, { maxRetriesPerRequest: 2, lazyConnect: false });
    this.client.on('error', (err) => {
      this.logger.error(`Redis throttler storage connection error: ${err.message}`);
    });
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const counterKey = `vpsy:throttle:${throttlerName}:${key}`;
    const blockKey = `${counterKey}:blocked`;

    const blockPttl = await this.client.pttl(blockKey);
    if (blockPttl > 0) {
      return {
        totalHits: limit + 1,
        timeToExpire: 0,
        isBlocked: true,
        timeToBlockExpire: Math.ceil(blockPttl / 1000),
      };
    }

    // INCR + conditional PEXPIRE rather than a single Lua script: under an
    // extreme first-hit race the window could be extended by a few ms. A rate
    // limiter's contract is "approximately N per window", not an exact
    // guarantee, so this trade-off favors simplicity. Revisit with a Lua
    // script (atomic GETSET+EXPIRE) if exact enforcement becomes a
    // requirement.
    const totalHits = await this.client.incr(counterKey);
    if (totalHits === 1) {
      await this.client.pexpire(counterKey, ttl);
    }
    const remainingPttl = await this.client.pttl(counterKey);
    const timeToExpire = Math.ceil(Math.max(remainingPttl, 0) / 1000);

    let isBlocked = false;
    let timeToBlockExpire = 0;
    if (totalHits > limit) {
      isBlocked = true;
      const blockMs = blockDuration > 0 ? blockDuration : ttl;
      await this.client.set(blockKey, '1', 'PX', blockMs);
      timeToBlockExpire = Math.ceil(blockMs / 1000);
    }

    return { totalHits, timeToExpire, isBlocked, timeToBlockExpire };
  }

  onApplicationShutdown(): void {
    this.client.disconnect();
  }
}
