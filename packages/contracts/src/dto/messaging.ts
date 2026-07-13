import { z } from 'zod';

/**
 * Messaging (context 14, `docs/technical/13-roadmap-and-phases.md` §Phase 2,
 * `docs/technical/15-communications-and-telephony.md` §6 for the sibling
 * async-media flow). Secure, in-platform, client↔assigned-clinician TEXT
 * threads over the `Thread`/`Message` models (`02-data-model.md` §I) — the
 * same models `MediaMessage` has used opaquely by `threadId` string since
 * Phase 3. This is the first code to treat `Thread` as a first-class,
 * ABAC-checked aggregate rather than an opaque scalar.
 *
 * Deliberately NO PHI-scrubbing/redaction here: this channel IS the clinical
 * communication itself (the point of an in-platform thread is that sensitive
 * content never has to leave the platform for SMS/email). Content is
 * protected by transport/at-rest encryption and strict participant ABAC, not
 * by hiding it from itself.
 *
 * Retention: messages may be soft-retracted by the sender within a short
 * window (`Message.deletedAt`); after that they are immutable for the clinical
 * record / audit trail.
 */

// ── Read models ──

export const messageSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  senderId: z.string(),
  body: z.string(),
  readAt: z.string().nullable().optional(),
  createdAt: z.string(),
  /** ISO timestamp when the sender soft-retracted the message; omitted/null if live. */
  deletedAt: z.string().nullable().optional(),
});
export type MessageDto = z.infer<typeof messageSchema>;

export const threadMessagePreviewSchema = z.object({
  id: z.string(),
  senderId: z.string(),
  body: z.string(),
  createdAt: z.string(),
});
export type ThreadMessagePreviewDto = z.infer<typeof threadMessagePreviewSchema>;

/**
 * `psychologistId`/`psychologistUserId` are resolved live from the client's
 * current APPROVED/ACTIVE `Assignment` — `Thread` itself only stores
 * `clientId` (`02-data-model.md` §I), so a thread's counterpart clinician
 * always tracks the client's *current* assignment (e.g. after a transfer)
 * rather than being frozen at thread-creation time.
 */
export const threadSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  psychologistId: z.string(),
  subject: z.string().nullable().optional(),
  createdAt: z.string(),
  lastMessage: threadMessagePreviewSchema.nullable().optional(),
  unreadCount: z.number().int().nonnegative(),
});
export type ThreadDto = z.infer<typeof threadSchema>;

// ── Write models ──

/**
 * `clientId`/`psychologistId` disambiguate the counterpart for a caller who
 * has more than one possible relationship (a PSYCHOLOGIST/MANAGER must name
 * the client; a CLIENT may omit both — their own client record + current
 * assignment resolve unambiguously). Either way, the server-verified ACTIVE
 * assignment is the only source of truth — a caller cannot open a thread
 * with an unassigned/stranger counterpart no matter what ids are supplied.
 */
export const createThreadSchema = z.object({
  clientId: z.string().min(1).optional(),
  psychologistId: z.string().min(1).optional(),
});
export type CreateThreadInput = z.infer<typeof createThreadSchema>;

export const sendMessageSchema = z.object({
  body: z.string().min(1).max(5_000),
});
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const listMessagesQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>;

export const paginatedMessagesSchema = z.object({
  messages: z.array(messageSchema),
  nextCursor: z.string().nullable().optional(),
});
export type PaginatedMessagesDto = z.infer<typeof paginatedMessagesSchema>;
