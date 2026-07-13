import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ConsentType,
  REQUIRED_CONSENT_VERSIONS,
  Role,
  TeleSessionStatus,
  type AuthPrincipal,
  type CreateTeleSessionInput,
  type TeleSessionDto,
  type TeleSessionJoinResult,
  type TeleSessionParticipantEvent,
} from '@vpsy/contracts';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { EventBus, Events } from '../../common/events/event-bus.service';
import { LiveKitAdapter } from './adapters/livekit.adapter';
import type { VideoProvider } from './ports/video-provider.port';

type TeleSessionRow = {
  id: string;
  tenantId: string;
  appointmentId: string;
  clientId: string;
  psychologistId: string;
  roomName: string;
  status: string;
  startedAt: Date | null;
  endedAt: Date | null;
  participantEvents: unknown;
  createdAt: Date;
};

type AppointmentRow = {
  id: string;
  tenantId: string;
  clientId: string;
  psychologistId: string;
};

type ClientRow = { id: string; userId: string; tenantId: string };
type PsychologistRow = { id: string; userId: string; tenantId: string };

/** Doc §14 HIPAA safeguards table — session-scoped RTC tokens are SHORT-TTL. */
const JOIN_TOKEN_TTL_SECONDS = 15 * 60;

const TERMINAL_STATUSES = [TeleSessionStatus.ENDED, TeleSessionStatus.CANCELLED];

/**
 * Telehealth (context 12, `08-telehealth-and-realtime.md` — the last
 * unbuilt bounded context). `TeleSession` is the connectivity/media
 * lifecycle layer (SCHEDULED -> WAITING_ROOM -> IN_PROGRESS -> ENDED, or
 * CANCELLED), deliberately parallel to — and never mutating — the clinical
 * `Session` (encounter/note anchor) owned by `scheduling`/`clinical-
 * documentation`.
 *
 * LiveKit Cloud is activate-on-key (`LiveKitAdapter.fromEnv()`, same shape
 * as `StripePaymentAdapter`/`TwilioSmsAdapter`): with no LIVEKIT_* env vars
 * configured, every endpoint that would need to mint a real join token
 * instead throws an honest `ServiceUnavailableException` (`VIDEO_NOT_
 * CONFIGURED`) — never a fake token that connects nowhere. The waiting-room
 * transition itself needs no LiveKit call (doc §6 — "authed but no media"),
 * so it still works even when video is unconfigured.
 *
 * Consent (doc §7): creating a session requires the client to hold a
 * current, non-revoked `TELEPSYCHOLOGY` consent. This is a NEW, narrower,
 * blocking check implemented directly against `prisma.consent` (never by
 * importing `ConsentService` — contexts interact only via `@vpsy/contracts`
 * + `EventBus`, never cross-module service imports) — deliberately not
 * `ConsentService.assertRequiredConsents`, which also requires
 * `DATA_PROCESSING` and would over-block relative to this doc's narrower
 * pre-media gate.
 *
 * ABAC (participants-only, mirrors `MessagingService.resolveParticipantThread`):
 * only the client or the assigned psychologist on the session's appointment
 * may create/join/admit/end/read it — a stranger, including a MANAGER who
 * only holds `scheduling:read`, 403s.
 */
@Injectable()
export class TelehealthService {
  private readonly logger = new Logger(TelehealthService.name);
  private readonly video: VideoProvider | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly bus: EventBus,
  ) {
    this.video = LiveKitAdapter.fromEnv();
    if (!this.video) {
      this.logger.warn(
        'LiveKit is not configured (LIVEKIT_API_KEY/LIVEKIT_API_SECRET/LIVEKIT_URL) — telehealth media-join endpoints will return 503 VIDEO_NOT_CONFIGURED until all three are set. The waiting-room transition still works (no media required).',
      );
    }
  }

  /**
   * Creates a TeleSession from an already-booked Appointment. Participant
   * ABAC + the TELEPSYCHOLOGY consent gate both run before any room is
   * minted. Idempotent: a caller retrying against an appointment that
   * already has a live (non-terminal) TeleSession gets that same row back
   * rather than a duplicate room.
   */
  async createSession(principal: AuthPrincipal, input: CreateTeleSessionInput): Promise<TeleSessionDto> {
    const tenantId = principal.tenantId;
    const { appointment, isPsychologist } = await this.resolveParticipantAppointment(principal, input.appointmentId);

    const existing = (await this.prisma.teleSession.findFirst({
      where: { tenantId, appointmentId: appointment.id, status: { notIn: TERMINAL_STATUSES } },
      orderBy: { createdAt: 'desc' },
    })) as TeleSessionRow | null;
    if (existing) return this.toDto(existing);

    await this.assertTelepsychologyConsent(appointment.clientId);

    const roomName = `tele_${appointment.id}_${randomUUID().slice(0, 8)}`;
    const initialEvent: TeleSessionParticipantEvent = {
      who: isPsychologist ? 'PSYCHOLOGIST' : 'CLIENT',
      event: 'created',
      at: new Date().toISOString(),
    };

    const created = (await this.prisma.teleSession.create({
      data: {
        tenantId,
        appointmentId: appointment.id,
        clientId: appointment.clientId,
        psychologistId: appointment.psychologistId,
        roomName,
        status: TeleSessionStatus.SCHEDULED,
        participantEvents: [initialEvent],
      },
    })) as TeleSessionRow;

    await this.audit.record({
      tenantId,
      actorId: principal.userId,
      action: 'telehealth.session.created',
      entityType: 'TeleSession',
      entityId: created.id,
      after: { appointmentId: appointment.id, status: created.status },
      critical: true,
    });
    await this.bus.publish(Events.TeleSessionCreated, tenantId, {
      teleSessionId: created.id,
      appointmentId: appointment.id,
      clientId: appointment.clientId,
      psychologistId: appointment.psychologistId,
    });

    return this.toDto(created);
  }

  /**
   * Doc §5/§6: a CLIENT joining lands in WAITING_ROOM — authed but no media,
   * no token minted, and no LiveKit configuration required. A PSYCHOLOGIST
   * joining gets a token immediately and the session flips to IN_PROGRESS
   * (starting it, if this is the first join). A participant rejoining an
   * already IN_PROGRESS session (e.g. reconnecting after a drop) gets a
   * fresh token rather than being sent back to the waiting room.
   */
  async joinSession(principal: AuthPrincipal, id: string): Promise<TeleSessionJoinResult> {
    const { session, isPsychologist } = await this.resolveParticipantSession(principal, id);
    this.assertNotTerminal(session);
    // Re-check telepsychology consent at join — consent can be revoked after create.
    await this.assertTelepsychologyConsent(session.clientId);

    if (isPsychologist) {
      const wasLive = session.status === TeleSessionStatus.IN_PROGRESS;
      const token = await this.mintTokenOrThrow(principal.userId, session.roomName);
      const event: TeleSessionParticipantEvent = {
        who: 'PSYCHOLOGIST',
        event: wasLive ? 'rejoined' : 'joined_started_session',
        at: new Date().toISOString(),
      };
      const updated = await this.appendEventAndTransition(session, event, {
        status: TeleSessionStatus.IN_PROGRESS,
        startedAt: session.startedAt ?? new Date(),
      });

      await this.audit.record({
        tenantId: principal.tenantId,
        actorId: principal.userId,
        action: wasLive ? 'telehealth.session.psychologist_rejoined' : 'telehealth.session.started',
        entityType: 'TeleSession',
        entityId: session.id,
      });
      if (!wasLive) {
        await this.bus.publish(Events.TeleSessionStarted, principal.tenantId, {
          teleSessionId: session.id,
          appointmentId: session.appointmentId,
        });
      }

      return { session: this.toDto(updated), token };
    }

    // CLIENT
    if (session.status === TeleSessionStatus.IN_PROGRESS) {
      // Already admitted previously (the room is live) — treat as a
      // reconnection, not a re-send to the waiting room.
      const token = await this.mintTokenOrThrow(principal.userId, session.roomName);
      const event: TeleSessionParticipantEvent = { who: 'CLIENT', event: 'rejoined', at: new Date().toISOString() };
      const updated = await this.appendEventAndTransition(session, event, {});
      await this.audit.record({
        tenantId: principal.tenantId,
        actorId: principal.userId,
        action: 'telehealth.session.client_rejoined',
        entityType: 'TeleSession',
        entityId: session.id,
      });
      return { session: this.toDto(updated), token };
    }

    const event: TeleSessionParticipantEvent = {
      who: 'CLIENT',
      event: session.status === TeleSessionStatus.SCHEDULED ? 'joined_waiting_room' : 'waiting_room_rejoin',
      at: new Date().toISOString(),
    };
    const updated = await this.appendEventAndTransition(session, event, { status: TeleSessionStatus.WAITING_ROOM });

    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'telehealth.session.client_waiting',
      entityType: 'TeleSession',
      entityId: session.id,
    });

    return { session: this.toDto(updated), token: null };
  }

  /**
   * PSYCHOLOGIST-only: admits the waiting client, minting THEIR token on
   * this response (the frontend relays it to the client) and flipping the
   * session to IN_PROGRESS. 409s if there is no one waiting (SCHEDULED —
   * client hasn't joined yet — or already IN_PROGRESS/terminal).
   */
  async admitClient(principal: AuthPrincipal, id: string): Promise<TeleSessionJoinResult> {
    const { session, isPsychologist, client } = await this.resolveParticipantSession(principal, id);
    if (!isPsychologist) {
      throw new ForbiddenException('Only the assigned psychologist may admit the client');
    }
    this.assertNotTerminal(session);
    if (session.status !== TeleSessionStatus.WAITING_ROOM) {
      throw new ConflictException('The client is not currently waiting to be admitted');
    }

    // Re-check before minting client media token (consent may have been revoked in waiting room).
    await this.assertTelepsychologyConsent(session.clientId);

    const token = await this.mintTokenOrThrow(client.userId, session.roomName);
    const event: TeleSessionParticipantEvent = {
      who: 'PSYCHOLOGIST',
      event: 'admitted_client',
      at: new Date().toISOString(),
    };
    const updated = await this.appendEventAndTransition(session, event, {
      status: TeleSessionStatus.IN_PROGRESS,
      startedAt: session.startedAt ?? new Date(),
    });

    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'telehealth.session.client_admitted',
      entityType: 'TeleSession',
      entityId: session.id,
      critical: true,
    });
    await this.bus.publish(Events.TeleSessionStarted, principal.tenantId, {
      teleSessionId: session.id,
      appointmentId: session.appointmentId,
    });

    return { session: this.toDto(updated), token };
  }

  /** Either participant may end the session. Idempotent on an already-ENDED session; a CANCELLED one cannot be ended. */
  async endSession(principal: AuthPrincipal, id: string): Promise<TeleSessionDto> {
    const { session, isPsychologist } = await this.resolveParticipantSession(principal, id);

    if (session.status === TeleSessionStatus.CANCELLED) {
      throw new ConflictException('This telehealth session was cancelled');
    }
    if (session.status === TeleSessionStatus.ENDED) {
      return this.toDto(session);
    }

    const event: TeleSessionParticipantEvent = {
      who: isPsychologist ? 'PSYCHOLOGIST' : 'CLIENT',
      event: 'ended',
      at: new Date().toISOString(),
    };
    const updated = await this.appendEventAndTransition(session, event, {
      status: TeleSessionStatus.ENDED,
      endedAt: new Date(),
    });

    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'telehealth.session.ended',
      entityType: 'TeleSession',
      entityId: session.id,
      critical: true,
    });
    await this.bus.publish(Events.TeleSessionEnded, principal.tenantId, {
      teleSessionId: session.id,
      appointmentId: session.appointmentId,
    });

    return this.toDto(updated);
  }

  async getSession(principal: AuthPrincipal, id: string): Promise<TeleSessionDto> {
    const { session } = await this.resolveParticipantSession(principal, id);
    return this.toDto(session);
  }

  // ── Consent gate (doc §7) ──

  private async assertTelepsychologyConsent(clientId: string): Promise<void> {
    const requiredVersion = REQUIRED_CONSENT_VERSIONS[ConsentType.TELEPSYCHOLOGY];
    const consent = await this.prisma.consent.findFirst({
      where: {
        clientId,
        type: ConsentType.TELEPSYCHOLOGY,
        version: requiredVersion,
        revokedAt: null,
      },
    });
    if (!consent) {
      throw new ConflictException({
        type: 'https://vpsy.health/errors/consent-required',
        title: 'Telehealth consent required',
        missing: [{ type: ConsentType.TELEPSYCHOLOGY, requiredVersion }],
      });
    }
  }

  // ── LiveKit gate (activate-on-key) ──

  private async mintTokenOrThrow(identity: string, roomName: string) {
    if (!this.video) {
      throw new ServiceUnavailableException({
        type: 'https://vpsy.health/errors/video-not-configured',
        title: 'VIDEO_NOT_CONFIGURED',
        detail:
          'Telehealth video is not configured for this environment (LIVEKIT_API_KEY/LIVEKIT_API_SECRET/LIVEKIT_URL unset).',
      });
    }
    return this.video.mintJoinToken({
      identity,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      ttlSeconds: JOIN_TOKEN_TTL_SECONDS,
    });
  }

  // ── ABAC ──

  /** Resolves + verifies the caller is a participant on the (not-yet-created) TeleSession's Appointment. */
  private async resolveParticipantAppointment(
    principal: AuthPrincipal,
    appointmentId: string,
  ): Promise<{ appointment: AppointmentRow; isClient: boolean; isPsychologist: boolean }> {
    const tenantId = principal.tenantId;
    const appointment = (await this.prisma.appointment.findFirst({
      where: { id: appointmentId, tenantId },
    })) as AppointmentRow | null;
    if (!appointment) throw new NotFoundException('Appointment not found');

    const [client, psychologist] = await Promise.all([
      this.prisma.client.findFirst({ where: { id: appointment.clientId, tenantId } }) as Promise<ClientRow | null>,
      this.prisma.psychologist.findFirst({
        where: { id: appointment.psychologistId, tenantId },
      }) as Promise<PsychologistRow | null>,
    ]);

    const isClient = principal.roles.includes(Role.CLIENT) && client?.userId === principal.userId;
    const isPsychologist = principal.roles.includes(Role.PSYCHOLOGIST) && psychologist?.userId === principal.userId;
    if (!isClient && !isPsychologist) {
      throw new ForbiddenException("Only this appointment's client and assigned psychologist may start a telehealth session");
    }

    return { appointment, isClient, isPsychologist };
  }

  /** Resolves + verifies the caller is a participant on an existing TeleSession. */
  private async resolveParticipantSession(
    principal: AuthPrincipal,
    id: string,
  ): Promise<{ session: TeleSessionRow; isClient: boolean; isPsychologist: boolean; client: ClientRow; psychologist: PsychologistRow }> {
    const tenantId = principal.tenantId;
    const session = (await this.prisma.teleSession.findFirst({
      where: { id, tenantId, deletedAt: null },
    })) as TeleSessionRow | null;
    if (!session) throw new NotFoundException('Telehealth session not found');

    const [client, psychologist] = await Promise.all([
      this.prisma.client.findFirst({ where: { id: session.clientId, tenantId } }) as Promise<ClientRow | null>,
      this.prisma.psychologist.findFirst({
        where: { id: session.psychologistId, tenantId },
      }) as Promise<PsychologistRow | null>,
    ]);
    if (!client || !psychologist) throw new NotFoundException('Telehealth session not found');

    const isClient = principal.roles.includes(Role.CLIENT) && client.userId === principal.userId;
    const isPsychologist = principal.roles.includes(Role.PSYCHOLOGIST) && psychologist.userId === principal.userId;
    if (!isClient && !isPsychologist) {
      throw new ForbiddenException("Only this session's client and assigned psychologist may access it");
    }

    return { session, isClient, isPsychologist, client, psychologist };
  }

  private assertNotTerminal(session: TeleSessionRow): void {
    if (TERMINAL_STATUSES.includes(session.status as (typeof TERMINAL_STATUSES)[number])) {
      throw new ConflictException('This telehealth session has ended');
    }
  }

  private async appendEventAndTransition(
    session: TeleSessionRow,
    event: TeleSessionParticipantEvent,
    patch: { status?: string; startedAt?: Date; endedAt?: Date },
  ): Promise<TeleSessionRow> {
    const existingEvents = Array.isArray(session.participantEvents)
      ? (session.participantEvents as TeleSessionParticipantEvent[])
      : [];
    return (await this.prisma.teleSession.update({
      where: { id: session.id },
      data: { ...patch, participantEvents: [...existingEvents, event] },
    })) as TeleSessionRow;
  }

  // ── Mappers ──

  private toDto(row: TeleSessionRow): TeleSessionDto {
    return {
      id: row.id,
      appointmentId: row.appointmentId,
      clientId: row.clientId,
      psychologistId: row.psychologistId,
      roomName: row.roomName,
      status: row.status as TeleSessionDto['status'],
      startedAt: row.startedAt ? row.startedAt.toISOString() : null,
      endedAt: row.endedAt ? row.endedAt.toISOString() : null,
      participantEvents: Array.isArray(row.participantEvents)
        ? (row.participantEvents as TeleSessionParticipantEvent[])
        : [],
      createdAt: row.createdAt.toISOString(),
    };
  }
}
