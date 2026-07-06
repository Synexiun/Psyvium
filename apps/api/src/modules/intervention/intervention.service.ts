import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@vpsy/contracts';
import type {
  AssignHomeworkInput,
  AuthPrincipal,
  CompleteHomeworkInput,
  CreateInterventionInput,
  HomeworkDto,
  InterventionDto,
} from '@vpsy/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { EventBus } from '../../common/events/event-bus.service';

/**
 * Canonical event names for context 15 (Intervention Tracking), per
 * docs/technical/01-bounded-contexts.md. Published as literal strings rather
 * than added to the shared `Events` const in `common/events/event-bus.service.ts`,
 * which is out of scope for this change — `EventBus.publish` accepts any
 * string name, so this does not require touching common/*.
 */
const INTERVENTION_DELIVERED = 'intervention.delivered';

type HomeworkRow = {
  id: string;
  interventionId: string;
  description: string;
  dueDate: Date | null;
  completionPct: number;
  clientReport: string | null;
  createdAt: Date;
};

type InterventionRow = {
  id: string;
  planId: string | null;
  goalId: string | null;
  sessionId: string | null;
  clinicalTarget: string;
  type: string;
  modality: string;
  durationMin: number | null;
  rationale: string | null;
  clientResponse: string | null;
  followUpDate: Date | null;
  effectivenessRating: number | null;
  adverseEffects: string | null;
  clinicianApproved: boolean;
  createdAt: Date;
  homework?: HomeworkRow[];
};

/**
 * Intervention Tracking (context 15). An Intervention is always anchored to
 * a client's ACTIVE TreatmentPlan (docs/technical/01-bounded-contexts.md ctx
 * 14/15) — the caller supplies `clientId` (+ optional `goalId`); this service
 * resolves the active plan server-side and never trusts a client-supplied
 * planId. Homework is reached only via its parent Intervention (the Prisma
 * model has no direct clientId column).
 */
@Injectable()
export class InterventionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly bus: EventBus,
  ) {}

  async create(principal: AuthPrincipal, input: CreateInterventionInput): Promise<InterventionDto> {
    const client = await this.prisma.client.findFirst({
      where: { id: input.clientId, tenantId: principal.tenantId },
    });
    if (!client) throw new NotFoundException('Client not found');

    const plan = await this.prisma.treatmentPlan.findFirst({
      where: { clientId: input.clientId, tenantId: principal.tenantId, status: 'active' },
      orderBy: { createdAt: 'desc' },
    });
    if (!plan) throw new NotFoundException('Client has no active treatment plan to attach this intervention to');

    if (input.goalId) {
      const goal = await this.prisma.goal.findFirst({
        where: { id: input.goalId, tenantId: principal.tenantId, planId: plan.id },
      });
      if (!goal) throw new NotFoundException('Goal not found on the client’s active plan');
    }

    if (input.sessionId) {
      const session = await this.prisma.session.findFirst({
        where: { id: input.sessionId, tenantId: principal.tenantId },
      });
      if (!session) throw new NotFoundException('Session not found');
    }

    const intervention = await this.prisma.intervention.create({
      data: {
        tenantId: principal.tenantId,
        planId: plan.id,
        goalId: input.goalId,
        sessionId: input.sessionId,
        clinicalTarget: input.clinicalTarget,
        type: input.type,
        modality: input.modality,
        durationMin: input.durationMin,
        rationale: input.rationale,
      },
    });

    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'intervention.delivered',
      entityType: 'Intervention',
      entityId: intervention.id,
      after: { clientId: input.clientId, planId: plan.id, type: intervention.type },
    });
    await this.bus.publish(INTERVENTION_DELIVERED, principal.tenantId, {
      interventionId: intervention.id,
      clientId: input.clientId,
      planId: plan.id,
    });

    return this.toDto(intervention as InterventionRow, input.clientId);
  }

  async assignHomework(principal: AuthPrincipal, input: AssignHomeworkInput): Promise<HomeworkDto> {
    const intervention = await this.prisma.intervention.findFirst({
      where: { id: input.interventionId, tenantId: principal.tenantId },
    });
    if (!intervention) throw new NotFoundException('Intervention not found');

    const homework = await this.prisma.homework.create({
      data: {
        tenantId: principal.tenantId,
        interventionId: input.interventionId,
        description: input.description,
        dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
      },
    });

    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'homework.assigned',
      entityType: 'Homework',
      entityId: homework.id,
      after: { interventionId: input.interventionId, dueDate: homework.dueDate },
    });

    return this.toHomeworkDto(homework);
  }

  /**
   * A client's interventions (+ their homework), across every TreatmentPlan
   * the client has ever had. A CLIENT principal may only list their own;
   * PSYCHOLOGIST/MANAGER may list any client in tenant (matches the ABAC
   * pattern in scheduling.service.ts / clients.service.ts).
   */
  async listForClient(principal: AuthPrincipal, clientId: string): Promise<InterventionDto[]> {
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, tenantId: principal.tenantId },
    });
    if (!client) throw new NotFoundException('Client not found');
    this.assertSelfOrClinician(principal, client.userId);

    const interventions = await this.prisma.intervention.findMany({
      where: { tenantId: principal.tenantId, plan: { clientId } },
      include: { homework: true },
      orderBy: { createdAt: 'desc' },
    });

    return interventions.map((i: InterventionRow) => this.toDto(i, clientId));
  }

  /**
   * Marks homework complete (or partially, via a resumed report). No
   * dedicated "homework:complete" permission exists in the Wave C scope
   * (rbac.ts is out of scope) — the controller gates this with
   * `Permission.CLIENT_READ` (held by CLIENT, PSYCHOLOGIST, and MANAGER
   * alike) and this service enforces that a CLIENT principal may only
   * complete their OWN homework; a clinician may record it on a client's
   * behalf (e.g. during a session).
   */
  async completeHomework(
    principal: AuthPrincipal,
    homeworkId: string,
    input: CompleteHomeworkInput,
  ): Promise<HomeworkDto> {
    const homework = await this.prisma.homework.findFirst({
      where: { id: homeworkId, tenantId: principal.tenantId },
      include: { intervention: { include: { plan: { include: { client: true } } } } },
    });
    if (!homework) throw new NotFoundException('Homework not found');

    const ownerUserId = homework.intervention.plan?.client.userId;
    if (principal.roles.includes(Role.CLIENT) && ownerUserId !== principal.userId) {
      throw new ForbiddenException('A client may only complete their own homework');
    }

    const updated = await this.prisma.homework.update({
      where: { id: homeworkId },
      data: { completionPct: input.completionPct, clientReport: input.clientReport },
    });

    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'homework.completed',
      entityType: 'Homework',
      entityId: updated.id,
      after: { completionPct: updated.completionPct },
    });

    return this.toHomeworkDto(updated);
  }

  private assertSelfOrClinician(principal: AuthPrincipal, clientUserId: string): void {
    if (principal.roles.includes(Role.CLIENT) && clientUserId !== principal.userId) {
      throw new ForbiddenException('A client may only view their own interventions and homework');
    }
  }

  private toHomeworkDto(h: HomeworkRow): HomeworkDto {
    return {
      id: h.id,
      interventionId: h.interventionId,
      description: h.description,
      dueDate: h.dueDate ? h.dueDate.toISOString() : null,
      completionPct: h.completionPct,
      clientReport: h.clientReport,
      createdAt: h.createdAt.toISOString(),
    };
  }

  private toDto(i: InterventionRow, clientId: string): InterventionDto {
    return {
      id: i.id,
      clientId,
      planId: i.planId,
      goalId: i.goalId,
      sessionId: i.sessionId,
      clinicalTarget: i.clinicalTarget,
      type: i.type,
      modality: i.modality,
      durationMin: i.durationMin,
      rationale: i.rationale,
      clientResponse: i.clientResponse,
      followUpDate: i.followUpDate ? i.followUpDate.toISOString() : null,
      effectivenessRating: i.effectivenessRating,
      adverseEffects: i.adverseEffects,
      clinicianApproved: i.clinicianApproved,
      createdAt: i.createdAt.toISOString(),
      homework: i.homework ? i.homework.map((h) => this.toHomeworkDto(h)) : undefined,
    };
  }
}
