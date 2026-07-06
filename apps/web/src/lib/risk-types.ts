/**
 * Local response types for the Risk & Crisis endpoints (context 21).
 * Mirror the shared backend contract exactly (packages/contracts/src/dto/risk.ts);
 * kept local to apps/web.
 * Core principle: risk detection routes to a HUMAN — nothing here auto-resolves.
 *
 * Endpoints:
 *   GET   /risk/board                          → RiskBoardDto
 *   PATCH /risk/flags/:id/acknowledge          → RiskFlagDto
 *   POST  /risk/escalations/:id/assign         → EscalationDto
 *   POST  /risk/escalations/:id/resolve        → EscalationDto
 *   PATCH /risk/escalations/:id/follow-up      → EscalationDto
 *   POST  /risk/safety-plans                   → SafetyPlanDto
 *   GET   /risk/safety-plans/me                → SafetyPlanDto | null
 *   GET   /risk/safety-plans/client/:clientId  → SafetyPlanDto | null
 *   POST  /risk/break-glass                    → BreakGlassResultDto
 *   POST  /risk/incident-reviews               → IncidentReviewDto
 *   GET   /risk/incident-reviews/pending       → PendingIncidentReviewsDto
 *   GET   /risk/incident-reviews/subject/:id   → IncidentReviewDto[]
 *   GET   /risk/crisis-resources               → CrisisResourcesDto
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
  /** Structured C-SSRS triage / raw safety-item-answer detail. */
  evidenceDetail?: unknown;
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
  /** Per-severity response-time target (SAFE-T / NPSG 15.01.01). */
  slaDueAt: string | null;
  /** Structured resolution snapshot — set by a licensed human at close. */
  riskLevelAtResolution: Severity | null;
  interventionsApplied: string[];
  /** Zero Suicide caring-contact follow-up. */
  followUpDueAt: string | null;
  followUpCompletedAt: string | null;
}

export interface RiskBoardDto {
  escalations: EscalationDto[];
  openFlags: RiskFlagDto[];
}

/** Structured means-restriction inventory item (Stanley-Brown SPI step 6). */
export interface MeansRestrictionItem {
  means: string;
  secured: boolean;
  how?: string;
  verifiedBy?: string;
}

/** Crisis-line info shown on the plan; the API defaults to the 988 entry. */
export interface CrisisLineInfo {
  label: string;
  phone: string;
  text?: string;
  chatUrl?: string;
}

/**
 * Input variant: the contract's `crisisLineInfoSchema` defaults label/phone
 * to the 988 Lifeline entry, so both are optional when authoring.
 */
export interface CrisisLineInfoInput {
  label?: string;
  phone?: string;
  text?: string;
  chatUrl?: string;
}

export interface SafetyPlanDto {
  id: string;
  clientId: string;
  warningSigns: string[];
  copingStrategies: string[];
  supportContacts: string[];
  professionalContacts: string[];
  environmentSafety: string | null;
  /** Stanley-Brown step 3: people/places for distraction (split from helpContacts). */
  distractionContacts: string[] | null;
  /** Stanley-Brown step 5: people to ask for help. */
  helpContacts: string[] | null;
  crisisLineInfo: CrisisLineInfo | null;
  meansRestriction: MeansRestrictionItem[] | null;
  /** When the client acknowledged the plan as a collaborative artifact. */
  clientAcknowledgedAt: string | null;
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
  distractionContacts?: string[];
  helpContacts?: string[];
  crisisLineInfo?: CrisisLineInfoInput;
  meansRestriction?: MeansRestrictionItem[];
  clientAcknowledgedAt?: string;
}

/**
 * Mirrors `resolveEscalationSchema` — `followUpDueAt` (ISO datetime) is
 * REQUIRED by the contract whenever `riskLevelAtResolution` is HIGH or
 * SEVERE (Zero Suicide caring-contact follow-up); the UI enforces the same
 * rule before submitting so the clinician is never surprised by a 400.
 */
export interface ResolveEscalationInput {
  resolution: string;
  riskLevelAtResolution: Severity;
  interventionsApplied: string[];
  followUpDueAt?: string;
}

/** Records that the caring-contact follow-up actually happened. */
export interface CompleteEscalationFollowUpInput {
  notes?: string;
}

/**
 * Post-incident review (Joint Commission NPSG 15.01.01 / TJC sentinel-event
 * review practice). A review's subject is either a SEVERE Escalation
 * resolution or a BreakGlassGrant, identified by `subjectId`. Deliberately
 * NOT a gate on resolveEscalation/breakGlass — resolution stays fast in a
 * crisis; the pending list is the enforcement mechanism.
 */
export type IncidentReviewKind = 'ESCALATION_RESOLUTION' | 'BREAK_GLASS';

export interface CreateIncidentReviewInput {
  kind: IncidentReviewKind;
  subjectId: string;
  findings: string;
  actionItems?: string[];
  cosignedBy?: string;
}

export interface IncidentReviewDto {
  id: string;
  kind: IncidentReviewKind;
  subjectId: string;
  reviewerId: string;
  findings: string;
  actionItems: string[] | null;
  cosignedBy: string | null;
  reviewedAt: string;
  createdAt: string;
}

/** One item on the "never ages silently" pending-review list. */
export interface PendingIncidentReviewItem {
  kind: IncidentReviewKind;
  subjectId: string;
  clientId: string;
  clientName: string;
  occurredAt: string;
  ageHours: number;
  summary: string;
}

export interface PendingIncidentReviewsDto {
  items: PendingIncidentReviewItem[];
}

/**
 * Jurisdiction-aware emergency resources (APA telepsychology guidance — 988
 * is US-only). `resolved` is the tenant-country-specific entry when one is
 * registered, otherwise the generic `fallback` — the API never returns a
 * wrong/dead number, and `isFallback` tells the UI which case it got.
 */
export interface CrisisResourceEntry {
  countryCode: string;
  label: string;
  phone: string;
  smsNumber?: string;
  chatUrl?: string;
  notes?: string;
}

export interface CrisisResourcesDto {
  countryCode: string | null;
  isFallback: boolean;
  resolved: CrisisResourceEntry;
  fallback: CrisisResourceEntry;
}
