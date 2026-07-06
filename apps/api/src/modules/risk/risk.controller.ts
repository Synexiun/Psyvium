import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  assignEscalationSchema,
  breakGlassSchema,
  completeEscalationFollowUpSchema,
  createIncidentReviewSchema,
  createSafetyPlanSchema,
  Permission,
  resolveEscalationSchema,
  type AssignEscalationInput,
  type AuthPrincipal,
  type BreakGlassInput,
  type CompleteEscalationFollowUpInput,
  type CreateIncidentReviewInput,
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

  @Patch('escalations/:id/follow-up')
  @RequirePermissions(Permission.ESCALATION_HANDLE)
  completeFollowUp(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(completeEscalationFollowUpSchema)) body: CompleteEscalationFollowUpInput,
  ) {
    return this.risk.completeFollowUp(user, id, body);
  }

  @Post('safety-plans')
  @RequirePermissions(Permission.SAFETYPLAN_WRITE)
  createSafetyPlan(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(createSafetyPlanSchema)) body: CreateSafetyPlanInput,
  ) {
    return this.risk.createSafetyPlan(user, body);
  }

  // Client-facing "own plan" read (Stanley-Brown SPI client-visible-copy
  // requirement) — declared ahead of the parameterized :clientId route below
  // for clarity; Nest doesn't need the ordering since the static "me" segment
  // never collides with a route under "client/:clientId".
  @Get('safety-plans/me')
  @RequirePermissions(Permission.CLIENT_READ)
  getMySafetyPlan(@CurrentUser() user: AuthPrincipal) {
    return this.risk.getMySafetyPlan(user);
  }

  @Get('safety-plans/client/:clientId')
  @RequirePermissions(Permission.RISK_READ)
  getLatestSafetyPlan(@CurrentUser() user: AuthPrincipal, @Param('clientId') clientId: string) {
    return this.risk.getLatestSafetyPlan(user, clientId);
  }

  // Emergency-access escape hatch (doc 06-security-and-rbac.md: break-glass
  // always emits a high-severity audit event) — the tightest limit in the
  // API, well below the global default, keyed by principal.
  @Post('break-glass')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @RequirePermissions(Permission.BREAKGLASS_INVOKE)
  breakGlass(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(breakGlassSchema)) body: BreakGlassInput,
  ) {
    return this.risk.breakGlass(user, body);
  }

  // Post-incident review (Joint Commission NPSG 15.01.01 / TJC sentinel-event
  // review practice, WAVE CR). Gated on ESCALATION_HANDLE — the same
  // permission that gates assign/resolve/follow-up — because sentinel-event
  // review is the same escalation-handling authority extended to its
  // post-hoc step, and ESCALATION_HANDLE is exactly the set of roles (
  // PSYCHOLOGIST/MANAGER/SUPERVISOR) who can plausibly author one; adding a
  // brand-new permission key for this would just duplicate that grant list.
  // Deliberately NOT a gate on resolveEscalation/breakGlass — see
  // RiskService doc comments; the pending list below is the enforcement.
  @Post('incident-reviews')
  @RequirePermissions(Permission.ESCALATION_HANDLE)
  createIncidentReview(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(createIncidentReviewSchema)) body: CreateIncidentReviewInput,
  ) {
    return this.risk.createIncidentReview(user, body);
  }

  // "Never ages silently": every SEVERE escalation resolution and
  // break-glass grant with no review row yet. Declared ahead of the
  // parameterized `subject/:subjectId` route below for clarity (no actual
  // collision — "pending" and "subject/:id" are distinct static segments).
  @Get('incident-reviews/pending')
  @RequirePermissions(Permission.RISK_READ)
  listPendingIncidentReviews(@CurrentUser() user: AuthPrincipal) {
    return this.risk.listPendingIncidentReviews(user);
  }

  @Get('incident-reviews/subject/:subjectId')
  @RequirePermissions(Permission.RISK_READ)
  getIncidentReviewsForSubject(@CurrentUser() user: AuthPrincipal, @Param('subjectId') subjectId: string) {
    return this.risk.getIncidentReviewsForSubject(user, subjectId);
  }

  // Jurisdiction-aware emergency resources (APA telepsychology guidance —
  // WAVE CR: "988 is US-only"). No PHI involved; gated the same as the
  // client's own safety-plan read (CLIENT_READ) since the patient home card
  // is the primary caller, alongside any clinician role that also holds it.
  @Get('crisis-resources')
  @RequirePermissions(Permission.CLIENT_READ)
  getCrisisResources(@CurrentUser() user: AuthPrincipal) {
    return this.risk.getCrisisResources(user);
  }
}
