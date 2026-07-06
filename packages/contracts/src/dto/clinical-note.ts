import { z } from 'zod';

/**
 * Clinical Documentation DTOs. Session notes are structured SOAP or DAP JSON.
 * A signed note is immutable — signing only ever sets signedAt/signedBy on that
 * row. Any subsequent edit is recorded as the next `version` for the same
 * session rather than mutating an existing row, so the record is append-only
 * regardless of signature state.
 */

export const soapNoteContentSchema = z.object({
  format: z.literal('SOAP'),
  subjective: z.string().max(4000),
  objective: z.string().max(4000),
  assessment: z.string().max(4000),
  plan: z.string().max(4000),
});

export const dapNoteContentSchema = z.object({
  format: z.literal('DAP'),
  data: z.string().max(4000),
  assessment: z.string().max(4000),
  plan: z.string().max(4000),
});

/** Free-text narrative note — the common quick-note case and what the clinician UI files. */
export const narrativeNoteContentSchema = z.object({
  format: z.literal('narrative'),
  narrative: z.string().min(1).max(8000),
});

export const sessionNoteContentSchema = z.discriminatedUnion('format', [
  soapNoteContentSchema,
  dapNoteContentSchema,
  narrativeNoteContentSchema,
]);
export type SessionNoteContent = z.infer<typeof sessionNoteContentSchema>;

export const createSessionNoteSchema = z.object({
  sessionId: z.string(),
  content: sessionNoteContentSchema,
  continuitySummary: z.string().max(2000).optional(),
});
export type CreateSessionNoteInput = z.infer<typeof createSessionNoteSchema>;

export const sessionNoteSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  content: sessionNoteContentSchema,
  continuitySummary: z.string().nullable(),
  signedAt: z.string().nullable(),
  signedBy: z.string().nullable(),
  version: z.number().int(),
  createdAt: z.string(),
});
export type SessionNoteDto = z.infer<typeof sessionNoteSchema>;
