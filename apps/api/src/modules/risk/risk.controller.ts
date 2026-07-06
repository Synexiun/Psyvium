import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  assignEscalationSchema,
  breakGlassSchema,
  createSafetyPlanSchema,
  Permission,
  resolveEscalationSchema,
  type AssignEscalationInput,
  type AuthPrincipal,
  type BreakGlassInput,
  type CreateSafetyPlanInput,
  type ResolveEscalationInput,
} from '@vpsy/contracts';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { RiskService } from './risk.service';

/**
 * Risk & Crisis (context 21, Phase 4). CORE PRINCIPLE: risk detection routes
 * to a human escalation — AI never resolves one, and every action here is
 * audited (see `06-security-and-rbac.md`, `13-roadmap-and-phases.md` Phase 4).
 */
@ApiTags('risk')
@ApiBearerAuth()
@Controller('risk')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RiskController {
  constructor(private readonly risk: RiskService) {}

  @Get('board')
  @RequirePermissions(Permission.RISK_READ)
  getBoard(@CurrentUser() user: AuthPrincipal) {
    return this.risk.getBoard(user);
  }

  @Patch('flags/:id/acknowledge')
  @RequirePermissions(Permission.ESCALATION_HANDLE)
  acknowledgeFlag(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.risk.acknowledgeFlag(user, id);
  }

  @Post('escalations/:id/assign')
  @RequirePermissions(Permission.ESCALATION_HANDLE)
  assignEscalation(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(assignEscalationSchema)) body: AssignEscalationInput,
  ) {
    return this.risk.assignEscalation(user, id, body);
  }

  @Post('escalations/:id/resolve')
  @RequirePermissions(Permission.ESCALATION_HANDLE)
  resolveEscalation(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(resolveEscalationSchema)) body: ResolveEscalationInput,
  ) {
    return this.risk.resolveEscalation(user, id, body);
  }

  @Post('safety-plans')
  @RequirePermissions(Permission.SAFETYPLAN_WRITE)
  createSafetyPlan(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(createSafetyPlanSchema)) body: CreateSafetyPlanInput,
  ) {
    return this.risk.createSafetyPlan(user, body);
  }

  @Get('safety-plans/client/:clientId')
  @RequirePermissions(Permission.RISK_READ)
  getLatestSafetyPlan(@CurrentUser() user: AuthPrincipal, @Param('clientId') clientId: string) {
    return this.risk.getLatestSafetyPlan(user, clientId);
  }

  @Post('break-glass')
  @RequirePermissions(Permission.BREAKGLASS_INVOKE)
  breakGlass(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(breakGlassSchema)) body: BreakGlassInput,
  ) {
    return this.risk.breakGlass(user, body);
  }
}
