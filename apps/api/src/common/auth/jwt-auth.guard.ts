import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AuthPrincipal } from '@vpsy/contracts';
import { ACCESS_TOKEN_COOKIE, MfaErrorCode } from '@vpsy/contracts';
import { jwtAccessSecret } from '../config/jwt-secrets';
import { PrismaService } from '../prisma/prisma.service';

/** Paths still usable while a mandatory-role user completes TOTP enrollment. */
const MFA_ENROLLMENT_ALLOWLIST =
  /(?:^|\/)auth\/(mfa\/enroll|mfa\/verify|logout|refresh|me)(?:\/|\?|$)/;

/**
 * Minimal `Cookie` header parser. We deliberately avoid pulling in a global
 * `cookie-parser` middleware for this — the guard is the only place the API
 * needs to read the session cookie, so it parses the one name it cares about
 * directly off the raw header.
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
 * Verifies the access token and attaches the AuthPrincipal (userId,
 * tenantId, roles, permissions, ABAC attributes) to the request. Downstream
 * guards/handlers read `req.principal`.
 *
 * Token source, in order: the httpOnly session cookie (the browser flow —
 * doc 06-security-and-rbac.md §3, XSS-safe token storage) first, falling
 * back to a `Authorization: Bearer` header (API clients / scripts —
 * scripts/smoke.sh relies on this fallback and MUST keep working).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const cookieToken = readCookie(req.headers['cookie'], ACCESS_TOKEN_COOKIE);
    const header: string | undefined = req.headers['authorization'];
    const bearerToken = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    const token = cookieToken ?? bearerToken;
    if (!token) {
      throw new UnauthorizedException('Missing session cookie or bearer token');
    }
    try {
      const payload = await this.jwt.verifyAsync(token, {
        secret: jwtAccessSecret(),
      });
      if (
        payload.typ !== 'access' ||
        typeof payload.sub !== 'string' ||
        typeof payload.tenantId !== 'string' ||
        typeof payload.sid !== 'string' ||
        !Number.isInteger(payload.ver)
      ) {
        throw new UnauthorizedException('Invalid access token claims');
      }

      // JWT validity alone is not enough: suspended/deactivated/deleted users,
      // inactive tenants, revoked sessions and tokens invalidated after refresh
      // reuse must stop working immediately rather than at access-token expiry.
      const session = await this.prisma.refreshSession.findFirst({
        where: {
          id: payload.sid,
          tenantId: payload.tenantId,
          userId: payload.sub,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        include: { user: { include: { tenant: true } } },
      });
      if (
        !session ||
        session.user.deletedAt ||
        session.user.status !== 'ACTIVE' ||
        session.user.tenant.status !== 'active' ||
        session.user.authVersion !== payload.ver
      ) {
        throw new UnauthorizedException('Session is no longer active');
      }
      const mfaEnrollmentRequired = Boolean(payload.mfaEnrollmentRequired);
      const principal: AuthPrincipal = {
        userId: payload.sub,
        tenantId: payload.tenantId,
        roles: payload.roles ?? [],
        permissions: payload.permissions ?? [],
        clinicId: payload.clinicId,
        jurisdiction: payload.jurisdiction,
        mfaEnrollmentRequired,
      };
      req.principal = principal;

      // Mandatory clinical/admin roles that have not enrolled TOTP may only
      // hit MFA enrollment/verify, refresh, logout, and identity bootstrap.
      if (mfaEnrollmentRequired) {
        const path: string = req.originalUrl ?? req.url ?? '';
        if (!MFA_ENROLLMENT_ALLOWLIST.test(path.split('?')[0] ?? path)) {
          throw new ForbiddenException({
            code: MfaErrorCode.MFA_ENROLLMENT_REQUIRED,
            message: 'MFA enrollment is required for this role before using the platform',
          });
        }
      }

      return true;
    } catch (err) {
      if (err instanceof ForbiddenException || err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
