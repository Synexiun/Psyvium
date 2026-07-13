/**
 * Clinical validation / algorithm governance register.
 *
 * Every deterministic clinical procedure that could support a marketed claim
 * is listed here with: version, citations, current sign-off status, and whether
 * marketing language is permitted. Default is honest: engineering-complete
 * does NOT equal clinically signed for marketing.
 *
 * Clinical governance records sign-off via VPSY_CLINICAL_SIGNOFF_JSON
 * (see applySignOffOverrides) — no schema migration required for staging.
 *
 * Disclaimer: this is an engineering register, not a regulatory certificate.
 */

import { ALGORITHM_VERSIONS, type AlgorithmFamily } from './algorithm-provenance';
import { CONSTRUCT_REGISTRY } from './psychometrics-registry';

export type ClinicalSignOffStatus =
  /** Implemented, unit-tested, citations in code — not clinical board signed. */
  | 'engineering-complete'
  /** Under formal clinical / psychometric review. */
  | 'internal-clinical-review'
  /** Signed by clinical governance for the listed marketed claims. */
  | 'signed'
  /** Explicitly not offered as a marketed claim (assistive / operational only). */
  | 'not-marketed';

export interface ClinicalValidationEntry {
  id: string;
  family: AlgorithmFamily;
  version: string;
  title: string;
  /** What product marketing / sales may claim only when status === 'signed'. */
  marketedClaims: string[];
  citations: string[];
  /** Module / file anchors for auditors. */
  codeAnchors: string[];
  signOffStatus: ClinicalSignOffStatus;
  /** When false, UI/API must not present scores as diagnostic. Always false unless signed for diagnosis claims (we never allow autonomous diagnosis). */
  marketingAllowed: boolean;
  /** Human decision always required (AI assists principle). */
  requiresHumanDecision: true;
  signedBy?: string;
  signedAt?: string;
  notes?: string;
}

const BASE_REGISTER: ClinicalValidationEntry[] = [
  {
    id: 'screening.composite',
    family: 'screening.composite',
    version: ALGORITHM_VERSIONS.screeningComposite,
    title: 'Intake composite screening score & urgency',
    marketedClaims: [
      'Structured intake screening with deterministic severity band mapping',
    ],
    citations: [
      'AERA/APA/NCME Standards for Educational and Psychological Testing (2014)',
      'Network-configured batteries; not a standalone diagnostic instrument',
    ],
    codeAnchors: [
      'apps/api/src/modules/intake/',
      'apps/api/src/common/clinical/severity.ts',
    ],
    signOffStatus: 'engineering-complete',
    marketingAllowed: false,
    requiresHumanDecision: true,
    notes: 'Assistive triage only — never a diagnosis.',
  },
  {
    id: 'screening.cssrs_inspired',
    family: 'screening.cssrs_inspired',
    version: ALGORITHM_VERSIONS.cssrsInspired,
    title: 'Safety-item risk flags (C-SSRS-inspired mapping)',
    marketedClaims: [
      'Deterministic elevation of risk flags from configured safety items',
    ],
    citations: [
      'C-SSRS conceptual mapping (Posner et al.) — implementation is inspired, not a licensed C-SSRS product',
      'Joint Commission NPSG 15.01.01 (suicide prevention)',
    ],
    codeAnchors: [
      'apps/api/src/modules/psychometrics/',
      'apps/api/src/common/clinical-safety.spec.ts',
    ],
    signOffStatus: 'engineering-complete',
    marketingAllowed: false,
    requiresHumanDecision: true,
    notes:
      'Do not market as "C-SSRS certified" without license + clinical sign-off. Safety items raise RiskFlag for human review.',
  },
  {
    id: 'scoring.classical',
    family: 'scoring.classical',
    version: ALGORITHM_VERSIONS.classicalScoring,
    title: 'Classical test theory sum scoring',
    marketedClaims: ['Sum-score administration for licensed instrument versions'],
    citations: ['Classical test theory; instrument-specific manuals when licensed'],
    codeAnchors: ['apps/api/src/modules/psychometrics/'],
    signOffStatus: 'engineering-complete',
    marketingAllowed: false,
    requiresHumanDecision: true,
  },
  {
    id: 'scoring.irt_eap',
    family: 'scoring.irt_eap',
    version: ALGORITHM_VERSIONS.irtEap,
    title: 'IRT EAP scoring',
    marketedClaims: ['IRT expected a posteriori scoring when item parameters are calibrated'],
    citations: ['Bock & Mislevy EAP; honest synthetic_demo calibration warnings when uncalibrated'],
    codeAnchors: ['apps/api/src/modules/psychometrics/'],
    signOffStatus: 'engineering-complete',
    marketingAllowed: false,
    requiresHumanDecision: true,
    notes: 'Calibration status must be exposed; never claim empirical norms on synthetic_demo banks.',
  },
  {
    id: 'scoring.cat',
    family: 'scoring.cat',
    version: ALGORITHM_VERSIONS.cat,
    title: 'Computerized adaptive testing (CAT)',
    marketedClaims: ['Adaptive item selection under instrument license grant'],
    citations: ['IRT CAT literature; InstrumentLicenseGrant enforced'],
    codeAnchors: ['apps/api/src/modules/psychometrics/'],
    signOffStatus: 'engineering-complete',
    marketingAllowed: false,
    requiresHumanDecision: true,
  },
  {
    id: 'outcomes.rci',
    family: 'outcomes.rci_jacobson_truax',
    version: ALGORITHM_VERSIONS.rci,
    title: 'Reliable Change Index (Jacobson–Truax)',
    marketedClaims: [
      'Reliable improvement / deterioration / no-reliable-change on constructs with published psychometrics',
    ],
    citations: [
      'Jacobson & Truax (1991)',
      ...CONSTRUCT_REGISTRY.filter((c) => c.normStatus === 'published').map((c) => c.citation),
    ],
    codeAnchors: [
      'apps/api/src/common/clinical/psychometrics-registry.ts',
      'apps/api/src/modules/outcomes/',
    ],
    signOffStatus: 'engineering-complete',
    marketingAllowed: false,
    requiresHumanDecision: true,
    notes: 'Unknown constructs return unknown-reliability — never fabricate SEM.',
  },
  {
    id: 'risk.sla',
    family: 'risk.sla',
    version: ALGORITHM_VERSIONS.riskSla,
    title: 'Crisis escalation SLA breach detection',
    marketedClaims: ['Operational SLA timers on open escalations'],
    citations: ['Zero Suicide / crisis ops practice; platform SLA config'],
    codeAnchors: ['apps/api/src/modules/risk/risk-sla.service.ts'],
    signOffStatus: 'not-marketed',
    marketingAllowed: false,
    requiresHumanDecision: true,
    notes: 'Operational control, not a clinical score.',
  },
  {
    id: 'risk.safety_plan',
    family: 'risk.safety_plan_completeness',
    version: ALGORITHM_VERSIONS.safetyPlanCompleteness,
    title: 'Stanley–Brown SPI completeness checks',
    marketedClaims: ['Safety plan completeness checklist against SPI elements'],
    citations: ['Stanley–Brown Safety Planning Intervention'],
    codeAnchors: ['apps/api/src/common/clinical/safety-plan-completeness.ts'],
    signOffStatus: 'engineering-complete',
    marketingAllowed: false,
    requiresHumanDecision: true,
  },
  {
    id: 'matching.rank',
    family: 'matching.rank',
    version: ALGORITHM_VERSIONS.matchingRank,
    title: 'Clinician matching rank',
    marketedClaims: ['Ranked assignment candidates for manager approval'],
    citations: ['Credential re-check; manager remains final assignment authority'],
    codeAnchors: ['apps/api/src/modules/matching/'],
    signOffStatus: 'not-marketed',
    marketingAllowed: false,
    requiresHumanDecision: true,
  },
  {
    id: 'mbc.schedule',
    family: 'mbc.schedule',
    version: ALGORITHM_VERSIONS.mbcSchedule,
    title: 'Measurement-based care schedule',
    marketedClaims: ['Suggested re-administration cadence for measures'],
    citations: ['MBC practice literature; schedule is assistive'],
    codeAnchors: ['apps/api/src/common/clinical/mbc-schedule.ts'],
    signOffStatus: 'engineering-complete',
    marketingAllowed: false,
    requiresHumanDecision: true,
  },
  {
    id: 'ai.gateway',
    family: 'documentation.note_quality',
    version: ALGORITHM_VERSIONS.noteQuality,
    title: 'AI clinical assistance (human-decision gate)',
    marketedClaims: [],
    citations: [
      'EU AI Act human oversight',
      'FDA CDS guidance (non-device CDS when clinician decides)',
      'APA AI guidance 2025',
    ],
    codeAnchors: [
      'apps/api/src/modules/ai-gateway/',
      'docs/technical/05-ai-clinical-layer.md',
    ],
    signOffStatus: 'not-marketed',
    marketingAllowed: false,
    requiresHumanDecision: true,
    notes:
      'Core principle: AI assists, licensed clinicians decide. No autonomous diagnosis. PENDING human decision on AIRecommendation.',
  },
];

export interface SignOffOverride {
  status: ClinicalSignOffStatus;
  signedBy?: string;
  signedAt?: string;
  notes?: string;
}

/**
 * Parse VPSY_CLINICAL_SIGNOFF_JSON:
 * { "outcomes.rci": { "status": "signed", "signedBy": "Dr. X, Clinical Board", "signedAt": "2026-08-01" } }
 */
export function parseSignOffOverrides(
  raw: string | undefined = process.env.VPSY_CLINICAL_SIGNOFF_JSON,
): Record<string, SignOffOverride> {
  if (!raw || raw.trim().length === 0) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, SignOffOverride>;
    if (typeof parsed !== 'object' || parsed === null) return {};
    return parsed;
  } catch {
    throw new Error(
      '[clinical] VPSY_CLINICAL_SIGNOFF_JSON is set but is not valid JSON. Fix or unset.',
    );
  }
}

export function applySignOffOverrides(
  entries: ClinicalValidationEntry[],
  overrides: Record<string, SignOffOverride> = parseSignOffOverrides(),
): ClinicalValidationEntry[] {
  return entries.map((e) => {
    const o = overrides[e.id];
    if (!o?.status) return { ...e };
    const signed = o.status === 'signed';
    return {
      ...e,
      signOffStatus: o.status,
      // Marketing only when explicitly signed AND claims exist — never for empty AI claims.
      marketingAllowed: signed && e.marketedClaims.length > 0,
      signedBy: o.signedBy ?? e.signedBy,
      signedAt: o.signedAt ?? e.signedAt,
      notes: o.notes ?? e.notes,
    };
  });
}

export function listClinicalValidationRegister(
  overrides?: Record<string, SignOffOverride>,
): ClinicalValidationEntry[] {
  return applySignOffOverrides(BASE_REGISTER, overrides ?? parseSignOffOverrides());
}

export function clinicalValidationSummary(entries = listClinicalValidationRegister()) {
  const byStatus: Record<ClinicalSignOffStatus, number> = {
    'engineering-complete': 0,
    'internal-clinical-review': 0,
    signed: 0,
    'not-marketed': 0,
  };
  for (const e of entries) {
    byStatus[e.signOffStatus] += 1;
  }
  const marketable = entries.filter((e) => e.marketingAllowed);
  return {
    total: entries.length,
    byStatus,
    marketableCount: marketable.length,
    /** True when no entry claims marketing without sign-off. */
    governanceHonest:
      entries.every((e) => !e.marketingAllowed || e.signOffStatus === 'signed') &&
      entries.every((e) => e.requiresHumanDecision === true),
  };
}
