import { Injectable, NestMiddleware } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { NextFunction, Request, Response } from 'express';
import { ACCESS_TOKEN_COOKIE } from '@vpsy/contracts';
import { jwtAccessSecret } from './config/jwt-secrets';
import { TenantContext } from './prisma/tenant-context';

/**
 * Minimal `Cookie` header parser, deliberately duplicated (not imported) from
 * JwtAuthGuard (apps/api/src/common/auth/jwt-auth.guard.ts) — that file is
 * out of scope for this change (see the RLS backstop task's file whitelist),
 * and this is a tiny, self-contained, non-security-sensitive utility (it
 * just extracts a named cookie value; JwtAuthGuard still does the one
 * verification decision that actually gates access).
 */
function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return undefined;
}

/**
 * Global MIDDLEWARE (registered in app.module.ts's `AppModule.configure()`,
 * NOT as APP_GUARD or APP_INTERCEPTOR — see the two rejected designs below)
 * that wires the request's tenantId into the AsyncLocalStorage-backed
 * TenantContext (common/prisma/tenant-context.ts) for the ENTIRE downstream
 * pipeline. The PrismaService RLS extension (common/prisma/rls.extension.ts)
 * reads it to set the Postgres session GUC `app.current_tenant` before every
 * query — the defense-in-depth backstop from
 * docs/technical/00-architecture-overview.md §4: a missed
 * `where: { tenantId }` in a module can no longer leak cross-tenant PHI,
 * because Postgres itself filters the rows.
 *
 * TWO EARLIER DESIGNS WERE TRIED AND EMPIRICALLY REJECTED:
 *
 * 1. APP_INTERCEPTOR calling `TenantContext.run({tenantId}, () =>
 *    next.handle())`: interceptors run AFTER all guards (Nest's request
 *    lifecycle is guards -> interceptors -> pipes -> handler), so a
 *    controller-level guard that itself queries the DB — `ClinicalWriteGuard`
 *    checks license/credential eligibility before session-note/treatment-plan
 *    writes — ran with NO tenant context yet. Its RLS-enforced join returned
 *    zero rows and it threw a spurious 403 (caught by scripts/smoke.sh:
 *    "note write (active license)" failed 403 instead of 201).
 *
 * 2. APP_GUARD calling `TenantContext.setTenantId(tenantId)` (an
 *    `AsyncLocalStorage.enterWith()` call, since a Guard's `canActivate()`
 *    has no callback to wrap, unlike an interceptor's `next.handle()`):
 *    this ran early enough (global guards run before controller guards), but
 *    empirically the `enterWith`-mutated store did NOT survive Nest's
 *    internal guards -> interceptors -> handler transition (confirmed by
 *    direct instrumentation: the guard logged the correct tenantId, but the
 *    RLS extension's `$allOperations` saw `undefined` moments later for the
 *    same request's Prisma calls) — Nest's internal plumbing between guards
 *    and the eventual handler invocation isn't a plain continuation of the
 *    guard's own promise chain, so `enterWith` (which only affects the
 *    calling continuation, not a wrapped one) didn't carry through.
 *
 * MIDDLEWARE fixes both problems at once: Express middleware runs before
 * ALL guards (earlier than design #2, so any guard's DB query is covered),
 * AND — critically — it can WRAP the rest of the request the same way the
 * original interceptor did, via `TenantContext.run({tenantId}, () =>
 * next())`. Calling `next()` *inside* the `run()` callback (rather than
 * calling `run()` and returning, the way `enterWith` had to) is what makes
 * the bound store durably cover the guards/interceptors/handler/service/
 * Prisma chain that follows — this is the standard Node/Express pattern for
 * per-request AsyncLocalStorage context.
 *
 * WHY IT VERIFIES THE JWT ITSELF: because it runs before JwtAuthGuard (a
 * controller-level guard), `req.principal` does not exist yet at this point
 * — this middleware cannot simply read it. It independently decodes+verifies
 * the same access token (cookie or Bearer header) using the same secret
 * (`jwtAccessSecret()`, imported from common/config/jwt-secrets.ts) that
 * JwtAuthGuard uses. This duplicates a small amount of token-reading logic
 * but introduces NO new authorization decision: this middleware NEVER
 * blocks a request (it always calls `next()`) — it only ever populates a
 * best-effort tenant id for the RLS backstop. If the token is missing,
 * expired, or tampered, tenantId simply stays unset here (same as an
 * unauthenticated request), and JwtAuthGuard still independently verifies
 * and rejects the request with 401 exactly as before this change. A forged
 * tenantId can therefore never reach a query: either the token is valid (so
 * this middleware's tenantId matches exactly what JwtAuthGuard would also
 * derive from it), or it's invalid (so tenantId stays unset here AND
 * JwtAuthGuard rejects the request before any handler or further guard
 * runs).
 */
@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  constructor(private readonly jwt: JwtService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const cookieToken = readCookie(req.headers?.['cookie'], ACCESS_TOKEN_COOKIE);
    const header: string | undefined = req.headers?.['authorization'];
    const bearerToken = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    const token = cookieToken ?? bearerToken;

    if (!token) {
      TenantContext.run({ tenantId: undefined }, () => next());
      return;
    }

    this.jwt
      .verifyAsync(token, { secret: jwtAccessSecret() })
      .then((payload) => {
        TenantContext.run({ tenantId: payload?.tenantId }, () => next());
      })
      .catch(() => {
        // Invalid/expired token: leave tenantId unset. JwtAuthGuard (which
        // runs later, per-controller) makes the actual accept/reject call.
        TenantContext.run({ tenantId: undefined }, () => next());
      });
  }
}
