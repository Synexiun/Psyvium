import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  createDiagnosisHypothesisSchema,
  createFormulationSchema,
  differentialAiAssistRequestSchema,
  updateDiagnosisHypothesisStatusSchema,
  updateFormulationStatusSchema,
  Permission,
  type AuthPrincipal,
  type CreateDiagnosisHypothesisInput,
  type CreateFormulationInput,
  type DifferentialAiAssistInput,
  type UpdateDiagnosisHypothesisStatusInput,
  type UpdateFormulationStatusInput,
} from '@vpsy/contracts';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { ClinicalWriteGuard } from '../../common/auth/clinical-write.guard';
import { ClinicalAccessGuard } from '../../common/auth/clinical-access.guard';
import { RequireClinicalAccess } from '../../common/auth/clinical-access.decorator';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AiGatewayService } from '../ai-gateway/ai-gateway.service';
import { DiagnosisService } from './diagnosis.service';

/**
 * Diagnosis Support (context 13). Non-diagnostic differential hypotheses,
 * always clinician-authored. No `DIAGNOSIS_*` permission exists yet
 * (packages/contracts/src/rbac.ts is out of scope for this change), so
 * reads/writes reuse `Permission.NOTE_READ`/`NOTE_WRITE` — the closest
 * existing "licensed clinician" gate (granted to PSYCHOLOGIST + SUPERVISOR
 * only, never CLIENT or MANAGER).
 */
@ApiTags('diagnosis-hypotheses')
@ApiBearerAuth()
@Controller('diagnosis-hypotheses')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DiagnosisController {
  constructor(
    private readonly diagnosis: DiagnosisService,
    // Injected directly here (NOT into DiagnosisService) so the AI Gateway
    // has no path whatsoever into DiagnosisService's writes — see the
    // structural "no AI-write path" guarantee test in
    // diagnosis.service.spec.ts, which asserts DiagnosisService's
    // constructor arity/source never references AiGateway.
    private readonly ai: AiGatewayService,
  ) {}

  @Post()
  @UseGuards(ClinicalWriteGuard, ClinicalAccessGuard)
  @RequireClinicalAccess({ resource: 'client', source: 'body', key: 'clientId' })
  @RequirePermissions(Permission.NOTE_WRITE)
  create(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(createDiagnosisHypothesisSchema)) body: CreateDiagnosisHypothesisInput,
  ) {
    return this.diagnosis.create(user, body);
  }

  /** Toggles `clinicianConfirmed` — see the model-gap note in diagnosis.service.ts. */
  @Patch('status')
  @UseGuards(ClinicalWriteGuard, ClinicalAccessGuard)
  @RequireClinicalAccess({ resource: 'hypothesis', source: 'body', key: 'hypothesisId' })
  @RequirePermissions(Permission.NOTE_WRITE)
  updateStatus(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(updateDiagnosisHypothesisStatusSchema)) body: UpdateDiagnosisHypothesisStatusInput,
  ) {
    return this.diagnosis.updateStatus(user, body);
  }

  @Get('client/:clientId')
  @UseGuards(ClinicalAccessGuard)
  @RequireClinicalAccess({ resource: 'client', source: 'params', key: 'clientId' })
  @RequirePermissions(Permission.NOTE_READ)
  listForClient(@CurrentUser() user: AuthPrincipal, @Param('clientId') clientId: string) {
    return this.diagnosis.listForClient(user, clientId);
  }

  /**
   * Differential Hypothesis assistant (doc 05 §3.2). Suggests non-diagnostic
   * DIRECTIONS only (always >= 2, anti-anchoring) — a clinician who agrees
   * still authors the actual DiagnosisHypothesis via `create()` above. Not
   * gated by ClinicalWriteGuard: this is a suggestion, not a clinical-record
   * mutation, matching the session-note/treatment-plan ai-assist pattern.
   */
  @Post('ai-assist')
  @UseGuards(ClinicalAccessGuard)
  @RequireClinicalAccess({ resource: 'client', source: 'body', key: 'clientId' })
  @RequirePermissions(Permission.NOTE_WRITE)
  aiAssist(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(differentialAiAssistRequestSchema)) body: DifferentialAiAssistInput,
  ) {
    return this.ai.suggestDifferentials({
      tenantId: user.tenantId,
      clientId: body.clientId,
      severityBand: body.severityBand,
      specialty: body.specialty,
      screeningDomainsElevated: body.screeningDomainsElevated,
    });
  }
}

/**
 * WAVE CR item 7 — coded Formulation/Diagnosis (DSM-5-TR/ICD-10/11). A
 * separate controller/route namespace from the hypothesis endpoints above:
 * `Formulation` is the clinician's ACTUAL diagnosis, not an assistive
 * differential. Same permission model as diagnosis-hypotheses (no dedicated
 * `DIAGNOSIS_*` permission exists yet) — writes require ClinicalWriteGuard +
 * NOTE_WRITE (licensed clinicians only), reads require NOTE_READ. There is
 * NO AI-write path here: nothing in the AI Gateway ever calls
 * `createFormulation`/`updateFormulationStatus` (asserted in
 * diagnosis.service.spec.ts).
 */
@ApiTags('formulations')
@ApiBearerAuth()
@Controller('formulations')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class FormulationController {
  constructor(private readonly diagnosis: DiagnosisService) {}

  @Post()
  @UseGuards(ClinicalWriteGuard, ClinicalAccessGuard)
  @RequireClinicalAccess({ resource: 'client', source: 'body', key: 'clientId' })
  @RequirePermissions(Permission.NOTE_WRITE)
  create(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(createFormulationSchema)) body: CreateFormulationInput,
  ) {
    return this.diagnosis.createFormulation(user, body);
  }

  @Patch(':id/status')
  @UseGuards(ClinicalWriteGuard, ClinicalAccessGuard)
  @RequireClinicalAccess({ resource: 'formulation', source: 'params', key: 'id' })
  @RequirePermissions(Permission.NOTE_WRITE)
  updateStatus(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateFormulationStatusSchema)) body: UpdateFormulationStatusInput,
  ) {
    return this.diagnosis.updateFormulationStatus(user, id, body);
  }

  @Get('client/:clientId')
  @UseGuards(ClinicalAccessGuard)
  @RequireClinicalAccess({ resource: 'client', source: 'params', key: 'clientId' })
  @RequirePermissions(Permission.NOTE_READ)
  listForClient(@CurrentUser() user: AuthPrincipal, @Param('clientId') clientId: string) {
    return this.diagnosis.listFormulationsForClient(user, clientId);
  }
}
