import { z } from 'zod';

/**
 * Wearables longitudinal-signal DTOs. Metrics are ingested one at a time from
 * the client's connected device (Apple Health, Google Fit, Fitbit, Oura,
 * Garmin, ...) and rolled up into a windowed summary for the clinician/client
 * dashboards. This is context, not diagnosis: the rollup never asserts a
 * clinical interpretation, only a plain-language observation of recent trend.
 */

export const wearableMetricKindSchema = z.enum([
  'hr',
  'hrv',
  'sleep_minutes',
  'rhr',
  'steps',
  'respiratory_rate',
  'skin_temp',
  'stress',
]);
export type WearableMetricKind = z.infer<typeof wearableMetricKindSchema>;

export const recordWearableMetricSchema = z.object({
  clientId: z.string(),
  deviceId: z.string().optional(),
  kind: wearableMetricKindSchema,
  value: z.number(),
  unit: z.string().max(20).optional(),
  recordedAt: z.string().datetime(),
});
export type RecordWearableMetricInput = z.infer<typeof recordWearableMetricSchema>;

export const wearableMetricSchema = z.object({
  id: z.string(),
  deviceId: z.string(),
  kind: wearableMetricKindSchema,
  value: z.number(),
  unit: z.string().nullable(),
  recordedAt: z.string(),
});
export type WearableMetricDto = z.infer<typeof wearableMetricSchema>;

export const wearableSeriesPointSchema = z.object({
  date: z.string(),
  hrvMs: z.number().nullable(),
  sleepHours: z.number().nullable(),
});
export type WearableSeriesPoint = z.infer<typeof wearableSeriesPointSchema>;

export const wearableRollupSchema = z.object({
  windowDays: z.number().int(),
  avgHrvMs: z.number().nullable(),
  avgSleepHours: z.number().nullable(),
  restingHrBpm: z.number().nullable(),
  arousalNote: z.string(),
  series: z.array(wearableSeriesPointSchema),
});
export type WearableRollup = z.infer<typeof wearableRollupSchema>;
