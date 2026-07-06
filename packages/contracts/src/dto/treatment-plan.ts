import { z } from 'zod';

/**
 * Treatment Planning DTOs. A plan owns a set of measurable goals. Creating a
 * new plan for a client supersedes any previously active plan (a client has
 * at most one ACTIVE plan at a time) — the superseded plan is kept, never
 * deleted. Goal progress is updated independently of the plan document.
 */

export const goalInputSchema = z.object({
  description: z.string().min(3).max(500),
  targetMetric: z.string().max(200).optional(),
  baseline: z.number().optional(),
  target: z.number().optional(),
});
export type GoalInput = z.infer<typeof goalInputSchema>;

export const createTreatmentPlanSchema = z.object({
  clientId: z.string(),
  problemList: z.array(z.string().max(300)).default([]),
  sessionFrequency: z.string().max(50).default('weekly'),
  measurementSchedule: z.record(z.string(), z.unknown()).default({}),
  riskPlan: z.string().max(2000).optional(),
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
