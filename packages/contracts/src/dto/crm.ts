import { z } from 'zod';
import { EngagementDirection, EngagementKind, LeadSource, ReferrerType } from '../enums';

/**
 * CRM & Referrals DTOs (`docs/technical/16-crm-and-referrals.md`, context 29).
 * This is the SHARED CONTRACT the web cockpit is built against in parallel —
 * shapes here must not drift from the doc without updating both sides.
 *
 * CRM data is never clinical data: `contact`/`presentingInterest` are
 * marketing-qualified signals, never a substitute for Intake & Screening
 * (context 6). Conversion is a one-way, audited handoff into Client Registry.
 */

export const crmContactSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().optional(),
  phone: z.string().max(40).optional(),
  /**
   * Optional suppression flag stored inside the contact JSON blob.
   * The Lead model has no dedicated `doNotContact` column — when this is
   * true, outbound engagement is blocked. Absence means "not set" (outreach
   * is still allowed, but conversion notes that care-consent is required).
   */
  doNotContact: z.boolean().optional(),
});
export type CrmContact = z.infer<typeof crmContactSchema>;

// ── Read models ──

export const pipelineStageSchema = z.object({
  id: z.string(),
  name: z.string(),
  order: z.number().int(),
  isWon: z.boolean(),
  isLost: z.boolean(),
});
export type PipelineStageDto = z.infer<typeof pipelineStageSchema>;

export const leadSchema = z.object({
  id: z.string(),
  source: z.nativeEnum(LeadSource),
  contact: crmContactSchema,
  presentingInterest: z.string().nullable().optional(),
  pipelineStageId: z.string(),
  pipelineStageName: z.string(),
  status: z.string(),
  referrerId: z.string().nullable().optional(),
  createdAt: z.string(),
  /**
   * Set on the response of `POST /crm/leads` when the submitted contact
   * deterministically matched an existing NON-converted lead (`16-crm-and-
   * referrals.md` §6.2) — the existing lead was enriched in place instead of
   * a duplicate being created. Absent/false on a normal fresh capture.
   */
  deduped: z.boolean().optional(),
});
export type LeadDto = z.infer<typeof leadSchema>;

/**
 * `GET /crm/leads/stalled` row (`16-crm-and-referrals.md` §2 — "a stalled-lead
 * rule ... surfaces overdue leads"). `basis` is always `'updatedAt'` today: the
 * `Lead` row has no dedicated "entered current stage" timestamp, so this is an
 * honest proxy — ANY field edit (not only a stage move) resets the clock, not
 * just a `LeadStageChanged` transition.
 */
export const stalledLeadSchema = leadSchema.extend({
  daysStalled: z.number().int().nonnegative(),
  staleSince: z.string(),
  basis: z.literal('updatedAt'),
});
export type StalledLeadDto = z.infer<typeof stalledLeadSchema>;

export const referrerSchema = z.object({
  id: z.string(),
  type: z.nativeEnum(ReferrerType),
  organizationName: z.string(),
  contact: z.object({
    name: z.string().optional(),
    email: z.string().email().optional(),
    phone: z.string().optional(),
  }),
  referralSharePct: z.number(),
  active: z.boolean(),
});
export type ReferrerDto = z.infer<typeof referrerSchema>;

export const engagementSchema = z.object({
  id: z.string(),
  subjectType: z.string(),
  subjectId: z.string(),
  kind: z.nativeEnum(EngagementKind),
  direction: z.nativeEnum(EngagementDirection),
  summary: z.string(),
  occurredAt: z.string(),
});
export type EngagementDto = z.infer<typeof engagementSchema>;

export const crmBoardSchema = z.object({
  stages: z.array(pipelineStageSchema),
  leadsByStage: z.record(z.string(), z.array(leadSchema)),
  referrers: z.array(referrerSchema),
});
export type CrmBoardDto = z.infer<typeof crmBoardSchema>;

// ── Write models ──

export const createLeadSchema = z.object({
  source: z.nativeEnum(LeadSource),
  contact: crmContactSchema,
  presentingInterest: z.string().max(2000).optional(),
  referrerId: z.string().optional(),
  campaignId: z.string().optional(),
});
export type CreateLeadInput = z.infer<typeof createLeadSchema>;

export const moveLeadStageSchema = z.object({
  toStageId: z.string().min(1),
  note: z.string().max(1000).optional(),
});
export type MoveLeadStageInput = z.infer<typeof moveLeadStageSchema>;

/**
 * Conversion body: email is required to provision the new `User` unless the
 * lead's own `contact.email` can be used instead (checked server-side).
 * `password` is optional — if omitted the account is provisioned with a
 * random credential (the client resets via the standard forgot-password flow).
 */
export const convertLeadSchema = z.object({
  email: z.string().email().optional(),
  password: z.string().min(8).max(200).optional(),
});
export type ConvertLeadInput = z.infer<typeof convertLeadSchema>;

export const convertLeadResultSchema = z.object({
  leadId: z.string(),
  clientId: z.string(),
  userId: z.string(),
  pipelineStageId: z.string(),
  convertedAt: z.string(),
});
export type ConvertLeadResult = z.infer<typeof convertLeadResultSchema>;

/**
 * Machine-readable CRM error codes, distinct from a generic 409, so the UI
 * can tell "the funnel has no won stage configured" apart from "this contact
 * is already a client — route to care, not marketing" (`16-crm-and-referrals.md`
 * §6.2 dedupe: a match against a CONVERTED lead is a routing error, not a
 * duplicate to merge).
 */
export const CrmErrorCode = {
  LEAD_ALREADY_CLIENT: 'lead.already_client',
} as const;
export type CrmErrorCode = (typeof CrmErrorCode)[keyof typeof CrmErrorCode];

export const createReferrerSchema = z.object({
  type: z.nativeEnum(ReferrerType),
  organizationName: z.string().min(1).max(200),
  contact: z
    .object({
      name: z.string().optional(),
      email: z.string().email().optional(),
      phone: z.string().optional(),
    })
    .default({}),
  referralSharePct: z.number().min(0).max(100).default(0),
  agreementId: z.string().optional(),
});
export type CreateReferrerInput = z.infer<typeof createReferrerSchema>;

export const stalledLeadsQuerySchema = z.object({
  days: z.coerce.number().int().positive().max(3650).default(14),
});
export type StalledLeadsQuery = z.infer<typeof stalledLeadsQuerySchema>;

export const logEngagementSchema = z.object({
  subjectType: z.string().min(1).max(50),
  subjectId: z.string().min(1),
  kind: z.nativeEnum(EngagementKind),
  direction: z.nativeEnum(EngagementDirection),
  summary: z.string().min(1).max(4000),
  occurredAt: z.string().datetime().optional(),
});
export type LogEngagementInput = z.infer<typeof logEngagementSchema>;
