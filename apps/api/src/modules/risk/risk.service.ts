import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { SeverityBand, RiskStatus } from '@vpsy/contracts';
import type {
  AssignEscalationInput,
  AuthPrincipal,
  BreakGlassInput,
  BreakGlassResultDto,
  CompleteEscalationFollowUpInput,
  CreateSafetyPlanInput,
  EscalationDto,
  ResolveEscalationInput,
  RiskBoardDto,
  RiskFlagDto,
  SafetyPlanDto,
} from '@vpsy/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { EventBus, Events } from '../../common/events/event-bus.service';

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
