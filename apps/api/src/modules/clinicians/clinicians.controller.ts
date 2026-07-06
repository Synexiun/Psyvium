import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission, type AuthPrincipal } from '@vpsy/contracts';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { CliniciansService } from './clinicians.service';

@ApiTags('clinicians')
@ApiBearerAuth()
@Controller('clinicians')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CliniciansController {
  constructor(private readonly clinicians: CliniciansService) {}

  @Get('me/caseload')
  @RequirePermissions(Permission.CLIENT_READ)
  getMyCaseload(@CurrentUser() user: AuthPrincipal) {
    return this.clinicians.getMyCaseload(user);
  }
}
