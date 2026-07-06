import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  riskContextAiAssistRequestSchema,
  Permission,
  type AuthPrincipal,
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
}
