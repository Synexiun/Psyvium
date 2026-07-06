'use client';

/**
 * Thin browser API client. Talks to the NestJS API through the Next rewrite
 * proxy (/api/backend/* → API /api/v1/*), so the browser never needs the API
 * origin and CORS stays simple. The access token is kept in localStorage for
 * the demo; a production build moves it to an httpOnly cookie.
 */
import type { CaseloadEntry, ClinicalSummary, WearableRollup } from './clinical-types';
import type {
  CreateEngagementInput,
  CreateLeadInput,
  CreateReferrerInput,
  CrmBoardDto,
  EngagementDto,
  LeadDto,
  ReferrerDto,
} from './crm-types';
import type {
  CallSessionDto,
  ClickToCallInput,
  CommsLogEntryDto,
  CreateMediaMessageInput,
  MediaMessageDto,
  RtcTokenDto,
  SendSmsInput,
  SmsMessageDto,
} from './comms-types';
import type {
  BreakGlassResultDto,
  CreateSafetyPlanInput,
  EscalationDto,
  RiskBoardDto,
  RiskFlagDto,
  SafetyPlanDto,
} from './risk-types';
import type {
  AppointmentDto,
  AppointmentStatus,
  AvailabilitySlotDto,
  BookAppointmentInput,
  CreateAvailabilityInput,
} from './scheduling-types';
import type {
  ComputePayoutInput,
  CreateInvoiceInput,
  FinanceSummaryDto,
  InvoiceDto,
  LedgerEntryDto,
  PaymentDto,
  PayoutDto,
} from './finance-types';
import type { ExecutiveReportDto, ManagerReportDto, NationalAnalyticsDto } from './analytics-types';

const TOKEN_KEY = 'vpsy.accessToken';

export function setToken(token: string) {
  if (typeof window !== 'undefined') localStorage.setItem(TOKEN_KEY, token);
}
export function getToken(): string | null {
  return typeof window !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null;
}
export function clearToken() {
  if (typeof window !== 'undefined') localStorage.removeItem(TOKEN_KEY);
}

/** Clears the stored session. Real sign-out — the server session (if any) is stateless JWT. */
export function logout() {
  clearToken();
}

export interface Principal {
  sub: string;
  roles: string[];
  permissions: string[];
}

/**
 * Decodes the access token's payload for UI role-routing only — the signature is
 * NOT verified client-side (the server is the sole authority on every request).
 * Returns null when there is no token or it cannot be decoded as a JWT.
 */
export function getPrincipal(): Principal | null {
  const token = getToken();
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const base64url = parts[1]!;
    const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const json = typeof window !== 'undefined' ? window.atob(padded) : Buffer.from(padded, 'base64').toString('utf-8');
    const decoded = decodeURIComponent(
      Array.prototype.map.call(json, (c: string) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''),
    );
    const payload = JSON.parse(decoded);
    if (!payload || typeof payload.sub !== 'string') return null;
    return {
      sub: payload.sub,
      roles: Array.isArray(payload.roles) ? payload.roles : [],
      permissions: Array.isArray(payload.permissions) ? payload.permissions : [],
    };
  } catch {
    return null;
  }
}

export class ApiError extends Error {
  constructor(public status: number, public body: unknown) {
    super(`API ${status}`);
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`/api/backend${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

export const api = {
  login: (email: string, password: string) =>
    request<{ accessToken: string; refreshToken: string; expiresIn: number }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  submitIntake: (payload: unknown) =>
    request('/intake', { method: 'POST', body: JSON.stringify(payload) }),
  listProposals: () => request<any[]>('/assignments/proposals'),
  approveAssignment: (assignmentId: string, psychologistId: string, managerNote?: string) =>
    request('/assignments/approve', {
      method: 'POST',
      body: JSON.stringify({ assignmentId, psychologistId, managerNote }),
    }),
  health: () => request<{ status: string; db: string }>('/health'),

  // ── Clinical contexts (Documentation, Treatment Planning, Psychometrics, Outcomes) ──
  createSessionNote: (sessionId: string, content: unknown) =>
    request('/session-notes', { method: 'POST', body: JSON.stringify({ sessionId, content }) }),
  listSessionNotes: (sessionId: string) => request<any[]>(`/session-notes/session/${sessionId}`),
  signSessionNote: (id: string) => request(`/session-notes/${id}/sign`, { method: 'POST' }),

  createTreatmentPlan: (payload: unknown) =>
    request('/treatment-plans', { method: 'POST', body: JSON.stringify(payload) }),
  activePlan: (clientId: string) => request<any>(`/treatment-plans/client/${clientId}/active`),
  updateGoalProgress: (goalId: string, progressPct: number, status?: string) =>
    request('/treatment-plans/goals/progress', {
      method: 'PATCH',
      body: JSON.stringify({ goalId, progressPct, status }),
    }),

  administerAssessment: (versionId: string, clientId: string, answers: Record<string, number>) =>
    request('/assessments/responses', {
      method: 'POST',
      body: JSON.stringify({ versionId, clientId, answers }),
    }),
  getAssessment: (id: string) => request<any>(`/assessments/responses/${id}`),

  recordOutcome: (clientId: string, construct: string, value: number) =>
    request('/outcomes', { method: 'POST', body: JSON.stringify({ clientId, construct, value }) }),
  clientOutcomes: (clientId: string) => request<any[]>(`/outcomes/client/${clientId}`),

  // ── Clinical read model (types mirror the shared contract — see clinical-types.ts) ──
  clientMe: () => request<ClinicalSummary>('/clients/me'),
  clinicalSummary: (clientId: string) =>
    request<ClinicalSummary>(`/clients/${clientId}/clinical-summary`),
  myCaseload: () => request<CaseloadEntry[]>('/clinicians/me/caseload'),
  wearableRollup: (clientId: string, windowDays = 7) =>
    request<WearableRollup>(`/wearables/client/${clientId}/rollup?windowDays=${windowDays}`),

  // ── CRM & Referrals (context 29 — types mirror the shared contract, see crm-types.ts) ──
  crmBoard: () => request<CrmBoardDto>('/crm/board'),
  crmCreateLead: (payload: CreateLeadInput) =>
    request<LeadDto>('/crm/leads', { method: 'POST', body: JSON.stringify(payload) }),
  crmMoveLeadStage: (leadId: string, toStageId: string) =>
    request<LeadDto>(`/crm/leads/${leadId}/stage`, {
      method: 'PATCH',
      body: JSON.stringify({ toStageId }),
    }),
  crmConvertLead: (leadId: string) =>
    request<LeadDto>(`/crm/leads/${leadId}/convert`, { method: 'POST' }),
  crmCreateReferrer: (payload: CreateReferrerInput) =>
    request<ReferrerDto>('/crm/referrers', { method: 'POST', body: JSON.stringify(payload) }),
  crmListReferrers: () => request<ReferrerDto[]>('/crm/referrers'),
  crmLogEngagement: (payload: CreateEngagementInput) =>
    request<EngagementDto>('/crm/engagement', { method: 'POST', body: JSON.stringify(payload) }),
  crmTimeline: (subjectType: string, subjectId: string) =>
    request<EngagementDto[]>(`/crm/timeline/${subjectType}/${subjectId}`),

  // ── Communications Hub (context 30 — types mirror the shared contract, see comms-types.ts) ──
  commsClickToCall: (payload: ClickToCallInput) =>
    request<CallSessionDto>('/comms/calls/click-to-call', { method: 'POST', body: JSON.stringify(payload) }),
  commsSendSms: (payload: SendSmsInput) =>
    request<SmsMessageDto>('/comms/sms', { method: 'POST', body: JSON.stringify(payload) }),
  commsLog: (clientId?: string) =>
    request<CommsLogEntryDto[]>(`/comms/log${clientId ? `?clientId=${clientId}` : ''}`),
  commsCreateMediaMessage: (payload: CreateMediaMessageInput) =>
    request<MediaMessageDto>('/comms/media-messages', { method: 'POST', body: JSON.stringify(payload) }),
  commsThreadMedia: (threadId: string) =>
    request<MediaMessageDto[]>(`/comms/media-messages/thread/${threadId}`),
  commsMarkMediaRead: (id: string) =>
    request<MediaMessageDto>(`/comms/media-messages/${id}/read`, { method: 'PATCH' }),
  commsRtcToken: (sessionId?: string) =>
    request<RtcTokenDto>('/comms/rtc/token', { method: 'POST', body: JSON.stringify({ sessionId }) }),

  // ── Risk & Crisis (context 21 — types mirror the shared contract, see risk-types.ts) ──
  riskBoard: () => request<RiskBoardDto>('/risk/board'),
  riskAcknowledgeFlag: (id: string) =>
    request<RiskFlagDto>(`/risk/flags/${id}/acknowledge`, { method: 'PATCH' }),
  riskAssignEscalation: (id: string, assignedTo: string) =>
    request<EscalationDto>(`/risk/escalations/${id}/assign`, { method: 'POST', body: JSON.stringify({ assignedTo }) }),
  riskResolveEscalation: (id: string, resolution: string) =>
    request<EscalationDto>(`/risk/escalations/${id}/resolve`, { method: 'POST', body: JSON.stringify({ resolution }) }),
  riskCreateSafetyPlan: (payload: CreateSafetyPlanInput) =>
    request<SafetyPlanDto>('/risk/safety-plans', { method: 'POST', body: JSON.stringify(payload) }),
  riskSafetyPlan: (clientId: string) =>
    request<SafetyPlanDto | null>(`/risk/safety-plans/client/${clientId}`),
  riskBreakGlass: (clientId: string, reason: string) =>
    request<BreakGlassResultDto>('/risk/break-glass', { method: 'POST', body: JSON.stringify({ clientId, reason }) }),

  // ── Scheduling (context 9 — types mirror the shared contract, see scheduling-types.ts) ──
  schedAgenda: () => request<AppointmentDto[]>('/scheduling/appointments'),
  schedAddAvailability: (payload: CreateAvailabilityInput) =>
    request<AvailabilitySlotDto>('/scheduling/availability', { method: 'POST', body: JSON.stringify(payload) }),
  schedAvailability: (psychologistId: string) =>
    request<AvailabilitySlotDto[]>(`/scheduling/availability/psychologist/${psychologistId}`),
  schedBook: (payload: BookAppointmentInput) =>
    request<AppointmentDto>('/scheduling/appointments/book', { method: 'POST', body: JSON.stringify(payload) }),
  schedSetStatus: (id: string, status: AppointmentStatus) =>
    request<AppointmentDto>(`/scheduling/appointments/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  schedRemind: (id: string) =>
    request<{ ok: boolean }>(`/scheduling/appointments/${id}/remind`, { method: 'POST' }),

  // ── Finance: Payments / Accounting / Payouts (ctx 24-26 — see finance-types.ts; money is strings) ──
  financeSummary: () => request<FinanceSummaryDto>('/finance/summary'),
  financeInvoices: () => request<InvoiceDto[]>('/finance/invoices'),
  financeCreateInvoice: (payload: CreateInvoiceInput) =>
    request<InvoiceDto>('/finance/invoices', { method: 'POST', body: JSON.stringify(payload) }),
  financePayInvoice: (id: string, method?: string) =>
    request<PaymentDto>(`/finance/invoices/${id}/pay`, { method: 'POST', body: JSON.stringify({ method }) }),
  financeLedger: () => request<LedgerEntryDto[]>('/finance/ledger'),
  financePayouts: () => request<PayoutDto[]>('/finance/payouts'),
  financeComputePayout: (payload: ComputePayoutInput) =>
    request<PayoutDto>('/finance/payouts/compute', { method: 'POST', body: JSON.stringify(payload) }),

  // ── Reports + National Analytics (ctx 27-28 — see analytics-types.ts) ──
  reportExecutive: () => request<ExecutiveReportDto>('/reports/executive'),
  reportManager: () => request<ManagerReportDto>('/reports/manager'),
  nationalAnalytics: () => request<NationalAnalyticsDto>('/analytics/national'),
};
