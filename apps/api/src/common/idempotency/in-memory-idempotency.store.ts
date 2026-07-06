import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import type { IdempotencyRecord, IdempotencyStore } from './idempotency-store.interface';

interface Entry {
  record?: IdempotencyRecord;
  lockedUntil?: number;
  expiresAt: number;
}

/**
 * Honest fallback used when `REDIS_URL` is not configured (see
 * `idempotency.module.ts`): a single-process `Map` with a documented sweep.
 *
 * Trade-offs vs. Redis, stated plainly rather than left implicit:
 * - Only correct for a single API instance — a second replica has its own
 *   Map, so a duplicate submit routed to a different instance would NOT be
 *   caught. This is acceptable for local/dev/single-instance deployments
 *   only; production with >1 replica must set `REDIS_URL`.
 * - Entries are swept lazily (on access) plus an interval sweep every
 *   minute, both driven by `expiresAt` — never silently unbounded memory.
 */
@Injectable()
export class InMemoryIdempotencyStore implements IdempotencyStore, OnApplicationShutdown {
  private readonly logger = new Logger(InMemoryIdempotencyStore.name);
  private readonly store = new Map<string, Entry>();
  private readonly sweepInterval: NodeJS.Timeout;

  constructor() {
    this.logger.warn(
      'REDIS_URL is not set — idempotency replay is ACTIVE but backed by an in-memory Map scoped to ' +
        'this process only. A duplicate request routed to a different replica will NOT be caught. ' +
        'Set REDIS_URL before running more than one API instance.',
    );
    this.sweepInterval = setInterval(() => this.sweep(), 60_000);
    this.sweepInterval.unref?.();
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (entry.expiresAt <= now) this.store.delete(key);
    }
  }

  private isLive(entry: Entry | undefined): entry is Entry {
    return !!entry && entry.expiresAt > Date.now();
  }

  async get(key: string): Promise<IdempotencyRecord | undefined> {
    const entry = this.store.get(key);
    if (!this.isLive(entry)) return undefined;
    return entry.record;
  }

  async acquireLock(key: string, lockTtlMs: number): Promise<boolean> {
    const now = Date.now();
    const entry = this.store.get(key);
    if (this.isLive(entry)) {
      if (entry.record) return false; // already completed — caller should replay, not re-acquire
      if (entry.lockedUntil && entry.lockedUntil > now) return false; // someone else is in flight
    }
    this.store.set(key, { lockedUntil: now + lockTtlMs, expiresAt: now + lockTtlMs });
    return true;
  }

  async set(key: string, record: IdempotencyRecord, ttlMs: number): Promise<void> {
    this.store.set(key, { record, expiresAt: Date.now() + ttlMs });
  }

  async releaseLock(key: string): Promise<void> {
    const entry = this.store.get(key);
    if (entry && !entry.record) this.store.delete(key);
  }

  onApplicationShutdown(): void {
    clearInterval(this.sweepInterval);
  }
}
