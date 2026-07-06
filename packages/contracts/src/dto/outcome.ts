import { z } from 'zod';

/**
 * Outcomes DTOs. Recording a measure returns a simple, deterministic trend —
 * the delta vs. the client's previous measure for the same construct. Since
 * polarity (whether a higher value is clinically better or worse) is
 * construct-specific and not modeled here, the trend reports a neutral
 * direction (increased/decreased/unchanged) rather than a value judgement.
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
