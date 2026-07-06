import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthPrincipal, Permission } from '@vpsy/contracts';
import { PERMISSIONS_KEY } from './permissions.decorator';

/**
 * RBAC enforcement. The ability layer (ABAC) refines this further inside
 * services using principal.tenantId / clinicId / jurisdiction. Server is the
 * source of truth; the frontend mirror is UI-only.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest();
    const principal: AuthPrincipal | undefined = req.principal;
    if (!principal) throw new ForbiddenException('No principal');

    const granted = new Set(principal.permissions);
    const missing = required.filter((p) => !granted.has(p));
    if (missing.length > 0) {
      throw new ForbiddenException(`Missing permission(s): ${missing.join(', ')}`);
    }
    return true;
  }
}
