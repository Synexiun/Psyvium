import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  AssignmentStatus,
  type ApproveAssignmentInput,
  type AuthPrincipal,
  type HoldAssignmentInput,
  type MatchCandidate,
  type RejectAssignmentInput,
} from '@vpsy/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { EventBus, Events } from '../../common/events/event-bus.service';
import { AiGatewayService } from '../ai-gateway/ai-gateway.service';

@Injectable()
export class MatchingService implements OnModuleInit {
  private readonly logger = new Logger(MatchingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiGatewayService,
    private readonly audit: AuditService,
    private readonly bus: EventBus,
  ) {}

  /** React to IntakeSubmitted by proposing an assignment for manager review. */
  onModuleInit() {
    this.bus.subscribe(Events.IntakeSubmitted, async (event) => {
      const p = event.payload as { clientId: string; suggestedSpecialty: string };
      await this.proposeForClient(event.tenantId, p.clientId, p.suggestedSpecialty).catch((err) =>
        this.logger.error(`propose failed: ${(err as Error).message}`),
      );
    });
  }

  /**
   * Deterministic candidate ranking; the AI layer only ever EXPLAINS the
   * top candidates (never reorders them) via `rankCandidates`; the manager
   * remains the final assignment authority.
   */
  async proposeForClient(tenantId: string, clientId: string, suggestedSpecialty: string) {
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, tenantId, status: 'active', deletedAt: null },
      include: {
        user: {
          select: { roleAssignments: { select: { jurisdiction: true } } },
        },
      },
    });
    if (!client) return;

    const jurisdictions = this.clientJurisdictions(client);
    if (jurisdictions.length === 0) {
      this.logger.warn(`No assignment proposed for client ${clientId}: client jurisdiction is not configured`);
    }

    const psychologists = await this.prisma.psychologist.findMany({
      where: { tenantId, acceptingClients: true, deletedAt: null },
      include: { user: true, credentials: true },
    });

    const now = new Date();
    const eligiblePsychologists = psychologists.flatMap((psychologist) => {
      const credential = this.eligibleCredential(psychologist, jurisdictions, now);
      return credential ? [{ psychologist, credential }] : [];
    });

    const candidates: MatchCandidate[] = eligiblePsychologists.map(({ psychologist: psy, credential }) => {
      const specialtyMatch = psy.specialties.some((s) => s.toLowerCase() === suggestedSpecialty.toLowerCase());
      const langMatch = psy.languages.includes(client.preferredLanguage);
      const utilization = psy.caseloadCap > 0 ? psy.currentCaseload / psy.caseloadCap : 1;

      // Weighted deterministic score (0..100)
      let score = 0;
      score += specialtyMatch ? 45 : 0;
      score += langMatch ? 20 : 0;
      score += (1 - Math.min(1, utilization)) * 20; // prefer capacity
      score += (psy.outcomeIndex / 100) * 15;
      score = Math.round(Math.min(100, score));

      const fitWarnings: string[] = [];
      if (!specialtyMatch) fitWarnings.push(`No exact specialty match for "${suggestedSpecialty}"`);
      if (!langMatch) fitWarnings.push(`Preferred language "${client.preferredLanguage}" not listed`);
      if (utilization >= 0.9) fitWarnings.push('Near caseload capacity');

      return {
        psychologistId: psy.id,
        displayName: psy.user.fullName,
        specialties: psy.specialties,
        languages: psy.languages,
        jurisdiction: credential.jurisdiction,
        caseloadUtilization: Number(utilization.toFixed(2)),
        outcomeIndex: psy.outcomeIndex,
        score,
        rationale:
          `Specialty ${specialtyMatch ? 'match' : 'partial'}, ` +
          `${langMatch ? 'language match' : 'language mismatch'}, ` +
          `${Math.round(utilization * 100)}% caseload, outcome index ${psy.outcomeIndex}.`,
        fitWarnings,
      };
    });

    // The RANKING itself is ALWAYS the deterministic sort computed inside
    // `rankCandidates` — the AI layer NEVER reorders it. When configured +
    // consented, it additionally returns a short assistive rationale note
    // per top-3 candidate, which is merged onto the persisted candidates
    // below purely for display; it never influences `rank`/order.
    const { ranked, aiRationales } = await this.ai.rankCandidates({ tenantId, clientId, candidates });
    const rationaleByPsychologist = new Map((aiRationales ?? []).map((r) => [r.psychologistId, r.rationale]));
    const candidatesWithRationale = ranked.map((c) =>
      rationaleByPsychologist.has(c.psychologistId)
        ? { ...c, aiRationale: rationaleByPsychologist.get(c.psychologistId) }
        : c,
    );

    let outcome: { assignment: any; created: boolean };
    try {
      outcome = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.assignment.findFirst({
          where: {
            tenantId,
            clientId,
            deletedAt: null,
            status: { in: [AssignmentStatus.PROPOSED, AssignmentStatus.APPROVED, AssignmentStatus.ACTIVE] },
          },
        });

        if (existing?.status === AssignmentStatus.PROPOSED) {
          const refreshed = await tx.assignment.update({
            where: { id: existing.id },
            data: { candidates: candidatesWithRationale as any, rank: 0 },
          });
          return { assignment: refreshed, created: false };
        }
        if (existing) return { assignment: existing, created: false };

        const created = await tx.assignment.create({
          data: {
            tenantId,
            clientId,
            status: AssignmentStatus.PROPOSED,
            proposedBy: 'AI',
            candidates: candidatesWithRationale as any,
            rank: 0,
          },
        });
        return { assignment: created, created: true };
      });
    } catch (error) {
      // The partial unique index is the final arbiter when two intake events
      // race. Return the winner rather than surfacing a duplicate proposal.
      if (!this.isUniqueConstraintError(error)) throw error;
      const winner = await this.prisma.assignment.findFirst({
        where: {
          tenantId,
          clientId,
          deletedAt: null,
          status: { in: [AssignmentStatus.PROPOSED, AssignmentStatus.APPROVED, AssignmentStatus.ACTIVE] },
        },
      });
      if (!winner) throw error;
      outcome = { assignment: winner, created: false };
    }

    const { assignment } = outcome;
    if (outcome.created) {
      await this.bus.publish(Events.AssignmentProposed, tenantId, { assignmentId: assignment.id, clientId });
      this.logger.log(`Proposed assignment ${assignment.id} with ${ranked.length} candidates`);
    }
    return assignment;
  }

  /** Manager triage board — proposed assignments awaiting a decision. */
  async listProposals(principal: AuthPrincipal) {
    return this.prisma.assignment.findMany({
      where: { tenantId: principal.tenantId, status: AssignmentStatus.PROPOSED },
      include: { client: { include: { user: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** MANAGER is the final assignment authority (ADR + product principle). */
  async approve(principal: AuthPrincipal, input: ApproveAssignmentInput) {
    const assignment = await this.prisma.assignment.findFirst({
      where: { id: input.assignmentId, tenantId: principal.tenantId, deletedAt: null },
      include: {
        client: {
          include: {
            user: {
              include: { roleAssignments: { select: { jurisdiction: true } } },
            },
          },
        },
      },
    });
    if (!assignment) throw new NotFoundException('Assignment not found');
    if (assignment.status !== AssignmentStatus.PROPOSED) {
      throw new ConflictException(`Assignment is already ${assignment.status}`);
    }

    // Re-check credential eligibility at approve time — manager authority is
    // final, but never allows unlicensed / wrong-jurisdiction assignment.
    const jurisdictions = this.clientJurisdictions(assignment.client);
    const psychologist = await this.prisma.psychologist.findFirst({
      where: { id: input.psychologistId, tenantId: principal.tenantId, deletedAt: null },
      include: {
        user: { select: { status: true, deletedAt: true } },
        credentials: true,
      },
    });
    if (!psychologist) throw new NotFoundException('Psychologist not found');
    const credential = this.eligibleCredential(psychologist, jurisdictions, new Date());
    if (!credential) {
      throw new UnprocessableEntityException(
        'Psychologist is not credential-eligible for this client (jurisdiction, verification, malpractice, capacity, or status)',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // Compare-and-swap: only one concurrent approval can move PROPOSED → APPROVED.
      // A second racer sees count=0 and aborts without double-incrementing caseload.
      const claimed = await tx.assignment.updateMany({
        where: {
          id: assignment.id,
          tenantId: principal.tenantId,
          status: AssignmentStatus.PROPOSED,
          deletedAt: null,
        },
        data: {
          psychologistId: input.psychologistId,
          approvedBy: principal.userId,
          managerNote: input.managerNote,
          status: AssignmentStatus.APPROVED,
        },
      });
      if (claimed.count !== 1) {
        throw new ConflictException('Assignment was already decided by another manager action');
      }

      // Capacity gate under the same transaction so two approvals cannot overfill.
      const capacity = await tx.psychologist.updateMany({
        where: {
          id: input.psychologistId,
          tenantId: principal.tenantId,
          deletedAt: null,
          acceptingClients: true,
          // Prisma cannot express currentCaseload < caseloadCap directly; re-check
          // with a raw filter after the row lock via findFirst under Serializable-ish
          // updateMany by id, then reject if over capacity.
        },
        data: { currentCaseload: { increment: 1 } },
      });
      if (capacity.count !== 1) {
        throw new UnprocessableEntityException('Psychologist is not accepting clients');
      }
      const psy = await tx.psychologist.findFirst({
        where: { id: input.psychologistId, tenantId: principal.tenantId },
        select: { currentCaseload: true, caseloadCap: true },
      });
      if (!psy || psy.caseloadCap <= 0 || psy.currentCaseload > psy.caseloadCap) {
        throw new UnprocessableEntityException('Psychologist caseload is full');
      }

      return tx.assignment.findFirstOrThrow({ where: { id: assignment.id } });
    });

    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'assignment.approved',
      entityType: 'Assignment',
      entityId: updated.id,
      after: { psychologistId: input.psychologistId, approvedBy: principal.userId },
      critical: true,
    });
    await this.bus.publish(Events.AssignmentApproved, principal.tenantId, {
      assignmentId: updated.id,
      clientId: updated.clientId,
      psychologistId: input.psychologistId,
    });
    return updated;
  }

  /**
   * Manager rejects a proposal — client returns to unassigned waitlist.
   * No REJECTED enum: CLOSED is the terminal status. Does not free caseload
   * (never assigned). Critical audit + domain event for downstream waitlist.
   */
  async reject(principal: AuthPrincipal, input: RejectAssignmentInput) {
    const assignment = await this.prisma.assignment.findFirst({
      where: { id: input.assignmentId, tenantId: principal.tenantId, deletedAt: null },
    });
    if (!assignment) throw new NotFoundException('Assignment not found');
    if (assignment.status !== AssignmentStatus.PROPOSED) {
      throw new ConflictException(`Only PROPOSED assignments can be rejected (status=${assignment.status})`);
    }

    const claimed = await this.prisma.assignment.updateMany({
      where: {
        id: assignment.id,
        tenantId: principal.tenantId,
        status: AssignmentStatus.PROPOSED,
        deletedAt: null,
      },
      data: {
        status: AssignmentStatus.CLOSED,
        managerNote: `REJECTED: ${input.reason}`,
        approvedBy: principal.userId,
      },
    });
    if (claimed.count !== 1) {
      throw new ConflictException('Assignment was already decided by another manager action');
    }

    const updated = await this.prisma.assignment.findFirstOrThrow({ where: { id: assignment.id } });
    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'assignment.rejected',
      entityType: 'Assignment',
      entityId: updated.id,
      before: { status: AssignmentStatus.PROPOSED },
      after: {
        status: AssignmentStatus.CLOSED,
        reason: input.reason,
        rejectedBy: principal.userId,
        transition: `${AssignmentStatus.PROPOSED}→${AssignmentStatus.CLOSED}`,
      },
      critical: true,
    });
    await this.bus.publish(Events.AssignmentRejected, principal.tenantId, {
      assignmentId: updated.id,
      clientId: updated.clientId,
      reason: input.reason,
    });
    return updated;
  }

  /**
   * Manager parks a proposal for later. No HOLD enum — status stays PROPOSED;
   * managerNote + audit `status: 'on_hold'` surface the hold to triage UIs.
   */
  async hold(principal: AuthPrincipal, input: HoldAssignmentInput) {
    const assignment = await this.prisma.assignment.findFirst({
      where: { id: input.assignmentId, tenantId: principal.tenantId, deletedAt: null },
    });
    if (!assignment) throw new NotFoundException('Assignment not found');
    if (assignment.status !== AssignmentStatus.PROPOSED) {
      throw new ConflictException(`Only PROPOSED assignments can be held (status=${assignment.status})`);
    }

    const claimed = await this.prisma.assignment.updateMany({
      where: {
        id: assignment.id,
        tenantId: principal.tenantId,
        status: AssignmentStatus.PROPOSED,
        deletedAt: null,
      },
      data: {
        managerNote: `[ON_HOLD] ${input.reason}`,
        approvedBy: principal.userId,
      },
    });
    if (claimed.count !== 1) {
      throw new ConflictException('Assignment was already decided by another manager action');
    }

    const updated = await this.prisma.assignment.findFirstOrThrow({ where: { id: assignment.id } });

    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'assignment.held',
      entityType: 'Assignment',
      entityId: updated.id,
      before: { status: AssignmentStatus.PROPOSED },
      after: { status: 'on_hold', reason: input.reason, heldBy: principal.userId },
      critical: true,
    });
    await this.bus.publish(Events.AssignmentHeld, principal.tenantId, {
      assignmentId: updated.id,
      clientId: updated.clientId,
      reason: input.reason,
    });
    return { ...updated, holdStatus: 'on_hold' as const };
  }

  private isUniqueConstraintError(error: unknown): boolean {
    // Prisma P2002 — unique constraint failed (partial unique open-assignment index).
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    );
  }

  private clientJurisdictions(client: {
    user?: { roleAssignments?: Array<{ jurisdiction: string | null }> } | null;
  }): string[] {
    return [
      ...new Set(
        (client.user?.roleAssignments ?? [])
          .map((assignment) => assignment.jurisdiction?.trim())
          .filter((jurisdiction): jurisdiction is string => Boolean(jurisdiction)),
      ),
    ];
  }

  private eligibleCredential<
    T extends {
      acceptingClients: boolean;
      currentCaseload: number;
      caseloadCap: number;
      deletedAt: Date | null;
      user?: { status?: string; deletedAt?: Date | null } | null;
      credentials: Array<{
        jurisdiction: string;
        verificationStatus: string;
        malpracticeStatus: string;
        expiresAt: Date | null;
      }>;
    },
  >(psychologist: T, jurisdictions: string[], now: Date): T['credentials'][number] | null {
    if (
      psychologist.deletedAt !== null ||
      !psychologist.acceptingClients ||
      psychologist.caseloadCap <= 0 ||
      psychologist.currentCaseload >= psychologist.caseloadCap ||
      psychologist.user?.status !== 'ACTIVE' ||
      psychologist.user?.deletedAt != null ||
      jurisdictions.length === 0
    ) {
      return null;
    }

    return (
      psychologist.credentials.find(
        (credential) =>
          jurisdictions.includes(credential.jurisdiction) &&
          credential.verificationStatus === 'verified' &&
          credential.malpracticeStatus === 'active' &&
          (credential.expiresAt === null || credential.expiresAt > now),
      ) ?? null
    );
  }
}
