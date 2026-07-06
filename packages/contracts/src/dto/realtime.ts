/**
 * Real-time push contract (SP3 — "live push, without lag"). This is the
 * curated, PHI-minimized event envelope pushed by the API's
 * RealtimeBridgeService (bridging the in-process EventBus to Socket.IO
 * rooms) and consumed by the web app's `useLiveEvents` hook.
 *
 * PHI MINIMIZATION is a correctness requirement, not a nice-to-have: a
 * `LiveEvent` payload may only ever carry ids, entity refs, coarse status,
 * and timestamps — NEVER clinical free-text (session notes, safety-plan
 * content, presenting problems, message bodies, etc). Anything requiring
 * that detail is fetched by the client over the normal authenticated REST
 * API once it reloads in response to the event.
 */
export const RealtimeEventType = {
  RiskFlagRaised: 'risk.flag.raised',
  EscalationRaised: 'risk.escalation.raised',
  EscalationAssigned: 'risk.escalation.assigned',
  EscalationResolved: 'risk.escalation.resolved',
  AssignmentProposed: 'assignment.proposed',
  AssignmentApproved: 'assignment.approved',
  AppointmentBooked: 'appointment.booked',
  AppointmentChanged: 'appointment.changed',
  AppointmentCancelled: 'appointment.cancelled',
  CommsMessage: 'comms.message',
  CommsCall: 'comms.call',
  AiRecommendationCreated: 'ai_recommendation.created',
} as const;
export type RealtimeEventType = (typeof RealtimeEventType)[keyof typeof RealtimeEventType];

export interface LiveEventEntityRef {
  /** e.g. "Escalation", "RiskFlag", "Assignment", "Appointment", "AIRecommendation" */
  type: string;
  id: string;
}

/** PHI-minimized real-time envelope — ids/refs/status/timestamps only, never free-text. */
export interface LiveEvent<T extends Record<string, unknown> = Record<string, unknown>> {
  type: RealtimeEventType;
  entity: LiveEventEntityRef;
  tenantId: string;
  /** ISO-8601 UTC timestamp. */
  occurredAt: string;
  /** Coarse status only (e.g. "assigned", "resolved", "CANCELLED", "PENDING"). */
  status?: string;
  /** Present only when this event was also pushed to one user's private room. */
  userId?: string;
  /** Ids/refs only — never clinical free-text. */
  data?: T;
}

/** Socket.IO event name the gateway/hook exchange every curated `LiveEvent` on. */
export const REALTIME_SOCKET_EVENT = 'event';
