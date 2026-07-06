import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import {
  AssignmentStatus,
  type ApproveAssignmentInput,
  type AuthPrincipal,
  type MatchCandidate,
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
    const client = await this.prisma.client.findUnique({ where: { id: clientId } });
    if (!client) return;

    const psychologists = await this.prisma.psychologist.findMany({
      where: { tenantId, acceptingClients: true, deletedAt: null },
      include: { user: true, credentials: true },
    });

    const candidates: MatchCandidate[] = psychologists.map((psy) => {
      const specialtyMatch = psy.specialties.some((s) => s.toLowerCase() === suggestedSpecialty.toLowerCase());
      const langMatch = psy.languages.includes(client.preferredLanguage);
      const utilization = psy.caseloadCap > 0 ? psy.currentCaseload / psy.caseloadCap : 1;
      const jurisdiction = psy.credentials[0]?.jurisdiction ?? 'unknown';

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
        jurisdiction,
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

    const assignment = await this.prisma.assignment.create({
      data: {
        tenantId,
        clientId,
        status: AssignmentStatus.PROPOSED,
        proposedBy: 'AI',
        candidates: candidatesWithRationale as any,
        rank: 0,
      },
    });

    await this.bus.publish(Events.AssignmentProposed, tenantId, { assignmentId: assignment.id, clientId });
    this.logger.log(`Proposed assignment ${assignment.id} with ${ranked.length} candidates`);
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
      where: { id: input.assignmentId, tenantId: principal.tenantId },
    });
    if (!assignment) throw new NotFoundException('Assignment not found');

    const updated = await this.prisma.$transaction(async (tx) => {
      const a = await tx.assignment.update({
        where: { id: assignment.id },
        data: {
          psychologistId: input.psychologistId,
          approvedBy: principal.userId,
          managerNote: input.managerNote,
          status: AssignmentStatus.APPROVED,
        },
      });
      await tx.psychologist.update({
        where: { id: input.psychologistId },
        data: { currentCaseload: { increment: 1 } },
      });
      return a;
    });

    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'assignment.approved',
      entityType: 'Assignment',
      entityId: updated.id,
      after: { psychologistId: input.psychologistId, approvedBy: principal.userId },
    });
    await this.bus.publish(Events.AssignmentApproved, principal.tenantId, {
      assignmentId: updated.id,
      clientId: updated.clientId,
      psychologistId: input.psychologistId,
    });
    return updated;
  }
}
