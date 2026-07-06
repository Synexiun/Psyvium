/**
 * Local response types for the Risk & Crisis endpoints (context 21).
 * Mirror the shared backend contract exactly; kept local to apps/web.
 * Core principle: risk detection routes to a HUMAN — nothing here auto-resolves.
 *
 * Endpoints:
 *   GET   /risk/board                          → RiskBoardDto
 *   PATCH /risk/flags/:id/acknowledge          → RiskFlagDto
 *   POST  /risk/escalations/:id/assign         → EscalationDto
 *   POST  /risk/escalations/:id/resolve        → EscalationDto
 *   POST  /risk/safety-plans                   → SafetyPlanDto
 *   GET   /risk/safety-plans/client/:clientId  → SafetyPlanDto | null
 *   POST  /risk/break-glass                    → BreakGlassResultDto
 */

export type Severity = 'LOW' | 'MODERATE' | 'HIGH' | 'SEVERE';

export interface RiskFlagDto {
  id: string;
  clientId: string;
  clientName: string;
  type: string;
  severity: Severity;
  source: string;
  evidence: string | null;
  status: string;
  createdAt: string;
}

export interface EscalationDto {
  id: string;
  riskFlagId: string;
  clientId: string;
  clientName: string;
  riskType: string;
  severity: Severity;
  openedAt: string;
  assignedTo: string | null;
  resolvedAt: string | null;
  resolution: string | null;
  slaBreached: boolean;
}

export interface RiskBoardDto {
  escalations: EscalationDto[];
  openFlags: RiskFlagDto[];
}

export interface SafetyPlanDto {
  id: string;
  clientId: string;
  warningSigns: string[];
  copingStrategies: string[];
  supportContacts: string[];
  professionalContacts: string[];
  environmentSafety: string | null;
  version: number;
  createdAt: string;
}

export interface BreakGlassResultDto {
  id: string;
  clientId: string;
  invokedBy: string;
  reason: string;
  grantedAt: string;
  expiresAt: string;
}

/* ── Request payloads ─────────────────────────────────────────────────── */
export interface CreateSafetyPlanInput {
  clientId: string;
  warningSigns: string[];
  copingStrategies: string[];
  supportContacts: string[];
  professionalContacts: string[];
  environmentSafety?: string;
}
