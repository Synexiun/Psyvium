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
});
export type LeadDto = z.infer<typeof leadSchema>;

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

export const logEngagementSchema = z.object({
  subjectType: z.string().min(1).max(50),
  subjectId: z.string().min(1),
  kind: z.nativeEnum(EngagementKind),
  direction: z.nativeEnum(EngagementDirection),
  summary: z.string().min(1).max(4000),
  occurredAt: z.string().datetime().optional(),
});
export type LogEngagementInput = z.infer<typeof logEngagementSchema>;
