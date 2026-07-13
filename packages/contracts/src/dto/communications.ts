import { z } from 'zod';
import { CallDirection, CallStatus, CommsLogKind, MediaKind, PhoneCapability, SmsDirection, SmsStatus } from '../enums';

/**
 * Communications Hub DTOs (`docs/technical/15-communications-and-telephony.md`,
 * context 30). This is the SHARED CONTRACT the web cockpit is built against
 * next — shapes here must not drift from the doc without updating both sides.
 *
 * Communications Hub is Supporting, not clinical-decision: it transports and
 * records voice/text/media, it never diagnoses or triages. Every mutation
 * here writes an `EngagementActivity` row (the unified comms log, `15` §7.1)
 * and a domain event, mirroring the CRM & Referrals pattern (`crm.ts`).
 */

// ── Read models ──

export const phoneNumberSchema = z.object({
  id: z.string(),
  e164: z.string(),
  provider: z.string(),
  capabilities: z.array(z.nativeEnum(PhoneCapability)),
  assignedTo: z.string().nullable().optional(),
});
export type PhoneNumberDto = z.infer<typeof phoneNumberSchema>;

export const callSessionSchema = z.object({
  id: z.string(),
  direction: z.nativeEnum(CallDirection),
  fromE164: z.string(),
  toE164: z.string(),
  status: z.nativeEnum(CallStatus),
  startedAt: z.string(),
  endedAt: z.string().nullable().optional(),
  durationSec: z.number().int().nullable().optional(),
  clientId: z.string().nullable().optional(),
});
export type CallSessionDto = z.infer<typeof callSessionSchema>;

export const smsMessageSchema = z.object({
  id: z.string(),
  direction: z.nativeEnum(SmsDirection),
  toE164: z.string(),
  fromE164: z.string(),
  body: z.string(),
  status: z.nativeEnum(SmsStatus),
  createdAt: z.string(),
});
export type SmsMessageDto = z.infer<typeof smsMessageSchema>;

/** Staff or system records a STOP/START style opt-out for an E.164 number. */
export const setSmsOptOutSchema = z.object({
  e164: z.string().min(8).max(20),
  /** When true, the number is suppressed; when false, START/re-consent. */
  optedOut: z.boolean(),
  reason: z.string().max(500).optional(),
});
export type SetSmsOptOutInput = z.infer<typeof setSmsOptOutSchema>;

export const smsOptOutSchema = z.object({
  e164: z.string(),
  optedOut: z.boolean(),
  source: z.string(),
  reason: z.string().nullable().optional(),
  optedOutAt: z.string().nullable().optional(),
  optedInAt: z.string().nullable().optional(),
});
export type SmsOptOutDto = z.infer<typeof smsOptOutSchema>;

export const mediaMessageSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  senderId: z.string(),
  kind: z.nativeEnum(MediaKind),
  storageKey: z.string(),
  durationSec: z.number().int(),
  mimeType: z.string(),
  transcript: z.string().nullable().optional(),
  deliveredAt: z.string().nullable().optional(),
  readAt: z.string().nullable().optional(),
  createdAt: z.string(),
});
export type MediaMessageDto = z.infer<typeof mediaMessageSchema>;

export const commsLogEntrySchema = z.object({
  id: z.string(),
  kind: z.nativeEnum(CommsLogKind),
  direction: z.nativeEnum(CallDirection), // INBOUND|OUTBOUND — shared shape with SmsDirection
  summary: z.string(),
  occurredAt: z.string(),
});
export type CommsLogEntryDto = z.infer<typeof commsLogEntrySchema>;

export const rtcTokenSchema = z.object({
  roomId: z.string(),
  iceServers: z.array(z.object({ urls: z.string() })),
  expiresAt: z.string(),
});
export type RtcTokenDto = z.infer<typeof rtcTokenSchema>;

// ── Write models ──

/**
 * Click-to-call (`15` §3.2, §10.1). The clinician's registered extension —
 * never the client's real number — is exposed to the far end; `toE164` is
 * the only number this endpoint accepts from the caller.
 */
export const clickToCallSchema = z.object({
  toE164: z.string().min(3).max(20),
  clientId: z.string().optional(),
  purpose: z.enum(['care', 'scheduling', 'billing']).default('care'),
});
export type ClickToCallInput = z.infer<typeof clickToCallSchema>;

export const sendSmsSchema = z.object({
  toE164: z.string().min(3).max(20),
  body: z.string().min(1).max(1600),
  clientId: z.string().optional(),
});
export type SendSmsInput = z.infer<typeof sendSmsSchema>;

/**
 * Send SMS by tenant template key (doc 15). Body placeholders use `{name}`
 * style — only string/number vars are interpolated; missing keys stay as-is.
 */
export const sendSmsByTemplateSchema = z.object({
  toE164: z.string().min(3).max(20),
  templateKey: z.string().min(1).max(100),
  locale: z.string().min(2).max(16).default('en'),
  vars: z.record(z.string(), z.union([z.string(), z.number()])).default({}),
  clientId: z.string().optional(),
});
export type SendSmsByTemplateInput = z.infer<typeof sendSmsByTemplateSchema>;

export const upsertSmsTemplateSchema = z.object({
  key: z.string().min(1).max(100),
  body: z.string().min(1).max(1600),
  locale: z.string().min(2).max(16).default('en'),
  active: z.boolean().default(true),
});
export type UpsertSmsTemplateInput = z.infer<typeof upsertSmsTemplateSchema>;

export const smsTemplateSchema = z.object({
  id: z.string(),
  key: z.string(),
  body: z.string(),
  locale: z.string(),
  active: z.boolean(),
});
export type SmsTemplateDto = z.infer<typeof smsTemplateSchema>;

export const createMediaMessageSchema = z.object({
  threadId: z.string().min(1),
  kind: z.nativeEnum(MediaKind),
  storageKey: z.string().min(1),
  durationSec: z.number().int().positive(),
  mimeType: z.string().min(1),
  transcript: z.string().max(10_000).optional(),
});
export type CreateMediaMessageInput = z.infer<typeof createMediaMessageSchema>;

export const rtcTokenRequestSchema = z.object({
  sessionId: z.string().optional(),
});
export type RtcTokenInput = z.infer<typeof rtcTokenRequestSchema>;
