import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  AuthPrincipal,
  CreateTreatmentPlanInput,
  GoalDto,
  TreatmentPlanAiAssistInput,
  TreatmentPlanAiAssistResult,
  TreatmentPlanDto,
  UpdateGoalProgressInput,
} from '@vpsy/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { EventBus, Events } from '../../common/events/event-bus.service';
import { AiGatewayService } from '../ai-gateway/ai-gateway.service';

type GoalRow = {
  id: string;
  planId: string;
  description: string;
  targetMetric: string | null;
  baseline: number | null;
  target: number | null;
  progressPct: number;
  status: string;
};

type PlanRow = {
  id: string;
  clientId: string;
  problemList: unknown;
  sessionFrequency: string;
  riskPlan: string | null;
  reviewDate: Date | null;
  status: string;
  version: number;
  createdAt: Date;
  goals: GoalRow[];
};

/**
 * Treatment Planning. A client has at most one ACTIVE plan; creating a new
 * one supersedes (never deletes) any prior active plan — clinical records
 * are append-only. Goal progress is tracked independently of the plan doc.
 */
@Injectable()
export class TreatmentPlanningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly bus: EventBus,
    private readonly ai: AiGatewayService,
  ) {}

  async create(principal: AuthPrincipal, input: CreateTreatmentPlanInput): Promise<TreatmentPlanDto> {
    const client = await this.prisma.client.findFirst({
      where: { id: input.clientId, tenantId: principal.tenantId },
    });
    if (!client) throw new NotFoundException('Client not found');

    const plan = await this.prisma.$transaction(async (tx) => {
      await tx.treatmentPlan.updateMany({
        where: { clientId: input.clientId, tenantId: principal.tenantId, status: 'active' },
        data: { status: 'superseded' },
      });

      return tx.treatmentPlan.create({
        data: {
          tenantId: principal.tenantId,
          clientId: input.clientId,
          problemList: input.problemList as any,
          sessionFrequency: input.sessionFrequency,
          measurementSchedule: input.measurementSchedule as any,
          riskPlan: input.riskPlan,
          reviewDate: input.reviewDate ? new Date(input.reviewDate) : undefined,
          status: 'active',
          goals: {
            create: input.goals.map((g) => ({
              tenantId: principal.tenantId,
              description: g.description,
              targetMetric: g.targetMetric,
              baseline: g.baseline,
              target: g.target,
            })),
          },
        },
        include: { goals: true },
      });
    });

    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'plan.activated',
      entityType: 'TreatmentPlan',
      entityId: plan.id,
      after: { clientId: input.clientId, goalCount: plan.goals.length },
    });
    await this.bus.publish(Events.PlanActivated, principal.tenantId, {
      planId: plan.id,
      clientId: input.clientId,
    });

    return this.toDto(plan as PlanRow);
  }

  async updateGoalProgress(principal: AuthPrincipal, input: UpdateGoalProgressInput): Promise<GoalDto> {
    const goal = await this.prisma.goal.findFirst({
      where: { id: input.goalId, tenantId: principal.tenantId },
    });
    if (!goal) throw new NotFoundException('Goal not found');

    const updated = await this.prisma.goal.update({
      where: { id: goal.id },
      data: { progressPct: input.progressPct, status: input.status ?? goal.status },
    });

    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'goal.progress.updated',
      entityType: 'Goal',
      entityId: updated.id,
      after: { progressPct: updated.progressPct, status: updated.status },
    });

    return this.toGoalDto(updated);
  }

  async getActivePlan(principal: AuthPrincipal, clientId: string): Promise<TreatmentPlanDto | null> {
    const plan = await this.prisma.treatmentPlan.findFirst({
      where: { tenantId: principal.tenantId, clientId, status: 'active' },
      include: { goals: true },
      orderBy: { createdAt: 'desc' },
    });
    return plan ? this.toDto(plan as PlanRow) : null;
  }

  /**
   * Treatment-Plan Support (doc 05 §3.3). Sends the AI Gateway ONLY the
   * coded, de-identified signals in `input` (severity band, specialty,
   * outcome-trend direction) — never history, hypotheses, or client
   * identifiers. Returns assistive suggestions; does not create or mutate
   * any TreatmentPlan/Goal row.
   */
  async aiAssist(principal: AuthPrincipal, input: TreatmentPlanAiAssistInput): Promise<TreatmentPlanAiAssistResult> {
    const client = await this.prisma.client.findFirst({
      where: { id: input.clientId, tenantId: principal.tenantId },
    });
    if (!client) throw new NotFoundException('Client not found');

    return this.ai.suggestTreatmentPlan({
      tenantId: principal.tenantId,
      clientId: input.clientId,
      severityBand: input.severityBand,
      specialty: input.specialty,
      outcomeTrend: input.outcomeTrend,
    });
  }

  private toGoalDto(g: GoalRow): GoalDto {
    return {
      id: g.id,
      planId: g.planId,
      description: g.description,
      targetMetric: g.targetMetric,
      baseline: g.baseline,
      target: g.target,
      progressPct: g.progressPct,
      status: g.status,
    };
  }

  private toDto(plan: PlanRow): TreatmentPlanDto {
    return {
      id: plan.id,
      clientId: plan.clientId,
      problemList: plan.problemList as string[],
      sessionFrequency: plan.sessionFrequency,
      riskPlan: plan.riskPlan,
      reviewDate: plan.reviewDate ? plan.reviewDate.toISOString() : null,
      status: plan.status,
      version: plan.version,
      goals: plan.goals.map((g) => this.toGoalDto(g)),
      createdAt: plan.createdAt.toISOString(),
    };
  }
}
