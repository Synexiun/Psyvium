import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  completeInviteSchema,
  createClientRegistrySchema,
  createPsychologistRegistrySchema,
  patchClientRegistrySchema,
  patchPsychologistRegistrySchema,
  Permission,
  registryListQuerySchema,
  type AuthPrincipal,
  type CompleteInviteInput,
  type CreateClientRegistryInput,
  type CreatePsychologistRegistryInput,
  type PatchClientRegistryInput,
  type PatchPsychologistRegistryInput,
  type RegistryListQuery,
} from '@vpsy/contracts';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { RegistryService } from './registry.service';

/**
 * Public invite activation (no JWT). The invite token is the credential —
 * same pattern as auth password-reset completion. Wired against the
 * PasswordResetToken store for INVITED users.
 */
@ApiTags('registry-invite')
@Controller('registry/invite')
export class RegistryInviteController {
  constructor(private readonly registry: RegistryService) {}

  @Post('complete')
  complete(@Body(new ZodValidationPipe(completeInviteSchema)) body: CompleteInviteInput) {
    return this.registry.completeInvite(body);
  }
}

/**
 * Client Registry (context 3, Wave E) — ADMIN write surface for the person
 * master record. See the permission-gap note atop
 * `packages/contracts/src/dto/registry.ts`: `Permission.CRM_WRITE` is
 * reused here (rbac.ts out of scope for this wave) and the actual
 * MANAGER/ADMIN-only restriction is enforced by `RegistryService.assertRegistryWriter`.
 */
@ApiTags('registry-clients')
@ApiBearerAuth()
@Controller('registry/clients')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ClientRegistryController {
  constructor(private readonly registry: RegistryService) {}

  @Post()
  @RequirePermissions(Permission.CRM_WRITE)
  create(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(createClientRegistrySchema)) body: CreateClientRegistryInput,
  ) {
    return this.registry.createClient(user, body);
  }

  @Get()
  @RequirePermissions(Permission.CRM_WRITE)
  list(@CurrentUser() user: AuthPrincipal, @Query(new ZodValidationPipe(registryListQuerySchema)) query: RegistryListQuery) {
    return this.registry.listClients(user, query.take, query.cursor);
  }

  @Patch(':id')
  @RequirePermissions(Permission.CRM_WRITE)
  patch(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(patchClientRegistrySchema)) body: PatchClientRegistryInput,
  ) {
    return this.registry.patchClient(user, id, body);
  }

  /** Soft-delete only — sets `deletedAt`; the row is never hard-deleted. */
  @Delete(':id')
  @RequirePermissions(Permission.CRM_WRITE)
  remove(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.registry.softDeleteClient(user, id);
  }
}

/**
 * Psychologist Registry (context 4, Wave E) — same gating rationale as
 * ClientRegistryController above.
 */
@ApiTags('registry-psychologists')
@ApiBearerAuth()
@Controller('registry/psychologists')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PsychologistRegistryController {
  constructor(private readonly registry: RegistryService) {}

  @Post()
  @RequirePermissions(Permission.CRM_WRITE)
  create(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(createPsychologistRegistrySchema)) body: CreatePsychologistRegistryInput,
  ) {
    return this.registry.createPsychologist(user, body);
  }

  @Get()
  @RequirePermissions(Permission.CRM_WRITE)
  list(@CurrentUser() user: AuthPrincipal, @Query(new ZodValidationPipe(registryListQuerySchema)) query: RegistryListQuery) {
    return this.registry.listPsychologists(user, query.take, query.cursor);
  }

  @Patch(':id')
  @RequirePermissions(Permission.CRM_WRITE)
  patch(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(patchPsychologistRegistrySchema)) body: PatchPsychologistRegistryInput,
  ) {
    return this.registry.patchPsychologist(user, id, body);
  }

  /** Soft-delete only — sets `deletedAt`; the row is never hard-deleted. */
  @Delete(':id')
  @RequirePermissions(Permission.CRM_WRITE)
  remove(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.registry.softDeletePsychologist(user, id);
  }
}
