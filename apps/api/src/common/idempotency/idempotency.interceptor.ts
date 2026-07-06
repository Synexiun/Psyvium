import {
  BadRequestException,
  ConflictException,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  NestInterceptor,
  type CallHandler,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Observable, of, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { IDEMPOTENCY_STORE, type IdempotencyRecord, type IdempotencyStore } from './idempotency-store.interface';
import { stableStringify } from './stable-stringify';

/** doc `04-api-design.md` §8: replay window before a key becomes reusable. */
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
/** Generous budget for the original request to finish before its lock is considered stale. */
const LOCK_TTL_MS = 15_000;
/** How long a concurrent duplicate waits for the in-flight original to finish before giving up. */
const CONCURRENT_WAIT_BUDGET_MS = 3_000;
const CONCURRENT_POLL_INTERVAL_MS = 150;

/**
 * Idempotency-Key replay (doc `04-api-design.md` §8). Applied to individual
 * mutating routes via `@UseInterceptors(IdempotencyInterceptor)` — currently
 * `finance.controller.ts#payInvoice`, `psychometrics.controller.ts#administer`,
 * `intake.controller.ts#submit` (money movement / clinical record creation).
 *
 * Behavior:
 * - Missing `Idempotency-Key` on one of these routes ⇒ `400` (fail closed —
 *   a client that omits the header on a money/clinical route must not be
 *   able to retry-and-double-execute).
 * - Same key + same body ⇒ the original response is replayed verbatim, with
 *   an `Idempotent-Replayed: true` header, and the handler is NOT re-invoked.
 * - Same key + a *different* body ⇒ `409` (`IDEMPOTENCY_REPLAY_MISMATCH`).
 * - Two concurrent requests with the same key ⇒ the second waits briefly for
 *   the first to finish, then replays (best-effort; see `IdempotencyStore`).
 *
 * Keyed by `(tenantId, route, key)` so the same key from two different
 * tenants (or reused on a different endpoint) never collides.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(@Inject(IDEMPOTENCY_STORE) private readonly store: IdempotencyStore) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();

    const key: string | undefined = req.headers?.['idempotency-key'];
    if (!key) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message:
          'This endpoint moves money or creates a clinical/record and requires an Idempotency-Key header ' +
          '(see docs/technical/04-api-design.md §8).',
      });
    }

    const tenantId = req.principal?.tenantId ?? 'anonymous';
    const route = `${context.getClass().name}.${context.getHandler().name}`;
    const storeKey = `${tenantId}:${route}:${key}`;
    const requestHash = createHash('sha256').update(stableStringify(req.body ?? {})).digest('hex');

    const replay = (record: IdempotencyRecord): Observable<any> => {
      res.status?.(record.status);
      res.setHeader?.('Idempotent-Replayed', 'true');
      return of(record.body);
    };

    const existing = await this.store.get(storeKey);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new ConflictException({
          code: 'IDEMPOTENCY_REPLAY_MISMATCH',
          message: 'This Idempotency-Key was already used with a different request body.',
        });
      }
      return replay(existing);
    }

    const acquired = await this.store.acquireLock(storeKey, LOCK_TTL_MS);
    if (!acquired) {
      // Someone else is mid-flight for this exact (tenant, route, key). Block
      // briefly then replay, per doc §8, rather than letting a double-tap
      // through as a second execution.
      const waited = await this.pollForCompletion(storeKey);
      if (waited) {
        if (waited.requestHash !== requestHash) {
          throw new ConflictException({
            code: 'IDEMPOTENCY_REPLAY_MISMATCH',
            message: 'This Idempotency-Key was already used with a different request body.',
          });
        }
        return replay(waited);
      }
      throw new ConflictException({
        code: 'IDEMPOTENCY_IN_PROGRESS',
        message: 'A request with this Idempotency-Key is still processing. Retry shortly.',
      });
    }

    return next.handle().pipe(
      tap((body) => {
        const status = res.statusCode ?? 200;
        void this.store.set(storeKey, { requestHash, status, body, storedAt: Date.now() }, IDEMPOTENCY_TTL_MS);
      }),
      catchError((err) => {
        void this.store.releaseLock(storeKey);
        return throwError(() => err);
      }),
    );
  }

  private async pollForCompletion(storeKey: string): Promise<IdempotencyRecord | undefined> {
    const deadline = Date.now() + CONCURRENT_WAIT_BUDGET_MS;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, CONCURRENT_POLL_INTERVAL_MS));
      const record = await this.store.get(storeKey);
      if (record) return record;
    }
    return undefined;
  }
}
