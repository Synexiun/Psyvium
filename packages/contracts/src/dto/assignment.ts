import { z } from 'zod';
import { AssignmentStatus } from '../enums';

/**
 * Matching & Assignment DTOs. The AI proposes ranked candidates with rationale;
 * the MANAGER is the final authority. `approve` requires a manager principal.
 */

export const matchCandidateSchema = z.object({
  psychologistId: z.string(),
  displayName: z.string(),
  specialties: z.array(z.string()),
  languages: z.array(z.string()),
  jurisdiction: z.string(),
  caseloadUtilization: z.number().min(0).max(1),
  outcomeIndex: z.number().min(0).max(100),
  score: z.number().min(0).max(100),
  rationale: z.string(),
  fitWarnings: z.array(z.string()).default([]),
});
export type MatchCandidate = z.infer<typeof matchCandidateSchema>;

export const assignmentSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  psychologistId: z.string().nullable(),
  status: z.nativeEnum(AssignmentStatus),
  proposedBy: z.string(),
  approvedBy: z.string().nullable(),
  candidates: z.array(matchCandidateSchema),
  createdAt: z.string(),
});
export type Assignment = z.infer<typeof assignmentSchema>;

export const approveAssignmentSchema = z.object({
  assignmentId: z.string(),
  psychologistId: z.string(),
  managerNote: z.string().max(1000).optional(),
});
export type ApproveAssignmentInput = z.infer<typeof approveAssignmentSchema>;

/**
 * Manager rejects a proposed assignment (PROPOSED → CLOSED). There is no
 * REJECTED enum value — CLOSED is the terminal status for declined proposals.
 */
export const rejectAssignmentSchema = z.object({
  assignmentId: z.string().min(1),
  reason: z.string().min(1).max(1000),
});
export type RejectAssignmentInput = z.infer<typeof rejectAssignmentSchema>;

/**
 * Manager places a proposed assignment on hold. There is no HOLD enum value —
 * status remains PROPOSED and the hold is recorded via managerNote + audit
 * (`status: 'on_hold'` in the audit payload / API response annotation).
 */
export const holdAssignmentSchema = z.object({
  assignmentId: z.string().min(1),
  reason: z.string().min(1).max(1000),
});
export type HoldAssignmentInput = z.infer<typeof holdAssignmentSchema>;
