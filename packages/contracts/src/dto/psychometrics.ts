import { z } from 'zod';
import { IrtModel, SeverityBand } from '../enums';

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

/**
 * Optional finer-grained tier *within* one of the four `SeverityBand` values
 * (WAVE CR — "PHQ-9 5-tier collapse"). The shared `SeverityBand` enum stays
 * 4-valued (LOW/MODERATE/HIGH/SEVERE, out of scope to widen); instruments whose
 * source convention distinguishes a tier inside SEVERE (e.g. the published
 * 9-item-depression-screen convention's "moderately severe" 15-19 vs "severe"
 * 20-27, Kroenke et al. 2001) document it here as informational sub-bands.
 * `ScoringService` surfaces the matching sub-band `label` in the persisted
 * interpretation text so the distinction reaches the clinician, not just the
 * JSON — never a silent metadata-only annotation.
 */
export const subBandSchema = z.object({
  parentBand: z.nativeEnum(SeverityBand),
  label: z.string(),
  min: z.number(),
  max: z.number(),
});
export type SubBand = z.infer<typeof subBandSchema>;

export const questionnaireCutoffsSchema = z.object({
  bands: z.array(severityCutoffSchema).min(1),
  subBands: z.array(subBandSchema).optional(),
});
export type QuestionnaireCutoffs = z.infer<typeof questionnaireCutoffsSchema>;

export const administerResponseSchema = z.object({
  versionId: z.string(),
  clientId: z.string(),
  answers: z.record(z.string(), z.number()),
  responseTimeMs: z.number().int().min(0).optional(),
});
export type AdministerResponseInput = z.infer<typeof administerResponseSchema>;

/**
 * IRT item parameters (docs/technical/07-psychometrics-engine.md §3/§5).
 * Deterministic scoring inputs: `a` (discrimination), `b` (difficulty,
 * dichotomous models), ordered `thresholds` (GRM category boundaries) and
 * `c` (lower asymptote / guessing, 3PL only). Constraints are enforced here
 * so a mis-calibrated row fails LOUDLY instead of silently producing a wrong
 * theta — a wrong IRT score is worse than none:
 *  - RASCH fixes a = 1 (a stored RASCH row with a ≠ 1 is a calibration error).
 *  - c is only meaningful (and required) for THREE_PL, and must lie in [0, 1).
 *  - GRM requires ≥ 1 strictly increasing thresholds; dichotomous models must
 *    not carry thresholds.
 */
export const irtItemParameterSchema = z
  .object({
    model: z.nativeEnum(IrtModel),
    a: z.number().finite().positive(),
    b: z.number().finite(),
    c: z.number().finite().min(0).lt(1).nullish(),
    thresholds: z.array(z.number().finite()).default([]),
  })
  .superRefine((p, ctx) => {
    if (p.model === IrtModel.RASCH && p.a !== 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'RASCH requires a = 1' });
    }
    if (p.model === IrtModel.THREE_PL && (p.c === null || p.c === undefined)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'THREE_PL requires a guessing parameter c in [0, 1)' });
    }
    if (p.model !== IrtModel.THREE_PL && p.c !== null && p.c !== undefined && p.c !== 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `c (guessing) is only valid for THREE_PL, got model ${p.model}` });
    }
    if (p.model === IrtModel.GRM) {
      if (p.thresholds.length < 1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'GRM requires at least one threshold' });
      }
      for (let i = 1; i < p.thresholds.length; i++) {
        if (p.thresholds[i]! <= p.thresholds[i - 1]!) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'GRM thresholds must be strictly increasing' });
          break;
        }
      }
    } else if (p.thresholds.length > 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `thresholds are only valid for GRM, got model ${p.model}` });
    }
  });
export type IrtItemParameter = z.infer<typeof irtItemParameterSchema>;

/** EAP scoring output: latent-trait estimate + posterior SD on the N(0,1) metric. */
export const irtScoreResultSchema = z.object({
  thetaEstimate: z.number(),
  standardError: z.number().positive(),
  reliabilityAtTheta: z.number().min(0).max(1),
  percentile: z.number().min(0).max(100),
  itemsUsed: z.number().int().positive(),
  irtModelsUsed: z.array(z.nativeEnum(IrtModel)),
});
export type IrtScoreResult = z.infer<typeof irtScoreResultSchema>;

export const psychometricScoreSchema = z.object({
  id: z.string(),
  responseId: z.string(),
  rawScore: z.number().nullable(),
  // IRT latent-trait estimate + its standard error (null on the classical path).
  thetaEstimate: z.number().nullable(),
  standardError: z.number().nullable(),
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

/**
 * Item-translation provenance (docs/technical/07-psychometrics-engine.md §9;
 * WAVE CR). A translation only reaches `status: "validated"` after a real
 * translation-validation study (forward-back-translation + cognitive
 * interviewing, COSMIN / Standards Ch.3) — never on creation.
 */
export const itemTranslationProvenanceSchema = z.object({
  method: z.string(),
  translator: z.string().optional(),
  backTranslator: z.string().optional(),
  cognitiveInterviewN: z.number().int().nonnegative().optional(),
  status: z.enum(['draft', 'validated']),
});
export type ItemTranslationProvenance = z.infer<typeof itemTranslationProvenanceSchema>;

/**
 * `translationStatus` on the read path served to the assessment UI
 * (`GET /assessments/versions/:id/items`):
 *  - `"source"` — no locale requested (or the source/English locale itself).
 *  - `"validated"` — a translation row exists for the requested locale AND
 *    its provenance status is `"validated"`.
 *  - `"unvalidated-source-language"` — the requested locale has no
 *    translation row, or only a `"draft"` one; the source-language stem is
 *    served instead, honestly marked as not yet a validated translation
 *    (never silently presented as localized).
 */
export const translationStatusSchema = z.enum(['source', 'validated', 'unvalidated-source-language']);
export type TranslationStatus = z.infer<typeof translationStatusSchema>;

export const assessmentItemSchema = z.object({
  id: z.string(),
  linkId: z.string().nullable(),
  stem: z.string(),
  responseOptions: z.unknown(),
  orderIndex: z.number(),
  locale: z.string(),
  translationStatus: translationStatusSchema,
});
export type AssessmentItemDto = z.infer<typeof assessmentItemSchema>;

export const versionItemsResponseSchema = z.object({
  versionId: z.string(),
  locale: z.string(),
  items: z.array(assessmentItemSchema),
});
export type VersionItemsResponseDto = z.infer<typeof versionItemsResponseSchema>;
