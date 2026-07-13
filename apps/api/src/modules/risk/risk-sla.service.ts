import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ESCALATION_AUTO_ASSIGN_AFTER_MINUTES, SeverityBand } from '@vpsy/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { EventBus, Events } from '../../common/events/event-bus.service';
import { TenantContext } from '../../common/prisma/tenant-context';

/** How often the sweep runs. */
const SWEEP_INTERVAL_MS = 60_000;

/** System actor id recorded on audit events the sweep itself generates. */
const SYSTEM_ACTOR_ID = 'system.risk-sla';

type SweepEscalationRow = {
  id: string;
  riskFlagId: string;
  openedAt: Date;
  slaDueAt: Date | null;
  riskFlag: { severity: string; clientId: string };
};

/**
 * Real SLA + on-call fallback (docs/10-10-PROGRAM.md WAVE CR item 3 —
 * "`Escalation.slaBreached` made real... on-call auto-routing of unassigned
 * SEVERE escalations (risk-register already *claims* this exists)").
 *
 * Deterministic, never AI-consulted, and tenant-scoped: because `RiskFlag`,
 * `Escalation` and `Psychologist` all sit under the STRICT RLS tenant policy
 * (see migration 20260706120000_rls_tenant_isolation_backstop — no
 * unset-tenant exception, zero rows without the GUC), a naive whole-table
 * sweep would silently see nothing. So this sweep first lists tenants from
 * the RLS-EXEMPT `Tenant` table, then re-enters `TenantContext.run` per
 * tenant so the `withTenantRls()` Prisma extension sets the correct
 * `app.current_tenant` GUC for every query issued inside that iteration —
 * exactly like a real per-request context, just synthesized here instead of
 * coming from a JWT.
 */
@Injectable()
export class RiskSlaService {
  private readonly logger = new Logger(RiskSlaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly bus: EventBus,
  ) {}

  @Interval(SWEEP_INTERVAL_MS)
  async sweep(): Promise<void> {
    const tenants = await this.prisma.tenant.findMany({ select: { id: true } });
    for (const tenant of tenants) {
      try {
        await TenantContext.run({ tenantId: tenant.id }, async () => {
          await this.breachOverdue(tenant.id);
          await this.autoAssignUnassignedSevere(tenant.id);
        });
      } catch (err) {
        // One tenant's failure must never block the others (or crash the
        // scheduler, which would silently stop all future sweeps).
        this.logger.error(`Risk SLA sweep failed for tenant ${tenant.id}: ${(err as Error).message}`);
      }
    }
  }

  /** Marks unresolved escalations past their `slaDueAt` as breached (audited + published). */
  private async breachOverdue(tenantId: string): Promise<void> {
    const now = new Date();
    const overdue = (await this.prisma.escalation.findMany({
      where: {
        tenantId,
        resolvedAt: null,
        slaBreached: false,
        slaDueAt: { not: null, lt: now },
      },
      include: { riskFlag: { select: { severity: true, clientId: true } } },
    })) as SweepEscalationRow[];

    for (const esc of overdue) {
      await this.prisma.escalation.update({ where: { id: esc.id }, data: { slaBreached: true } });

      await this.audit.record({
        tenantId,
        actorId: SYSTEM_ACTOR_ID,
        action: 'escalation.sla_breached',
        entityType: 'Escalation',
        entityId: esc.id,
        after: { severity: 'HIGH', slaDueAt: esc.slaDueAt?.toISOString() ?? null, riskSeverity: esc.riskFlag.severity },
        // Fail-closed: an SLA breach on a crisis escalation must never
        // silently succeed without its audit trail.
        critical: true,
      });

      // Raw event name (not `Events.EscalationSlaBreached`): this wave owns
      // only the Risk & Crisis / Intake / Psychometrics modules, not the
      // shared event-bus registry, so a brand-new event name is published as
      // a literal string using the same `noun.verb` convention as the
      // existing `Events` entries rather than adding a key to that file.
      await this.bus.publish('escalation.sla_breached', tenantId, {
        escalationId: esc.id,
        riskFlagId: esc.riskFlagId,
        clientId: esc.riskFlag.clientId,
        severity: esc.riskFlag.severity,
      });
    }
  }

  /**
   * On-call fallback: an unassigned SEVERE escalation older than
   * `ESCALATION_AUTO_ASSIGN_AFTER_MINUTES` auto-routes to the tenant's
   * least-loaded accepting-clients psychologist — a manager can always
   * reassign afterward, but a SEVERE case must never simply sit unowned.
   */
  private async autoAssignUnassignedSevere(tenantId: string): Promise<void> {
    const cutoff = new Date(Date.now() - ESCALATION_AUTO_ASSIGN_AFTER_MINUTES * 60_000);
    const unassigned = (await this.prisma.escalation.findMany({
      where: {
        tenantId,
        resolvedAt: null,
        assignedTo: null,
        openedAt: { lt: cutoff },
        riskFlag: { severity: SeverityBand.SEVERE },
      },
      include: { riskFlag: { select: { severity: true, clientId: true } } },
    })) as SweepEscalationRow[];
    if (unassigned.length === 0) return;

    // Credential-eligible pool only: verified active license, active malpractice,
    // non-expired, active user — never least-loaded alone.
    const now = new Date();
    const candidates = await this.prisma.psychologist.findMany({
      where: {
        tenantId,
        acceptingClients: true,
        deletedAt: null,
        user: { status: 'ACTIVE', deletedAt: null },
        credentials: {
          some: {
            verificationStatus: 'verified',
            malpracticeStatus: 'active',
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
        },
      },
      orderBy: { currentCaseload: 'asc' },
      take: 20,
      select: { id: true, userId: true, currentCaseload: true, caseloadCap: true },
    });
    const onCall = candidates.find((p) => p.caseloadCap <= 0 || p.currentCaseload < p.caseloadCap);
    if (!onCall) {
      this.logger.warn(
        `No credential-eligible on-call psychologist available for tenant ${tenantId} SEVERE auto-assign`,
      );
      return;
    }

    for (const esc of unassigned) {
      await this.prisma.escalation.update({
        where: { id: esc.id },
        data: { assignedTo: onCall.userId },
      });

      await this.audit.record({
        tenantId,
        actorId: SYSTEM_ACTOR_ID,
        action: 'escalation.auto_assigned',
        entityType: 'Escalation',
        entityId: esc.id,
        after: {
          assignedTo: onCall.userId,
          reason: `on-call fallback: unassigned SEVERE past ${ESCALATION_AUTO_ASSIGN_AFTER_MINUTES}min (credential-eligible)`,
        },
        critical: true,
      });

      await this.bus.publish(Events.EscalationAssigned, tenantId, {
        escalationId: esc.id,
        riskFlagId: esc.riskFlagId,
        clientId: esc.riskFlag.clientId,
        assignedTo: onCall.userId,
      });
    }
  }
}
