import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { SeverityBand, RiskStatus } from '@vpsy/contracts';
import type {
  AssignEscalationInput,
  AuthPrincipal,
  BreakGlassInput,
  BreakGlassResultDto,
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

type RiskFlagRow = {
  id: string;
  clientId: string;
  type: string;
  severity: string;
  source: string;
  evidence: string | null;
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
  version: number;
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
        where: { tenantId: principal.tenantId, resolvedAt: null },
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

    return this.toEscalationDto(updated as EscalationRow);
  }

  /**
   * Resolves an escalation. NEVER automated — requires an authenticated
   * human principal with `escalation:handle`; the resolution narrative is
   * mandatory. Also marks the underlying RiskFlag RESOLVED so it drops off
   * the board's `openFlags`, closing the loop deterministically.
   */
  async resolveEscalation(
    principal: AuthPrincipal,
    id: string,
    input: ResolveEscalationInput,
  ): Promise<EscalationDto> {
    if (!principal?.userId) {
      throw new ForbiddenException('Escalation resolution requires an authenticated human principal');
    }

    const escalation = await this.prisma.escalation.findFirst({
      where: { id, tenantId: principal.tenantId },
      include: { riskFlag: { include: { client: { include: { user: true } } } } },
    });
    if (!escalation) throw new NotFoundException('Escalation not found');
    if (escalation.resolvedAt) throw new ConflictException('Escalation is already resolved');

    const resolvedAt = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const esc = await tx.escalation.update({
        where: { id: escalation.id },
        data: { resolvedAt, resolution: input.resolution },
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
      after: { resolvedAt: resolvedAt.toISOString(), resolution: input.resolution },
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
      version: plan.version,
      createdAt: plan.createdAt.toISOString(),
    };
  }
}
