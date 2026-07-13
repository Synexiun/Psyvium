import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AssignmentStatus, Role, type AuthPrincipal, type ClinicalSummary } from '@vpsy/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';
import { WearablesService } from '../wearables/wearables.service';

const EXCERPT_LENGTH = 140;
const WEARABLE_WINDOW_DAYS = 7;
const RECENT_NOTES_LIMIT = 5;
const OUTCOME_HISTORY_LIMIT = 20;

type ClientWithUser = {
  id: string;
  tenantId: string;
  userId: string;
  preferredLanguage: string;
  riskLevel: string;
  user: { fullName: string };
};

/**
 * Read-model assembly for the flagship client/clinician dashboards. Pulls a
 * single `ClinicalSummary` together from several bounded contexts (this
 * service does not own any of that data — it is a query-side aggregator).
 */
@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wearables: WearablesService,
  ) {}

  /** The authenticated CLIENT's own summary, resolved via Client.userId. */
  async getMySummary(principal: AuthPrincipal): Promise<ClinicalSummary> {
    const client = await this.prisma.client.findFirst({
      where: { userId: principal.userId, tenantId: principal.tenantId },
      include: { user: true },
    });
    if (!client) throw new NotFoundException('Client profile not found for this user');
    return this.buildSummary(principal, client);
  }

  /**
   * A clinician's or manager's view of a specific client. ABAC-gated: the
   * requester must either be MANAGER or the psychologist on an
   * APPROVED/ACTIVE assignment for this client.
   */
  async getClinicalSummary(principal: AuthPrincipal, clientId: string): Promise<ClinicalSummary> {
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, tenantId: principal.tenantId },
      include: { user: true },
    });
    if (!client) throw new NotFoundException('Client not found');

    await this.assertCanViewClient(principal, clientId);

    return this.buildSummary(principal, client);
  }

  private async assertCanViewClient(principal: AuthPrincipal, clientId: string): Promise<void> {
    if (principal.roles.includes(Role.MANAGER)) return;

    const psychologist = await this.prisma.psychologist.findFirst({
      where: { userId: principal.userId, tenantId: principal.tenantId },
    });
    const assignment = psychologist
      ? await this.prisma.assignment.findFirst({
          where: {
            clientId,
            tenantId: principal.tenantId,
            psychologistId: psychologist.id,
            status: { in: [AssignmentStatus.APPROVED, AssignmentStatus.ACTIVE] },
          },
        })
      : null;

    if (!assignment) {
      throw new ForbiddenException('Not an assigned psychologist for this client');
    }
  }

  private async buildSummary(principal: AuthPrincipal, client: ClientWithUser): Promise<ClinicalSummary> {
    const tenantId = principal.tenantId;
    const clientId = client.id;

    const [nextAppointment, activePlan, latestResponse, outcomeMeasures, recentNotes, hasWearable] =
      await Promise.all([
        this.prisma.appointment.findFirst({
          where: {
            clientId,
            tenantId,
            startsAt: { gte: new Date() },
            status: { in: ['BOOKED', 'CONFIRMED'] },
          },
          orderBy: { startsAt: 'asc' },
        }),
        this.prisma.treatmentPlan.findFirst({
          where: { clientId, tenantId, status: 'active' },
          include: { goals: true },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.questionnaireResponse.findFirst({
          where: { clientId, tenantId },
          include: { score: true },
          orderBy: { completedAt: 'desc' },
        }),
        this.prisma.outcomeMeasure.findMany({
          where: { clientId, tenantId },
          orderBy: { occurredAt: 'asc' },
        }),
        this.prisma.sessionNote.findMany({
          where: { tenantId, session: { appointment: { clientId } } },
          orderBy: { createdAt: 'desc' },
          take: RECENT_NOTES_LIMIT,
        }),
        this.wearables.hasConnectedDevice(tenantId, clientId),
      ]);

    return {
      client: {
        id: client.id,
        displayName: client.user.fullName,
        riskLevel: client.riskLevel as ClinicalSummary['client']['riskLevel'],
        preferredLanguage: client.preferredLanguage,
      },
      nextAppointment: nextAppointment
        ? { id: nextAppointment.id, startsAt: nextAppointment.startsAt.toISOString(), format: nextAppointment.format }
        : null,
      activePlan: activePlan
        ? {
            id: activePlan.id,
            status: activePlan.status,
            version: activePlan.version,
            clientAcknowledgedAt: activePlan.clientAcknowledgedAt
              ? activePlan.clientAcknowledgedAt.toISOString()
              : null,
            goals: activePlan.goals.map((g) => ({
              id: g.id,
              description: g.description,
              targetMetric: g.targetMetric,
              progressPct: g.progressPct,
              status: g.status,
            })),
          }
        : null,
      latestAssessment: latestResponse
        ? {
            id: latestResponse.score?.id ?? latestResponse.id,
            rawScore: latestResponse.score?.rawScore ?? null,
            severityBand: (latestResponse.score?.severityBand ?? null) as
              | ClinicalSummary['client']['riskLevel']
              | null,
            interpretation: latestResponse.score?.interpretation ?? null,
            completedAt: latestResponse.completedAt.toISOString(),
          }
        : null,
      outcomes: this.computeOutcomeTrends(outcomeMeasures).slice(-OUTCOME_HISTORY_LIMIT),
      recentNotes: recentNotes.map((n) => ({
        id: n.id,
        signedAt: n.signedAt ? n.signedAt.toISOString() : null,
        signedBy: n.signedBy,
        version: n.version,
        excerpt: this.noteExcerpt(n.content),
      })),
      wearable: hasWearable ? await this.wearables.getRollup(principal, clientId, WEARABLE_WINDOW_DAYS) : null,
    };
  }

  private computeOutcomeTrends(
    measures: { id: string; construct: string; value: number; occurredAt: Date }[],
  ): ClinicalSummary['outcomes'] {
    const lastSeen = new Map<string, { value: number }>();
    return measures.map((m) => {
      const previous = lastSeen.get(m.construct) ?? null;
      lastSeen.set(m.construct, { value: m.value });

      const delta = previous ? Number((m.value - previous.value).toFixed(4)) : null;
      const direction: ClinicalSummary['outcomes'][number]['trend']['direction'] = !previous
        ? 'baseline'
        : delta === 0
          ? 'unchanged'
          : (delta ?? 0) > 0
            ? 'increased'
            : 'decreased';

      return {
        construct: m.construct,
        value: m.value,
        occurredAt: m.occurredAt.toISOString(),
        trend: { direction, delta },
      };
    });
  }

  private noteExcerpt(content: unknown): string {
    if (!content || typeof content !== 'object') return '';
    const c = content as Record<string, unknown>;
    const text = [c.subjective, c.data, c.objective, c.assessment, c.plan]
      .filter((v): v is string => typeof v === 'string' && v.length > 0)
      .join(' ');
    return text.length > EXCERPT_LENGTH ? `${text.slice(0, EXCERPT_LENGTH)}…` : text;
  }
}
