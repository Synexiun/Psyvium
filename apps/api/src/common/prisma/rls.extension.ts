import type { PrismaClient } from '@vpsy/database';
import { TenantContext } from './tenant-context';

/**
 * `set_config(..., true)` is TRANSACTION-local: it always resets at
 * COMMIT/ROLLBACK regardless of outcome, so it can never leak the previous
 * request's tenant onto a reused pooled connection. `COALESCE($1, '')`
 * because Postgres GUCs can't be set to SQL NULL via set_config; policies
 * normalize the empty string back to NULL with `NULLIF(..., '')` (see the
 * RLS migration) to mean "no tenant context" for the narrow unauthenticated
 * exception (login/register).
 */
const SET_TENANT_SQL = `SELECT set_config('app.current_tenant', COALESCE($1, ''), true)`;

/**
 * Prisma Client Extension: the RLS "backstop" tenant-context wiring
 * (docs/technical/00-architecture-overview.md §4). Before every model
 * operation it sets the Postgres session GUC `app.current_tenant` to the
 * current request's tenantId (read from AsyncLocalStorage — see
 * tenant-context.ts + the global TenantContextInterceptor).
 *
 * Two execution paths, because ~9 services use Prisma *interactive*
 * transactions (`prisma.$transaction(async (tx) => {...})`). Empirically,
 * `this` inside a `query.$allModels.$allOperations` callback does NOT expose
 * `$transaction`/`$executeRawUnsafe` — not even for a genuinely top-level,
 * non-nested call — so introspecting `this`/`Prisma.getExtensionContext(this)`
 * to distinguish "root" from "nested inside an interactive transaction"
 * doesn't work. Instead we track it ourselves:
 *
 *  - `$transaction` itself is wrapped below (once, on the returned extended
 *    client) so that when a service calls `prisma.$transaction(async (tx) =>
 *    {...})`, we set the GUC exactly ONCE — via the real `tx` Prisma hands us,
 *    which DOES have `$executeRawUnsafe` (only `$transaction`/`$connect`/
 *    `$disconnect`/`$on`/`$extends` are excluded from an interactive-tx
 *    client) — before invoking the caller's callback, and mark the
 *    AsyncLocalStorage context `insideTransaction`.
 *  - Root call (`TenantContext.isInsideTransaction()` is false): bundle
 *    `set_config` + the real query into ONE array-form `$transaction([...])`
 *    on the closure-captured `base` client (matching Prisma's own documented
 *    RLS extension recipe) so both land on the same pooled connection
 *    atomically before the query commits.
 *  - Nested call (`insideTransaction` is true): the GUC was already set once
 *    for this transaction's connection by the `$transaction` wrapper above —
 *    just run the query as-is.
 */
export function withTenantRls<T extends PrismaClient>(base: T) {
  const extended = base.$extends({
    name: 'tenant-rls',
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          if (TenantContext.isInsideTransaction()) {
            return query(args);
          }
          const tenantId = TenantContext.getTenantId();
          const [, result] = await base.$transaction([
            base.$executeRawUnsafe(SET_TENANT_SQL, tenantId ?? null),
            query(args),
          ]);
          return result;
        },
      },
    },
  });

  const originalTransaction = (extended as any).$transaction.bind(extended);
  (extended as any).$transaction = (...txArgs: any[]) => {
    const [first, ...rest] = txArgs;
    if (typeof first !== 'function') {
      // Array-form batch transaction — not used anywhere in this codebase
      // today (grepped: all 9 call sites use the interactive callback form),
      // but pass it through unchanged for forward-compatibility. Each batched
      // operation still goes through $allOperations individually; since
      // that's a root-level call (not marked insideTransaction) it will try
      // to open its OWN nested $transaction via the branch above — batched
      // array-form calls should therefore set the GUC themselves if they
      // ever need it, same as today.
      return originalTransaction(first, ...rest);
    }
    const tenantId = TenantContext.getTenantId();
    const wrappedCallback = async (tx: unknown) => {
      await (tx as any).$executeRawUnsafe(SET_TENANT_SQL, tenantId ?? null);
      return TenantContext.runInsideTransaction(() => first(tx));
    };
    return originalTransaction(wrappedCallback, ...rest);
  };

  return extended;
}
