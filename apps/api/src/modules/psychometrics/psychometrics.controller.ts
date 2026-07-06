import { Body, Controller, Get, Param, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  administerResponseSchema,
  Permission,
  type AdministerResponseInput,
  type AuthPrincipal,
} from '@vpsy/contracts';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import { PsychometricsService } from './psychometrics.service';

@ApiTags('psychometrics')
@ApiBearerAuth()
@Controller('assessments')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PsychometricsController {
  constructor(private readonly psychometrics: PsychometricsService) {}

  /**
   * Administers a response against a published QuestionnaireVersion and scores
   * it atomically. NOT license-gated: assessments are commonly self-report
   * (a CLIENT administers their own screening from the patient app), so the
   * ClinicalWriteGuard (which requires a Psychologist/Credential profile) does
   * NOT apply here — it is reserved for clinician-authored records (notes,
   * plans). Access is still bounded by the ASSESSMENT_ADMINISTER permission.
   */
  // Clinical-record mutation (doc 04-api-design.md §8): requires
  // Idempotency-Key and replays the original scored response on a duplicate
  // submit, so a retried/double-tapped submission never administers twice.
  @Post('responses')
  @RequirePermissions(Permission.ASSESSMENT_ADMINISTER)
  @UseInterceptors(IdempotencyInterceptor)
  administer(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(administerResponseSchema)) body: AdministerResponseInput,
  ) {
    return this.psychometrics.administer(user, body);
  }

  @Get('responses/:id')
  @RequirePermissions(Permission.ASSESSMENT_INTERPRET)
  getResponse(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.psychometrics.getResponse(user, id);
  }
}
