import { z } from 'zod';

/**
 * Outcomes DTOs. Recording a measure returns a deterministic trend — the raw
 * delta vs. the client's previous measure for the same construct, PLUS the
 * Reliable Change Index (Jacobson & Truax, 1991) so a raw delta is never
 * mistaken for a clinically-reliable change. Since polarity (whether a higher
 * value is clinically better or worse) is construct-specific, `direction`
 * itself stays a neutral increased/decreased/unchanged/baseline read; the
 * value judgement lives in `classification`, which IS direction-aware for the
 * constructs whose psychometrics (SD, reliability) are known (see the
 * constants map in outcomes.service.ts — never fabricated for unknown
 * constructs).
 */

export const recordOutcomeMeasureSchema = z.object({
  clientId: z.string(),
  construct: z.string().min(2).max(100),
  value: z.number(),
  dropoutRisk: z.number().min(0).max(1).optional(),
  deteriorationRisk: z.number().min(0).max(1).optional(),
  relapseRisk: z.number().min(0).max(1).optional(),
});
export type RecordOutcomeMeasureInput = z.infer<typeof recordOutcomeMeasureSchema>;

export const outcomeTrendSchema = z.object({
  direction: z.enum(['increased', 'decreased', 'unchanged', 'baseline']),
  delta: z.number().nullable(),
  previousValue: z.number().nullable(),
  /**
   * Reliable Change Index = (score2 - score1) / SE_diff, SE_diff = SEM *
   * sqrt(2), SEM = SD * sqrt(1 - reliability). `null` whenever there is no
   * prior measure to compare against, or the construct's psychometrics are
   * not in the known-constructs table (see outcomes.service.ts) — we never
   * fabricate an SD/reliability to force a number out.
   */
  rci: z.number().nullable(),
  /**
   * Jacobson-Truax classification: |rci| >= 1.96 is a reliable change at the
   * 95% CI; direction-aware (a decrease is "improved" for lower-is-better
   * symptom scales such as PHQ-9/GAD-7). `'baseline'` when there's no prior
   * measure; `'unknown-reliability'` is the honest fallback for a construct
   * with no known SD/reliability on file.
   */
  classification: z.enum([
    'reliably-improved',
    'reliably-worsened',
    'no-reliable-change',
    'unknown-reliability',
    'baseline',
  ]),
});
export type OutcomeTrend = z.infer<typeof outcomeTrendSchema>;

export const outcomeMeasureSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  construct: z.string(),
  value: z.number(),
  therapeuticResponse: z.string(),
  occurredAt: z.string(),
  trend: outcomeTrendSchema,
});
export type OutcomeMeasureDto = z.infer<typeof outcomeMeasureSchema>;
