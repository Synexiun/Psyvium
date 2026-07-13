import { Body, Controller, Get, Param, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  administerResponseSchema,
  catAnswerSchema,
  catStartSchema,
  Permission,
  type AdministerResponseInput,
  type AuthPrincipal,
  type CatAnswerInput,
  type CatStartInput,
} from '@vpsy/contracts';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import { PsychometricsService } from './psychometrics.service';
import { CatService } from './cat.service';
import { DifService, type DifAnalysisRequest } from './dif.service';

@ApiTags('psychometrics')
@ApiBearerAuth()
@Controller('assessments')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PsychometricsController {
  constructor(
    private readonly psychometrics: PsychometricsService,
    private readonly cat: CatService,
    private readonly dif: DifService,
  ) {}

  /**
   * License-aware instrument catalog (professional psychometrics inventory).
   * PUBLIC_DOMAIN always administerable; LICENSED/PROPRIETARY need active grant.
   */
  @Get('catalog')
  @RequirePermissions(Permission.ASSESSMENT_ADMINISTER)
  listCatalog(@CurrentUser() user: AuthPrincipal) {
    return this.psychometrics.listCatalog(user);
  }

  /**
   * Differential Item Functioning (Mantel–Haenszel) research endpoint.
   * Sample-size gated; never drives automated clinical decisions.
   */
  @Post('dif/analyze')
  @RequirePermissions(Permission.ASSESSMENT_INTERPRET)
  analyzeDif(@Body() body: DifAnalysisRequest) {
    return this.dif.analyze(body);
  }

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

  /**
   * Psychometric Interpretation (doc 05 §3.7) — CLINICIAN_ONLY assistive
   * interpretation of an already-scored, already-banded result. No request
   * body: the target score is identified entirely by `:id`, and every signal
   * sent to the model is derived server-side (never re-scored, never
   * overridden by AI).
   */
  @Post('scores/:id/ai-interpret')
  @RequirePermissions(Permission.ASSESSMENT_INTERPRET)
  aiInterpret(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.psychometrics.aiInterpret(user, id);
  }

  /**
   * Serves item stems/response options for the web assessment UI
   * (docs/technical/07-psychometrics-engine.md §9). Same permission as
   * self-administer: a CLIENT reading the questions they're about to answer
   * needs no clinician-credential gate. `?locale=` requests a translation;
   * omitted (or `en`) serves the source-language item. See
   * `PsychometricsService.getVersionItems` for the honest-fallback contract —
   * an unvalidated/missing translation is never silently served as localized.
   */
  @Get('versions/:id/items')
  @RequirePermissions(Permission.ASSESSMENT_ADMINISTER)
  getVersionItems(@Param('id') id: string, @Query('locale') locale?: string) {
    return this.psychometrics.getVersionItems(id, locale);
  }

  // ── Computerized Adaptive Testing (docs/technical/07-psychometrics-engine.md §6) ──
  // Same access model as batch self-administer: NOT license-gated (clients
  // self-report), bounded by ASSESSMENT_ADMINISTER + the ABAC client-self
  // check inside CatService (a CLIENT only ever touches their own session).

  /** Starts a CAT session against a CAT-declaring, calibrated instrument; returns the first item. */
  @Post('cat/start')
  @RequirePermissions(Permission.ASSESSMENT_ADMINISTER)
  @UseInterceptors(IdempotencyInterceptor)
  startCat(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(catStartSchema)) body: CatStartInput,
  ) {
    return this.cat.start(user, body);
  }

  /**
   * Records the answer to the pending item, re-runs EAP, and returns either
   * the next max-information item or the completed session with its final
   * persisted score. `itemId` must echo the pending item, so a double-tapped
   * or stale submit fails loudly (400) instead of double-recording; the
   * Idempotency-Key replay additionally lets a retried request replay the
   * original outcome verbatim (doc 04-api-design.md §8).
   */
  @Post('cat/:sessionId/answer')
  @RequirePermissions(Permission.ASSESSMENT_ADMINISTER)
  @UseInterceptors(IdempotencyInterceptor)
  answerCat(
    @CurrentUser() user: AuthPrincipal,
    @Param('sessionId') sessionId: string,
    @Body(new ZodValidationPipe(catAnswerSchema)) body: CatAnswerInput,
  ) {
    return this.cat.answer(user, sessionId, body);
  }

  @Get('cat/:sessionId')
  @RequirePermissions(Permission.ASSESSMENT_ADMINISTER)
  getCatSession(@CurrentUser() user: AuthPrincipal, @Param('sessionId') sessionId: string) {
    return this.cat.getState(user, sessionId);
  }
}
