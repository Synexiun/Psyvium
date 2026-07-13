import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@vpsy/database';

export interface DomainEvent<T = unknown> {
  name: string;
  tenantId: string;
  occurredAt: Date;
  payload: T;
}

type Handler = (event: DomainEvent) => void | Promise<void>;

/** Result of a publish attempt — lets callers that need it (the outbox relay)
 * distinguish "every subscriber ran clean" from "at least one threw", without
 * changing behavior for the ~22 existing call sites that just `await` it as a
 * bare statement and never touch the resolved value. */
export interface PublishResult {
  ok: boolean;
  errors: string[];
}

/** Narrow structural view of a Prisma transaction client — only the one table
 * `publishDurable` needs. Mirrors the `ScoringTx` convention in
 * `psychometrics.service.ts`: unit-test mocks stay honest about what's
 * actually written, and any `Prisma.TransactionClient` satisfies this shape
 * for free. */
export interface OutboxTx {
  outboxEvent: {
    create: (args: {
      data: { tenantId: string; eventName: string; payload: Prisma.InputJsonValue };
    }) => Promise<unknown>;
  };
}

/**
 * In-process typed event bus. Contexts publish domain events; other contexts
 * subscribe. This is the seam that becomes NATS/JetStream at extraction time
 * (ADR-005) — publishers/subscribers keep the same interface.
 *
 * ## Transactional outbox (ADR-005) — the durable vs. direct split
 *
 * Publishing after a `$transaction` commits has a gap: a crash between commit
 * and publish silently drops the event. Two ways to publish from here on:
 *
 * - `publishDurable(tx, ...)` — writes an `OutboxEvent` row USING THE
 *   CALLER'S transaction client, so the event record commits atomically with
 *   the domain-state change. `OutboxRelayService` (common/outbox) sweeps
 *   PENDING rows (~2s) and republishes them through `publish()` below, so
 *   every existing subscriber (realtime bridge, metrics bridge, matching)
 *   keeps working unchanged. Use this for events that must never be silently
 *   dropped: `RiskFlagRaised`, `EscalationRaised` (intake + psychometrics
 *   safety hits), `EscalationAssigned`/`EscalationResolved` (risk service),
 *   `PaymentCaptured` (finance). Subscribers see these within ~2s instead of
 *   instantly — acceptable for risk/finance flows, since the UI already has
 *   realtime pushes for the rest of the experience.
 * - `publish(...)` — the original fire-and-forget, synchronous, post-commit
 *   publish. Kept for events whose loss is tolerable: UI-refresh signals and
 *   anything with its own durable source of truth regardless of delivery
 *   (`IntakeSubmitted`, `AssessmentScored`, `InvoiceCreated`,
 *   `AIRecommendationCreated`, comms/scheduling notifications, etc.).
 *   `SafetyPlanCreated` and `BreakGlassInvoked` are ALSO still on this path —
 *   they are safety-relevant but were not named in the audit's four critical
 *   categories, so they're flagged here as an honest candidate for a future
 *   outbox wave rather than silently left ambiguous.
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

  /** Writes the event into the outbox as part of the caller's own
   * transaction — if the transaction rolls back, the row never exists. Does
   * NOT invoke subscribers; `OutboxRelayService` does that on its sweep. */
  async publishDurable<T>(tx: OutboxTx, eventName: string, tenantId: string, payload: T): Promise<void> {
    // The payload is arbitrary event-specific data (see the `payload` params
    // at each call site); Prisma's Json column only accepts its own
    // `InputJsonValue` shape, so this cast is the one deliberate escape
    // hatch — same convention `psychometrics.service.ts` already uses for
    // its scored-response JSON columns.
    await tx.outboxEvent.create({
      data: { tenantId, eventName, payload: payload as unknown as Prisma.InputJsonValue },
    });
  }

  async publish<T>(name: string, tenantId: string, payload: T): Promise<PublishResult> {
    const event: DomainEvent<T> = { name, tenantId, occurredAt: new Date(), payload };
    this.logger.debug(`event ${name} (tenant=${tenantId})`);
    const handlers = this.handlers.get(name) ?? [];
    const errors: string[] = [];
    await Promise.all(
      handlers.map(async (h) => {
        try {
          await h(event as DomainEvent);
        } catch (err) {
          const message = (err as Error).message;
          this.logger.error(`handler for ${name} failed: ${message}`);
          errors.push(message);
        }
      }),
    );
    return { ok: errors.length === 0, errors };
  }
}

/** Canonical event names (a superset lives in docs/technical/01-bounded-contexts.md). */
export const Events = {
  IntakeSubmitted: 'intake.submitted',
  RiskFlagRaised: 'risk.flag.raised',
  AssignmentProposed: 'assignment.proposed',
  AssignmentApproved: 'assignment.approved',
  AssignmentRejected: 'assignment.rejected',
  AssignmentHeld: 'assignment.held',
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
  // Messaging (context 14) — secure client<->clinician text threads
  MessageSent: 'message.sent',
  // Risk & Crisis (context 21)
  EscalationRaised: 'escalation.raised',
  EscalationAssigned: 'escalation.assigned',
  EscalationResolved: 'escalation.resolved',
  BreakGlassInvoked: 'breakglass.invoked',
  SafetyPlanCreated: 'safetyplan.created',
  /** Risk SLA: published as raw name historically; keep constant for SIEM subscribers. */
  EscalationSlaBreached: 'escalation.sla_breached',
  /** Audit integrity: daily tip anchor result (ok or broken). */
  AuditDailyAnchor: 'audit.daily_anchor',
  AuditChainBroken: 'audit.chain_broken',
  // Scheduling (context 9)
  AppointmentBooked: 'appointment.booked',
  AppointmentStatusChanged: 'appointment.status_changed',
  NoShowRecorded: 'appointment.no_show_recorded',
  // Decoupled seam: a Communications-Hub subscriber turns this into an
  // SMS/notification — Scheduling never imports the communications module.
  AppointmentReminderDue: 'appointment.reminder_due',
  // Finance (contexts 24/25/26 — Payments, Accounting, Revenue Share/Payouts)
  InvoiceCreated: 'invoice.created',
  PaymentCaptured: 'payment.captured',
  PaymentRefunded: 'payment.refunded',
  PayoutComputed: 'payout.computed',
  // AI Gateway (ADR-007) — every inference is logged as an AIRecommendation
  // behind a PENDING human-decision gate; this is the seam the real-time
  // layer (SP3) and any other PENDING-queue subscriber hooks into.
  AIRecommendationCreated: 'ai_recommendation.created',
  // Telehealth (context 12, last unbuilt context — `08-telehealth-and-
  // realtime.md`): LiveKit-backed session lifecycle events.
  TeleSessionCreated: 'telesession.created',
  TeleSessionStarted: 'telesession.started',
  TeleSessionEnded: 'telesession.ended',
} as const;
