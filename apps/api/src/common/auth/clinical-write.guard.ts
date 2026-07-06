import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthPrincipal } from '@vpsy/contracts';
import { CredentialingService } from '../../modules/credentialing/credentialing.service';

/**
 * Phase-2 compliance gate (docs/technical/13-roadmap-and-phases.md, Credentialing
 * & Contracts DoD): "Clinical writes blocked when license inactive or
 * jurisdiction/scope mismatched." Applied in addition to JwtAuthGuard +
 * PermissionsGuard on clinical WRITE endpoints only (session-note create/sign,
 * treatment-plan create/goal-progress, assessment administer) — never on
 * client-initiated intake or on read endpoints.
 *
 * Runs after JwtAuthGuard so `req.principal` is already populated. Delegates
 * the actual eligibility check to `CredentialingService.assertClinicalEligibility`,
 * which throws ForbiddenException on any of: no psychologist/credential
 * profile, unverified, inactive malpractice status, expired, or a
 * jurisdiction that doesn't match the acting principal's.
 */
@Injectable()
export class ClinicalWriteGuard implements CanActivate {
  constructor(private readonly credentialing: CredentialingService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const principal: AuthPrincipal | undefined = req.principal;
    if (!principal) throw new ForbiddenException('No principal');

    await this.credentialing.assertClinicalEligibility(principal.userId, principal.jurisdiction);
    return true;
  }
}
