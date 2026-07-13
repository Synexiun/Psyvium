import { z } from 'zod';

/**
 * Clinical Documentation DTOs. Session notes are structured SOAP or DAP JSON.
 * A signed note is immutable — signing only ever sets signedAt/signedBy on that
 * row. Any subsequent edit is recorded as the next `version` for the same
 * session rather than mutating an existing row, so the record is append-only
 * regardless of signature state.
 */

/** Optional clinical-quality checklist items (assistive documentation excellence). */
export const noteQualityChecklistSchema = z
  .record(z.union([z.boolean(), z.string()]))
  .optional();

export const soapNoteContentSchema = z.object({
  format: z.literal('SOAP'),
  subjective: z.string().max(4000),
  objective: z.string().max(4000),
  assessment: z.string().max(4000),
  plan: z.string().max(4000),
  qualityChecklist: noteQualityChecklistSchema,
});

export const dapNoteContentSchema = z.object({
  format: z.literal('DAP'),
  data: z.string().max(4000),
  assessment: z.string().max(4000),
  plan: z.string().max(4000),
  qualityChecklist: noteQualityChecklistSchema,
});

/** Free-text narrative note — the common quick-note case and what the clinician UI files. */
export const narrativeNoteContentSchema = z.object({
  format: z.literal('narrative'),
  narrative: z.string().min(1).max(8000),
  qualityChecklist: noteQualityChecklistSchema,
});

export const sessionNoteContentSchema = z.discriminatedUnion('format', [
  soapNoteContentSchema,
  dapNoteContentSchema,
  narrativeNoteContentSchema,
]);
export type SessionNoteContent = z.infer<typeof sessionNoteContentSchema>;

/**
 * WAVE CR item 8 — golden-thread enforcement (docs/10-10-PROGRAM.md): CMS/
 * Medicaid audit standard that diagnosis -> plan -> note is traceable.
 * `planId`/`goalIds` are the caller-supplied thread anchors; the service
 * requires them when the client has an ACTIVE TreatmentPlan (400 otherwise)
 * and honestly flags `sessionSnapshot.goldenThread: 'no-active-plan'` when
 * there is none to anchor to. `formulationId` optionally cites the coded
 * diagnosis the session addressed. `amendsVersionId`/`amendmentReason` are
 * the WAVE CR P1 amendment-semantics fields — the service requires a reason
 * whenever the session already has a prior SIGNED note.
 */
export const createSessionNoteSchema = z.object({
  sessionId: z.string(),
  content: sessionNoteContentSchema,
  continuitySummary: z.string().max(2000).optional(),
  planId: z.string().optional(),
  goalIds: z.array(z.string()).default([]),
  formulationId: z.string().optional(),
  amendsVersionId: z.string().optional(),
  amendmentReason: z.string().max(2000).optional(),
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
  planId: z.string().nullable(),
  goalIds: z.array(z.string()),
  formulationId: z.string().nullable(),
  riskStatusAtNote: z.string().nullable(),
  sessionSnapshot: z.record(z.unknown()).nullable(),
  amendsVersionId: z.string().nullable(),
  amendmentReason: z.string().nullable(),
});
export type SessionNoteDto = z.infer<typeof sessionNoteSchema>;
