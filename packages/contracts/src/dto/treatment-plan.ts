import { z } from 'zod';

/**
 * Treatment Planning DTOs. A plan owns a set of measurable goals. Creating a
 * new plan for a client supersedes any previously active plan (a client has
 * at most one ACTIVE plan at a time) — the superseded plan is kept, never
 * deleted. Goal progress is updated independently of the plan document.
 *
 * SMART-goal enforcement (Joint Commission care-plan standard — audit finding
 * #4): every goal must be Measurable (targetMetric + baseline + target are
 * required below, not optional) so a goal can never be recorded as bare prose.
 * The Goal model (schema.prisma) has no per-goal `targetDate` column and this
 * remediation may not change the schema, so the Time-bound requirement is
 * enforced at the PLAN level instead via `reviewDate`: the service defaults
 * it to +90 days (Joint Commission's typical care-plan review cycle) when the
 * caller omits it, and `GET /treatment-plans/overdue-reviews` surfaces any
 * active plan whose reviewDate has passed.
 */

export const goalInputSchema = z.object({
  description: z.string().min(3).max(500),
  targetMetric: z.string().min(1).max(200),
  baseline: z.number(),
  target: z.number(),
});
export type GoalInput = z.infer<typeof goalInputSchema>;

export const createTreatmentPlanSchema = z.object({
  clientId: z.string(),
  problemList: z.array(z.string().max(300)).default([]),
  sessionFrequency: z.string().max(50).default('weekly'),
  measurementSchedule: z.record(z.string(), z.unknown()).default({}),
  riskPlan: z.string().max(2000).optional(),
  // Optional here — the service defaults it to +90 days when absent so every
  // plan still ends up with an enforced review cadence (see module doc above).
  reviewDate: z.string().datetime().optional(),
  goals: z.array(goalInputSchema).min(1).max(20),
});
export type CreateTreatmentPlanInput = z.infer<typeof createTreatmentPlanSchema>;

export const updateGoalProgressSchema = z.object({
  goalId: z.string(),
  progressPct: z.number().min(0).max(100),
  status: z.enum(['active', 'achieved', 'discontinued']).optional(),
});
export type UpdateGoalProgressInput = z.infer<typeof updateGoalProgressSchema>;

export const goalSchema = z.object({
  id: z.string(),
  planId: z.string(),
  description: z.string(),
  targetMetric: z.string().nullable(),
  baseline: z.number().nullable(),
  target: z.number().nullable(),
  progressPct: z.number(),
  status: z.string(),
});
export type GoalDto = z.infer<typeof goalSchema>;

export const treatmentPlanSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  problemList: z.array(z.string()),
  sessionFrequency: z.string(),
  riskPlan: z.string().nullable(),
  reviewDate: z.string().nullable(),
  status: z.string(),
  version: z.number().int(),
  goals: z.array(goalSchema),
  createdAt: z.string(),
});
export type TreatmentPlanDto = z.infer<typeof treatmentPlanSchema>;
