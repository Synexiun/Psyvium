import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request tenant context (docs/technical/00-architecture-overview.md §4
 * "RLS is the backstop if application code ever forgets"). Populated by the
 * global `TenantContextMiddleware` (apps/api/src/common/tenant-context.interceptor.ts,
 * registered in AppModule.configure()) from the request's verified access
 * token, and read by the RLS Prisma extension (./rls.extension.ts) to set
 * the Postgres session GUC `app.current_tenant` before every query — so a
 * missed `where: { tenantId }` in application code still cannot cross tenant
 * boundaries at the DB layer.
 *
 * AsyncLocalStorage (not a request-scoped Nest provider) so the context is
 * available to PrismaService without threading it through every service's
 * constructor — the whole point is that modules inherit this without edits.
 * Bound via `TenantContext.run(store, () => next())` from middleware, which
 * wraps the entire rest of the request (guards, interceptors, handler,
 * services, Prisma calls) — this is deliberate; see the middleware file's
 * doc comment for why an interceptor-based and a guard-based alternative
 * were each tried and empirically rejected first.
 */
export interface TenantContextStore {
  /** Undefined for unauthenticated requests (login, register, health). */
  tenantId?: string;
  /**
   * True while executing inside an app-level interactive transaction
   * (`prisma.$transaction(async (tx) => {...})` — ~9 services use this).
   * Set by the `$transaction` wrapper in rls.extension.ts, which issues
   * `set_config` exactly ONCE for the whole transaction's connection before
   * running the callback; this flag tells the query extension's nested
   * operations to skip re-wrapping (there's no reliable way to introspect
   * "am I inside a tx" from `this` inside a Prisma query-extension callback —
   * empirically it doesn't expose `$transaction`/`$executeRawUnsafe` there
   * regardless of nesting, so we track it ourselves instead).
   */
  insideTransaction?: boolean;
}

const storage = new AsyncLocalStorage<TenantContextStore>();

export const TenantContext = {
  /** Runs `fn` with `store` bound for the entire (async) call chain it starts. */
  run<T>(store: TenantContextStore, fn: () => T): T {
    return storage.run(store, fn);
  },

  /** Current request's tenantId, or undefined outside a request / unauthenticated. */
  getTenantId(): string | undefined {
    return storage.getStore()?.tenantId;
  },

  /** Marks the current async context as "inside an interactive transaction". */
  runInsideTransaction<T>(fn: () => T): T {
    const current = storage.getStore() ?? {};
    return storage.run({ ...current, insideTransaction: true }, fn);
  },

  isInsideTransaction(): boolean {
    return storage.getStore()?.insideTransaction === true;
  },
};
