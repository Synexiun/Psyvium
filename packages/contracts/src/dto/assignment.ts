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
