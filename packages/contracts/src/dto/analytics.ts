import { z } from 'zod';

/**
 * Analytics DTOs (`docs/technical/13-roadmap-and-phases.md`, contexts 27 Reports
 * / 28 National Analytics, Phase 6 — "Operational + clinical reporting,
 * exports" and "De-identified, aggregate population insights for
 * Government/Executive"). This is the SHARED CONTRACT the web cockpit is
 * built against.
 *
 * Money crosses the wire as a **decimal string** (never a JS number), matching
 * the Finance module's convention (`dto/finance.ts`) — the server always
 * computes with `Prisma.Decimal`. Timestamps are UTC ISO-8601 strings.
 *
 * NATIONAL ANALYTICS DE-IDENTIFICATION GUARANTEE: `NationalAnalyticsDto` never
 * carries an individually-identifying value. Any `PopulationMetric` whose
 * `cohortSize` is below `kAnonymityFloor` is emitted with `value: null` and
 * `suppressed: true` — the underlying aggregate is never serialized. There is
 * no re-identification path through this contract.
 */

const moneyString = z.string().regex(/^-?\d+(\.\d+)?$/, 'must be a decimal string');

// ── Reports (ctx 27) ──

export const executiveReportSchema = z.object({
  generatedAt: z.string(),
  currency: z.string(),
  revenue: z.object({
    paidTotal: moneyString,
    outstanding: moneyString,
    payoutsPending: moneyString,
  }),
  clients: z.object({
    total: z.number(),
    active: z.number(),
  }),
  clinicians: z.object({
    count: z.number(),
    avgOutcomeIndex: z.number(),
  }),
  outcomes: z.object({
    measureCount: z.number(),
    avgValue: z.number().nullable(),
  }),
});
export type ExecutiveReportDto = z.infer<typeof executiveReportSchema>;

export const managerReportSchema = z.object({
  generatedAt: z.string(),
  intakes: z.object({
    total: z.number(),
    bySeverity: z.object({
      LOW: z.number(),
      MODERATE: z.number(),
      HIGH: z.number(),
      SEVERE: z.number(),
    }),
  }),
  assignments: z.object({
    proposed: z.number(),
    approved: z.number(),
  }),
  risk: z.object({
    openEscalations: z.number(),
    openFlags: z.number(),
  }),
  appointments: z.object({
    upcoming: z.number(),
    noShows: z.number(),
  }),
});
export type ManagerReportDto = z.infer<typeof managerReportSchema>;

// ── National Analytics (ctx 28) ──

export const nationalMetricSchema = z.object({
  region: z.string(),
  metric: z.string(),
  value: z.number().nullable(),
  unit: z.string().nullable(),
  window: z.string(),
  cohortSize: z.number(),
  suppressed: z.boolean(),
});
export type NationalMetricDto = z.infer<typeof nationalMetricSchema>;

export const nationalAnalyticsSchema = z.object({
  generatedAt: z.string(),
  kAnonymityFloor: z.number(),
  metrics: z.array(nationalMetricSchema),
});
export type NationalAnalyticsDto = z.infer<typeof nationalAnalyticsSchema>;
