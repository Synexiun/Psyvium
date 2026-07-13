import { SeverityBand } from '@vpsy/contracts';

/**
 * Shared clinical severity lattice used everywhere risk, intake, psychometrics,
 * and outcomes escalate a client's reflected risk level. Escalate-only semantics:
 * a later observation may raise, never silently lower, a client's risk band.
 */
export const SEVERITY_RANK: Record<string, number> = {
  [SeverityBand.LOW]: 1,
  [SeverityBand.MODERATE]: 2,
  [SeverityBand.HIGH]: 3,
  [SeverityBand.SEVERE]: 4,
  // legacy / free-text aliases seen in older rows
  low: 1,
  mild: 1,
  moderate: 2,
  high: 3,
  severe: 4,
  critical: 4,
};

export function severityRank(band: string | null | undefined): number {
  if (!band) return 0;
  return SEVERITY_RANK[band] ?? SEVERITY_RANK[band.toUpperCase()] ?? 0;
}

/** True when nextBand is strictly higher than previous on the clinical lattice. */
export function isSeverityEscalation(
  previous: string | null | undefined,
  next: string | null | undefined,
): boolean {
  return severityRank(next) > severityRank(previous);
}

/** Max of two bands — used when merging concurrent clinical signals. */
export function maxSeverity(a: string | null | undefined, b: string | null | undefined): string {
  return severityRank(a) >= severityRank(b) ? (a ?? SeverityBand.LOW) : (b ?? SeverityBand.LOW);
}
