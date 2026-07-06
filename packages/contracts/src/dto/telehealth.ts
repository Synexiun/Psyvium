import { z } from 'zod';

/**
 * Telehealth (context 12, `docs/technical/08-telehealth-and-realtime.md`) —
 * the LAST unbuilt bounded context. `TeleSession` is the connectivity/media
 * lifecycle layer (waiting room -> live room -> ended), deliberately distinct
 * from the clinical `Session` (the encounter/note-anchor, `scheduling`
 * context): this module never creates or mutates a `Session` row.
 *
 * `status` is a plain, DTO-validated string (not a Prisma enum) — same
 * pattern as `IncidentReviewKind` (`dto/risk.ts`) — so a future state never
 * needs a migration.
 */
export const TeleSessionStatus = {
  SCHEDULED: 'SCHEDULED',
  WAITING_ROOM: 'WAITING_ROOM',
  IN_PROGRESS: 'IN_PROGRESS',
  ENDED: 'ENDED',
  CANCELLED: 'CANCELLED',
} as const;
export type TeleSessionStatus = (typeof TeleSessionStatus)[keyof typeof TeleSessionStatus];

/**
 * Append-only participant-event log (doc §5/§6): every lifecycle transition
 * — join, admit, waiting-room entry, end — is pushed onto `TeleSession.
 * participantEvents`, never overwritten. `who` is the participant ROLE, not a
 * user id, since a TeleSession only ever has these two seats.
 */
export const teleSessionParticipantEventSchema = z.object({
  who: z.enum(['CLIENT', 'PSYCHOLOGIST']),
  event: z.string(),
  at: z.string(),
});
export type TeleSessionParticipantEvent = z.infer<typeof teleSessionParticipantEventSchema>;

export const teleSessionSchema = z.object({
  id: z.string(),
  appointmentId: z.string(),
  clientId: z.string(),
  psychologistId: z.string(),
  roomName: z.string(),
  status: z.nativeEnum(TeleSessionStatus),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  participantEvents: z.array(teleSessionParticipantEventSchema),
  createdAt: z.string(),
});
export type TeleSessionDto = z.infer<typeof teleSessionSchema>;

// ── Write models ──

/**
 * Creates a TeleSession from an already-booked `Appointment`. The caller
 * must be a participant on that appointment (the client or the assigned
 * psychologist) and the client must hold a current, non-revoked
 * `TELEPSYCHOLOGY` consent (doc §7 — the pre-media consent gate) or this
 * 409s before any room is minted.
 */
export const createTeleSessionSchema = z.object({
  appointmentId: z.string().min(1),
});
export type CreateTeleSessionInput = z.infer<typeof createTeleSessionSchema>;

/**
 * A room-scoped, identity-bound, short-TTL (15 min) LiveKit join token (doc
 * §14 HIPAA safeguards — "session-scoped RTC tokens"). Only ever minted by
 * the `LiveKitAdapter` when `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET`/
 * `LIVEKIT_URL` are all configured — never fabricated.
 */
export const liveKitTokenSchema = z.object({
  token: z.string(),
  url: z.string(),
  roomName: z.string(),
  expiresAt: z.string(),
});
export type LiveKitTokenDto = z.infer<typeof liveKitTokenSchema>;

/**
 * Result of a join/admit call: the current session state, plus a token IF
 * one was minted this call (a CLIENT's first join lands them in the waiting
 * room with `token: null` — authed but no media, doc §6 — until a
 * psychologist admits them).
 */
export const teleSessionJoinResultSchema = z.object({
  session: teleSessionSchema,
  token: liveKitTokenSchema.nullable(),
});
export type TeleSessionJoinResult = z.infer<typeof teleSessionJoinResultSchema>;
