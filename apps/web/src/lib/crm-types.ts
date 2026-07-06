/**
 * Local response types for the CRM & Referrals endpoints (context 29).
 *
 * These mirror the shared backend contract EXACTLY but are deliberately kept
 * local to apps/web (not imported from @vpsy/contracts) so the web app stays
 * decoupled from the backend build. If the contract evolves, update here.
 *
 * Endpoints:
 *   GET   /crm/board                          → CrmBoardDto
 *   POST  /crm/leads                          → LeadDto
 *   PATCH /crm/leads/:id/stage                → LeadDto
 *   POST  /crm/leads/:id/convert              → LeadDto
 *   POST  /crm/referrers                      → ReferrerDto
 *   GET   /crm/referrers                      → ReferrerDto[]
 *   POST  /crm/engagement                     → EngagementDto
 *   GET   /crm/timeline/:subjectType/:subjectId → EngagementDto[]
 */

export type LeadSource = 'WEB' | 'REFERRAL' | 'CAMPAIGN' | 'INSTITUTION';

export type ReferrerType =
  | 'DOCTOR'
  | 'SCHOOL'
  | 'EMPLOYER'
  | 'COURT'
  | 'INSTITUTION'
  | 'SELF';

export type EngagementKind = 'CALL' | 'SMS' | 'EMAIL' | 'MEDIA_MESSAGE' | 'NOTE' | 'MEETING';
export type EngagementDirection = 'INBOUND' | 'OUTBOUND';
export type EngagementSubjectType = 'LEAD' | 'REFERRER' | 'CLIENT';

export interface PipelineStageDto {
  id: string;
  name: string;
  order: number;
  isWon: boolean;
  isLost: boolean;
}

export interface LeadContact {
  name: string;
  email?: string;
  phone?: string;
}

export interface LeadDto {
  id: string;
  source: LeadSource;
  contact: LeadContact;
  /** Marketing-qualified interest signal — never clinical content. */
  presentingInterest?: string;
  pipelineStageId: string;
  pipelineStageName: string;
  status: string;
  referrerId?: string;
  createdAt: string;
}

export interface ReferrerDto {
  id: string;
  type: ReferrerType;
  organizationName: string;
  contact: { name?: string; email?: string; phone?: string };
  referralSharePct: number;
  active: boolean;
}

export interface EngagementDto {
  id: string;
  subjectType: string;
  subjectId: string;
  kind: EngagementKind;
  direction: EngagementDirection;
  summary: string;
  occurredAt: string;
}

export interface CrmBoardDto {
  stages: PipelineStageDto[];
  leadsByStage: Record<string, LeadDto[]>;
  referrers: ReferrerDto[];
}

/* ── Request payloads ─────────────────────────────────────────────────── */

export interface CreateLeadInput {
  source: LeadSource;
  contact: LeadContact;
  presentingInterest?: string;
  referrerId?: string;
}

export interface CreateReferrerInput {
  type: ReferrerType;
  organizationName: string;
  contact: { name?: string; email?: string; phone?: string };
  referralSharePct: number;
}

export interface CreateEngagementInput {
  subjectType: EngagementSubjectType;
  subjectId: string;
  kind: EngagementKind;
  direction: EngagementDirection;
  summary: string;
  occurredAt: string;
}
