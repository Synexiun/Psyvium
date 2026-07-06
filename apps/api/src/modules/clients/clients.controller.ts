import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission, type AuthPrincipal } from '@vpsy/contracts';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { ClientsService } from './clients.service';

@ApiTags('clients')
@ApiBearerAuth()
@Controller('clients')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  /** The authenticated CLIENT's own clinical summary. */
  @Get('me')
  @RequirePermissions(Permission.CLIENT_READ)
  getMe(@CurrentUser() user: AuthPrincipal) {
    return this.clients.getMySummary(user);
  }

  /** A clinician's/manager's view of a specific client. ABAC-gated in the service. */
  @Get(':clientId/clinical-summary')
  @RequirePermissions(Permission.CLIENT_READ)
  getClinicalSummary(@CurrentUser() user: AuthPrincipal, @Param('clientId') clientId: string) {
    return this.clients.getClinicalSummary(user, clientId);
  }
}
