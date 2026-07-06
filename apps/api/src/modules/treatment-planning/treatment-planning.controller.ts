import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  createTreatmentPlanSchema,
  treatmentPlanAiAssistRequestSchema,
  updateGoalProgressSchema,
  Permission,
  type AuthPrincipal,
  type CreateTreatmentPlanInput,
  type TreatmentPlanAiAssistInput,
  type UpdateGoalProgressInput,
} from '@vpsy/contracts';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { ClinicalWriteGuard } from '../../common/auth/clinical-write.guard';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { TreatmentPlanningService } from './treatment-planning.service';

@ApiTags('treatment-planning')
@ApiBearerAuth()
@Controller('treatment-plans')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TreatmentPlanningController {
  constructor(private readonly plans: TreatmentPlanningService) {}

  /** Supersedes any prior active plan for the client. Gated by ClinicalWriteGuard. */
  @Post()
  @UseGuards(ClinicalWriteGuard)
  @RequirePermissions(Permission.PLAN_WRITE)
  create(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(createTreatmentPlanSchema)) body: CreateTreatmentPlanInput,
  ) {
    return this.plans.create(user, body);
  }

  @Patch('goals/progress')
  @UseGuards(ClinicalWriteGuard)
  @RequirePermissions(Permission.PLAN_WRITE)
  updateGoalProgress(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(updateGoalProgressSchema)) body: UpdateGoalProgressInput,
  ) {
    return this.plans.updateGoalProgress(user, body);
  }

  @Get('client/:clientId/active')
  @RequirePermissions(Permission.PLAN_READ)
  getActivePlan(@CurrentUser() user: AuthPrincipal, @Param('clientId') clientId: string) {
    return this.plans.getActivePlan(user, clientId);
  }

  /**
   * Treatment-Plan Support (doc 05 §3.3). Returns assistive goal/intervention
   * SUGGESTIONS only — never prescriptive, never persisted. The clinician
   * composes the actual plan via `create()`/`updateGoalProgress()` above.
   * Not gated by ClinicalWriteGuard: this is a suggestion, not a clinical
   * record mutation.
   */
  @Post('ai-assist')
  @RequirePermissions(Permission.PLAN_WRITE)
  aiAssist(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(treatmentPlanAiAssistRequestSchema)) body: TreatmentPlanAiAssistInput,
  ) {
    return this.plans.aiAssist(user, body);
  }
}
