import { Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import { jwtAccessSecret } from '../config/jwt-secrets';

/**
 * Global rate-limit guard (doc `04-api-design.md` §9): keys the bucket by
 * authenticated principal ("tenant + user") when the caller is authenticated,
 * falling back to IP otherwise (login/register, or a missing/invalid token —
 * which is rejected separately by `JwtAuthGuard` with a 401; this guard's job
 * is only to choose a fair bucket, never to make an authn/authz decision).
 *
 * This guard is registered as a **global** `APP_GUARD` (see `rate-limit.module.ts`),
 * which in Nest's guard-resolution order runs *before* any controller-level
 * `@UseGuards(JwtAuthGuard, ...)` — so `req.principal` is not populated yet on
 * the first pass. Rather than depend on guard ordering, this guard
 * independently (and defensively) verifies the bearer token itself, purely to
 * extract a tracking key — it never throws on a bad/missing token; it just
 * falls back to IP.
 */
@Injectable()
export class PrincipalThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storage: ThrottlerStorage,
    reflector: Reflector,
    private readonly jwt: JwtService,
  ) {
    super(options, storage, reflector);
  }

  protected async getTracker(req: Record<string, any>): Promise<string> {
    // If some earlier guard already attached the principal (e.g. a future
    // route orders JwtAuthGuard first), reuse it rather than re-verifying.
    const attached = req.principal;
    if (attached?.tenantId && attached?.userId) {
      return `principal:${attached.tenantId}:${attached.userId}`;
    }

    const header: string | undefined = req.headers?.['authorization'];
    if (header?.startsWith('Bearer ')) {
      try {
        const payload = await this.jwt.verifyAsync(header.slice(7), { secret: jwtAccessSecret() });
        if (payload?.tenantId && payload?.sub) {
          return `principal:${payload.tenantId}:${payload.sub}`;
        }
      } catch {
        // Invalid/expired token: fall through to cookie / IP.
      }
    }

    // Browser portal uses httpOnly access cookie (doc 06 §3) — principal
    // tracking must not collapse every staff user behind NAT to one IP bucket.
    const cookieHeader: string | undefined = req.headers?.cookie ?? req.headers?.Cookie;
    const cookieToken = this.readCookie(cookieHeader, 'vpsy_at');
    if (cookieToken) {
      try {
        const payload = await this.jwt.verifyAsync(cookieToken, { secret: jwtAccessSecret() });
        if (payload?.tenantId && payload?.sub) {
          return `principal:${payload.tenantId}:${payload.sub}`;
        }
      } catch {
        // Invalid/expired cookie: fall through to IP tracking.
      }
    }

    return `ip:${req.ip}`;
  }

  private readCookie(header: string | undefined, name: string): string | undefined {
    if (!header) return undefined;
    for (const part of header.split(';')) {
      const [rawKey, ...rest] = part.trim().split('=');
      if (rawKey === name) return decodeURIComponent(rest.join('='));
    }
    return undefined;
  }
}
