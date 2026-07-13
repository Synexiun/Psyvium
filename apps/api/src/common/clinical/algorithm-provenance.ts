/**
 * Algorithm provenance stamps (healthcare CDS / EU AI Act transparency).
 * Every deterministic clinical computation should attach a versioned stamp so
 * later audits can reconstruct *which* algorithm produced a flag or score.
 * These are NOT model weights — they are pure code-versioned procedures.
 */

export type AlgorithmFamily =
  | 'screening.composite'
  | 'screening.cssrs_inspired'
  | 'scoring.classical'
  | 'scoring.irt_eap'
  | 'scoring.cat'
  | 'outcomes.rci_jacobson_truax'
  | 'risk.sla'
  | 'risk.safety_plan_completeness'
  | 'matching.rank'
  | 'mbc.schedule'
  | 'coding.icd10_format'
  | 'zero_suicide.checklist'
  | 'analytics.k_anonymity'
  | 'wearables.rollup_nondiagnostic'
  | 'documentation.note_quality';

export interface AlgorithmStamp {
  family: AlgorithmFamily;
  /** Semver of the procedure implementation (bump when math or cutoffs change). */
  version: string;
  /** Short literature / standard citation for clinical governance. */
  citation: string;
  /** ISO timestamp when the computation ran. */
  computedAt: string;
  /** Honest calibration status for psychometric algorithms. */
  calibration?: 'empirical' | 'synthetic_demo' | 'unknown';
}

export function stampAlgorithm(
  family: AlgorithmFamily,
  version: string,
  citation: string,
  extras?: Partial<Pick<AlgorithmStamp, 'calibration'>>,
): AlgorithmStamp {
  return {
    family,
    version,
    citation,
    computedAt: new Date().toISOString(),
    ...extras,
  };
}

/** Registry of current algorithm versions — single place to bump. */
export const ALGORITHM_VERSIONS = {
  screeningComposite: '2.1.0',
  cssrsInspired: '1.3.0',
  classicalScoring: '1.2.0',
  irtEap: '1.1.0',
  cat: '1.1.0',
  rci: '1.2.0',
  riskSla: '1.1.0',
  safetyPlanCompleteness: '1.0.0',
  matchingRank: '1.2.0',
  mbcSchedule: '1.0.0',
  icd10Format: '1.0.0',
  zeroSuicide: '1.0.0',
  analyticsKAnonymity: '1.0.0',
  wearablesRollup: '1.0.0',
  noteQuality: '1.0.0',
} as const;
