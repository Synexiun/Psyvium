import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AuthPrincipal } from '@vpsy/contracts';
import { jwtAccessSecret } from '../config/jwt-secrets';

/**
 * Verifies the bearer access token and attaches the AuthPrincipal (userId,
 * tenantId, roles, permissions, ABAC attributes) to the request. Downstream
 * guards/handlers read `req.principal`.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers['authorization'];
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const token = header.slice(7);
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
