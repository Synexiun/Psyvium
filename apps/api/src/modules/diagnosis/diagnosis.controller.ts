import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  createDiagnosisHypothesisSchema,
  updateDiagnosisHypothesisStatusSchema,
  Permission,
  type AuthPrincipal,
  type CreateDiagnosisHypothesisInput,
  type UpdateDiagnosisHypothesisStatusInput,
} from '@vpsy/contracts';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { ClinicalWriteGuard } from '../../common/auth/clinical-write.guard';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
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
  constructor(private readonly diagnosis: DiagnosisService) {}

  @Post()
  @UseGuards(ClinicalWriteGuard)
  @RequirePermissions(Permission.NOTE_WRITE)
  create(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(createDiagnosisHypothesisSchema)) body: CreateDiagnosisHypothesisInput,
  ) {
    return this.diagnosis.create(user, body);
  }

  /** Toggles `clinicianConfirmed` — see the model-gap note in diagnosis.service.ts. */
  @Patch('status')
  @UseGuards(ClinicalWriteGuard)
  @RequirePermissions(Permission.NOTE_WRITE)
  updateStatus(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(updateDiagnosisHypothesisStatusSchema)) body: UpdateDiagnosisHypothesisStatusInput,
  ) {
    return this.diagnosis.updateStatus(user, body);
  }

  @Get('client/:clientId')
  @RequirePermissions(Permission.NOTE_READ)
  listForClient(@CurrentUser() user: AuthPrincipal, @Param('clientId') clientId: string) {
    return this.diagnosis.listForClient(user, clientId);
  }
}
