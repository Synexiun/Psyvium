import { Role } from './enums';

/**
 * Permissions are `context:action` strings. Roles grant coarse permissions;
 * ABAC attributes (tenantId, clinicId, jurisdiction, consentState) refine them
 * at decision time (see the API's ability layer). The server is the source of
 * truth; the frontend imports this only for UI gating.
 */
export const Permission = {
  // Intake & screening
  INTAKE_SUBMIT: 'intake:submit',
  INTAKE_READ: 'intake:read',
  SCREENING_READ: 'screening:read',
  CONSENT_GRANT: 'consent:grant',
  // Credentialing & Contracts
  CREDENTIAL_WRITE: 'credential:write',
  CREDENTIAL_VERIFY: 'credential:verify',
  // Matching & assignment
  ASSIGNMENT_PROPOSE: 'assignment:propose',
  ASSIGNMENT_APPROVE: 'assignment:approve',
  ASSIGNMENT_READ: 'assignment:read',
  // Clinical
  CLIENT_READ: 'client:read',
  CLIENT_WRITE: 'client:write',
  SESSION_HOST: 'session:host',
  NOTE_WRITE: 'note:write',
  NOTE_READ: 'note:read',
  PLAN_WRITE: 'plan:write',
  PLAN_READ: 'plan:read',
  INTERVENTION_WRITE: 'intervention:write',
  // Risk
  RISK_READ: 'risk:read',
  ESCALATION_HANDLE: 'escalation:handle',
  SAFETYPLAN_WRITE: 'safetyplan:write',
  BREAKGLASS_INVOKE: 'breakglass:invoke',
  // Psychometrics
  ASSESSMENT_ADMINISTER: 'assessment:administer',
  ASSESSMENT_INTERPRET: 'assessment:interpret',
  // Outcomes
  OUTCOME_RECORD: 'outcome:record',
  OUTCOME_READ: 'outcome:read',
  // Wearables
  WEARABLE_READ: 'wearable:read',
  WEARABLE_WRITE: 'wearable:write',
  // Business
  INVOICE_READ: 'invoice:read',
  PAYOUT_MANAGE: 'payout:manage',
  ACCOUNTING_READ: 'accounting:read',
  // Finance (contexts 24/25/26 — Payments, Accounting, Revenue Share/Payouts)
  FINANCE_READ: 'finance:read',
  FINANCE_MANAGE: 'finance:manage',
  // AI
  AI_SUGGEST: 'ai:suggest',
  AI_DECISION: 'ai:decision',
  // Governance
  AUDIT_READ: 'audit:read',
  ADMIN_CONFIG: 'admin:config',
  NATIONAL_ANALYTICS_READ: 'national:read',
  // Reports (ctx 27, Phase 6 — Executive + Manager operational/clinical reporting)
  REPORTS_READ: 'reports:read',
  // CRM & Referrals
  CRM_READ: 'crm:read',
  CRM_WRITE: 'crm:write',
  // Communications Hub
  COMMS_READ: 'comms:read',
  COMMS_WRITE: 'comms:write',
  // Scheduling
  SCHEDULING_READ: 'scheduling:read',
  SCHEDULING_MANAGE: 'scheduling:manage',
  SCHEDULING_BOOK: 'scheduling:book',
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];

/** Baseline role → permission grants. ABAC narrows these further at runtime. */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  [Role.CLIENT]: [
    Permission.INTAKE_SUBMIT,
    Permission.INVOICE_READ,
    Permission.ASSESSMENT_ADMINISTER,
    Permission.CLIENT_READ,
    Permission.WEARABLE_READ,
    Permission.WEARABLE_WRITE,
    Permission.CONSENT_GRANT,
    // Communications Hub: read own comms log + send/read async media
    // messages in their own thread; click-to-call and SMS send are gated
    // to PSYCHOLOGIST/MANAGER inside CommunicationsService (ABAC-in-service,
    // see `15-communications-and-telephony.md` §7.3).
    Permission.COMMS_READ,
    Permission.COMMS_WRITE,
    // Scheduling (ctx 9): a client reads their own agenda + books into an
    // approved-assignment slot; managing availability/status is clinician/ops.
    Permission.SCHEDULING_READ,
    Permission.SCHEDULING_BOOK,
  ],
  [Role.PSYCHOLOGIST]: [
    Permission.INTAKE_READ,
    Permission.SCREENING_READ,
    Permission.CLIENT_READ,
    Permission.CLIENT_WRITE,
    Permission.SESSION_HOST,
    Permission.NOTE_WRITE,
    Permission.NOTE_READ,
    Permission.PLAN_WRITE,
    Permission.PLAN_READ,
    Permission.INTERVENTION_WRITE,
    Permission.RISK_READ,
    // Risk & Crisis (ctx 21): per the RBAC matrix (06-security-and-rbac.md
    // §4.3) Psychologist holds full RCUF on Risk & Crisis — the treating
    // clinician handles their own client's escalations and authors safety
    // plans; break-glass is available for emergency access to any client.
    Permission.ESCALATION_HANDLE,
    Permission.SAFETYPLAN_WRITE,
    Permission.BREAKGLASS_INVOKE,
    Permission.ASSESSMENT_ADMINISTER,
    Permission.ASSESSMENT_INTERPRET,
    Permission.OUTCOME_RECORD,
    Permission.OUTCOME_READ,
    Permission.WEARABLE_READ,
    Permission.AI_SUGGEST,
    Permission.AI_DECISION,
    Permission.CREDENTIAL_WRITE,
    Permission.COMMS_READ,
    Permission.COMMS_WRITE,
    // Scheduling (ctx 9): manages own availability, marks appointment
    // status, sends reminders.
    Permission.SCHEDULING_READ,
    Permission.SCHEDULING_MANAGE,
  ],
  [Role.MANAGER]: [
    Permission.INTAKE_READ,
    Permission.SCREENING_READ,
    Permission.ASSIGNMENT_PROPOSE,
    Permission.ASSIGNMENT_APPROVE,
    Permission.ASSIGNMENT_READ,
    Permission.CLIENT_READ,
    Permission.RISK_READ,
    Permission.ESCALATION_HANDLE,
    // Break-glass is an ops/emergency-access lever, not a clinical-authoring
    // one — Manager gets invoke, not SAFETYPLAN_WRITE (non-clinical role).
    Permission.BREAKGLASS_INVOKE,
    Permission.OUTCOME_READ,
    Permission.WEARABLE_READ,
    Permission.AI_SUGGEST,
    Permission.AUDIT_READ,
    Permission.CREDENTIAL_WRITE,
    Permission.CREDENTIAL_VERIFY,
    Permission.CRM_READ,
    Permission.CRM_WRITE,
    Permission.COMMS_READ,
    Permission.COMMS_WRITE,
    // Scheduling (ctx 9): tenant-wide agenda visibility, can book on a
    // client's behalf, and can manage availability/status/reminders.
    Permission.SCHEDULING_READ,
    Permission.SCHEDULING_MANAGE,
    Permission.SCHEDULING_BOOK,
    // Finance (ctx 24/25/26): a MANAGER can operate the business day-to-day
    // (raise invoices, capture payments, compute payouts) alongside FINANCE.
    Permission.FINANCE_READ,
    Permission.FINANCE_MANAGE,
    // Reports (ctx 27): a MANAGER reads the operational report for their clinic.
    Permission.REPORTS_READ,
  ],
  [Role.SUPERVISOR]: [
    Permission.CLIENT_READ,
    Permission.NOTE_WRITE,
    Permission.NOTE_READ,
    Permission.PLAN_READ,
    Permission.RISK_READ,
    Permission.ESCALATION_HANDLE,
    Permission.SAFETYPLAN_WRITE,
    Permission.BREAKGLASS_INVOKE,
    Permission.ASSESSMENT_INTERPRET,
    Permission.OUTCOME_READ,
  ],
  [Role.ADMIN]: [
    Permission.ADMIN_CONFIG,
    Permission.AUDIT_READ,
    Permission.CLIENT_READ,
    Permission.CREDENTIAL_VERIFY,
    Permission.CRM_READ,
    Permission.CRM_WRITE,
  ],
  [Role.FINANCE]: [
    Permission.INVOICE_READ,
    Permission.PAYOUT_MANAGE,
    Permission.ACCOUNTING_READ,
    Permission.FINANCE_READ,
    Permission.FINANCE_MANAGE,
  ],
  [Role.EXECUTIVE]: [
    Permission.ACCOUNTING_READ,
    Permission.AUDIT_READ,
    // Finance (ctx 24/25/26): Executive gets read-only visibility into the
    // business — invoices, ledger, payouts, summary — never manage.
    Permission.FINANCE_READ,
    // Reports (ctx 27): Executive reads the tenant-wide executive report.
    Permission.REPORTS_READ,
    // National Analytics (ctx 28): Executive also sees de-identified,
    // aggregate national insight alongside Government (Phase 6 DoD).
    Permission.NATIONAL_ANALYTICS_READ,
  ],
  [Role.GOVERNMENT]: [Permission.NATIONAL_ANALYTICS_READ],
};
