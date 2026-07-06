'use client';

/**
 * Thin browser API client. Talks to the NestJS API through the Next rewrite
 * proxy (/api/backend/* → API /api/v1/*), so the browser never needs the API
 * origin and CORS stays simple.
 *
 * Secure token storage (doc 06-security-and-rbac.md §3): the access token
 * itself is NEVER held in JS-reachable storage. The API sets it in an
 * httpOnly, SameSite=Lax cookie on login/register, and every request here
 * goes out with `credentials: 'include'` so the browser attaches it
 * automatically — a same-origin request via the rewrite above, so no CORS
 * dance is needed. What we DO keep client-side is a small, non-sensitive
 * "principal hint" (userId/roles/permissions, no token) purely so the UI can
 * route/label itself without waiting on a round trip; it carries no
 * authority — the API re-derives the real principal from the cookie/bearer
 * token on every request, so a tampered or stale hint can misroute the UI at
 * worst, never grant access.
 */
import type { AuthTokens } from '@vpsy/contracts';
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
  CompleteEscalationFollowUpInput,
  CreateIncidentReviewInput,
  CreateSafetyPlanInput,
  CrisisResourcesDto,
  EscalationDto,
  IncidentReviewDto,
  PendingIncidentReviewsDto,
  ResolveEscalationInput,
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

const PRINCIPAL_HINT_KEY = 'vpsy.principalHint';

export interface Principal {
  sub: string;
  roles: string[];
  permissions: string[];
}

/**
 * COMPAT SHIM — not part of the hardened auth path, kept only because a
 * handful of files outside this pass's scope still read/write a raw client
 * token directly and cannot be edited here:
 *   - `lib/live-events.tsx` puts it in the Socket.IO handshake `auth.token`,
 *     because `common/realtime/realtime.gateway.ts` (also out of scope this
 *     pass) authenticates sockets from a bearer-style token, not the httpOnly
 *     cookie — cookies aren't in the handshake payload it reads.
 *   - The per-page "quick sign-in" widgets (comms/crm/finance/home/intake/
 *     manager/reports/risk/schedule/session) call `setToken`/`getToken`
 *     directly around their own `api.login()` calls and client-side gates.
 *
 * `request()` below NEVER reads this — every real API call is authorized
 * solely by the httpOnly session cookie (or an `Authorization: Bearer`
 * header from a non-browser client). This value grants nothing there.
 *
 * It lives in `sessionStorage`, not `localStorage`: it does not persist past
 * the tab/browser closing and isn't shared across tabs, which removes the
 * "steal once, replay indefinitely across restarts" exposure of the old
 * localStorage copy. It is still readable by an active same-page XSS like any
 * JS-reachable store — fully closing that gap means migrating the files
 * above off a client-held token (e.g. cookie-aware socket auth), which is
 * outside this pass's file scope and tracked as a follow-up.
 */
const LEGACY_TOKEN_KEY = 'vpsy.legacyToken';

export function setToken(token: string) {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(LEGACY_TOKEN_KEY, token);
  } catch {
    /* storage unavailable (private mode, quota) — the cookie session still works */
  }
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return sessionStorage.getItem(LEGACY_TOKEN_KEY);
  } catch {
    return null;
  }
}

function clearLegacyToken() {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(LEGACY_TOKEN_KEY);
  } catch {
    /* noop */
  }
}

/**
 * Persists the non-sensitive principal summary the API returns on
 * login/register — never the token. Pass `null` to clear it (sign-out).
 */
export function rememberPrincipal(principal: Principal | null) {
  if (typeof window === 'undefined') return;
  if (principal) localStorage.setItem(PRINCIPAL_HINT_KEY, JSON.stringify(principal));
  else localStorage.removeItem(PRINCIPAL_HINT_KEY);
}

/**
 * Reads the locally-remembered principal hint for UI role-routing only. This
 * is NOT an authorization decision — it carries no token and grants nothing;
 * the server independently re-derives the real principal from the session
 * cookie (or bearer token) on every request. Returns null when signed out or
 * the hint cannot be parsed.
 */
export function getPrincipal(): Principal | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(PRINCIPAL_HINT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.sub !== 'string') return null;
    return {
      sub: parsed.sub,
      roles: Array.isArray(parsed.roles) ? parsed.roles : [],
      permissions: Array.isArray(parsed.permissions) ? parsed.permissions : [],
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
  const res = await fetch(`/api/backend${path}`, {
    ...options,
    // Same-origin (the Next rewrite proxies server-side), so this is enough
    // to carry the httpOnly session cookie — no token ever touches JS.
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

/** Clears the local principal hint, the legacy compat token, and the server session cookie. Real sign-out. */
export async function logout() {
  rememberPrincipal(null);
  clearLegacyToken();
  try {
    await request('/auth/logout', { method: 'POST' });
  } catch {
    // Best-effort — the cookie may already be gone; local state is cleared regardless.
  }
}

export const api = {
  login: (email: string, password: string, totp?: string) =>
    request<AuthTokens>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, ...(totp ? { totp } : {}) }),
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
  riskResolveEscalation: (id: string, payload: ResolveEscalationInput) =>
    request<EscalationDto>(`/risk/escalations/${id}/resolve`, { method: 'POST', body: JSON.stringify(payload) }),
  riskCompleteFollowUp: (id: string, payload: CompleteEscalationFollowUpInput = {}) =>
    request<EscalationDto>(`/risk/escalations/${id}/follow-up`, { method: 'PATCH', body: JSON.stringify(payload) }),
  riskCreateSafetyPlan: (payload: CreateSafetyPlanInput) =>
    request<SafetyPlanDto>('/risk/safety-plans', { method: 'POST', body: JSON.stringify(payload) }),
  riskSafetyPlan: (clientId: string) =>
    request<SafetyPlanDto | null>(`/risk/safety-plans/client/${clientId}`),
  /** Client-facing read of the signed-in client's own latest safety plan. */
  riskMySafetyPlan: () => request<SafetyPlanDto | null>('/risk/safety-plans/me'),
  riskBreakGlass: (clientId: string, reason: string) =>
    request<BreakGlassResultDto>('/risk/break-glass', { method: 'POST', body: JSON.stringify({ clientId, reason }) }),
  /** Post-incident review (TJC sentinel-event review practice) — never gates resolution. */
  riskCreateIncidentReview: (payload: CreateIncidentReviewInput) =>
    request<IncidentReviewDto>('/risk/incident-reviews', { method: 'POST', body: JSON.stringify(payload) }),
  /** "Never ages silently": SEVERE resolutions + break-glass grants with no review yet. */
  riskPendingIncidentReviews: () => request<PendingIncidentReviewsDto>('/risk/incident-reviews/pending'),
  riskIncidentReviewsForSubject: (subjectId: string) =>
    request<IncidentReviewDto[]>(`/risk/incident-reviews/subject/${subjectId}`),
  /** Jurisdiction-aware emergency resources (APA telepsychology guidance — 988 is US-only). */
  riskCrisisResources: () => request<CrisisResourcesDto>('/risk/crisis-resources'),

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
