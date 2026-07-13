import { Body, Controller, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  createClinicSchema,
  patchClinicSchema,
  patchTenantSchema,
  Permission,
  upsertFeatureFlagSchema,
  type AuthPrincipal,
  type CreateClinicInput,
  type PatchClinicInput,
  type PatchTenantInput,
  type UpsertFeatureFlagInput,
} from '@vpsy/contracts';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AdminService } from './admin.service';
import { SecurityStatusService } from '../../common/crypto/security-status.service';
import { FieldReencryptService } from '../../common/crypto/field-reencrypt.service';
import {
  clinicalValidationSummary,
  listClinicalValidationRegister,
} from '../../common/clinical/clinical-validation-register';
import {
  listVendorBaaRegister,
  vendorBaaSummary,
} from '../../common/compliance/vendor-baa-register';

/**
 * Admin Configuration (contexts 2/27, Wave E). `Permission.ADMIN_CONFIG` is
 * already ADMIN-only in rbac.ts — a native, exact fit for this surface (no
 * rbac.ts change or service-layer role check needed, unlike the Registry
 * module).
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(Permission.ADMIN_CONFIG)
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly security: SecurityStatusService,
    private readonly reencrypt: FieldReencryptService,
  ) {}

  @Get('tenant')
  getTenant(@CurrentUser() user: AuthPrincipal) {
    return this.admin.getTenant(user);
  }

  @Patch('tenant')
  patchTenant(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(patchTenantSchema)) body: PatchTenantInput,
  ) {
    return this.admin.patchTenant(user, body);
  }

  @Post('clinics')
  createClinic(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(createClinicSchema)) body: CreateClinicInput,
  ) {
    return this.admin.createClinic(user, body);
  }

  @Get('clinics')
  listClinics(@CurrentUser() user: AuthPrincipal) {
    return this.admin.listClinics(user);
  }

  @Patch('clinics/:id')
  patchClinic(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(patchClinicSchema)) body: PatchClinicInput,
  ) {
    return this.admin.patchClinic(user, id, body);
  }

  @Get('feature-flags')
  listFeatureFlags(@CurrentUser() user: AuthPrincipal) {
    return this.admin.listFeatureFlags(user);
  }

  /** Upserts a single flag by key — the EU-AI-Act kill-switch seam. Always audited. */
  @Put('feature-flags')
  upsertFeatureFlag(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(upsertFeatureFlagSchema)) body: UpsertFeatureFlagInput,
  ) {
    return this.admin.upsertFeatureFlag(user, body);
  }

  /**
   * PHI staging security posture: cipher, SIEM, documents, audit chain tip,
   * and restore-drill checklist probes.
   */
  @Get('security/status')
  securityStatus(@CurrentUser() user: AuthPrincipal) {
    return this.security.status(user);
  }

  /**
   * Run one field re-encrypt batch for the caller's tenant (or all tenants when
   * scope=all). Use after DEK rotation while previous keys remain configured.
   */
  @Post('security/field-reencrypt')
  fieldReencrypt(
    @CurrentUser() user: AuthPrincipal,
    @Query('scope') scope?: string,
    @Query('sealPlaintext') sealPlaintext?: string,
  ) {
    const seal = sealPlaintext === 'true' || sealPlaintext === '1';
    if (scope === 'all') {
      return this.reencrypt.runForAllTenants({ sealPlaintext: seal });
    }
    return this.reencrypt.runForTenant(user.tenantId, { sealPlaintext: seal });
  }

  /**
   * Clinical algorithm validation register — engineering status + governance
   * sign-off (VPSY_CLINICAL_SIGNOFF_JSON). Marketing claims only when signed.
   */
  @Get('clinical/validation-register')
  clinicalValidationRegister() {
    const entries = listClinicalValidationRegister();
    return { entries, summary: clinicalValidationSummary(entries) };
  }

  /**
   * Subprocessor / BAA inventory. Status overrides via VPSY_BAA_STATUS_JSON.
   * productionPhiReady is false until all required BAAs are marked signed.
   */
  @Get('compliance/vendors')
  vendorBaaRegister() {
    const entries = listVendorBaaRegister();
    return { entries, summary: vendorBaaSummary(entries) };
  }
}
