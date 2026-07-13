import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  decideAiRecommendationSchema,
  riskContextAiAssistRequestSchema,
  Permission,
  type AuthPrincipal,
  type DecideAiRecommendationInput,
  type RiskContextAiAssistInput,
} from '@vpsy/contracts';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AiGatewayService } from './ai-gateway.service';

/**
 * Crisis context-assembly (doc 05 §3.6). Lives INSIDE the AI Gateway module
 * (not the Risk & Crisis context) precisely because it must never touch risk
 * DETECTION: this endpoint only ASSEMBLES a brief situational summary for the
 * human responder AFTER a RiskFlag/Escalation already exists elsewhere.
 * Advisory only — the assigned clinician/manager decides and acts.
 */
@ApiTags('ai-gateway')
@ApiBearerAuth()
@Controller('ai')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AiRiskContextController {
  constructor(private readonly ai: AiGatewayService) {}

  @Post('risk-context')
  @RequirePermissions(Permission.RISK_READ)
  riskContext(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(riskContextAiAssistRequestSchema)) body: RiskContextAiAssistInput,
  ) {
    return this.ai.summarizeRiskContext({
      tenantId: user.tenantId,
      clientId: body.clientId,
      riskFlagId: body.riskFlagId,
      severity: body.severity,
      riskType: body.riskType,
      openEscalations: body.openEscalations,
      hasActiveSafetyPlan: body.hasActiveSafetyPlan,
      slaDueInMinutes: body.slaDueInMinutes,
    });
  }

  /** PENDING human-decision queue — clinicians decide; AI never self-accepts. */
  @Get('recommendations/pending')
  @RequirePermissions(Permission.AI_DECISION)
  listPending(
    @CurrentUser() user: AuthPrincipal,
    @Query('limit') limit?: string,
  ) {
    const parsed = limit ? Number(limit) : 50;
    return this.ai.listPendingRecommendations(user, Number.isFinite(parsed) ? parsed : 50);
  }

  /**
   * Model/prompt provenance for a single recommendation (EU AI Act logging).
   * Must be registered BEFORE the `:id/decision` sibling so Nest routing is unambiguous.
   */
  @Get('recommendations/:id')
  @RequirePermissions(Permission.AI_DECISION)
  getProvenance(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.ai.getRecommendationProvenance(user, id);
  }

  @Patch('recommendations/:id/decision')
  @RequirePermissions(Permission.AI_DECISION)
  decide(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(decideAiRecommendationSchema)) body: DecideAiRecommendationInput,
  ) {
    return this.ai.decideRecommendation(user, id, body);
  }
}
