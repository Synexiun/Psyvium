import { z } from 'zod';
import { HumanDecision, SeverityBand, TherapyFormat } from '../enums';

/**
 * AI-assist DTOs for two more governed agents from docs/technical/05-ai-clinical-layer.md
 * §3: the Session-Note Assistant (§3.4) and Treatment-Plan Support (§3.3).
 *
 * PHI MINIMIZATION: every request schema here carries ONLY de-identified,
 * coded/structured signals (enum bands, theme codes, ids, booleans) — never
 * raw free-text notes, narratives, or client identifiers. Response schemas
 * are always assistive/non-diagnostic drafts or suggestions; nothing here
 * writes to, signs, or activates a clinical record — a licensed clinician
 * always reviews and decides (ADR-007).
 */

// ── Session-Note Assistant (§3.4, hook `note-compose`) ──

export const sessionNoteAiAssistRequestSchema = z.object({
  sessionId: z.string(),
  sessionType: z.nativeEnum(TherapyFormat).default(TherapyFormat.INDIVIDUAL),
  /** Coded presenting-theme tags only (e.g. "anxiety-worry", "sleep") — never free text. */
  presentingThemeCodes: z.array(z.string().max(50)).max(10).default([]),
  /** Whether a safety/risk signal is open for this client — never risk narrative detail. */
  riskPresent: z.boolean().default(false),
  /** Ids of active treatment-plan goals in scope for this session — no goal text required. */
  planGoalIds: z.array(z.string()).max(20).default([]),
});
export type SessionNoteAiAssistInput = z.infer<typeof sessionNoteAiAssistRequestSchema>;

/** Structural SOAP prompts, not fabricated narrative — the clinician supplies all content. */
export const sessionNoteDraftScaffoldSchema = z.object({
  subjective: z.string(),
  objective: z.string(),
  assessment: z.string(),
  plan: z.string(),
});
export type SessionNoteDraftScaffold = z.infer<typeof sessionNoteDraftScaffoldSchema>;

export const sessionNoteAiAssistResponseSchema = z.object({
  watermark: z.literal('AI-DRAFT — unsigned; clinician review and edit required before signing'),
  draft: sessionNoteDraftScaffoldSchema,
  source: z.enum(['ai', 'rule-based']),
  aiConfigured: z.boolean(),
  recommendationId: z.string().optional(),
  /**
   * WAVE CR — set when a real model call was skipped because the client has
   * no non-revoked `AI_ASSISTED_ANALYSIS` consent (source stays 'rule-based';
   * the model client is never invoked). Absent when AI simply isn't
   * configured or the client has consented.
   */
  withheldReason: z.enum(['no-ai-consent', 'feature-disabled']).optional(),
});
export type SessionNoteAiAssistResult = z.infer<typeof sessionNoteAiAssistResponseSchema>;

// ── Treatment-Plan Support (§3.3, hook `plan-update`) ──

export const treatmentPlanAiAssistRequestSchema = z.object({
  clientId: z.string(),
  severityBand: z.nativeEnum(SeverityBand),
  specialty: z.string().max(100),
  /** Direction of the primary outcome-construct trend only — never raw scores/dates. */
  outcomeTrend: z.enum(['improving', 'stable', 'declining', 'insufficient-data']).default('insufficient-data'),
});
export type TreatmentPlanAiAssistInput = z.infer<typeof treatmentPlanAiAssistRequestSchema>;

/** Options only, never prescriptive — the clinician composes the actual CarePlan. */
export const treatmentPlanSuggestionsSchema = z.object({
  goalSuggestions: z.array(z.string()),
  interventionSuggestions: z.array(z.string()),
  measurementCadenceSuggestion: z.string(),
});
export type TreatmentPlanSuggestions = z.infer<typeof treatmentPlanSuggestionsSchema>;

export const treatmentPlanAiAssistResponseSchema = z.object({
  suggestions: treatmentPlanSuggestionsSchema,
  source: z.enum(['ai', 'rule-based']),
  aiConfigured: z.boolean(),
  recommendationId: z.string().optional(),
  /**
   * WAVE CR — set when a real model call was skipped because the client has
   * no non-revoked `AI_ASSISTED_ANALYSIS` consent (source stays 'rule-based';
   * the model client is never invoked). Absent when AI simply isn't
   * configured or the client has consented.
   */
  withheldReason: z.enum(['no-ai-consent', 'feature-disabled']).optional(),
});
export type TreatmentPlanAiAssistResult = z.infer<typeof treatmentPlanAiAssistResponseSchema>;

/**
 * Wave C completion — the 5 remaining governed agents from doc 05 §3:
 * Differential Hypothesis (§3.2), Outcome Intelligence (§3.5), Psychometric
 * Interpretation (§3.7), Crisis context-assembly (§3.6), and the Allocation
 * rationale extension (§3.8). Same PHI-minimization / activate-on-key /
 * honest-degradation / AI-consent-gate / PENDING-AIRecommendation contract as
 * the three agents above.
 */

// ── Differential Hypothesis (§3.2, hook `dx-support`) ──

export const differentialAiAssistRequestSchema = z.object({
  clientId: z.string(),
  severityBand: z.nativeEnum(SeverityBand),
  specialty: z.string().max(100),
  /** Coded elevated-screening-domain tags only (e.g. "depression", "anxiety") — never free text. */
  screeningDomainsElevated: z.array(z.string().max(50)).max(10).default([]),
});
export type DifferentialAiAssistInput = z.infer<typeof differentialAiAssistRequestSchema>;

/** One hedged, non-diagnostic differential DIRECTION — never a diagnosis. */
export const differentialDirectionSchema = z.object({
  direction: z.string(),
  rationale: z.string(),
});
export type DifferentialDirection = z.infer<typeof differentialDirectionSchema>;

export const differentialAiAssistResponseSchema = z.object({
  /** Anti-anchoring rule (doc 05 §3.2): ALWAYS >= 2 competing directions — never a single answer. */
  directions: z.array(differentialDirectionSchema).min(2),
  source: z.enum(['ai', 'rule-based']),
  aiConfigured: z.boolean(),
  recommendationId: z.string().optional(),
  withheldReason: z.enum(['no-ai-consent', 'feature-disabled']).optional(),
});
export type DifferentialAiAssistResult = z.infer<typeof differentialAiAssistResponseSchema>;

// ── Outcome Intelligence (§3.5, hook `outcome-review`) ──

/**
 * `rciClassification`/`direction` mirror `OutcomesService`'s deterministic
 * Reliable Change Index output (`dto/outcome.ts` `OutcomeTrend`) — the AI
 * layer only narrates an ALREADY-COMPUTED classification, never recomputes
 * or overrides it.
 */
export const outcomeAiAssistRequestSchema = z.object({
  clientId: z.string(),
  construct: z.string().max(100),
  rciClassification: z.enum([
    'baseline',
    'unknown-reliability',
    'no-reliable-change',
    'reliably-improved',
    'reliably-worsened',
  ]),
  direction: z.enum(['baseline', 'unchanged', 'increased', 'decreased']),
  /** Count of measures in the series only — never raw scores or dates. */
  nPoints: z.number().int().nonnegative(),
});
export type OutcomeAiAssistInput = z.infer<typeof outcomeAiAssistRequestSchema>;

export const outcomeAiAssistResponseSchema = z.object({
  narrative: z.string(),
  source: z.enum(['ai', 'rule-based']),
  aiConfigured: z.boolean(),
  recommendationId: z.string().optional(),
  withheldReason: z.enum(['no-ai-consent', 'feature-disabled']).optional(),
});
export type OutcomeAiAssistResult = z.infer<typeof outcomeAiAssistResponseSchema>;

// ── Psychometric Interpretation (§3.7, hook `score-review`) — CLINICIAN ONLY ──
// No request body: the target score is identified by the `:id` path param
// (`POST /assessments/scores/:id/ai-interpret`) and every signal sent to the
// model is derived server-side from the already-computed, deterministic
// PsychometricScore row — never re-scored, never overridden by AI.

export const psychometricAiAssistResponseSchema = z.object({
  interpretation: z.string(),
  source: z.enum(['ai', 'rule-based']),
  aiConfigured: z.boolean(),
  recommendationId: z.string().optional(),
  withheldReason: z.enum(['no-ai-consent', 'feature-disabled']).optional(),
});
export type PsychometricAiAssistResult = z.infer<typeof psychometricAiAssistResponseSchema>;

// ── Crisis context-assembly (§3.6, hook `risk-context`) ──
// Risk DETECTION is entirely deterministic and lives in the Risk & Crisis
// context (out of scope here). This agent only ASSEMBLES a brief situational
// summary for the human responder AFTER a RiskFlag/Escalation already
// exists — advisory only; the assigned clinician/manager decides and acts.

export const riskContextAiAssistRequestSchema = z.object({
  clientId: z.string(),
  riskFlagId: z.string(),
  severity: z.nativeEnum(SeverityBand),
  riskType: z.string().max(100),
  openEscalations: z.number().int().nonnegative(),
  hasActiveSafetyPlan: z.boolean(),
  slaDueInMinutes: z.number().int(),
});
export type RiskContextAiAssistInput = z.infer<typeof riskContextAiAssistRequestSchema>;

export const riskContextAiAssistResponseSchema = z.object({
  summary: z.string(),
  source: z.enum(['ai', 'rule-based']),
  aiConfigured: z.boolean(),
  recommendationId: z.string().optional(),
  withheldReason: z.enum(['no-ai-consent', 'feature-disabled']).optional(),
});
export type RiskContextAiAssistResult = z.infer<typeof riskContextAiAssistResponseSchema>;

// ── Allocation rationale (§3.8 extension) ──
// The RANKING itself stays the deterministic sort MatchingService computes —
// the model NEVER reorders candidates. This is a SHORT assistive rationale
// note per top-3 candidate only, derived from coded score-component signals.

export const allocationRationaleSchema = z.object({
  psychologistId: z.string(),
  rationale: z.string(),
});
export type AllocationRationale = z.infer<typeof allocationRationaleSchema>;

// ── Human decision gate (ADR-007 / doc 05) ──
// Every AIRecommendation is born PENDING. A licensed clinician records the
// terminal decision here — never auto-accepted.

const terminalHumanDecision = z.enum([
  HumanDecision.ACCEPTED,
  HumanDecision.MODIFIED,
  HumanDecision.REJECTED,
]);

export const decideAiRecommendationSchema = z.object({
  decision: terminalHumanDecision,
  /** Required when decision is MODIFIED — free-text clinician amendment note. */
  modificationNote: z.string().min(3).max(2000).optional(),
  /** Optional free-text rationale for ACCEPTED/REJECTED (audited). */
  rationale: z.string().max(2000).optional(),
}).superRefine((value, ctx) => {
  if (value.decision === HumanDecision.MODIFIED && !value.modificationNote?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['modificationNote'],
      message: 'modificationNote is required when decision is MODIFIED',
    });
  }
});
export type DecideAiRecommendationInput = z.infer<typeof decideAiRecommendationSchema>;

export const aiRecommendationDtoSchema = z.object({
  id: z.string(),
  agent: z.string(),
  confidence: z.number(),
  humanDecision: z.nativeEnum(HumanDecision),
  decidedBy: z.string().nullable(),
  linkedEntityType: z.string().nullable(),
  linkedEntityId: z.string().nullable(),
  output: z.unknown(),
  createdAt: z.string(),
});
export type AiRecommendationDto = z.infer<typeof aiRecommendationDtoSchema>;
