import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  grantConsentSchema,
  Permission,
  type AuthPrincipal,
  type GrantConsentInput,
} from '@vpsy/contracts';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ConsentService } from './consent.service';

@ApiTags('consent')
@ApiBearerAuth()
@Controller('consents')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ConsentController {
  constructor(private readonly consents: ConsentService) {}

  /** Client grants a versioned consent (e.g. TELEPSYCHOLOGY, DATA_PROCESSING). */
  @Post()
  @RequirePermissions(Permission.CONSENT_GRANT)
  grant(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(grantConsentSchema)) body: GrantConsentInput,
  ) {
    return this.consents.grant(user, body);
  }

  @Get('me')
  @RequirePermissions(Permission.CONSENT_GRANT)
  listMine(@CurrentUser() user: AuthPrincipal) {
    return this.consents.listMine(user);
  }

  @Patch(':id/revoke')
  @RequirePermissions(Permission.CONSENT_GRANT)
  revoke(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.consents.revoke(user, id);
  }
}
