/**
 * Local response types for the Communications Hub endpoints (context 30).
 * Mirror the shared backend contract exactly; kept local to apps/web so the
 * web app stays decoupled from the backend build. Reconcile here if the
 * contract evolves.
 *
 * Endpoints:
 *   POST /comms/calls/click-to-call            → CallSessionDto
 *   POST /comms/sms                            → SmsMessageDto
 *   GET  /comms/log?clientId=                  → CommsLogEntryDto[]
 *   POST /comms/media-messages                 → MediaMessageDto
 *   GET  /comms/media-messages/thread/:id      → MediaMessageDto[]
 *   PATCH /comms/media-messages/:id/read       → MediaMessageDto
 *   POST /comms/rtc/token                       → RtcTokenDto
 */

export type CommDirection = 'INBOUND' | 'OUTBOUND';
export type SmsStatus = 'QUEUED' | 'SENT' | 'DELIVERED' | 'FAILED';
export type MediaKind = 'VOICE' | 'VIDEO';
export type CommsLogKind = 'CALL' | 'SMS' | 'MEDIA_MESSAGE';

export interface CallSessionDto {
  id: string;
  direction: CommDirection;
  fromE164: string;
  toE164: string;
  status: string;
  startedAt: string;
  endedAt?: string;
  durationSec?: number;
  clientId?: string;
}

export interface SmsMessageDto {
  id: string;
  direction: CommDirection;
  toE164: string;
  fromE164: string;
  body: string;
  status: SmsStatus;
  createdAt: string;
}

export interface MediaMessageDto {
  id: string;
  threadId: string;
  senderId: string;
  kind: MediaKind;
  storageKey: string;
  durationSec: number;
  mimeType: string;
  transcript?: string;
  deliveredAt?: string;
  readAt?: string;
  createdAt: string;
}

export interface CommsLogEntryDto {
  id: string;
  kind: CommsLogKind;
  direction: CommDirection;
  summary: string;
  occurredAt: string;
}

export interface RtcTokenDto {
  roomId: string;
  iceServers: { urls: string }[];
  expiresAt: string;
}

/* ── Request payloads ─────────────────────────────────────────────────── */
export interface ClickToCallInput {
  toE164: string;
  clientId?: string;
}
export interface SendSmsInput {
  toE164: string;
  body: string;
  clientId?: string;
}
export interface CreateMediaMessageInput {
  threadId: string;
  kind: MediaKind;
  storageKey: string;
  durationSec: number;
  mimeType: string;
  transcript?: string;
}
