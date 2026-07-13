import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { EmailService } from '../email/email.service';
import { SiemExportService } from '../siem/siem-export.service';
import { EventBus, Events } from './event-bus.service';

/**
 * DPO / on-call / SIEM alert consumer (Phase 4 DoD).
 *
 * Always emits structured HIGH logs. Also:
 *   - SIEM export when VPSY_SIEM_WEBHOOK_URL and/or VPSY_SIEM_LOCAL_DIR set
 *   - Email when DPO_ALERT_EMAIL + live email provider configured
 *
 * Payloads are PHI-minimized (ids + status only).
 */
@Injectable()
export class DpoAlertSubscriber implements OnModuleInit {
  private readonly logger = new Logger('DPOAlert');

  constructor(
    private readonly bus: EventBus,
    @Optional() private readonly email?: EmailService,
    @Optional() private readonly siem?: SiemExportService,
  ) {}

  onModuleInit() {
    this.bus.subscribe(Events.BreakGlassInvoked, async (event) => {
      const p = event.payload as {
        grantId?: string;
        clientId?: string;
        invokedBy?: string;
        reason?: string;
        expiresAt?: string;
      };
      await this.dispatch({
        type: Events.BreakGlassInvoked,
        severity: 'HIGH',
        tenantId: event.tenantId,
        title: 'Break-glass emergency access invoked',
        payload: {
          alert: 'BREAK_GLASS',
          grantId: p.grantId,
          clientId: p.clientId,
          invokedBy: p.invokedBy,
          expiresAt: p.expiresAt,
          reasonPreview: (p.reason ?? '').slice(0, 120),
        },
      });
    });

    this.bus.subscribe(Events.EscalationAssigned, async (event) => {
      const p = event.payload as {
        escalationId?: string;
        riskFlagId?: string;
        clientId?: string;
        assignedTo?: string;
      };
      await this.dispatch({
        type: Events.EscalationAssigned,
        severity: 'HIGH',
        tenantId: event.tenantId,
        title: 'Crisis escalation assigned',
        payload: { alert: 'ESCALATION_ASSIGNED', ...p },
      });
    });

    this.bus.subscribe(Events.EscalationSlaBreached, async (event) => {
      const p = event.payload as {
        escalationId?: string;
        riskFlagId?: string;
        clientId?: string;
        severity?: string;
      };
      await this.dispatch({
        type: Events.EscalationSlaBreached,
        severity: 'CRITICAL',
        tenantId: event.tenantId,
        title: 'Crisis escalation SLA breached',
        payload: { alert: 'ESCALATION_SLA_BREACHED', ...p },
      });
    });

    this.bus.subscribe(Events.AuditChainBroken, async (event) => {
      const p = event.payload as {
        day?: string;
        tipHash?: string | null;
        brokenAt?: string;
        reason?: string;
        checked?: number;
      };
      await this.dispatch({
        type: Events.AuditChainBroken,
        severity: 'CRITICAL',
        tenantId: event.tenantId,
        title: 'Audit hash chain integrity failure',
        payload: { alert: 'AUDIT_CHAIN_BROKEN', ...p },
      });
    });

    this.bus.subscribe(Events.AuditDailyAnchor, async (event) => {
      const p = event.payload as {
        day?: string;
        tipHash?: string | null;
        chainOk?: boolean;
        checked?: number;
      };
      // Successful anchors are SIEM/log only (no email spam).
      if (this.siem) {
        await this.siem.emit({
          type: Events.AuditDailyAnchor,
          severity: p.chainOk === false ? 'CRITICAL' : 'INFO',
          tenantId: event.tenantId,
          payload: { alert: 'AUDIT_DAILY_ANCHOR', ...p },
        });
      } else {
        this.logger.log(JSON.stringify({ alert: 'AUDIT_DAILY_ANCHOR', tenantId: event.tenantId, ...p }));
      }
    });
  }

  private async dispatch(input: {
    type: string;
    severity: 'INFO' | 'WARN' | 'HIGH' | 'CRITICAL';
    tenantId: string;
    title: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    const line = JSON.stringify({
      ...input.payload,
      severity: input.severity,
      tenantId: input.tenantId,
      type: input.type,
    });
    if (input.severity === 'CRITICAL' || input.severity === 'HIGH') {
      this.logger.error(line);
    } else {
      this.logger.warn(line);
    }

    if (this.siem) {
      try {
        await this.siem.emit({
          type: input.type,
          severity: input.severity,
          tenantId: input.tenantId,
          payload: input.payload,
        });
      } catch (err) {
        this.logger.warn(`SIEM emit failed: ${(err as Error).message}`);
      }
    }

    await this.maybeEmail(input.title, { ...input.payload, tenantId: input.tenantId });
  }

  private async maybeEmail(title: string, payload: Record<string, unknown>): Promise<void> {
    const to = process.env.DPO_ALERT_EMAIL?.trim();
    if (!to || !this.email) return;
    try {
      await this.email.sendSecurityAlert(to, {
        title,
        tenantId: String(payload.tenantId ?? ''),
        summary: JSON.stringify(payload),
      });
    } catch (err) {
      this.logger.warn(`DPO email alert failed: ${(err as Error).message}`);
    }
  }
}
