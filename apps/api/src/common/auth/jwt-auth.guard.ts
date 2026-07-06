import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AuthPrincipal } from '@vpsy/contracts';
import { ACCESS_TOKEN_COOKIE } from '@vpsy/contracts';
import { jwtAccessSecret } from '../config/jwt-secrets';

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
  constructor(private readonly jwt: JwtService) {}

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
      const principal: AuthPrincipal = {
        userId: payload.sub,
        tenantId: payload.tenantId,
        roles: payload.roles ?? [],
        permissions: payload.permissions ?? [],
        clinicId: payload.clinicId,
        jurisdiction: payload.jurisdiction,
      };
      req.principal = principal;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
