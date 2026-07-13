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
  /** Structured C-SSRS triage / raw safety-item-answer detail (WAVE CR item 1/2). */
  evidenceDetail: z.unknown().nullable().optional(),
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
  /** Real per-severity response-time target (WAVE CR item 3). */
  slaDueAt: z.string().nullable(),
  /** SAFE-T/NPSG 15.01.01 structured resolution (WAVE CR item 4). */
  riskLevelAtResolution: z.nativeEnum(SeverityBand).nullable(),
  interventionsApplied: z.array(z.string()),
  /** Zero Suicide caring-contact follow-up (WAVE CR item 4). */
  followUpDueAt: z.string().nullable(),
  followUpCompletedAt: z.string().nullable(),
});
export type EscalationDto = z.infer<typeof escalationSchema>;

/**
 * SLA response-time targets per severity band (SAFE-T/Joint Commission NPSG
 * 15.01.01 — documented, deterministic; never AI-consulted). Lives in
 * contracts (not a service) because both Intake & Screening and
 * Psychometrics need it at Escalation-creation time and hexagonal modules
 * may only share code via `@vpsy/contracts`, never cross-import each other.
 */
export const ESCALATION_SLA_MINUTES: Record<SeverityBand, number> = {
  [SeverityBand.SEVERE]: 60,
  [SeverityBand.HIGH]: 4 * 60,
  [SeverityBand.MODERATE]: 24 * 60,
  [SeverityBand.LOW]: 24 * 60,
};

/** On-call fallback: an unassigned SEVERE escalation past this age auto-routes. */
export const ESCALATION_AUTO_ASSIGN_AFTER_MINUTES = 15;

export function computeEscalationSlaDueAt(severity: SeverityBand, openedAt: Date): Date {
  const minutes = ESCALATION_SLA_MINUTES[severity] ?? ESCALATION_SLA_MINUTES[SeverityBand.LOW];
  return new Date(openedAt.getTime() + minutes * 60_000);
}

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

/**
 * Resolution always requires a licensed human's narrative — never auto-set.
 *
 * Structured per SAFE-T/Joint Commission NPSG 15.01.01 (WAVE CR item 4):
 * `riskLevelAtResolution` is the clinician's risk-level snapshot at close,
 * `interventionsApplied` documents what was done, and `followUpDueAt` is the
 * Zero Suicide caring-contact date — REQUIRED whenever the resolution-time
 * risk level is HIGH or SEVERE (reattempt-reduction evidence).
 */
export const resolveEscalationSchema = z
  .object({
    resolution: z.string().min(5).max(4000),
    riskLevelAtResolution: z.nativeEnum(SeverityBand),
    interventionsApplied: z.array(z.string().min(1).max(200)).max(20).default([]),
    followUpDueAt: z.string().datetime().optional(),
  })
  .superRefine((val, ctx) => {
    const requiresFollowUp =
      val.riskLevelAtResolution === SeverityBand.HIGH || val.riskLevelAtResolution === SeverityBand.SEVERE;
    if (requiresFollowUp && !val.followUpDueAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'followUpDueAt is required when riskLevelAtResolution is HIGH or SEVERE (Zero Suicide caring-contact follow-up)',
        path: ['followUpDueAt'],
      });
    }
  });
export type ResolveEscalationInput = z.infer<typeof resolveEscalationSchema>;

/** Records that the Zero Suicide caring-contact follow-up actually happened. */
export const completeEscalationFollowUpSchema = z.object({
  notes: z.string().max(2000).optional(),
});
export type CompleteEscalationFollowUpInput = z.infer<typeof completeEscalationFollowUpSchema>;

/** Structured means-restriction inventory item (Stanley-Brown SPI step 6). */
export const meansRestrictionItemSchema = z.object({
  means: z.string().min(1).max(200),
  secured: z.boolean().default(false),
  how: z.string().max(500).optional(),
  verifiedBy: z.string().max(200).optional(),
});
export type MeansRestrictionItem = z.infer<typeof meansRestrictionItemSchema>;

/** Crisis-line info shown on the plan; defaults to the 988 Lifeline entry. */
export const crisisLineInfoSchema = z.object({
  label: z.string().max(200).default('988 Suicide & Crisis Lifeline'),
  phone: z.string().max(50).default('988'),
  text: z.string().max(50).optional(),
  chatUrl: z.string().max(300).optional(),
});
export type CrisisLineInfo = z.infer<typeof crisisLineInfoSchema>;

/**
 * A safety plan is append-only: creating a new one for the same client
 * supersedes the prior version but never mutates it (matches the clinical
 * record's tamper-evident, versioned-facts convention).
 *
 * Stanley-Brown SPI completeness (WAVE CR item 5) — all new fields are
 * OPTIONAL/additive so existing callers are unaffected:
 *  - `distractionContacts` (step 3: people/places for distraction) is split
 *    from `helpContacts` (step 5: people to ask for help); `supportContacts`
 *    above stays for back-compat.
 *  - `crisisLineInfo` defaults to the 988 entry when the service persists it.
 *  - `meansRestriction` is a structured inventory, not free text.
 *  - `clientAcknowledgedAt` records the collaborative-artifact acknowledgment.
 */
export const createSafetyPlanSchema = z.object({
  clientId: z.string(),
  warningSigns: z.array(z.string().max(300)).min(1).max(20),
  copingStrategies: z.array(z.string().max(300)).min(1).max(20),
  supportContacts: z.array(z.string().max(300)).max(20).default([]),
  professionalContacts: z.array(z.string().max(300)).max(20).default([]),
  environmentSafety: z.string().max(2000).optional(),
  distractionContacts: z.array(z.string().max(300)).max(20).optional(),
  helpContacts: z.array(z.string().max(300)).max(20).optional(),
  crisisLineInfo: crisisLineInfoSchema.optional(),
  meansRestriction: z.array(meansRestrictionItemSchema).max(20).optional(),
  clientAcknowledgedAt: z.string().datetime().optional(),
});
export type CreateSafetyPlanInput = z.infer<typeof createSafetyPlanSchema>;

export const safetyPlanCompletenessSchema = z.object({
  score: z.number().min(0).max(100),
  missing: z.array(z.string()),
  algorithmVersion: z.string(),
  citation: z.string(),
});

export const safetyPlanSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  warningSigns: z.array(z.string()),
  copingStrategies: z.array(z.string()),
  supportContacts: z.array(z.string()),
  professionalContacts: z.array(z.string()),
  environmentSafety: z.string().nullable(),
  distractionContacts: z.array(z.string()).nullable(),
  helpContacts: z.array(z.string()).nullable(),
  crisisLineInfo: crisisLineInfoSchema.nullable(),
  meansRestriction: z.array(meansRestrictionItemSchema).nullable(),
  clientAcknowledgedAt: z.string().nullable(),
  version: z.number().int(),
  createdAt: z.string(),
  /** Stanley–Brown SPI completeness (assistive quality metric, never a save gate). */
  completeness: safetyPlanCompletenessSchema.optional(),
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

/**
 * Post-incident review (Joint Commission NPSG 15.01.01 / TJC sentinel-event
 * review practice — WAVE CR: "the Journey-4 doc promises supervisor review
 * that has no code"). A review's subject is either a SEVERE Escalation
 * resolution or a BreakGlassGrant, identified by `subjectId` — kept a plain
 * string (DTO-validated against this enum) rather than a Prisma enum column,
 * so a future subject kind never needs a migration.
 */
export const IncidentReviewKind = {
  ESCALATION_RESOLUTION: 'ESCALATION_RESOLUTION',
  BREAK_GLASS: 'BREAK_GLASS',
} as const;
export type IncidentReviewKind = (typeof IncidentReviewKind)[keyof typeof IncidentReviewKind];

/**
 * Creates a post-incident review. Deliberately NOT a gate on resolution —
 * `resolveEscalation`/`breakGlass` must stay fast in a crisis; this is the
 * after-the-fact supervisory record, surfaced by the `pending` list below so
 * a required review can never silently age out.
 */
export const createIncidentReviewSchema = z.object({
  kind: z.nativeEnum(IncidentReviewKind),
  subjectId: z.string(),
  findings: z.string().min(20).max(4000),
  actionItems: z.array(z.string().min(1).max(300)).max(20).optional(),
  /** A second reviewer's sign-off (e.g. clinical director co-sign on a sentinel event). */
  cosignedBy: z.string().max(200).optional(),
});
export type CreateIncidentReviewInput = z.infer<typeof createIncidentReviewSchema>;

export const incidentReviewSchema = z.object({
  id: z.string(),
  kind: z.nativeEnum(IncidentReviewKind),
  subjectId: z.string(),
  reviewerId: z.string(),
  findings: z.string(),
  actionItems: z.array(z.string()).nullable(),
  cosignedBy: z.string().nullable(),
  reviewedAt: z.string(),
  createdAt: z.string(),
});
export type IncidentReviewDto = z.infer<typeof incidentReviewSchema>;

/**
 * One item on the "never ages silently" pending-review list: a SEVERE
 * escalation resolved with no IncidentReview row yet, or a BreakGlassGrant
 * with none. `ageHours` is how long it has been waiting, since the whole
 * point of this list is that nothing should sit unreviewed indefinitely.
 */
export const pendingIncidentReviewItemSchema = z.object({
  kind: z.nativeEnum(IncidentReviewKind),
  subjectId: z.string(),
  clientId: z.string(),
  clientName: z.string(),
  occurredAt: z.string(),
  ageHours: z.number(),
  summary: z.string(),
});
export type PendingIncidentReviewItem = z.infer<typeof pendingIncidentReviewItemSchema>;

export const pendingIncidentReviewsSchema = z.object({
  items: z.array(pendingIncidentReviewItemSchema),
});
export type PendingIncidentReviewsDto = z.infer<typeof pendingIncidentReviewsSchema>;

/**
 * Jurisdiction-aware emergency resources (APA telepsychology guidance —
 * WAVE CR: "988 is US-only" — the patient home card must show the caller's
 * own country's crisis line, not a hardcoded US number). The registry itself
 * (country code → entry) lives in the risk module as a code constant
 * (`crisis-lines.ts`); this contract is just the shape of what the API
 * returns — the resolved entry for the tenant's country plus the generic
 * fallback, so the client can render an honest "we don't have a specific
 * number for your country yet" state instead of ever showing a wrong one.
 */
export const crisisResourceEntrySchema = z.object({
  countryCode: z.string(),
  label: z.string(),
  phone: z.string(),
  smsNumber: z.string().optional(),
  chatUrl: z.string().optional(),
  notes: z.string().optional(),
});
export type CrisisResourceEntry = z.infer<typeof crisisResourceEntrySchema>;

export const crisisResourcesSchema = z.object({
  /** The tenant's resolved country code, or null if the tenant lookup failed. */
  countryCode: z.string().nullable(),
  /** True when `resolved` IS the generic fallback (no country-specific entry). */
  isFallback: z.boolean(),
  resolved: crisisResourceEntrySchema,
  fallback: crisisResourceEntrySchema,
});
export type CrisisResourcesDto = z.infer<typeof crisisResourcesSchema>;
