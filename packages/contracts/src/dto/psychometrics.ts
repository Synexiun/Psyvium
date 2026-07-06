import { z } from 'zod';
import { SeverityBand } from '../enums';

/**
 * Psychometrics DTOs. Administering a response computes a PsychometricScore
 * deterministically via classical (raw-sum) scoring against the published
 * QuestionnaireVersion's `cutoffs` JSON — AI never touches this path, so
 * severity banding is reproducible and auditable. `cutoffs.bands` must be an
 * exhaustive set of inclusive [min, max] raw-score ranges.
 */

export const severityCutoffSchema = z.object({
  band: z.nativeEnum(SeverityBand),
  min: z.number(),
  max: z.number(),
});
export type SeverityCutoff = z.infer<typeof severityCutoffSchema>;

export const questionnaireCutoffsSchema = z.object({
  bands: z.array(severityCutoffSchema).min(1),
});
export type QuestionnaireCutoffs = z.infer<typeof questionnaireCutoffsSchema>;

export const administerResponseSchema = z.object({
  versionId: z.string(),
  clientId: z.string(),
  answers: z.record(z.string(), z.number()),
  responseTimeMs: z.number().int().min(0).optional(),
});
export type AdministerResponseInput = z.infer<typeof administerResponseSchema>;

export const psychometricScoreSchema = z.object({
  id: z.string(),
  responseId: z.string(),
  rawScore: z.number().nullable(),
  severityBand: z.nativeEnum(SeverityBand).nullable(),
  interpretation: z.string().nullable(),
  createdAt: z.string(),
});
export type PsychometricScoreDto = z.infer<typeof psychometricScoreSchema>;

export const questionnaireResponseSchema = z.object({
  id: z.string(),
  versionId: z.string(),
  clientId: z.string(),
  answers: z.record(z.string(), z.number()),
  completedAt: z.string(),
  score: psychometricScoreSchema.nullable(),
});
export type QuestionnaireResponseDto = z.infer<typeof questionnaireResponseSchema>;
