/**
 * Local response types for the clinical read endpoints.
 *
 * These mirror the shared backend contract EXACTLY but are deliberately kept
 * local to apps/web (not imported from @vpsy/contracts) so the web app stays
 * decoupled from the backend build. If the contract evolves, update here.
 *
 * Endpoints:
 *   GET /clients/me                                   → ClinicalSummary
 *   GET /clients/:clientId/clinical-summary           → ClinicalSummary
 *   GET /clinicians/me/caseload                       → CaseloadEntry[]
 *   GET /wearables/client/:clientId/rollup?windowDays → WearableRollup
 */

export type TrendDirection = 'increased' | 'decreased' | 'unchanged' | 'baseline';

export interface OutcomePoint {
  construct: string;
  value: number;
  occurredAt: string;
  trend: { direction: TrendDirection; delta: number | null };
}

export interface WearableRollup {
  windowDays: number;
  avgHrvMs: number | null;
  avgSleepHours: number | null;
  restingHrBpm: number | null;
  arousalNote: string;
  series: { date: string; hrvMs: number | null; sleepHours: number | null }[];
}

export interface PlanGoalSummary {
  id: string;
  description: string;
  targetMetric: string | null;
  /** 0–100 */
  progressPct: number;
  status: string;
}

export interface ActivePlanSummary {
  id: string;
  status: string;
  version: number;
  goals: PlanGoalSummary[];
}

export interface LatestAssessmentSummary {
  id: string;
  rawScore: number | null;
  severityBand: string | null;
  interpretation: string | null;
  completedAt: string;
}

export interface RecentNoteSummary {
  id: string;
  signedAt: string | null;
  signedBy: string | null;
  version: number;
  excerpt: string;
}

export interface ClinicalSummary {
  client: {
    id: string;
    displayName: string;
    riskLevel: string;
    preferredLanguage: string;
  };
  nextAppointment: { id: string; startsAt: string; format: string } | null;
  activePlan: ActivePlanSummary | null;
  latestAssessment: LatestAssessmentSummary | null;
  outcomes: OutcomePoint[];
  recentNotes: RecentNoteSummary[];
  wearable: WearableRollup | null;
}

export interface CaseloadEntry {
  clientId: string;
  displayName: string;
  riskLevel: string;
  nextAppointmentAt: string | null;
}
