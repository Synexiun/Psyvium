export const IDEMPOTENCY_STORE = Symbol('IDEMPOTENCY_STORE');

/** What we persist once a mutating request has actually completed. */
export interface IdempotencyRecord {
  /** Hash of the (canonicalized) request body, to detect key reuse with a different payload. */
  requestHash: string;
  /** HTTP status the original response was sent with. */
  status: number;
  /** The original JSON response body, replayed verbatim on a duplicate. */
  body: unknown;
  storedAt: number;
}

/**
 * Backing store for `IdempotencyInterceptor` (doc `04-api-design.md` §8).
 * Two implementations: `RedisIdempotencyStore` (shared across instances,
 * used when `REDIS_URL` is set) and `InMemoryIdempotencyStore` (single
 * process, honest fallback — see `idempotency.module.ts`).
 */
export interface IdempotencyStore {
  /** The completed record for `key`, or `undefined` if none exists (yet). */
  get(key: string): Promise<IdempotencyRecord | undefined>;

  /**
   * Best-effort mutual exclusion for the "request currently in flight" window
   * between a key being first seen and its record being stored. Returns
   * `true` if this caller acquired the lock (i.e. is the one that should
   * execute the handler), `false` if another request already holds it.
   */
  acquireLock(key: string, lockTtlMs: number): Promise<boolean>;

  /** Persist the completed response and release the in-flight lock. */
  set(key: string, record: IdempotencyRecord, ttlMs: number): Promise<void>;

  /** Release the lock without a completed record (the handler threw). */
  releaseLock(key: string): Promise<void>;
}
