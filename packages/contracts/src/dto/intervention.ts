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

/**
 * WAVE CR P1 — Kazantzis homework-loop remediation (docs/10-10-PROGRAM.md).
 * The meta-analytic homework->outcome effect is driven by assignment
 * rationale, difficulty calibration, and clinician review-at-next-session.
 * `difficulty` is a plain string validated against this fixed set — no new
 * Prisma enum (schema.prisma column is a bare String? for this field).
 */
export const HOMEWORK_DIFFICULTY = ['gentle', 'moderate', 'challenging'] as const;
export const homeworkDifficultySchema = z.enum(HOMEWORK_DIFFICULTY);
export type HomeworkDifficulty = z.infer<typeof homeworkDifficultySchema>;

/**
 * Outcome-alignment tag recorded by the clinician when reviewing a client's
 * homework report at the next session — the third Kazantzis mechanism.
 * Same "plain string, DTO-validated" treatment as `difficulty` above.
 */
export const HOMEWORK_OUTCOME_ALIGNMENT = ['helped', 'neutral', 'unclear', 'setback'] as const;
export const homeworkOutcomeAlignmentSchema = z.enum(HOMEWORK_OUTCOME_ALIGNMENT);
export type HomeworkOutcomeAlignment = z.infer<typeof homeworkOutcomeAlignmentSchema>;

export const assignHomeworkSchema = z.object({
  interventionId: z.string(),
  description: z.string().min(2).max(1000),
  dueDate: z.string().datetime().optional(),
  rationale: z.string().max(2000).optional(),
  difficulty: homeworkDifficultySchema.optional(),
});
export type AssignHomeworkInput = z.infer<typeof assignHomeworkSchema>;

export const homeworkSchema = z.object({
  id: z.string(),
  interventionId: z.string(),
  description: z.string(),
  dueDate: z.string().nullable(),
  completionPct: z.number(),
  clientReport: z.string().nullable(),
  rationale: z.string().nullable(),
  difficulty: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  reviewedBy: z.string().nullable(),
  reviewNotes: z.string().nullable(),
  reviewOutcome: z.string().nullable(),
  createdAt: z.string(),
});
export type HomeworkDto = z.infer<typeof homeworkSchema>;

/**
 * Clinician review-at-next-session step (the third Kazantzis mechanism):
 * discussing the homework report and its bearing on treatment is what
 * converts an assigned task into an outcome-linked one. CLIENT principals
 * must never be able to call this — enforced in the service, not just RBAC,
 * since `Permission.INTERVENTION_WRITE` is clinician-only already, and this
 * endpoint additionally sits behind `ClinicalWriteGuard`.
 */
export const reviewHomeworkSchema = z.object({
  homeworkId: z.string(),
  reviewNotes: z.string().min(3).max(2000),
  outcomeAlignment: homeworkOutcomeAlignmentSchema.optional(),
});
export type ReviewHomeworkInput = z.infer<typeof reviewHomeworkSchema>;

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
