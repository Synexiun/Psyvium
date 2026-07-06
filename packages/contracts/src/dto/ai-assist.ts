import { z } from 'zod';
import { SeverityBand, TherapyFormat } from '../enums';

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
});
export type TreatmentPlanAiAssistResult = z.infer<typeof treatmentPlanAiAssistResponseSchema>;
