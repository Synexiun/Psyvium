import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { EmailService } from '../email/email.service';
import { EventBus, Events } from './event-bus.service';

/**
 * DPO / on-call alert consumer (Phase 4 DoD).
 *
 * Always emits structured HIGH logs for SIEM. When DPO_ALERT_EMAIL + live
 * email provider are configured, also sends a PHI-minimized security alert.
 */
@Injectable()
export class DpoAlertSubscriber implements OnModuleInit {
  private readonly logger = new Logger('DPOAlert');

  constructor(
    private readonly bus: EventBus,
    @Optional() private readonly email?: EmailService,
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
      const payload = {
        alert: 'BREAK_GLASS',
        severity: 'HIGH',
        tenantId: event.tenantId,
        grantId: p.grantId,
        clientId: p.clientId,
        invokedBy: p.invokedBy,
        expiresAt: p.expiresAt,
        reasonPreview: (p.reason ?? '').slice(0, 120),
      };
      this.logger.error(JSON.stringify(payload));
      await this.maybeEmail('Break-glass emergency access invoked', payload);
    });

    this.bus.subscribe(Events.EscalationAssigned, async (event) => {
      const p = event.payload as {
        escalationId?: string;
        riskFlagId?: string;
        clientId?: string;
        assignedTo?: string;
      };
      const payload = {
        alert: 'ESCALATION_ASSIGNED',
        severity: 'HIGH',
        tenantId: event.tenantId,
        ...p,
      };
      this.logger.warn(JSON.stringify(payload));
      await this.maybeEmail('Crisis escalation assigned', payload);
    });
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
