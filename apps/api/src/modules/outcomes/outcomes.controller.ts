import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  outcomeAiAssistRequestSchema,
  recordOutcomeMeasureSchema,
  Permission,
  type AuthPrincipal,
  type OutcomeAiAssistInput,
  type RecordOutcomeMeasureInput,
} from '@vpsy/contracts';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { ClinicalAccessGuard } from '../../common/auth/clinical-access.guard';
import { RequireClinicalAccess } from '../../common/auth/clinical-access.decorator';
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
  @UseGuards(ClinicalAccessGuard)
  @RequireClinicalAccess({ resource: 'client', source: 'body', key: 'clientId' })
  @RequirePermissions(Permission.OUTCOME_RECORD)
  record(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(recordOutcomeMeasureSchema)) body: RecordOutcomeMeasureInput,
  ) {
    return this.outcomes.record(user, body);
  }

  @Get('client/:clientId')
  @UseGuards(ClinicalAccessGuard)
  @RequireClinicalAccess({ resource: 'client', source: 'params', key: 'clientId' })
  @RequirePermissions(Permission.OUTCOME_READ)
  listForClient(@CurrentUser() user: AuthPrincipal, @Param('clientId') clientId: string) {
    return this.outcomes.listForClient(user, clientId);
  }

  /**
   * Outcome Intelligence (doc 05 §3.5). Narrates an ALREADY-COMPUTED,
   * deterministic RCI trend classification for the clinician — never
   * recomputes it, never writes an OutcomeMeasure.
   */
  @Post('ai-assist')
  @UseGuards(ClinicalAccessGuard)
  @RequireClinicalAccess({ resource: 'client', source: 'body', key: 'clientId' })
  @RequirePermissions(Permission.OUTCOME_READ)
  aiAssist(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(outcomeAiAssistRequestSchema)) body: OutcomeAiAssistInput,
  ) {
    return this.outcomes.aiAssist(user, body);
  }
}
