import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { RealtimeEventType, Role, type LiveEvent, type LiveEventEntityRef } from '@vpsy/contracts';
import { EventBus, Events, type DomainEvent } from '../events/event-bus.service';
import { RealtimeGateway } from './realtime.gateway';

/** Maps one internal DomainEvent to the curated, PHI-minimized envelope — or `null` to drop it. */
type Mapper = (event: DomainEvent) => {
  type: RealtimeEventType;
  entity: LiveEventEntityRef;
  status?: string;
  /** Present only when this event should ALSO be pushed to one user's private room. */
  userIds?: string[];
  roles?: Role[];
  data?: Record<string, unknown>;
} | null;

/**
 * Bridges the in-process EventBus (see `common/events/event-bus.service.ts`)
 * to authenticated participant and explicit operational-role rooms owned by
 * `RealtimeGateway`. This is the ONLY place that translates internal domain
 * events into the public real-time contract — every mapper below hand-picks
 * ids/refs/status, never the raw event payload, so clinical free-text can
 * never leak onto the wire even if a future publisher adds a field.
 *
 * Depends only on the EventBus abstraction + the gateway's room-emit API —
 * never on another bounded context's service/repository — matching the
 * hexagonal rule that contexts interact only via `@vpsy/contracts` + EventBus.
 */
@Injectable()
export class RealtimeBridgeService implements OnModuleInit {
  private readonly logger = new Logger(RealtimeBridgeService.name);

  constructor(
    private readonly bus: EventBus,
    private readonly gateway: RealtimeGateway,
  ) {}

  onModuleInit(): void {
    // ── Risk & Crisis (context 21) ──
    this.wire(Events.RiskFlagRaised, (e) => {
      const p = e.payload as { riskFlagId: string; clientId: string };
      return {
        type: RealtimeEventType.RiskFlagRaised,
        entity: { type: 'RiskFlag', id: p.riskFlagId },
        roles: [Role.MANAGER, Role.SUPERVISOR],
      };
    });

    this.wire(Events.EscalationRaised, (e) => {
      const p = e.payload as { escalationId: string; riskFlagId: string; clientId: string };
      return {
        type: RealtimeEventType.EscalationRaised,
        entity: { type: 'Escalation', id: p.escalationId },
        roles: [Role.MANAGER, Role.SUPERVISOR],
      };
    });

    this.wire(Events.EscalationAssigned, (e) => {
      const p = e.payload as { escalationId: string; riskFlagId: string; clientId: string; assignedTo: string };
      return {
        type: RealtimeEventType.EscalationAssigned,
        entity: { type: 'Escalation', id: p.escalationId },
        status: 'assigned',
        userIds: [p.assignedTo],
        roles: [Role.MANAGER, Role.SUPERVISOR],
      };
    });

    this.wire(Events.EscalationResolved, (e) => {
      const p = e.payload as { escalationId: string; riskFlagId: string; clientId: string };
      return {
        type: RealtimeEventType.EscalationResolved,
        entity: { type: 'Escalation', id: p.escalationId },
        status: 'resolved',
        roles: [Role.MANAGER, Role.SUPERVISOR],
      };
    });

    // ── Matching & Assignment (context 11) ──
    this.wire(Events.AssignmentProposed, (e) => {
      const p = e.payload as { assignmentId: string; clientId: string };
      return {
        type: RealtimeEventType.AssignmentProposed,
        entity: { type: 'Assignment', id: p.assignmentId },
        status: 'proposed',
        roles: [Role.MANAGER],
      };
    });

    this.wire(Events.AssignmentApproved, (e) => {
      const p = e.payload as { assignmentId: string; clientId: string; psychologistId: string };
      return {
        type: RealtimeEventType.AssignmentApproved,
        entity: { type: 'Assignment', id: p.assignmentId },
        status: 'approved',
        roles: [Role.MANAGER],
      };
    });

    // ── Scheduling (context 9) ──
    this.wire(Events.AppointmentBooked, (e) => {
      const p = e.payload as { appointmentId: string; clientId: string; psychologistId: string; startsAt: string };
      return {
        type: RealtimeEventType.AppointmentBooked,
        entity: { type: 'Appointment', id: p.appointmentId },
        status: 'BOOKED',
        roles: [Role.MANAGER],
        data: { startsAt: p.startsAt },
      };
    });

    this.wire(Events.AppointmentStatusChanged, (e) => {
      const p = e.payload as { appointmentId: string; clientId: string; psychologistId: string; status: string };
      return {
        type: p.status === 'CANCELLED' ? RealtimeEventType.AppointmentCancelled : RealtimeEventType.AppointmentChanged,
        entity: { type: 'Appointment', id: p.appointmentId },
        status: p.status,
        roles: [Role.MANAGER],
      };
    });

    // ── Communications Hub (context 30) ──
    this.wire(Events.CallCompleted, (e) => {
      const p = e.payload as { callId: string; clientId: string | null; status: string };
      return {
        type: RealtimeEventType.CommsCall,
        entity: { type: 'CallSession', id: p.callId },
        status: p.status,
        data: p.clientId ? { clientId: p.clientId } : {},
      };
    });

    this.wire(Events.MediaMessageSent, (e) => {
      const p = e.payload as { mediaMessageId: string; threadId: string; senderId: string };
      return {
        type: RealtimeEventType.CommsMessage,
        entity: { type: 'MediaMessage', id: p.mediaMessageId },
        data: { threadId: p.threadId },
      };
    });

    // ── Messaging (context 14) ──
    // Reuses the CommsMessage envelope shape — ids/refs only, NEVER the
    // message body, which is what PHI minimization on the wire means here
    // (`RealtimeEventType` doc comment). The recipient's client reloads the
    // thread over the authenticated REST API to see the actual text.
    this.wire(Events.MessageSent, (e) => {
      const p = e.payload as { messageId: string; threadId: string; senderId: string; recipientUserIds?: string[] };
      return {
        type: RealtimeEventType.CommsMessage,
        entity: { type: 'Message', id: p.messageId },
        userIds: p.recipientUserIds ?? [],
        data: { threadId: p.threadId },
      };
    });

    // ── AI Gateway (ADR-007) ──
    this.wire(Events.AIRecommendationCreated, (e) => {
      const p = e.payload as {
        recommendationId: string;
        agent: string;
        linkedEntityType?: string;
        linkedEntityId?: string;
      };
      return {
        type: RealtimeEventType.AiRecommendationCreated,
        entity: { type: 'AIRecommendation', id: p.recommendationId },
        status: 'PENDING',
        data: {
          agent: p.agent,
          linkedEntityType: p.linkedEntityType ?? null,
          linkedEntityId: p.linkedEntityId ?? null,
        },
      };
    });
  }

  /** Subscribes once and emits only to explicitly declared users/roles. */
  private wire(eventName: string, map: Mapper): void {
    this.bus.subscribe(eventName, (event) => {
      try {
        const mapped = map(event);
        if (!mapped) return;
        const liveEvent: LiveEvent = {
          type: mapped.type,
          entity: mapped.entity,
          tenantId: event.tenantId,
          occurredAt: event.occurredAt.toISOString(),
          status: mapped.status,
          data: mapped.data,
        };
        if (mapped.roles?.length) {
          this.gateway.emitToRoles(event.tenantId, mapped.roles, liveEvent);
        }
        for (const userId of new Set(mapped.userIds ?? [])) {
          this.gateway.emitToUser(userId, { ...liveEvent, userId });
        }
      } catch (err) {
        this.logger.error(`bridge mapping failed for ${eventName}: ${(err as Error).message}`);
      }
    });
  }
}
