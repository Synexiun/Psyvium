import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  recordWearableMetricSchema,
  Permission,
  type AuthPrincipal,
  type RecordWearableMetricInput,
} from '@vpsy/contracts';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { WearablesService } from './wearables.service';

@ApiTags('wearables')
@ApiBearerAuth()
@Controller('wearables')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class WearablesController {
  constructor(private readonly wearables: WearablesService) {}

  @Post('metrics')
  @RequirePermissions(Permission.WEARABLE_WRITE)
  ingest(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(recordWearableMetricSchema)) body: RecordWearableMetricInput,
  ) {
    return this.wearables.ingest(user, body);
  }

  @Get('client/:clientId/rollup')
  @RequirePermissions(Permission.WEARABLE_READ)
  getRollup(
    @CurrentUser() user: AuthPrincipal,
    @Param('clientId') clientId: string,
    @Query('windowDays') windowDays?: string,
  ) {
    return this.wearables.getRollup(user, clientId, windowDays ? Number(windowDays) : undefined);
  }
}
