import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  assignHomeworkSchema,
  completeHomeworkSchema,
  createInterventionSchema,
  Permission,
  reviewHomeworkSchema,
  type AssignHomeworkInput,
  type AuthPrincipal,
  type CompleteHomeworkInput,
  type CreateInterventionInput,
  type ReviewHomeworkInput,
} from '@vpsy/contracts';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { ClinicalWriteGuard } from '../../common/auth/clinical-write.guard';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { InterventionService } from './intervention.service';

@ApiTags('interventions')
@ApiBearerAuth()
@Controller('interventions')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class InterventionController {
  constructor(private readonly interventions: InterventionService) {}

  /** Always anchors to the client's current ACTIVE TreatmentPlan. Clinician-gated. */
  @Post()
  @UseGuards(ClinicalWriteGuard)
  @RequirePermissions(Permission.INTERVENTION_WRITE)
  create(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(createInterventionSchema)) body: CreateInterventionInput,
  ) {
    return this.interventions.create(user, body);
  }

  /** Assigns homework to an existing Intervention. Clinician-gated. */
  @Post('homework')
  @UseGuards(ClinicalWriteGuard)
  @RequirePermissions(Permission.INTERVENTION_WRITE)
  assignHomework(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(assignHomeworkSchema)) body: AssignHomeworkInput,
  ) {
    return this.interventions.assignHomework(user, body);
  }

  /** A client's own interventions + homework; clinician/manager may view any client's. */
  @Get('client/:clientId')
  @RequirePermissions(Permission.CLIENT_READ)
  listForClient(@CurrentUser() user: AuthPrincipal, @Param('clientId') clientId: string) {
    return this.interventions.listForClient(user, clientId);
  }

  /**
   * Marks homework complete (client self-report, or a clinician recording it
   * on the client's behalf). Not gated by ClinicalWriteGuard — this is a
   * progress update, not a clinical-record authoring action. See
   * `Permission.CLIENT_READ` reuse note in InterventionService.completeHomework.
   */
  @Patch('homework/:id/complete')
  @RequirePermissions(Permission.CLIENT_READ)
  completeHomework(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(completeHomeworkSchema)) body: CompleteHomeworkInput,
  ) {
    return this.interventions.completeHomework(user, id, body);
  }

  /**
   * Kazantzis homework-loop remediation (docs/10-10-PROGRAM.md WAVE CR P1):
   * clinician review-at-next-session step. Clinician-only — gated by both
   * ClinicalWriteGuard and INTERVENTION_WRITE (not held by CLIENT, see
   * packages/contracts/src/rbac.ts), with a service-layer check as
   * defense-in-depth. The `:id` route param is the authoritative homework
   * id; it overrides whatever `homeworkId` the body carries.
   */
  @Patch('homework/:id/review')
  @UseGuards(ClinicalWriteGuard)
  @RequirePermissions(Permission.INTERVENTION_WRITE)
  reviewHomework(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reviewHomeworkSchema)) body: ReviewHomeworkInput,
  ) {
    return this.interventions.reviewHomework(user, { ...body, homeworkId: id });
  }
}
