import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventBus, Events } from './event-bus.service';

/**
 * DPO / on-call alert consumer (Phase 4 DoD).
 *
 * Until real SMTP/PagerDuty is wired, this logs a HIGH-severity structured
 * alert that log-shipping / on-call systems can page on. Never swallows —
 * break-glass and SLA breach must not be silent.
 */
@Injectable()
export class DpoAlertSubscriber implements OnModuleInit {
  private readonly logger = new Logger('DPOAlert');

  constructor(private readonly bus: EventBus) {}

  onModuleInit() {
    this.bus.subscribe(Events.BreakGlassInvoked, async (event) => {
      const p = event.payload as {
        grantId?: string;
        clientId?: string;
        invokedBy?: string;
        reason?: string;
        expiresAt?: string;
      };
      this.logger.error(
        JSON.stringify({
          alert: 'BREAK_GLASS',
          severity: 'HIGH',
          tenantId: event.tenantId,
          grantId: p.grantId,
          clientId: p.clientId,
          invokedBy: p.invokedBy,
          expiresAt: p.expiresAt,
          // reason truncated for log systems; full reason remains in audit trail
          reasonPreview: (p.reason ?? '').slice(0, 120),
        }),
      );
    });

    this.bus.subscribe(Events.EscalationAssigned, async (event) => {
      const p = event.payload as {
        escalationId?: string;
        riskFlagId?: string;
        clientId?: string;
        assignedTo?: string;
      };
      this.logger.warn(
        JSON.stringify({
          alert: 'ESCALATION_ASSIGNED',
          severity: 'HIGH',
          tenantId: event.tenantId,
          ...p,
        }),
      );
    });
  }
}
