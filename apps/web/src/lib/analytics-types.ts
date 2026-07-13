/**
 * Local response types for Reports (ctx 27) + National Analytics (ctx 28).
 * Mirror the shared backend contract exactly; kept local to apps/web.
 * National Analytics is aggregate + de-identified ONLY — metrics whose cohort
 * is below the k-anonymity floor arrive `suppressed: true` with `value: null`.
 *
 * Endpoints:
 *   GET /reports/executive   → ExecutiveReportDto
 *   GET /reports/manager     → ManagerReportDto
 *   GET /analytics/national  → NationalAnalyticsDto
 */

export interface ExecutiveReportDto {
  generatedAt: string;
  currency: string;
  revenue: { paidTotal: string; outstanding: string; payoutsPending: string };
  clients: { total: number; active: number };
  clinicians: { count: number; avgOutcomeIndex: number };
  outcomes: { measureCount: number; avgValue: number | null };
}

export interface ManagerReportDto {
  generatedAt: string;
  intakes: { total: number; bySeverity: { LOW: number; MODERATE: number; HIGH: number; SEVERE: number } };
  assignments: { proposed: number; approved: number };
  risk: { openEscalations: number; openFlags: number };
  appointments: { upcoming: number; noShows: number };
}

export interface NationalMetricDto {
  region: string;
  metric: string;
  value: number | null;
  unit: string | null;
  window: string;
  cohortSize: number;
  suppressed: boolean;
}

export interface NationalAnalyticsDto {
  generatedAt: string;
  kAnonymityFloor: number;
  metrics: NationalMetricDto[];
  meta: {
    kAnonymityPolicy: string;
    kAnonymityFloor: number;
    algorithm: {
      family: string;
      version: string;
      citation: string;
      computedAt: string;
    };
  };
}
