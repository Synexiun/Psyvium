import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthPrincipal, ClinicalSummary } from '@vpsy/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ClinicalAccessService } from '../../common/auth/clinical-access.service';
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
    private readonly clinicalAccess: ClinicalAccessService,
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
   * A clinician's or manager's view of a specific client. ABAC-gated via the
   * central ClinicalAccessService (assignment, break-glass, supervisor, manager).
   */
  async getClinicalSummary(principal: AuthPrincipal, clientId: string): Promise<ClinicalSummary> {
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, tenantId: principal.tenantId },
      include: { user: true },
    });
    if (!client) throw new NotFoundException('Client not found');

    await this.clinicalAccess.assertCanAccessClient(principal, clientId);

    return this.buildSummary(principal, client);
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

    const mbcHints = this.buildMbcHints(
      activePlan?.reviewDate ?? null,
      latestResponse?.completedAt ?? null,
    );

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
      ...((mbcHints?.length ?? 0) > 0 ? { mbcHints } : {}),
    };
  }

  /**
   * Lightweight MBC overdue hints (optional fields on ClinicalSummary).
   * - plan reviewDate in the past → plan_review_overdue
   * - latest assessment older than 14 days → assessment_stale
   * Advisory only — never blocks care.
   */
  private buildMbcHints(
    reviewDate: Date | null | undefined,
    lastAssessmentAt: Date | null | undefined,
  ): ClinicalSummary['mbcHints'] {
    const hints: NonNullable<ClinicalSummary['mbcHints']> = [];
    const now = Date.now();
    if (reviewDate && reviewDate.getTime() < now) {
      hints.push({
        kind: 'plan_review_overdue',
        message: 'Active treatment plan review date has passed — schedule a collaborative plan review.',
        since: reviewDate.toISOString(),
      });
    }
    const STALE_MS = 14 * 24 * 60 * 60 * 1000;
    if (lastAssessmentAt && now - lastAssessmentAt.getTime() > STALE_MS) {
      hints.push({
        kind: 'assessment_stale',
        message: 'Latest MBC assessment is more than 14 days old — consider re-administering the primary measure.',
        since: lastAssessmentAt.toISOString(),
      });
    }
    return hints;
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
