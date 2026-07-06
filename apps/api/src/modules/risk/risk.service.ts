import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { IncidentReviewKind, SeverityBand, RiskStatus } from '@vpsy/contracts';
import type {
  AssignEscalationInput,
  AuthPrincipal,
  BreakGlassInput,
  BreakGlassResultDto,
  CompleteEscalationFollowUpInput,
  CreateIncidentReviewInput,
  CreateSafetyPlanInput,
  CrisisResourcesDto,
  EscalationDto,
  IncidentReviewDto,
  PendingIncidentReviewItem,
  PendingIncidentReviewsDto,
  ResolveEscalationInput,
  RiskBoardDto,
  RiskFlagDto,
  SafetyPlanDto,
} from '@vpsy/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { EventBus, Events } from '../../common/events/event-bus.service';
import { CRISIS_LINE_FALLBACK, resolveCrisisResource } from './crisis-lines';

/** 1 hour, matching the roadmap's break-glass time-box (06-security-and-rbac.md §2.2). */
const BREAK_GLASS_TTL_MS = 60 * 60 * 1000;

/** SEVERE→LOW ordering for the priority-lane board. */
const SEVERITY_RANK: Record<string, number> = {
  [SeverityBand.SEVERE]: 4,
  [SeverityBand.HIGH]: 3,
  [SeverityBand.MODERATE]: 2,
  [SeverityBand.LOW]: 1,
};

/** Resolution risk levels that require a Zero Suicide caring-contact follow-up. */
const FOLLOW_UP_REQUIRED_LEVELS = new Set<string>([SeverityBand.HIGH, SeverityBand.SEVERE]);

type RiskFlagRow = {
  id: string;
  clientId: string;
  type: string;
  severity: string;
  source: string;
  evidence: string | null;
  evidenceDetail?: unknown;
  status: string;
  createdAt: Date;
  client: { user: { fullName: string } };
};

type EscalationRow = {
  id: string;
  riskFlagId: string;
  openedAt: Date;
  assignedTo: string | null;
  resolvedAt: Date | null;
  resolution: string | null;
  slaBreached: boolean;
  slaDueAt?: Date | null;
  riskLevelAtResolution?: string | null;
  interventionsApplied?: string[];
  followUpDueAt?: Date | null;
  followUpCompletedAt?: Date | null;
  riskFlag: RiskFlagRow;
};

type SafetyPlanRow = {
  id: string;
  clientId: string;
  warningSigns: string[];
  copingStrategies: string[];
  supportContacts: unknown;
  professionalContacts: unknown;
  environmentSafety: string | null;
  distractionContacts?: unknown;
  helpContacts?: unknown;
  crisisLineInfo?: unknown;
  meansRestriction?: unknown;
  clientAcknowledgedAt?: Date | null;
  version: number;
  createdAt: Date;
};

/** Default crisis-line entry persisted when a safety plan doesn't specify one. */
const DEFAULT_CRISIS_LINE_INFO = { label: '988 Suicide & Crisis Lifeline', phone: '988' };

type IncidentReviewRow = {
  id: string;
  kind: string;
  subjectId: string;
  reviewerId: string;
  findings: string;
  actionItems: unknown;
  cosignedBy: string | null;
  reviewedAt: Date;
  createdAt: Date;
};

/**
 * Risk & Crisis (context 21, Phase 4). Owns the human escalation workflow,
 * the append-only safety plan, and the audited break-glass emergency-access
 * lever. `RiskFlag` + `Escalation` rows themselves are raised deterministically
 * by Intake & Screening — this service never creates a flag, only routes and
 * closes the human response to one.
 *
 * CORE PRINCIPLE: risk detection routes to a human; AI never resolves an
 * escalation. `resolveEscalation` hard-requires an authenticated human
 * principal (enforced twice: JwtAuthGuard/PermissionsGuard at the edge, and
 * defensively here so the invariant holds even if this service is ever
 * called from a non-HTTP entrypoint).
 */
@Injectable()
export class RiskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly bus: EventBus,
  ) {}

  async getBoard(principal: AuthPrincipal): Promise<RiskBoardDto> {
    const [escalations, flags] = await Promise.all([
      this.prisma.escalation.findMany({
        // Open escalations PLUS resolved ones still awaiting their caring-contact
        // follow-up (Zero Suicide: resolution isn't the end of the pathway — the
        // board's follow-ups lane must see them until the contact is recorded).
        where: {
          tenantId: principal.tenantId,
          OR: [
            { resolvedAt: null },
            { resolvedAt: { not: null }, followUpDueAt: { not: null }, followUpCompletedAt: null },
          ],
        },
        include: { riskFlag: { include: { client: { include: { user: true } } } } },
      }),
      this.prisma.riskFlag.findMany({
        where: { tenantId: principal.tenantId, status: { not: RiskStatus.RESOLVED } },
        include: { client: { include: { user: true } } },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const sorted = [...escalations].sort((a, b) => {
      const rankDiff = SEVERITY_RANK[b.riskFlag.severity]! - SEVERITY_RANK[a.riskFlag.severity]!;
      if (rankDiff !== 0) return rankDiff;
      return a.openedAt.getTime() - b.openedAt.getTime();
    });

    return {
      escalations: sorted.map((e) => this.toEscalationDto(e as EscalationRow)),
      openFlags: flags.map((f) => this.toFlagDto(f as RiskFlagRow)),
    };
  }

  async acknowledgeFlag(principal: AuthPrincipal, id: string): Promise<RiskFlagDto> {
    const flag = await this.prisma.riskFlag.findFirst({
      where: { id, tenantId: principal.tenantId },
      include: { client: { include: { user: true } } },
    });
    if (!flag) throw new NotFoundException('Risk flag not found');
    if (flag.status === RiskStatus.RESOLVED) {
      throw new ConflictException('Risk flag is already resolved');
    }
    if (flag.status === RiskStatus.ACKNOWLEDGED) {
      throw new ConflictException('Risk flag is already acknowledged');
    }

    const updated = await this.prisma.riskFlag.update({
      where: { id: flag.id },
      data: { status: RiskStatus.ACKNOWLEDGED },
      include: { client: { include: { user: true } } },
    });

    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'risk.flag.acknowledged',
      entityType: 'RiskFlag',
      entityId: updated.id,
      before: { status: flag.status },
      after: { status: updated.status },
    });

    return this.toFlagDto(updated as RiskFlagRow);
  }

  async assignEscalation(
    principal: AuthPrincipal,
    id: string,
    input: AssignEscalationInput,
  ): Promise<EscalationDto> {
    const escalation = await this.prisma.escalation.findFirst({
      where: { id, tenantId: principal.tenantId },
      include: { riskFlag: { include: { client: { include: { user: true } } } } },
    });
    if (!escalation) throw new NotFoundException('Escalation not found');
    if (escalation.resolvedAt) throw new ConflictException('Escalation is already resolved');

    const updated = await this.prisma.escalation.update({
      where: { id: escalation.id },
      data: { assignedTo: input.assignedTo },
      include: { riskFlag: { include: { client: { include: { user: true } } } } },
    });

    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'escalation.assigned',
      entityType: 'Escalation',
      entityId: updated.id,
      before: { assignedTo: escalation.assignedTo },
      after: { assignedTo: updated.assignedTo },
    });

    if (updated.assignedTo) {
      await this.bus.publish(Events.EscalationAssigned, principal.tenantId, {
        escalationId: updated.id,
        riskFlagId: updated.riskFlagId,
        clientId: updated.riskFlag.clientId,
        assignedTo: updated.assignedTo,
      });
    }

    return this.toEscalationDto(updated as EscalationRow);
  }

  /**
   * Resolves an escalation. NEVER automated — requires an authenticated
   * human principal with `escalation:handle`; the resolution narrative is
   * mandatory. Also marks the underlying RiskFlag RESOLVED so it drops off
   * the board's `openFlags`, closing the loop deterministically.
   *
   * SAFE-T/Joint Commission NPSG 15.01.01 (WAVE CR item 4): the contract
   * (`resolveEscalationSchema`) already enforces `followUpDueAt` whenever
   * `riskLevelAtResolution` is HIGH/SEVERE via `superRefine`; this service
   * re-asserts the same invariant defensively so it holds even if this
   * method is ever invoked from a non-HTTP entrypoint.
   */
  async resolveEscalation(
    principal: AuthPrincipal,
    id: string,
    input: ResolveEscalationInput,
  ): Promise<EscalationDto> {
    if (!principal?.userId) {
      throw new ForbiddenException('Escalation resolution requires an authenticated human principal');
    }
    if (FOLLOW_UP_REQUIRED_LEVELS.has(input.riskLevelAtResolution) && !input.followUpDueAt) {
      throw new BadRequestException(
        'followUpDueAt is required when riskLevelAtResolution is HIGH or SEVERE (Zero Suicide caring-contact follow-up)',
      );
    }

    const escalation = await this.prisma.escalation.findFirst({
      where: { id, tenantId: principal.tenantId },
      include: { riskFlag: { include: { client: { include: { user: true } } } } },
    });
    if (!escalation) throw new NotFoundException('Escalation not found');
    if (escalation.resolvedAt) throw new ConflictException('Escalation is already resolved');

    const resolvedAt = new Date();
    const followUpDueAt = input.followUpDueAt ? new Date(input.followUpDueAt) : null;
    const updated = await this.prisma.$transaction(async (tx) => {
      const esc = await tx.escalation.update({
        where: { id: escalation.id },
        data: {
          resolvedAt,
          resolution: input.resolution,
          riskLevelAtResolution: input.riskLevelAtResolution,
          interventionsApplied: input.interventionsApplied ?? [],
          followUpDueAt,
        },
        include: { riskFlag: { include: { client: { include: { user: true } } } } },
      });
      await tx.riskFlag.update({
        where: { id: escalation.riskFlagId },
        data: { status: RiskStatus.RESOLVED },
      });
      return esc;
    });

    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'escalation.resolved',
      entityType: 'Escalation',
      entityId: updated.id,
      before: { resolvedAt: null },
      after: {
        resolvedAt: resolvedAt.toISOString(),
        resolution: input.resolution,
        riskLevelAtResolution: input.riskLevelAtResolution,
        interventionsApplied: input.interventionsApplied ?? [],
        followUpDueAt: followUpDueAt ? followUpDueAt.toISOString() : null,
      },
      // Fail-closed (06-security-and-rbac.md §5): an escalation resolution
      // must never silently succeed without its audit trail.
      critical: true,
    });

    await this.bus.publish(Events.EscalationResolved, principal.tenantId, {
      escalationId: updated.id,
      riskFlagId: updated.riskFlagId,
      clientId: updated.riskFlag.clientId,
      resolvedBy: principal.userId,
    });

    return this.toEscalationDto(updated as EscalationRow);
  }

  /**
   * Records that the Zero Suicide caring-contact follow-up actually
   * happened. Requires a scheduled `followUpDueAt` (i.e. the escalation must
   * already be resolved with a follow-up requirement) and is idempotent —
   * recording it twice is a conflict, not a silent no-op, so double-entry
   * mistakes surface rather than hide.
   */
  async completeFollowUp(
    principal: AuthPrincipal,
    id: string,
    input: CompleteEscalationFollowUpInput,
  ): Promise<EscalationDto> {
    const escalation = await this.prisma.escalation.findFirst({
      where: { id, tenantId: principal.tenantId },
      include: { riskFlag: { include: { client: { include: { user: true } } } } },
    });
    if (!escalation) throw new NotFoundException('Escalation not found');
    if (!escalation.followUpDueAt) {
      throw new BadRequestException('This escalation has no follow-up contact scheduled');
    }
    if (escalation.followUpCompletedAt) {
      throw new ConflictException('Follow-up has already been recorded as completed');
    }

    const completedAt = new Date();
    const updated = await this.prisma.escalation.update({
      where: { id: escalation.id },
      data: { followUpCompletedAt: completedAt },
      include: { riskFlag: { include: { client: { include: { user: true } } } } },
    });

    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'escalation.followup_completed',
      entityType: 'Escalation',
      entityId: updated.id,
      after: { followUpCompletedAt: completedAt.toISOString(), notes: input.notes ?? null },
    });

    return this.toEscalationDto(updated as EscalationRow);
  }

  /**
   * Append-only: a new safety plan for a client supersedes the prior one
   * (higher `version`) but the prior row is never mutated or deleted —
   * matches the clinical record's tamper-evident, versioned-facts convention.
   */
  async createSafetyPlan(principal: AuthPrincipal, input: CreateSafetyPlanInput): Promise<SafetyPlanDto> {
    const client = await this.prisma.client.findFirst({
      where: { id: input.clientId, tenantId: principal.tenantId },
    });
    if (!client) throw new NotFoundException('Client not found');

    const latest = await this.prisma.safetyPlan.findFirst({
      where: { tenantId: principal.tenantId, clientId: input.clientId },
      orderBy: { version: 'desc' },
    });

    const plan = await this.prisma.safetyPlan.create({
      data: {
        tenantId: principal.tenantId,
        clientId: input.clientId,
        warningSigns: input.warningSigns,
        copingStrategies: input.copingStrategies,
        supportContacts: input.supportContacts ?? [],
        professionalContacts: input.professionalContacts ?? [],
        environmentSafety: input.environmentSafety,
        // Stanley-Brown SPI completeness (WAVE CR item 5) — additive fields.
        distractionContacts: input.distractionContacts ?? undefined,
        helpContacts: input.helpContacts ?? undefined,
        crisisLineInfo: input.crisisLineInfo ?? DEFAULT_CRISIS_LINE_INFO,
        meansRestriction: input.meansRestriction ?? undefined,
        clientAcknowledgedAt: input.clientAcknowledgedAt ? new Date(input.clientAcknowledgedAt) : undefined,
        version: (latest?.version ?? 0) + 1,
      },
    });

    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'safetyplan.created',
      entityType: 'SafetyPlan',
      entityId: plan.id,
      after: { clientId: plan.clientId, version: plan.version },
    });

    await this.bus.publish(Events.SafetyPlanCreated, principal.tenantId, {
      safetyPlanId: plan.id,
      clientId: plan.clientId,
      version: plan.version,
    });

    return this.toSafetyPlanDto(plan as SafetyPlanRow);
  }

  async getLatestSafetyPlan(principal: AuthPrincipal, clientId: string): Promise<SafetyPlanDto | null> {
    const plan = await this.prisma.safetyPlan.findFirst({
      where: { tenantId: principal.tenantId, clientId },
      orderBy: { version: 'desc' },
    });
    return plan ? this.toSafetyPlanDto(plan as SafetyPlanRow) : null;
  }

  /**
   * Client-facing read of their own latest safety plan (Stanley-Brown SPI
   * "client-visible copy" requirement, WAVE CR item 5) — own-client-only,
   * mirroring the `ClientsService.getMySummary` own-record lookup pattern.
   */
  async getMySafetyPlan(principal: AuthPrincipal): Promise<SafetyPlanDto | null> {
    const client = await this.prisma.client.findFirst({
      where: { userId: principal.userId, tenantId: principal.tenantId },
    });
    if (!client) throw new NotFoundException('Client profile not found for this user');
    return this.getLatestSafetyPlan(principal, client.id);
  }

  /**
   * Break-glass emergency access. Always reason-gated, time-boxed to 1h, and
   * paired with a HIGH-priority audit event + a `BreakGlassInvoked` domain
   * event — the seam a DPO-alerting subscriber hooks into (Phase 4 DoD:
   * "Break-glass access flow audited + alerts DPO").
   */
  async breakGlass(principal: AuthPrincipal, input: BreakGlassInput): Promise<BreakGlassResultDto> {
    const client = await this.prisma.client.findFirst({
      where: { id: input.clientId, tenantId: principal.tenantId },
    });
    if (!client) throw new NotFoundException('Client not found');
    if (!input.reason || input.reason.trim().length < 10) {
      throw new BadRequestException('A justification reason is required for break-glass access');
    }

    const grantedAt = new Date();
    const expiresAt = new Date(grantedAt.getTime() + BREAK_GLASS_TTL_MS);

    const grant = await this.prisma.breakGlassGrant.create({
      data: {
        tenantId: principal.tenantId,
        clientId: input.clientId,
        invokedBy: principal.userId,
        reason: input.reason,
        grantedAt,
        expiresAt,
      },
    });

    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'breakglass.invoked',
      entityType: 'BreakGlassGrant',
      entityId: grant.id,
      after: {
        severity: 'HIGH',
        clientId: grant.clientId,
        reason: grant.reason,
        expiresAt: expiresAt.toISOString(),
      },
      // Fail-closed (06-security-and-rbac.md §5): emergency PHI access must
      // never proceed silently without its audit + DPO-alert trail.
      critical: true,
    });

    await this.bus.publish(Events.BreakGlassInvoked, principal.tenantId, {
      grantId: grant.id,
      clientId: grant.clientId,
      invokedBy: grant.invokedBy,
      reason: grant.reason,
      expiresAt: expiresAt.toISOString(),
    });

    return {
      id: grant.id,
      clientId: grant.clientId,
      invokedBy: grant.invokedBy,
      reason: grant.reason,
      grantedAt: grant.grantedAt.toISOString(),
      expiresAt: grant.expiresAt.toISOString(),
    };
  }

  /**
   * Post-incident review (Joint Commission NPSG 15.01.01 / TJC sentinel-event
   * review practice — WAVE CR). Deliberately NOT a gate: `resolveEscalation`
   * and `breakGlass` already completed by the time a review is authored —
   * resolution must stay fast in a crisis, so this is the after-the-fact
   * supervisory record, not a blocking step. `listPendingIncidentReviews` is
   * the enforcement mechanism (a required review can never silently age out
   * because it's a hidden write nobody has to remember to check for).
   */
  async createIncidentReview(
    principal: AuthPrincipal,
    input: CreateIncidentReviewInput,
  ): Promise<IncidentReviewDto> {
    await this.assertReviewSubjectExists(principal, input.kind, input.subjectId);

    const review = await this.prisma.incidentReview.create({
      data: {
        tenantId: principal.tenantId,
        kind: input.kind,
        subjectId: input.subjectId,
        reviewerId: principal.userId,
        findings: input.findings,
        actionItems: input.actionItems ?? undefined,
        cosignedBy: input.cosignedBy,
      },
    });

    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'incidentreview.created',
      entityType: 'IncidentReview',
      entityId: review.id,
      after: {
        kind: review.kind,
        subjectId: review.subjectId,
        cosignedBy: review.cosignedBy ?? null,
      },
      // Part of the tamper-evident safety record (docs/10-10-PROGRAM.md WAVE
      // CR): a post-incident review must never silently succeed without its
      // own audit trail.
      critical: true,
    });

    return this.toIncidentReviewDto(review as IncidentReviewRow);
  }

  /** A review's subject is either an Escalation or a BreakGlassGrant — verify it exists in this tenant before writing. */
  private async assertReviewSubjectExists(
    principal: AuthPrincipal,
    kind: string,
    subjectId: string,
  ): Promise<void> {
    if (kind === IncidentReviewKind.BREAK_GLASS) {
      const grant = await this.prisma.breakGlassGrant.findFirst({
        where: { id: subjectId, tenantId: principal.tenantId },
      });
      if (!grant) throw new NotFoundException('Break-glass grant not found');
      return;
    }
    const escalation = await this.prisma.escalation.findFirst({
      where: { id: subjectId, tenantId: principal.tenantId },
    });
    if (!escalation) throw new NotFoundException('Escalation not found');
  }

  /**
   * The "never ages silently" list (TJC sentinel-event practice): every
   * SEVERE escalation resolution and every break-glass grant that has no
   * IncidentReview row yet, oldest/longest-waiting first. This — not a
   * write-path gate on resolution — is the enforcement mechanism.
   */
  async listPendingIncidentReviews(principal: AuthPrincipal): Promise<PendingIncidentReviewsDto> {
    const [severeResolved, reviewedEscalations, grants, reviewedGrants] = await Promise.all([
      this.prisma.escalation.findMany({
        where: {
          tenantId: principal.tenantId,
          resolvedAt: { not: null },
          riskFlag: { severity: SeverityBand.SEVERE },
        },
        include: { riskFlag: { include: { client: { include: { user: true } } } } },
      }),
      this.prisma.incidentReview.findMany({
        where: { tenantId: principal.tenantId, kind: IncidentReviewKind.ESCALATION_RESOLUTION },
        select: { subjectId: true },
      }),
      this.prisma.breakGlassGrant.findMany({
        where: { tenantId: principal.tenantId },
        include: { client: { include: { user: true } } },
      }),
      this.prisma.incidentReview.findMany({
        where: { tenantId: principal.tenantId, kind: IncidentReviewKind.BREAK_GLASS },
        select: { subjectId: true },
      }),
    ]);

    const reviewedEscalationIds = new Set(reviewedEscalations.map((r) => r.subjectId));
    const reviewedGrantIds = new Set(reviewedGrants.map((r) => r.subjectId));
    const now = Date.now();
    const ageHours = (since: Date) => Math.round(((now - since.getTime()) / 3_600_000) * 10) / 10;

    const items: PendingIncidentReviewItem[] = [];

    for (const esc of severeResolved as (EscalationRow & { resolvedAt: Date })[]) {
      if (reviewedEscalationIds.has(esc.id)) continue;
      items.push({
        kind: IncidentReviewKind.ESCALATION_RESOLUTION,
        subjectId: esc.id,
        clientId: esc.riskFlag.clientId,
        clientName: esc.riskFlag.client.user.fullName,
        occurredAt: esc.resolvedAt.toISOString(),
        ageHours: ageHours(esc.resolvedAt),
        summary: esc.resolution ?? '(no resolution narrative on file)',
      });
    }

    for (const grant of grants as {
      id: string;
      clientId: string;
      reason: string;
      grantedAt: Date;
      client: { user: { fullName: string } };
    }[]) {
      if (reviewedGrantIds.has(grant.id)) continue;
      items.push({
        kind: IncidentReviewKind.BREAK_GLASS,
        subjectId: grant.id,
        clientId: grant.clientId,
        clientName: grant.client.user.fullName,
        occurredAt: grant.grantedAt.toISOString(),
        ageHours: ageHours(grant.grantedAt),
        summary: grant.reason,
      });
    }

    items.sort((a, b) => b.ageHours - a.ageHours);
    return { items };
  }

  /** All reviews recorded against one subject (an Escalation or a BreakGlassGrant), newest first. */
  async getIncidentReviewsForSubject(principal: AuthPrincipal, subjectId: string): Promise<IncidentReviewDto[]> {
    const reviews = await this.prisma.incidentReview.findMany({
      where: { tenantId: principal.tenantId, subjectId, deletedAt: null },
      orderBy: { reviewedAt: 'desc' },
    });
    return reviews.map((r) => this.toIncidentReviewDto(r as IncidentReviewRow));
  }

  /**
   * Jurisdiction-aware emergency resources (APA telepsychology guidance —
   * WAVE CR: "988 is US-only"). Resolves the caller's tenant countryCode and
   * returns the matching crisis-line entry alongside the generic fallback —
   * never a wrong/dead number, never PHI.
   */
  async getCrisisResources(principal: AuthPrincipal): Promise<CrisisResourcesDto> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: principal.tenantId },
      select: { countryCode: true },
    });
    const { resolved, isFallback } = resolveCrisisResource(tenant?.countryCode ?? null);
    return {
      countryCode: tenant?.countryCode ?? null,
      isFallback,
      resolved,
      fallback: CRISIS_LINE_FALLBACK,
    };
  }

  private toIncidentReviewDto(review: IncidentReviewRow): IncidentReviewDto {
    return {
      id: review.id,
      kind: review.kind as IncidentReviewDto['kind'],
      subjectId: review.subjectId,
      reviewerId: review.reviewerId,
      findings: review.findings,
      actionItems: (review.actionItems as string[] | null) ?? null,
      cosignedBy: review.cosignedBy,
      reviewedAt: review.reviewedAt.toISOString(),
      createdAt: review.createdAt.toISOString(),
    };
  }

  private toFlagDto(flag: RiskFlagRow): RiskFlagDto {
    return {
      id: flag.id,
      clientId: flag.clientId,
      clientName: flag.client.user.fullName,
      type: flag.type as RiskFlagDto['type'],
      severity: flag.severity as RiskFlagDto['severity'],
      source: flag.source as RiskFlagDto['source'],
      evidence: flag.evidence,
      evidenceDetail: flag.evidenceDetail ?? null,
      status: flag.status as RiskFlagDto['status'],
      createdAt: flag.createdAt.toISOString(),
    };
  }

  private toEscalationDto(escalation: EscalationRow): EscalationDto {
    return {
      id: escalation.id,
      riskFlagId: escalation.riskFlagId,
      clientId: escalation.riskFlag.clientId,
      clientName: escalation.riskFlag.client.user.fullName,
      riskType: escalation.riskFlag.type as EscalationDto['riskType'],
      severity: escalation.riskFlag.severity as EscalationDto['severity'],
      openedAt: escalation.openedAt.toISOString(),
      assignedTo: escalation.assignedTo,
      resolvedAt: escalation.resolvedAt ? escalation.resolvedAt.toISOString() : null,
      resolution: escalation.resolution,
      slaBreached: escalation.slaBreached,
      slaDueAt: escalation.slaDueAt ? escalation.slaDueAt.toISOString() : null,
      riskLevelAtResolution: (escalation.riskLevelAtResolution as EscalationDto['riskLevelAtResolution']) ?? null,
      interventionsApplied: escalation.interventionsApplied ?? [],
      followUpDueAt: escalation.followUpDueAt ? escalation.followUpDueAt.toISOString() : null,
      followUpCompletedAt: escalation.followUpCompletedAt ? escalation.followUpCompletedAt.toISOString() : null,
    };
  }

  private toSafetyPlanDto(plan: SafetyPlanRow): SafetyPlanDto {
    return {
      id: plan.id,
      clientId: plan.clientId,
      warningSigns: plan.warningSigns,
      copingStrategies: plan.copingStrategies,
      supportContacts: (plan.supportContacts as string[] | null) ?? [],
      professionalContacts: (plan.professionalContacts as string[] | null) ?? [],
      environmentSafety: plan.environmentSafety,
      distractionContacts: (plan.distractionContacts as string[] | null) ?? null,
      helpContacts: (plan.helpContacts as string[] | null) ?? null,
      crisisLineInfo: (plan.crisisLineInfo as SafetyPlanDto['crisisLineInfo']) ?? null,
      meansRestriction: (plan.meansRestriction as SafetyPlanDto['meansRestriction']) ?? null,
      clientAcknowledgedAt: plan.clientAcknowledgedAt ? plan.clientAcknowledgedAt.toISOString() : null,
      version: plan.version,
      createdAt: plan.createdAt.toISOString(),
    };
  }
}
