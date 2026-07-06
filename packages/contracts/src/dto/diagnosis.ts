import { z } from 'zod';

/**
 * Diagnosis Support DTOs (context 13). `DiagnosisHypothesis` is a
 * clinician-entered DIFFERENTIAL — never an AI-autonomous diagnosis. The
 * `hypothesis` field is deliberately free text in non-diagnostic language
 * (docs/technical/01-bounded-contexts.md ctx 13: "*Non-diagnostic*
 * differential hypotheses, referral flags"); `aiRecommendationId` may
 * optionally cite an AI Gateway suggestion the clinician is confirming or
 * overriding, but the record itself is always authored by the clinician.
 *
 * The Prisma model has no generic `status` enum — the only status-like
 * field is the boolean `clinicianConfirmed`. "Update status" (per the Wave C
 * brief) is therefore implemented as toggling that flag; see the flagged gap
 * in the module's README-equivalent (service comment) for a richer status
 * enum (e.g. ruled_out/active/confirmed) as a documented follow-up.
 */

export const createDiagnosisHypothesisSchema = z.object({
  clientId: z.string(),
  hypothesis: z.string().min(3).max(1000),
  confidence: z.number().min(0).max(1).default(0),
  evidence: z.array(z.string().max(500)).default([]),
  referralFlags: z.array(z.string().max(200)).default([]),
  aiRecommendationId: z.string().optional(),
});
export type CreateDiagnosisHypothesisInput = z.infer<typeof createDiagnosisHypothesisSchema>;

export const updateDiagnosisHypothesisStatusSchema = z.object({
  hypothesisId: z.string(),
  clinicianConfirmed: z.boolean(),
});
export type UpdateDiagnosisHypothesisStatusInput = z.infer<typeof updateDiagnosisHypothesisStatusSchema>;

export const diagnosisHypothesisSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  hypothesis: z.string(),
  confidence: z.number(),
  evidence: z.array(z.string()),
  referralFlags: z.array(z.string()),
  clinicianConfirmed: z.boolean(),
  aiRecommendationId: z.string().nullable(),
  createdAt: z.string(),
});
export type DiagnosisHypothesisDto = z.infer<typeof diagnosisHypothesisSchema>;
