import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Role } from '@vpsy/contracts';
import type {
  AuthPrincipal,
  CallSessionDto,
  ClickToCallInput,
  CommsLogEntryDto,
  CreateMediaMessageInput,
  MediaMessageDto,
  RtcTokenDto,
  RtcTokenInput,
  SendSmsInput,
  SmsMessageDto,
} from '@vpsy/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { EventBus, Events } from '../../common/events/event-bus.service';
import { OfflineStubAdapter } from './adapters/offline-stub.adapter';
import { TwilioSmsAdapter } from './adapters/twilio-sms.adapter';
import type { TelephonyProvider } from './ports/telephony-provider.port';
import type { SmsProvider } from './ports/sms-provider.port';

const COMMS_LOG_LIMIT = 20;

type CallSessionRow = {
  id: string;
  direction: string;
  fromE164: string;
  toE164: string;
  status: string;
  startedAt: Date;
  endedAt: Date | null;
  durationSec: number | null;
  clientId: string | null;
};

type SmsMessageRow = {
  id: string;
  direction: string;
  toE164: string;
  fromE164: string;
  body: string;
  status: string;
  createdAt: Date;
};

type MediaMessageRow = {
  id: string;
  threadId: string;
  senderId: string;
  kind: string;
  storageKey: string;
  durationSec: number;
  mimeType: string;
  transcript: string | null;
  deliveredAt: Date | null;
  readAt: Date | null;
  createdAt: Date;
};

/**
 * Communications Hub (context 30, `docs/technical/15-communications-and-
 * telephony.md`). Supporting, not clinical-decision: it moves voice, text,
 * and media, and feeds every touch into the unified `EngagementActivity`
 * timeline (`16-crm-and-referrals.md` reuses the same table). No method
 * here calls a vendor SDK directly — both provider ports resolve to the
 * offline stub until a real SIP/cloud adapter is wired (`15` §2).
 */
@Injectable()
export class CommunicationsService {
  private readonly logger = new Logger(CommunicationsService.name);
  private readonly telephony: TelephonyProvider;
  private readonly sms: SmsProvider;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly bus: EventBus,
    private readonly offlineStub: OfflineStubAdapter,
  ) {
    // Provider selection seam (`15` §2, §8), activate-on-key: a real adapter is
    // selected when its credentials are present; otherwise we keep the offline
    // stub — never silently pretending an unconfigured integration is live.

    // SMS: real Twilio when TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN are set.
    const twilioSms = TwilioSmsAdapter.fromEnv();
    if (twilioSms) {
      this.sms = twilioSms;
      this.logger.log('SMS provider: Twilio (live).');
    } else {
      if (process.env.SMS_PROVIDER) {
        this.logger.warn(
          `SMS_PROVIDER=${process.env.SMS_PROVIDER} set but no Twilio credentials — falling back to the offline stub (see docs/technical/15-communications-and-telephony.md §2.3).`,
        );
      }
      this.sms = offlineStub;
    }

    // Voice: real click-to-call is async (status via webhook) and needs a public
    // status-callback endpoint + tenant Twilio number — a separate ticket. Until
    // then telephony stays on the honest offline stub.
    if (process.env.TELEPHONY_PROVIDER) {
      this.logger.warn(
        `TELEPHONY_PROVIDER=${process.env.TELEPHONY_PROVIDER} set but real voice needs a status-callback webhook — falling back to the offline stub (see docs/technical/15-communications-and-telephony.md §2.3).`,
      );
    }
    this.telephony = offlineStub;
  }

  // ── Calls ──

  /**
   * Click-to-call (`15` §3.2, §10.1). Gated to PSYCHOLOGIST/MANAGER
   * (ABAC-in-service, mirroring `PermissionsGuard`'s comment that RBAC is
   * refined further inside services) — a CLIENT holds `comms:write` only
   * for their own async media messages, never for placing calls.
   */
  async clickToCall(principal: AuthPrincipal, input: ClickToCallInput): Promise<CallSessionDto> {
    this.assertStaffRole(principal, 'place a call');
    const tenantId = principal.tenantId;

    const fromNumber = await this.prisma.phoneNumber.findFirst({
      where: { tenantId, capabilities: { has: 'VOICE' } },
    });
    if (!fromNumber) throw new ConflictException('No VOICE-capable phone number provisioned for this tenant');

    const startedAt = new Date();
    const result = await this.telephony.placeCall(fromNumber.e164, input.toE164, {
      clientId: input.clientId,
      purpose: input.purpose,
    });
    const endedAt = new Date(startedAt.getTime() + result.durationSec * 1000);

    const call = await this.prisma.callSession.create({
      data: {
        tenantId,
        direction: 'OUTBOUND',
        fromE164: fromNumber.e164,
        toE164: input.toE164,
        clientId: input.clientId,
        purpose: input.purpose,
        startedAt,
        endedAt,
        durationSec: result.durationSec,
        status: result.status,
        providerRef: result.providerRef,
      },
    });

    await this.prisma.engagementActivity.create({
      data: {
        tenantId,
        subjectType: input.clientId ? 'Client' : 'PhoneNumber',
        subjectId: input.clientId ?? input.toE164,
        kind: 'CALL',
        direction: 'OUTBOUND',
        summary: `Click-to-call to ${input.toE164} — ${result.status.toLowerCase()} (${result.durationSec}s)`,
        actorId: principal.userId,
        occurredAt: endedAt,
      },
    });

    await this.audit.record({
      tenantId,
      actorId: principal.userId,
      action: 'comms.call.completed',
      entityType: 'CallSession',
      entityId: call.id,
      after: { status: call.status, durationSec: call.durationSec, clientId: call.clientId },
    });

    await this.bus.publish(Events.CallCompleted, tenantId, {
      callId: call.id,
      clientId: call.clientId,
      durationSec: call.durationSec,
      status: call.status,
    });

    return this.toCallSessionDto(call as CallSessionRow);
  }

  // ── SMS ──

  /**
   * Send an SMS through the offline stub's deterministic
   * QUEUED → SENT → DELIVERED lifecycle (`15` §4.3). Gated to
   * PSYCHOLOGIST/MANAGER, same as click-to-call.
   */
  async sendSms(principal: AuthPrincipal, input: SendSmsInput): Promise<SmsMessageDto> {
    this.assertStaffRole(principal, 'send an SMS');
    const tenantId = principal.tenantId;

    const fromNumber = await this.prisma.phoneNumber.findFirst({
      where: { tenantId, capabilities: { has: 'SMS' } },
    });
    if (!fromNumber) throw new ConflictException('No SMS-capable phone number provisioned for this tenant');

    let sms = await this.prisma.smsMessage.create({
      data: {
        tenantId,
        direction: 'OUTBOUND',
        toE164: input.toE164,
        fromE164: fromNumber.e164,
        body: input.body,
        clientId: input.clientId,
        status: 'QUEUED',
      },
    });

    const result = await this.sms.sendSms(input.toE164, fromNumber.e164, input.body);
    sms = await this.prisma.smsMessage.update({
      where: { id: sms.id },
      data: { status: result.status === 'SENT' ? 'SENT' : 'FAILED', providerRef: result.providerRef },
    });

    if (sms.status === 'SENT') {
      // Offline stub simulates the carrier delivery receipt synchronously —
      // no network round-trip, deterministic outcome every run.
      sms = await this.prisma.smsMessage.update({ where: { id: sms.id }, data: { status: 'DELIVERED' } });
    }

    await this.prisma.engagementActivity.create({
      data: {
        tenantId,
        subjectType: input.clientId ? 'Client' : 'PhoneNumber',
        subjectId: input.clientId ?? input.toE164,
        kind: 'SMS',
        direction: 'OUTBOUND',
        summary: `SMS to ${input.toE164}: ${input.body.slice(0, 80)}`,
        actorId: principal.userId,
      },
    });

    await this.audit.record({
      tenantId,
      actorId: principal.userId,
      action: sms.status === 'DELIVERED' ? 'comms.sms.delivered' : 'comms.sms.failed',
      entityType: 'SmsMessage',
      entityId: sms.id,
      after: { status: sms.status, clientId: sms.clientId },
    });

    if (sms.status === 'DELIVERED') {
      await this.bus.publish(Events.SmsDelivered, tenantId, { smsId: sms.id, clientId: sms.clientId });
    }

    return this.toSmsMessageDto(sms as SmsMessageRow);
  }

  /**
   * System-originated SMS send — no principal/staff-role gate, because the
   * caller is another bounded context (e.g. Scheduling's appointment-
   * reminder seam, `15`/`09-*`), not an end-user request. Reuses the exact
   * same provider selection (incl. offline stub) and
   * `SmsMessage`/`EngagementActivity`/audit lifecycle as `sendSms`, but never
   * throws on a missing SMS-capable number or a provider failure — it always
   * reports the outcome honestly so a system caller (e.g. a reminder flow)
   * can decide what to do next instead of the whole request blowing up.
   */
  async sendSystemSms(
    tenantId: string,
    toE164: string,
    body: string,
    opts?: { clientId?: string },
  ): Promise<{ sent: boolean; smsId?: string; reason?: string }> {
    const fromNumber = await this.prisma.phoneNumber.findFirst({
      where: { tenantId, capabilities: { has: 'SMS' } },
    });
    if (!fromNumber) {
      this.logger.warn(`sendSystemSms: no SMS-capable phone number provisioned for tenant ${tenantId}`);
      return { sent: false, reason: 'no-sms-number-provisioned' };
    }

    let sms = await this.prisma.smsMessage.create({
      data: {
        tenantId,
        direction: 'OUTBOUND',
        toE164,
        fromE164: fromNumber.e164,
        body,
        clientId: opts?.clientId,
        status: 'QUEUED',
      },
    });

    const result = await this.sms.sendSms(toE164, fromNumber.e164, body);
    sms = await this.prisma.smsMessage.update({
      where: { id: sms.id },
      data: { status: result.status === 'SENT' ? 'SENT' : 'FAILED', providerRef: result.providerRef },
    });

    if (sms.status === 'SENT') {
      // Same simulated-delivery-receipt simplification as `sendSms`.
      sms = await this.prisma.smsMessage.update({ where: { id: sms.id }, data: { status: 'DELIVERED' } });
    }

    await this.prisma.engagementActivity.create({
      data: {
        tenantId,
        subjectType: opts?.clientId ? 'Client' : 'PhoneNumber',
        subjectId: opts?.clientId ?? toE164,
        kind: 'SMS',
        direction: 'OUTBOUND',
        summary: `System SMS to ${toE164}: ${body.slice(0, 80)}`,
      },
    });

    await this.audit.record({
      tenantId,
      action: sms.status === 'DELIVERED' ? 'comms.system_sms.delivered' : 'comms.system_sms.failed',
      entityType: 'SmsMessage',
      entityId: sms.id,
      after: { status: sms.status, clientId: sms.clientId },
    });

    if (sms.status === 'DELIVERED') {
      await this.bus.publish(Events.SmsDelivered, tenantId, { smsId: sms.id, clientId: sms.clientId });
    }

    return {
      sent: sms.status === 'DELIVERED',
      smsId: sms.id,
      reason: sms.status === 'DELIVERED' ? undefined : 'send-failed',
    };
  }

  // ── Unified comms log ──

  async getLog(principal: AuthPrincipal, clientId?: string): Promise<CommsLogEntryDto[]> {
    const tenantId = principal.tenantId;

    const [calls, smsMessages, mediaMessages] = await Promise.all([
      this.prisma.callSession.findMany({
        where: { tenantId, ...(clientId ? { clientId } : {}) },
        orderBy: { startedAt: 'desc' },
        take: COMMS_LOG_LIMIT,
      }),
      this.prisma.smsMessage.findMany({
        where: { tenantId, ...(clientId ? { clientId } : {}) },
        orderBy: { createdAt: 'desc' },
        take: COMMS_LOG_LIMIT,
      }),
      this.prisma.mediaMessage.findMany({
        where: { tenantId, ...(clientId ? { threadId: { contains: clientId } } : {}) },
        orderBy: { createdAt: 'desc' },
        take: COMMS_LOG_LIMIT,
      }),
    ]);

    const mediaEntries = await Promise.all(
      (mediaMessages as MediaMessageRow[]).map((m) => this.toMediaLogEntry(tenantId, m)),
    );

    const entries: CommsLogEntryDto[] = [
      ...(calls as CallSessionRow[]).map((c) => this.toCallLogEntry(c)),
      ...(smsMessages as SmsMessageRow[]).map((s) => this.toSmsLogEntry(s)),
      ...mediaEntries,
    ];

    return entries
      .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
      .slice(0, COMMS_LOG_LIMIT);
  }

  // ── Async media messages ──

  /**
   * Record an async voice/video message (`15` §6). `senderId` is always the
   * authenticated principal — never client-supplied — so a CLIENT can only
   * ever send as themselves, which is what "media send to their own thread"
   * means in practice absent a modeled Thread-participant check (Thread is
   * owned by Messaging, context 19; `threadId` here is an opaque scalar per
   * `02-data-model.md` Group I).
   */
  async createMediaMessage(principal: AuthPrincipal, input: CreateMediaMessageInput): Promise<MediaMessageDto> {
    const tenantId = principal.tenantId;

    const message = await this.prisma.mediaMessage.create({
      data: {
        tenantId,
        threadId: input.threadId,
        senderId: principal.userId,
        kind: input.kind,
        storageKey: input.storageKey,
        durationSec: input.durationSec,
        mimeType: input.mimeType,
        transcript: input.transcript,
        // Offline stub: no real virus-scan/transcode pipeline, so the
        // "deliver-when-online" step (`15` §6.1 step 5) is simulated as
        // immediate — the recipient is always "online" in the demo.
        deliveredAt: new Date(),
      },
    });

    await this.prisma.engagementActivity.create({
      data: {
        tenantId,
        subjectType: 'Thread',
        subjectId: input.threadId,
        kind: 'MEDIA_MESSAGE',
        direction: 'OUTBOUND',
        summary: `${input.kind === 'VIDEO' ? 'Video' : 'Voice'} message (${input.durationSec}s)`,
        actorId: principal.userId,
      },
    });

    await this.audit.record({
      tenantId,
      actorId: principal.userId,
      action: 'comms.media_message.sent',
      entityType: 'MediaMessage',
      entityId: message.id,
      after: { threadId: message.threadId, kind: message.kind, durationSec: message.durationSec },
    });

    await this.bus.publish(Events.MediaMessageSent, tenantId, {
      mediaMessageId: message.id,
      threadId: message.threadId,
      senderId: message.senderId,
    });

    return this.toMediaMessageDto(message as MediaMessageRow);
  }

  async listMediaMessagesByThread(principal: AuthPrincipal, threadId: string): Promise<MediaMessageDto[]> {
    const messages = await this.prisma.mediaMessage.findMany({
      where: { tenantId: principal.tenantId, threadId },
      orderBy: { createdAt: 'asc' },
    });
    return (messages as MediaMessageRow[]).map((m) => this.toMediaMessageDto(m));
  }

  async markMediaMessageRead(principal: AuthPrincipal, id: string): Promise<MediaMessageDto> {
    const tenantId = principal.tenantId;
    const existing = await this.prisma.mediaMessage.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Media message not found');

    const message = existing.readAt
      ? existing
      : await this.prisma.mediaMessage.update({ where: { id }, data: { readAt: new Date() } });

    if (!existing.readAt) {
      await this.audit.record({
        tenantId,
        actorId: principal.userId,
        action: 'comms.media_message.read',
        entityType: 'MediaMessage',
        entityId: id,
      });
    }

    return this.toMediaMessageDto(message as MediaMessageRow);
  }

  // ── In-house WebRTC signaling handshake ──

  /**
   * Room id + STUN iceServers stub for the shared self-hosted WebRTC SFU
   * (`15` §5). The real SFU/TURN infrastructure is infra per the doc — this
   * only issues the ephemeral handshake token, never touches the network.
   */
  async getRtcToken(principal: AuthPrincipal, input: RtcTokenInput): Promise<RtcTokenDto> {
    const roomId = input.sessionId ? `room_${input.sessionId}` : `room_adhoc_${principal.userId}_${Date.now()}`;
    const expiresAt = new Date(Date.now() + 5 * 60_000);

    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'comms.rtc_token.issued',
      entityType: 'RtcToken',
      entityId: roomId,
    });

    return {
      roomId,
      iceServers: [{ urls: 'stun:stun.vpsy.internal:3478' }],
      expiresAt: expiresAt.toISOString(),
    };
  }

  // ── ABAC ──

  private assertStaffRole(principal: AuthPrincipal, action: string): void {
    const allowed = principal.roles.includes(Role.PSYCHOLOGIST) || principal.roles.includes(Role.MANAGER);
    if (!allowed) {
      throw new ForbiddenException(`Only an assigned psychologist or manager may ${action}`);
    }
  }

  // ── Mappers ──

  private toCallSessionDto(call: CallSessionRow): CallSessionDto {
    return {
      id: call.id,
      direction: call.direction as CallSessionDto['direction'],
      fromE164: call.fromE164,
      toE164: call.toE164,
      status: call.status as CallSessionDto['status'],
      startedAt: call.startedAt.toISOString(),
      endedAt: call.endedAt?.toISOString(),
      durationSec: call.durationSec ?? undefined,
      clientId: call.clientId ?? undefined,
    };
  }

  private toSmsMessageDto(sms: SmsMessageRow): SmsMessageDto {
    return {
      id: sms.id,
      direction: sms.direction as SmsMessageDto['direction'],
      toE164: sms.toE164,
      fromE164: sms.fromE164,
      body: sms.body,
      status: sms.status as SmsMessageDto['status'],
      createdAt: sms.createdAt.toISOString(),
    };
  }

  private toMediaMessageDto(message: MediaMessageRow): MediaMessageDto {
    return {
      id: message.id,
      threadId: message.threadId,
      senderId: message.senderId,
      kind: message.kind as MediaMessageDto['kind'],
      storageKey: message.storageKey,
      durationSec: message.durationSec,
      mimeType: message.mimeType,
      transcript: message.transcript ?? undefined,
      deliveredAt: message.deliveredAt?.toISOString(),
      readAt: message.readAt?.toISOString(),
      createdAt: message.createdAt.toISOString(),
    };
  }

  private toCallLogEntry(call: CallSessionRow): CommsLogEntryDto {
    return {
      id: call.id,
      kind: 'CALL',
      direction: call.direction as CommsLogEntryDto['direction'],
      summary: `${call.direction === 'INBOUND' ? 'Inbound' : 'Outbound'} call ${call.status.toLowerCase()}${
        call.durationSec ? ` (${call.durationSec}s)` : ''
      }`,
      occurredAt: (call.endedAt ?? call.startedAt).toISOString(),
    };
  }

  private toSmsLogEntry(sms: SmsMessageRow): CommsLogEntryDto {
    return {
      id: sms.id,
      kind: 'SMS',
      direction: sms.direction as CommsLogEntryDto['direction'],
      summary: `SMS ${sms.status.toLowerCase()}: ${sms.body.slice(0, 60)}`,
      occurredAt: sms.createdAt.toISOString(),
    };
  }

  /**
   * A `MediaMessage` has no directional field of its own (it is
   * sender/thread-scoped, not call/SMS-shaped) — direction for the unified
   * log is inferred from whether the sender is a `Client` (INBOUND, i.e.
   * client → clinic) or staff (OUTBOUND, clinic → client).
   */
  private async toMediaLogEntry(tenantId: string, message: MediaMessageRow): Promise<CommsLogEntryDto> {
    const senderIsClient = await this.prisma.client.findFirst({
      where: { userId: message.senderId, tenantId },
      select: { id: true },
    });
    return {
      id: message.id,
      kind: 'MEDIA_MESSAGE',
      direction: senderIsClient ? 'INBOUND' : 'OUTBOUND',
      summary: `${message.kind === 'VIDEO' ? 'Video' : 'Voice'} message (${message.durationSec}s)`,
      occurredAt: message.createdAt.toISOString(),
    };
  }
}
