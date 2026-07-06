/**
 * Shared clinical + business enumerations.
 * Single source of truth consumed by both the NestJS API and the Next.js web app,
 * so UI labels and DB values can never drift. Mirrors the Prisma enums.
 */

export const Role = {
  CLIENT: 'CLIENT',
  PSYCHOLOGIST: 'PSYCHOLOGIST',
  MANAGER: 'MANAGER',
  SUPERVISOR: 'SUPERVISOR',
  ADMIN: 'ADMIN',
  FINANCE: 'FINANCE',
  EXECUTIVE: 'EXECUTIVE',
  GOVERNMENT: 'GOVERNMENT',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const SeverityBand = {
  LOW: 'LOW',
  MODERATE: 'MODERATE',
  HIGH: 'HIGH',
  SEVERE: 'SEVERE',
} as const;
export type SeverityBand = (typeof SeverityBand)[keyof typeof SeverityBand];

export const TherapyFormat = {
  INDIVIDUAL: 'INDIVIDUAL',
  COUPLE: 'COUPLE',
  FAMILY: 'FAMILY',
  GROUP: 'GROUP',
} as const;
export type TherapyFormat = (typeof TherapyFormat)[keyof typeof TherapyFormat];

export const AssignmentStatus = {
  PROPOSED: 'PROPOSED',
  APPROVED: 'APPROVED',
  ACTIVE: 'ACTIVE',
  TRANSFERRED: 'TRANSFERRED',
  CLOSED: 'CLOSED',
} as const;
export type AssignmentStatus = (typeof AssignmentStatus)[keyof typeof AssignmentStatus];

export const AppointmentStatus = {
  BOOKED: 'BOOKED',
  CONFIRMED: 'CONFIRMED',
  COMPLETED: 'COMPLETED',
  NO_SHOW: 'NO_SHOW',
  CANCELLED: 'CANCELLED',
} as const;
export type AppointmentStatus = (typeof AppointmentStatus)[keyof typeof AppointmentStatus];

export const SessionModality = {
  VIDEO: 'VIDEO',
  AUDIO: 'AUDIO',
  IN_PERSON: 'IN_PERSON',
} as const;
export type SessionModality = (typeof SessionModality)[keyof typeof SessionModality];

export const RiskType = {
  SUICIDAL_IDEATION: 'SUICIDAL_IDEATION',
  SELF_HARM: 'SELF_HARM',
  HOMICIDAL: 'HOMICIDAL',
  DOMESTIC_VIOLENCE: 'DOMESTIC_VIOLENCE',
  ABUSE_NEGLECT: 'ABUSE_NEGLECT',
  PSYCHOSIS: 'PSYCHOSIS',
  MANIA: 'MANIA',
  SEVERE_SUBSTANCE: 'SEVERE_SUBSTANCE',
  MEDICAL_EMERGENCY: 'MEDICAL_EMERGENCY',
} as const;
export type RiskType = (typeof RiskType)[keyof typeof RiskType];

export const RiskSource = {
  SCREENING: 'SCREENING',
  AI: 'AI',
  CLINICIAN: 'CLINICIAN',
  WEARABLE: 'WEARABLE',
} as const;
export type RiskSource = (typeof RiskSource)[keyof typeof RiskSource];

export const RiskStatus = {
  OPEN: 'OPEN',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  ESCALATED: 'ESCALATED',
  RESOLVED: 'RESOLVED',
} as const;
export type RiskStatus = (typeof RiskStatus)[keyof typeof RiskStatus];

export const InterventionType = {
  CBT: 'CBT',
  DBT: 'DBT',
  ACT: 'ACT',
  SCHEMA: 'SCHEMA',
  EMDR_REFERRAL: 'EMDR_REFERRAL',
  EXPOSURE: 'EXPOSURE',
  BEHAVIORAL_ACTIVATION: 'BEHAVIORAL_ACTIVATION',
  MINDFULNESS: 'MINDFULNESS',
  PSYCHOEDUCATION: 'PSYCHOEDUCATION',
  SLEEP_HYGIENE: 'SLEEP_HYGIENE',
  COUPLES: 'COUPLES',
  FAMILY: 'FAMILY',
  CRISIS_SAFETY: 'CRISIS_SAFETY',
  RELAPSE_PREVENTION: 'RELAPSE_PREVENTION',
} as const;
export type InterventionType = (typeof InterventionType)[keyof typeof InterventionType];

export const ConsentType = {
  TELEPSYCHOLOGY: 'TELEPSYCHOLOGY',
  DATA_PROCESSING: 'DATA_PROCESSING',
  RECORDING: 'RECORDING',
  RESEARCH: 'RESEARCH',
  CRISIS_POLICY: 'CRISIS_POLICY',
  /**
   * WAVE CR — AI-consent remediation (docs/10-10-PROGRAM.md WAVE CR; APA AI
   * guidance 2025 / GDPR Art.22). Gates whether the AI Gateway may send a
   * client-linked inference to a real model. Deliberately NOT part of
   * `REQUIRED_CONSENT_VERSIONS` (packages/contracts/src/dto/consent.ts) — a
   * client who declines or revokes this consent still receives full care;
   * the AI Gateway simply degrades to its honest rule-based path.
   */
  AI_ASSISTED_ANALYSIS: 'AI_ASSISTED_ANALYSIS',
} as const;
export type ConsentType = (typeof ConsentType)[keyof typeof ConsentType];

export const ScoringMethod = {
  CLASSICAL: 'CLASSICAL',
  IRT: 'IRT',
  CAT: 'CAT',
} as const;
export type ScoringMethod = (typeof ScoringMethod)[keyof typeof ScoringMethod];

/**
 * IRT response models (07-psychometrics-engine.md §5). Mirrors the Prisma
 * `IrtModel` enum. RASCH/TWO_PL/THREE_PL are dichotomous (0/1 responses);
 * GRM (Graded Response Model) covers ordered polytomous (Likert) items.
 */
export const IrtModel = {
  RASCH: 'RASCH',
  TWO_PL: 'TWO_PL',
  THREE_PL: 'THREE_PL',
  GRM: 'GRM',
} as const;
export type IrtModel = (typeof IrtModel)[keyof typeof IrtModel];

export const AiAgent = {
  INTAKE: 'INTAKE',
  DIFFERENTIAL: 'DIFFERENTIAL',
  TREATMENT_PLAN: 'TREATMENT_PLAN',
  SESSION_NOTE: 'SESSION_NOTE',
  OUTCOME: 'OUTCOME',
  CRISIS_RISK: 'CRISIS_RISK',
  PSYCHOMETRIC: 'PSYCHOMETRIC',
  ALLOCATION: 'ALLOCATION',
} as const;
export type AiAgent = (typeof AiAgent)[keyof typeof AiAgent];

export const HumanDecision = {
  ACCEPTED: 'ACCEPTED',
  MODIFIED: 'MODIFIED',
  REJECTED: 'REJECTED',
  PENDING: 'PENDING',
} as const;
export type HumanDecision = (typeof HumanDecision)[keyof typeof HumanDecision];

export const ContractType = {
  SALARY: 'SALARY',
  PER_SESSION: 'PER_SESSION',
  REVENUE_SHARE: 'REVENUE_SHARE',
  TIERED_COMMISSION: 'TIERED_COMMISSION',
} as const;
export type ContractType = (typeof ContractType)[keyof typeof ContractType];

// ── Group G — Business & Finance (contexts 24/25/26) ──
export const InvoiceStatus = {
  DRAFT: 'DRAFT',
  OPEN: 'OPEN',
  PAID: 'PAID',
  REFUNDED: 'REFUNDED',
  VOID: 'VOID',
} as const;
export type InvoiceStatus = (typeof InvoiceStatus)[keyof typeof InvoiceStatus];

export const PayoutStatus = {
  PENDING: 'PENDING',
  COMPUTED: 'COMPUTED',
  RELEASED: 'RELEASED',
  FAILED: 'FAILED',
} as const;
export type PayoutStatus = (typeof PayoutStatus)[keyof typeof PayoutStatus];

// ── Group I — CRM & Referrals (context 29) ──
export const LeadSource = {
  WEB: 'WEB',
  REFERRAL: 'REFERRAL',
  CAMPAIGN: 'CAMPAIGN',
  INSTITUTION: 'INSTITUTION',
} as const;
export type LeadSource = (typeof LeadSource)[keyof typeof LeadSource];

export const ReferrerType = {
  DOCTOR: 'DOCTOR',
  SCHOOL: 'SCHOOL',
  EMPLOYER: 'EMPLOYER',
  COURT: 'COURT',
  INSTITUTION: 'INSTITUTION',
  SELF: 'SELF',
} as const;
export type ReferrerType = (typeof ReferrerType)[keyof typeof ReferrerType];

export const EngagementKind = {
  CALL: 'CALL',
  SMS: 'SMS',
  EMAIL: 'EMAIL',
  MEDIA_MESSAGE: 'MEDIA_MESSAGE',
  NOTE: 'NOTE',
  MEETING: 'MEETING',
} as const;
export type EngagementKind = (typeof EngagementKind)[keyof typeof EngagementKind];

export const EngagementDirection = {
  INBOUND: 'INBOUND',
  OUTBOUND: 'OUTBOUND',
} as const;
export type EngagementDirection = (typeof EngagementDirection)[keyof typeof EngagementDirection];

// ── Group I — Communications Hub (context 30) ──
export const PhoneCapability = {
  VOICE: 'VOICE',
  SMS: 'SMS',
} as const;
export type PhoneCapability = (typeof PhoneCapability)[keyof typeof PhoneCapability];

export const CallDirection = {
  INBOUND: 'INBOUND',
  OUTBOUND: 'OUTBOUND',
} as const;
export type CallDirection = (typeof CallDirection)[keyof typeof CallDirection];

export const CallStatus = {
  RINGING: 'RINGING',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  NO_ANSWER: 'NO_ANSWER',
  FAILED: 'FAILED',
  VOICEMAIL: 'VOICEMAIL',
} as const;
export type CallStatus = (typeof CallStatus)[keyof typeof CallStatus];

export const SmsDirection = {
  INBOUND: 'INBOUND',
  OUTBOUND: 'OUTBOUND',
} as const;
export type SmsDirection = (typeof SmsDirection)[keyof typeof SmsDirection];

export const SmsStatus = {
  QUEUED: 'QUEUED',
  SENT: 'SENT',
  DELIVERED: 'DELIVERED',
  FAILED: 'FAILED',
} as const;
export type SmsStatus = (typeof SmsStatus)[keyof typeof SmsStatus];

export const MediaKind = {
  VOICE: 'VOICE',
  VIDEO: 'VIDEO',
} as const;
export type MediaKind = (typeof MediaKind)[keyof typeof MediaKind];

export const CommsLogKind = {
  CALL: 'CALL',
  SMS: 'SMS',
  MEDIA_MESSAGE: 'MEDIA_MESSAGE',
} as const;
export type CommsLogKind = (typeof CommsLogKind)[keyof typeof CommsLogKind];

/**
 * WAVE CR item 7 (docs/10-10-PROGRAM.md) — the clinician's coded
 * Formulation/Diagnosis status. Mirrors the Prisma `FormulationStatus` enum.
 * Distinct from `DiagnosisHypothesis.clinicianConfirmed` (a boolean on the
 * assistive differential) — this is the lifecycle of the actual diagnosis.
 */
export const FormulationStatus = {
  PROVISIONAL: 'PROVISIONAL',
  CONFIRMED: 'CONFIRMED',
  RULED_OUT: 'RULED_OUT',
} as const;
export type FormulationStatus = (typeof FormulationStatus)[keyof typeof FormulationStatus];
