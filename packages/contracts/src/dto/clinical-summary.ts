import { z } from 'zod';
import { SeverityBand } from '../enums';
import { wearableRollupSchema } from './wearable';

/**
 * Read-model DTOs for the flagship client/clinician dashboards. These are
 * deliberately flat, pre-aggregated shapes assembled server-side from several
 * bounded contexts (Clients, Matching, Treatment Planning, Psychometrics,
 * Outcomes, Clinical Documentation, Wearables) — the frontend renders them
 * directly with no further joining.
 */

export const clinicalSummaryClientSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  riskLevel: z.nativeEnum(SeverityBand),
  preferredLanguage: z.string(),
});

export const clinicalSummaryAppointmentSchema = z.object({
  id: z.string(),
  startsAt: z.string(),
  format: z.string(),
});

export const clinicalSummaryGoalSchema = z.object({
  id: z.string(),
  description: z.string(),
  targetMetric: z.string().nullable(),
  progressPct: z.number(),
  status: z.string(),
});

export const clinicalSummaryPlanSchema = z.object({
  id: z.string(),
  status: z.string(),
  version: z.number().int(),
  clientAcknowledgedAt: z.string().nullable().optional(),
  goals: z.array(clinicalSummaryGoalSchema),
});

export const clinicalSummaryAssessmentSchema = z.object({
  id: z.string(),
  rawScore: z.number().nullable(),
  severityBand: z.nativeEnum(SeverityBand).nullable(),
  interpretation: z.string().nullable(),
  completedAt: z.string(),
});

export const clinicalSummaryOutcomeTrendSchema = z.object({
  direction: z.enum(['increased', 'decreased', 'unchanged', 'baseline']),
  delta: z.number().nullable(),
});

export const clinicalSummaryOutcomeSchema = z.object({
  construct: z.string(),
  value: z.number(),
  occurredAt: z.string(),
  trend: clinicalSummaryOutcomeTrendSchema,
});

export const clinicalSummaryNoteSchema = z.object({
  id: z.string(),
  signedAt: z.string().nullable(),
  signedBy: z.string().nullable(),
  version: z.number().int(),
  excerpt: z.string(),
});

export const clinicalSummarySchema = z.object({
  client: clinicalSummaryClientSchema,
  nextAppointment: clinicalSummaryAppointmentSchema.nullable(),
  activePlan: clinicalSummaryPlanSchema.nullable(),
  latestAssessment: clinicalSummaryAssessmentSchema.nullable(),
  outcomes: z.array(clinicalSummaryOutcomeSchema),
  recentNotes: z.array(clinicalSummaryNoteSchema),
  wearable: wearableRollupSchema.nullable(),
});
export type ClinicalSummary = z.infer<typeof clinicalSummarySchema>;

export const caseloadEntrySchema = z.object({
  clientId: z.string(),
  displayName: z.string(),
  riskLevel: z.nativeEnum(SeverityBand),
  nextAppointmentAt: z.string().nullable(),
});
export type CaseloadEntry = z.infer<typeof caseloadEntrySchema>;
