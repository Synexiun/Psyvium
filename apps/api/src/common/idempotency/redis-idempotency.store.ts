import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import type { IdempotencyRecord, IdempotencyStore } from './idempotency-store.interface';

/**
 * Redis-backed `IdempotencyStore` (doc `04-api-design.md` §8) — shared across
 * every API instance, so a duplicate `Idempotency-Key` is caught no matter
 * which replica handles the retry. Activated only when `REDIS_URL` is set
 * (see `idempotency.module.ts`).
 */
@Injectable()
export class RedisIdempotencyStore implements IdempotencyStore, OnApplicationShutdown {
  private readonly logger = new Logger(RedisIdempotencyStore.name);
  private readonly client: Redis;

  constructor(redisUrl: string) {
    this.client = new Redis(redisUrl, { maxRetriesPerRequest: 2, lazyConnect: false });
    this.client.on('error', (err) => {
      this.logger.error(`Redis idempotency store connection error: ${err.message}`);
    });
  }

  private recordKey(key: string): string {
    return `vpsy:idempotency:${key}`;
  }

  private lockKey(key: string): string {
    return `vpsy:idempotency:${key}:lock`;
  }

  async get(key: string): Promise<IdempotencyRecord | undefined> {
    const raw = await this.client.get(this.recordKey(key));
    return raw ? (JSON.parse(raw) as IdempotencyRecord) : undefined;
  }

  async acquireLock(key: string, lockTtlMs: number): Promise<boolean> {
    const result = await this.client.set(this.lockKey(key), '1', 'PX', lockTtlMs, 'NX');
    return result === 'OK';
  }

  async set(key: string, record: IdempotencyRecord, ttlMs: number): Promise<void> {
    await this.client.set(this.recordKey(key), JSON.stringify(record), 'PX', ttlMs);
    await this.client.del(this.lockKey(key));
  }

  async releaseLock(key: string): Promise<void> {
    await this.client.del(this.lockKey(key));
  }

  onApplicationShutdown(): void {
    this.client.disconnect();
  }
}
