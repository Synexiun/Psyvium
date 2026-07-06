import { z } from 'zod';
import { InterventionType } from '../enums';

/**
 * Intervention Tracking DTOs (context 15). Every Intervention is anchored to
 * a client's ACTIVE TreatmentPlan (optionally a specific Goal within it) —
 * this is what "linked to a TreatmentPlan/Goal/client" means in practice:
 * the caller supplies `clientId` (+ optional `goalId`), and the service
 * resolves/validates the plan server-side rather than trusting a client-
 * supplied `planId`. Homework is always attached to an Intervention (the
 * Prisma model has no direct clientId — it is reached via
 * Intervention → TreatmentPlan → Client).
 */

export const createInterventionSchema = z.object({
  clientId: z.string(),
  goalId: z.string().optional(),
  sessionId: z.string().optional(),
  clinicalTarget: z.string().min(2).max(300),
  type: z.nativeEnum(InterventionType),
  modality: z.string().max(50).default('individual'),
  durationMin: z.number().int().positive().max(600).optional(),
  rationale: z.string().max(2000).optional(),
});
export type CreateInterventionInput = z.infer<typeof createInterventionSchema>;

export const interventionSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  planId: z.string().nullable(),
  goalId: z.string().nullable(),
  sessionId: z.string().nullable(),
  clinicalTarget: z.string(),
  type: z.string(),
  modality: z.string(),
  durationMin: z.number().nullable(),
  rationale: z.string().nullable(),
  clientResponse: z.string().nullable(),
  followUpDate: z.string().nullable(),
  effectivenessRating: z.number().nullable(),
  adverseEffects: z.string().nullable(),
  clinicianApproved: z.boolean(),
  createdAt: z.string(),
  homework: z.array(z.lazy(() => homeworkSchema)).optional(),
});
export type InterventionDto = z.infer<typeof interventionSchema>;

export const assignHomeworkSchema = z.object({
  interventionId: z.string(),
  description: z.string().min(2).max(1000),
  dueDate: z.string().datetime().optional(),
});
export type AssignHomeworkInput = z.infer<typeof assignHomeworkSchema>;

export const homeworkSchema = z.object({
  id: z.string(),
  interventionId: z.string(),
  description: z.string(),
  dueDate: z.string().nullable(),
  completionPct: z.number(),
  clientReport: z.string().nullable(),
  createdAt: z.string(),
});
export type HomeworkDto = z.infer<typeof homeworkSchema>;

/**
 * Marks homework complete (or partially complete via a resumed report).
 * There is no dedicated "homework:complete" permission in the Wave C scope
 * (packages/contracts/src/rbac.ts is out of scope for this change) — the
 * controller reuses `Permission.CLIENT_READ`, the one permission already
 * granted to CLIENT, PSYCHOLOGIST, and MANAGER alike, and the service layer
 * enforces that a CLIENT principal may only complete their OWN homework.
 */
export const completeHomeworkSchema = z.object({
  completionPct: z.number().min(0).max(100).default(100),
  clientReport: z.string().max(2000).optional(),
});
export type CompleteHomeworkInput = z.infer<typeof completeHomeworkSchema>;
