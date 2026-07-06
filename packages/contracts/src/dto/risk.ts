import { z } from 'zod';
import { RiskSource, RiskStatus, RiskType, SeverityBand } from '../enums';

/**
 * Risk & Crisis DTOs (context 21, Phase 4). Core principle: risk detection
 * routes to a HUMAN — nothing here auto-resolves an escalation, and the AI
 * Gateway (Phase 5) only ever surfaces a risk-triage *suggestion*, never a
 * decision. `RiskFlag` + `Escalation` are raised deterministically by Intake
 * & Screening (see `IntakeService.submit`); this module owns the human
 * workflow that acts on them (acknowledge, assign, resolve), the append-only
 * safety plan, and the audited break-glass emergency-access lever.
 */

export const riskFlagSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  clientName: z.string(),
  type: z.nativeEnum(RiskType),
  severity: z.nativeEnum(SeverityBand),
  source: z.nativeEnum(RiskSource),
  evidence: z.string().nullable(),
  status: z.nativeEnum(RiskStatus),
  createdAt: z.string(),
});
export type RiskFlagDto = z.infer<typeof riskFlagSchema>;

export const escalationSchema = z.object({
  id: z.string(),
  riskFlagId: z.string(),
  clientId: z.string(),
  clientName: z.string(),
  riskType: z.nativeEnum(RiskType),
  severity: z.nativeEnum(SeverityBand),
  openedAt: z.string(),
  assignedTo: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  resolution: z.string().nullable(),
  slaBreached: z.boolean(),
});
export type EscalationDto = z.infer<typeof escalationSchema>;

/**
 * The priority lane view: unresolved escalations sorted SEVERE→LOW then
 * oldest-first (so the most severe, longest-waiting cases surface first),
 * plus the tenant's currently-open risk flags (not yet RESOLVED).
 */
export const riskBoardSchema = z.object({
  escalations: z.array(escalationSchema),
  openFlags: z.array(riskFlagSchema),
});
export type RiskBoardDto = z.infer<typeof riskBoardSchema>;

export const assignEscalationSchema = z.object({
  assignedTo: z.string().min(1).max(200),
});
export type AssignEscalationInput = z.infer<typeof assignEscalationSchema>;

/** Resolution always requires a licensed human's narrative — never auto-set. */
export const resolveEscalationSchema = z.object({
  resolution: z.string().min(5).max(4000),
});
export type ResolveEscalationInput = z.infer<typeof resolveEscalationSchema>;

/**
 * A safety plan is append-only: creating a new one for the same client
 * supersedes the prior version but never mutates it (matches the clinical
 * record's tamper-evident, versioned-facts convention).
 */
export const createSafetyPlanSchema = z.object({
  clientId: z.string(),
  warningSigns: z.array(z.string().max(300)).min(1).max(20),
  copingStrategies: z.array(z.string().max(300)).min(1).max(20),
  supportContacts: z.array(z.string().max(300)).max(20).default([]),
  professionalContacts: z.array(z.string().max(300)).max(20).default([]),
  environmentSafety: z.string().max(2000).optional(),
});
export type CreateSafetyPlanInput = z.infer<typeof createSafetyPlanSchema>;

export const safetyPlanSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  warningSigns: z.array(z.string()),
  copingStrategies: z.array(z.string()),
  supportContacts: z.array(z.string()),
  professionalContacts: z.array(z.string()),
  environmentSafety: z.string().nullable(),
  version: z.number().int(),
  createdAt: z.string(),
});
export type SafetyPlanDto = z.infer<typeof safetyPlanSchema>;

/**
 * Break-glass: time-boxed (1h) emergency access, always reason-gated and
 * always audited HIGH-priority + published as the DPO-alert seam
 * (`BreakGlassInvoked`). See `06-security-and-rbac.md` §2.2 / §4.4.
 */
export const breakGlassSchema = z.object({
  clientId: z.string(),
  reason: z.string().min(10).max(2000),
});
export type BreakGlassInput = z.infer<typeof breakGlassSchema>;

export const breakGlassResultSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  invokedBy: z.string(),
  reason: z.string(),
  grantedAt: z.string(),
  expiresAt: z.string(),
});
export type BreakGlassResultDto = z.infer<typeof breakGlassResultSchema>;
