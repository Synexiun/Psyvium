import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Role,
  type AssessmentAssignmentDto,
  type AssignAssessmentInput,
  type AuthPrincipal,
  type CompleteAssignmentInput,
  type QuestionnaireResponseDto,
} from '@vpsy/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { EventBus, Events } from '../../common/events/event-bus.service';
import { AiGatewayService } from '../ai-gateway/ai-gateway.service';
import { PsychometricsService } from './psychometrics.service';
import { assertAuthorizedAssessmentTarget } from './assessment-target-access';
import { assertActiveInstrumentLicense } from './instrument-license';
import { validateStaticResponses } from './response-validation';

/**
 * Assessment assignment workflow (doc 07 §9):
 *
 *   clinician assigns a published instrument → the client sees it on their
 *   dashboard and completes it → answers are scored through the EXACT batch
 *   pipeline (deterministic bands + safety-item → Risk routing) → the
 *   clinician reviews answers/score/guide → a governed AI briefing is
 *   auto-requested (consent + kill-switch gated, honest rule-based fallback,
 *   NEVER blocking) and lands in the PENDING AIRecommendation ledger.
 *
 * ABAC: assigning/reading uses the unified caseload enforcer
 * (assertAuthorizedAssessmentTarget); completing is CLIENT-SELF ONLY. The
 * assigner must hold a clinical staff role — a client can never assign to
 * themselves even though CLIENT carries assessment:administer for self-report.
 */

const CLINICAL_ASSIGNER_ROLES: readonly Role[] = [Role.PSYCHOLOGIST, Role.MANAGER, Role.SUPERVISOR];

const ASSIGNMENT_INCLUDE = {
  questionnaireVersion: {
    select: {
      id: true,
      questionnaire: { select: { code: true, name: true, construct: true } },
      _count: { select: { items: { where: { active: true } } } },
    },
  },
} as const;

type AssignmentRow = {
  id: string;
  clientId: string;
  questionnaireVersionId: string;
  assignedBy: string;
  note: string | null;
  status: string;
  dueAt: Date | null;
  responseId: string | null;
  completedAt: Date | null;
  createdAt: Date;
  questionnaireVersion: {
    id: string;
    questionnaire: { code: string; name: string; construct: string };
    _count: { items: number };
  };
};

@Injectable()
export class AssessmentAssignmentService {
  private readonly logger = new Logger(AssessmentAssignmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly bus: EventBus,
    private readonly psychometrics: PsychometricsService,
    private readonly ai: AiGatewayService,
  ) {}

  /** Clinician assigns a published CLASSICAL instrument version to a client on their caseload. */
  async assign(principal: AuthPrincipal, input: AssignAssessmentInput): Promise<AssessmentAssignmentDto> {
    if (!principal.roles.some((r) => CLINICAL_ASSIGNER_ROLES.includes(r as Role))) {
      throw new ForbiddenException('Only clinical staff (psychologist/manager/supervisor) can assign assessments');
    }

    const version = await this.prisma.questionnaireVersion.findUnique({
      where: { id: input.versionId },
      include: { questionnaire: true },
    });
    if (!version || !version.published || !version.questionnaire) {
      throw new NotFoundException('Published questionnaire version not found');
    }
    // CAT instruments are administered interactively through the adaptive
    // flow — a static assignment of one would mis-serve its item bank.
    if (version.questionnaire.scoringMethod === 'CAT') {
      throw new BadRequestException(
        'Adaptive (CAT) instruments are administered interactively — direct the client to the adaptive assessment flow instead of assigning a static form',
      );
    }
    // Doc 07 §2 — a licensed instrument can't even be ASSIGNED without a grant.
    await assertActiveInstrumentLicense(this.prisma, principal.tenantId, version.questionnaire);

    const client = await this.prisma.client.findFirst({
      where: { id: input.clientId, tenantId: principal.tenantId, deletedAt: null },
      select: { id: true, userId: true },
    });
    if (!client) throw new NotFoundException('Client not found');
    await assertAuthorizedAssessmentTarget(this.prisma, principal, client);

    // One open assignment per instrument per client — a duplicate would just
    // split the same ask into two dashboard entries.
    const existing = await this.prisma.assessmentAssignment.findFirst({
      where: {
        tenantId: principal.tenantId,
        clientId: client.id,
        questionnaireVersionId: version.id,
        status: 'ASSIGNED',
        deletedAt: null,
      },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('This instrument is already assigned to the client and awaiting completion');
    }

    const assignment = await this.prisma.assessmentAssignment.create({
      data: {
        tenantId: principal.tenantId,
        clientId: client.id,
        questionnaireVersionId: version.id,
        assignedBy: principal.userId,
        note: input.note,
        dueAt: input.dueAt ? new Date(input.dueAt) : undefined,
      },
      include: ASSIGNMENT_INCLUDE,
    });

    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'assessment.assigned',
      entityType: 'AssessmentAssignment',
      entityId: assignment.id,
      after: {
        clientId: client.id,
        instrumentCode: version.questionnaire.code,
        versionId: version.id,
        dueAt: input.dueAt ?? null,
      },
    });
    await this.bus.publish(Events.AssessmentAssigned, principal.tenantId, {
      assignmentId: assignment.id,
      clientId: client.id,
      instrumentCode: version.questionnaire.code,
    });

    return this.toDto(assignment as AssignmentRow);
  }

  /** The signed-in CLIENT's own assignments (their dashboard list). */
  async listMine(principal: AuthPrincipal): Promise<AssessmentAssignmentDto[]> {
    const client = await this.prisma.client.findFirst({
      where: { tenantId: principal.tenantId, userId: principal.userId, deletedAt: null },
      select: { id: true },
    });
    if (!client) throw new NotFoundException('No client profile for this account');

    const rows = await this.prisma.assessmentAssignment.findMany({
      where: { tenantId: principal.tenantId, clientId: client.id, deletedAt: null, status: { not: 'CANCELLED' } },
      include: ASSIGNMENT_INCLUDE,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 100,
    });
    return rows.map((row) => this.toDto(row as AssignmentRow));
  }

  /** Clinician view of a client's assignments (unified caseload ABAC). */
  async listForClient(principal: AuthPrincipal, clientId: string): Promise<AssessmentAssignmentDto[]> {
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, tenantId: principal.tenantId, deletedAt: null },
      select: { id: true, userId: true },
    });
    if (!client) throw new NotFoundException('Client not found');
    await assertAuthorizedAssessmentTarget(this.prisma, principal, client);

    const rows = await this.prisma.assessmentAssignment.findMany({
      where: { tenantId: principal.tenantId, clientId, deletedAt: null },
      include: ASSIGNMENT_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((row) => this.toDto(row as AssignmentRow));
  }

  /**
   * CLIENT-SELF completion: validates + scores the answers through the exact
   * batch pipeline (deterministic bands, safety-item → RiskFlag/Escalation),
   * links the response, and CAS-flips ASSIGNED → COMPLETED so a double-submit
   * can never score twice. Returns the response WITHOUT the score — result
   * interpretation is clinician-only (doc 07 "score suppression").
   */
  async complete(
    principal: AuthPrincipal,
    assignmentId: string,
    input: CompleteAssignmentInput,
  ): Promise<{ assignment: AssessmentAssignmentDto; responseId: string }> {
    const assignment = await this.prisma.assessmentAssignment.findFirst({
      where: { id: assignmentId, tenantId: principal.tenantId, deletedAt: null },
      include: ASSIGNMENT_INCLUDE,
    });
    if (!assignment) throw new NotFoundException('Assignment not found');

    const client = await this.prisma.client.findFirst({
      where: { id: assignment.clientId, tenantId: principal.tenantId },
      select: { id: true, userId: true, riskLevel: true },
    });
    if (!client) throw new NotFoundException('Client not found');
    // Completion is the CLIENT's own act — staff use the administer path.
    if (client.userId !== principal.userId) {
      throw new ForbiddenException('Only the assigned client can complete this assessment');
    }
    if (assignment.status !== 'ASSIGNED') {
      throw new ConflictException(`Assignment is already ${assignment.status}`);
    }

    const version = await this.prisma.questionnaireVersion.findUnique({
      where: { id: assignment.questionnaireVersionId },
      include: {
        questionnaire: { select: { id: true, code: true, scoringMethod: true, licensing: true } },
        items: {
          where: { active: true },
          orderBy: { orderIndex: 'asc' },
          include: { parameters: { where: { active: true }, orderBy: { createdAt: 'desc' } } },
        },
      },
    });
    if (!version || !version.published || !version.questionnaire) {
      throw new NotFoundException('Published questionnaire version not found');
    }
    // License re-check at completion: a grant revoked after assignment must
    // fail closed here too, not silently score a licensed instrument.
    await assertActiveInstrumentLicense(this.prisma, principal.tenantId, version.questionnaire);

    validateStaticResponses(version.items ?? [], input.answers);
    const computation = this.psychometrics.buildScoreComputation(version, input.answers);

    const result = await this.prisma.$transaction(async (tx) => {
      // CAS FIRST: claim the assignment before any scoring writes so two
      // concurrent submits cannot both persist a scored response.
      const claimed = await tx.assessmentAssignment.updateMany({
        where: { id: assignment.id, tenantId: principal.tenantId, status: 'ASSIGNED' },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
      if (claimed.count !== 1) {
        throw new ConflictException('Assignment was already completed');
      }
      const persisted = await this.psychometrics.persistScoredResponse(
        tx,
        principal,
        client,
        {
          versionId: version.id,
          clientId: client.id,
          answers: input.answers,
          responseTimeMs: input.responseTimeMs,
        },
        computation,
        'STATIC',
      );
      await tx.assessmentAssignment.update({
        where: { id: assignment.id },
        data: { responseId: persisted.response.id },
      });
      return persisted;
    });

    // Identical post-commit trail to a batch administration.
    await this.psychometrics.publishScoredOutcome(principal, client.id, computation, result);
    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'assessment.assignment_completed',
      entityType: 'AssessmentAssignment',
      entityId: assignment.id,
      after: {
        responseId: result.response.id,
        instrumentCode: version.questionnaire.code,
        safetyFlagsRaised: result.raisedFlagIds.length,
      },
    });
    await this.bus.publish(Events.AssessmentAssignmentCompleted, principal.tenantId, {
      assignmentId: assignment.id,
      clientId: client.id,
      responseId: result.response.id,
    });

    // Governed AI briefing (doc 05 §3.7) — requested AT COMPLETION so it's
    // usually waiting in the PENDING ledger when the clinician opens the
    // result. Fire-and-forget: consent + kill-switch gated inside the
    // gateway, honest rule-based fallback, and a failure here must NEVER
    // affect the client's completion.
    const synthetic = (result.score.interpretation ?? '').includes('SYNTHETIC CALIBRATION');
    void this.ai
      .interpretScore({
        tenantId: principal.tenantId,
        clientId: client.id,
        scoreId: result.score.id,
        instrumentCode: version.questionnaire.code,
        severityBand: result.score.severityBand,
        theta: result.score.thetaEstimate ?? null,
        se: result.score.standardError ?? null,
        synthetic,
      })
      .catch((err) =>
        this.logger.warn(`AI briefing request failed for score ${result.score.id}: ${(err as Error).message}`),
      );

    const updated = await this.prisma.assessmentAssignment.findFirstOrThrow({
      where: { id: assignment.id },
      include: ASSIGNMENT_INCLUDE,
    });
    return { assignment: this.toDto(updated as AssignmentRow), responseId: result.response.id };
  }

  /** Clinician cancels an open assignment (never deletes a completed record). */
  async cancel(principal: AuthPrincipal, assignmentId: string): Promise<AssessmentAssignmentDto> {
    if (!principal.roles.some((r) => CLINICAL_ASSIGNER_ROLES.includes(r as Role))) {
      throw new ForbiddenException('Only clinical staff can cancel assessment assignments');
    }
    const assignment = await this.prisma.assessmentAssignment.findFirst({
      where: { id: assignmentId, tenantId: principal.tenantId, deletedAt: null },
      include: ASSIGNMENT_INCLUDE,
    });
    if (!assignment) throw new NotFoundException('Assignment not found');

    const client = await this.prisma.client.findFirst({
      where: { id: assignment.clientId, tenantId: principal.tenantId },
      select: { id: true, userId: true },
    });
    if (!client) throw new NotFoundException('Client not found');
    await assertAuthorizedAssessmentTarget(this.prisma, principal, client);

    const claimed = await this.prisma.assessmentAssignment.updateMany({
      where: { id: assignmentId, tenantId: principal.tenantId, status: 'ASSIGNED' },
      data: { status: 'CANCELLED', cancelledBy: principal.userId, cancelledAt: new Date() },
    });
    if (claimed.count !== 1) {
      throw new ConflictException(`Only ASSIGNED assignments can be cancelled (current status=${assignment.status})`);
    }

    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'assessment.assignment_cancelled',
      entityType: 'AssessmentAssignment',
      entityId: assignmentId,
      before: { status: 'ASSIGNED' },
      after: { status: 'CANCELLED' },
    });

    const updated = await this.prisma.assessmentAssignment.findFirstOrThrow({
      where: { id: assignmentId },
      include: ASSIGNMENT_INCLUDE,
    });
    return this.toDto(updated as AssignmentRow);
  }

  /**
   * Latest governed AI briefing for a score (clinician results view). Reads
   * the AIRecommendation ledger — never triggers a model call itself; the
   * on-demand regenerate path stays POST /assessments/scores/:id/ai-interpret.
   */
  async getScoreBriefing(
    principal: AuthPrincipal,
    scoreId: string,
  ): Promise<{ recommendationId: string; output: unknown; humanDecision: string; createdAt: string } | null> {
    const score = await this.prisma.psychometricScore.findFirst({
      where: { id: scoreId, tenantId: principal.tenantId },
      include: { response: { include: { client: { select: { id: true, userId: true } } } } },
    });
    if (!score) throw new NotFoundException('Score not found');
    await assertAuthorizedAssessmentTarget(this.prisma, principal, score.response.client);

    const recommendation = await this.prisma.aIRecommendation.findFirst({
      where: {
        tenantId: principal.tenantId,
        agent: 'PSYCHOMETRIC',
        linkedEntityType: 'PsychometricScore',
        linkedEntityId: scoreId,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!recommendation) return null;
    return {
      recommendationId: recommendation.id,
      output: recommendation.output,
      humanDecision: recommendation.humanDecision,
      createdAt: recommendation.createdAt.toISOString(),
    };
  }

  /** Clinician view of the completed response behind an assignment. */
  async getAssignmentResponse(principal: AuthPrincipal, assignmentId: string): Promise<QuestionnaireResponseDto> {
    const assignment = await this.prisma.assessmentAssignment.findFirst({
      where: { id: assignmentId, tenantId: principal.tenantId, deletedAt: null },
      select: { responseId: true },
    });
    if (!assignment?.responseId) throw new NotFoundException('Assignment has no completed response');
    return this.psychometrics.getResponse(principal, assignment.responseId);
  }

  private toDto(row: AssignmentRow): AssessmentAssignmentDto {
    return {
      id: row.id,
      clientId: row.clientId,
      versionId: row.questionnaireVersionId,
      instrumentCode: row.questionnaireVersion.questionnaire.code,
      instrumentName: row.questionnaireVersion.questionnaire.name,
      construct: row.questionnaireVersion.questionnaire.construct,
      itemCount: row.questionnaireVersion._count.items,
      note: row.note,
      status: row.status as AssessmentAssignmentDto['status'],
      assignedBy: row.assignedBy,
      dueAt: row.dueAt ? row.dueAt.toISOString() : null,
      responseId: row.responseId,
      completedAt: row.completedAt ? row.completedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
