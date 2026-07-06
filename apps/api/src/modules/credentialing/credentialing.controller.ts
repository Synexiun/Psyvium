import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  createCredentialSchema,
  verifyCredentialSchema,
  Permission,
  type AuthPrincipal,
  type CreateCredentialInput,
  type VerifyCredentialInput,
} from '@vpsy/contracts';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CredentialingService } from './credentialing.service';

@ApiTags('credentialing')
@ApiBearerAuth()
@Controller('credentials')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CredentialingController {
  constructor(private readonly credentials: CredentialingService) {}

  /** Captures a license/credential for a psychologist (self, unless psychologistId is given). */
  @Post()
  @RequirePermissions(Permission.CREDENTIAL_WRITE)
  create(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(createCredentialSchema)) body: CreateCredentialInput,
  ) {
    return this.credentials.create(user, body);
  }

  /** Sets verification/malpractice status — MANAGER/ADMIN only (credential:verify). */
  @Patch(':id/verify')
  @RequirePermissions(Permission.CREDENTIAL_VERIFY)
  verify(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(verifyCredentialSchema)) body: VerifyCredentialInput,
  ) {
    return this.credentials.verify(user, id, body);
  }

  @Get('psychologist/:id')
  @RequirePermissions(Permission.CREDENTIAL_WRITE)
  listByPsychologist(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.credentials.listByPsychologist(user, id);
  }
}
