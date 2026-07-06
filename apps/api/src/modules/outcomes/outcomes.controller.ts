import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  recordOutcomeMeasureSchema,
  Permission,
  type AuthPrincipal,
  type RecordOutcomeMeasureInput,
} from '@vpsy/contracts';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { OutcomesService } from './outcomes.service';

@ApiTags('outcomes')
@ApiBearerAuth()
@Controller('outcomes')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class OutcomesController {
  constructor(private readonly outcomes: OutcomesService) {}

  @Post()
  @RequirePermissions(Permission.OUTCOME_RECORD)
  record(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(recordOutcomeMeasureSchema)) body: RecordOutcomeMeasureInput,
  ) {
    return this.outcomes.record(user, body);
  }

  @Get('client/:clientId')
  @RequirePermissions(Permission.OUTCOME_READ)
  listForClient(@CurrentUser() user: AuthPrincipal, @Param('clientId') clientId: string) {
    return this.outcomes.listForClient(user, clientId);
  }
}
