import { Injectable, Logger } from '@nestjs/common';

export interface DomainEvent<T = unknown> {
  name: string;
  tenantId: string;
  occurredAt: Date;
  payload: T;
}

type Handler = (event: DomainEvent) => void | Promise<void>;

/**
 * In-process typed event bus. Contexts publish domain events; other contexts
 * subscribe. This is the seam that becomes NATS/JetStream at extraction time
 * (ADR-005) — publishers/subscribers keep the same interface.
 *
 * A production build pairs this with a transactional outbox so "state changed
 * ⇔ event emitted" is guaranteed. Here we emit synchronously post-commit.
 */
@Injectable()
export class EventBus {
  private readonly logger = new Logger(EventBus.name);
  private readonly handlers = new Map<string, Handler[]>();

  subscribe(eventName: string, handler: Handler): void {
    const list = this.handlers.get(eventName) ?? [];
    list.push(handler);
    this.handlers.set(eventName, list);
  }

  async publish<T>(name: string, tenantId: string, payload: T): Promise<void> {
    const event: DomainEvent<T> = { name, tenantId, occurredAt: new Date(), payload };
    this.logger.debug(`event ${name} (tenant=${tenantId})`);
    const handlers = this.handlers.get(name) ?? [];
    await Promise.all(
      handlers.map(async (h) => {
        try {
          await h(event as DomainEvent);
        } catch (err) {
          this.logger.error(`handler for ${name} failed: ${(err as Error).message}`);
        }
      }),
    );
  }
}

/** Canonical event names (a superset lives in docs/technical/01-bounded-contexts.md). */
export const Events = {
  IntakeSubmitted: 'intake.submitted',
  RiskFlagRaised: 'risk.flag.raised',
  AssignmentProposed: 'assignment.proposed',
  AssignmentApproved: 'assignment.approved',
  NoteSigned: 'note.signed',
  PlanActivated: 'plan.activated',
  AssessmentScored: 'assessment.scored',
  // CRM & Referrals (context 29)
  LeadCaptured: 'lead.captured',
  LeadStageChanged: 'lead.stage_changed',
  ReferralReceived: 'referral.received',
  LeadConverted: 'lead.converted',
  // Communications Hub (context 30)
  CallCompleted: 'call.completed',
  SmsDelivered: 'sms.delivered',
  MediaMessageSent: 'media_message.sent',
  // Risk & Crisis (context 21)
  EscalationResolved: 'escalation.resolved',
  BreakGlassInvoked: 'breakglass.invoked',
  SafetyPlanCreated: 'safetyplan.created',
  // Scheduling (context 9)
  AppointmentBooked: 'appointment.booked',
  NoShowRecorded: 'appointment.no_show_recorded',
  // Decoupled seam: a Communications-Hub subscriber turns this into an
  // SMS/notification — Scheduling never imports the communications module.
  AppointmentReminderDue: 'appointment.reminder_due',
  // Finance (contexts 24/25/26 — Payments, Accounting, Revenue Share/Payouts)
  InvoiceCreated: 'invoice.created',
  PaymentCaptured: 'payment.captured',
  PayoutComputed: 'payout.computed',
} as const;
