/**
 * Measurement-based care psychometrics registry.
 *
 * Published SD + test–retest/internal consistency coefficients for RCI and
 * reliable-change classification. Only instruments with citable published
 * psychometrics live here — free-text constructs fall back to
 * `unknown-reliability` (never fabricated).
 *
 * Citations are kept next to the numbers so clinical governance can audit
 * every constant without reverse-engineering code history.
 */

export type ConstructPolarity = 'lower-is-better' | 'higher-is-better';

export interface ConstructPsychometrics {
  /** Canonical construct key used in OutcomeMeasure.construct. */
  key: string;
  displayName: string;
  aliases: string[];
  sd: number;
  reliability: number;
  polarity: ConstructPolarity;
  /** Typical clinical range for validation (not a hard clamp). */
  scoreRange: [number, number];
  /** Caseness / screen-positive guidance (assistive — never diagnostic). */
  screenPositiveAt?: number;
  citation: string;
  /** AERA/APA/NCME honesty: empirical vs synthetic demo norms. */
  normStatus: 'published' | 'synthetic_demo';
}

export const CONSTRUCT_REGISTRY: ConstructPsychometrics[] = [
  {
    key: 'depression',
    displayName: 'Depression severity (PHQ-9 convention)',
    aliases: ['depression', 'phq-9', 'phq9', 'phq_9'],
    sd: 6.1,
    reliability: 0.86,
    polarity: 'lower-is-better',
    scoreRange: [0, 27],
    screenPositiveAt: 10,
    citation:
      'PHQ-9: Kroenke, Spitzer & Williams (2001); Löwe et al. (2004). SD≈6.1, α≈0.86.',
    normStatus: 'published',
  },
  {
    key: 'anxiety',
    displayName: 'Anxiety severity (GAD-7 convention)',
    aliases: ['anxiety', 'gad-7', 'gad7', 'gad_7'],
    sd: 5.5,
    reliability: 0.89,
    polarity: 'lower-is-better',
    scoreRange: [0, 21],
    screenPositiveAt: 10,
    citation:
      'GAD-7: Spitzer, Kroenke, Williams & Löwe (2006). SD≈5.5, α≈0.89.',
    normStatus: 'published',
  },
  {
    key: 'wellbeing',
    displayName: 'Psychological well-being (WHO-5 convention)',
    aliases: ['wellbeing', 'well-being', 'who-5', 'who5'],
    sd: 20.0,
    reliability: 0.82,
    polarity: 'higher-is-better',
    scoreRange: [0, 100],
    citation:
      'WHO-5: Topp et al. (2015) systematic review; Topp 2015 α typically 0.82–0.95.',
    normStatus: 'published',
  },
  {
    key: 'ptsd',
    displayName: 'PTSD symptom severity (PCL-5 convention)',
    aliases: ['ptsd', 'pcl-5', 'pcl5', 'pcl_5'],
    sd: 15.0,
    reliability: 0.94,
    polarity: 'lower-is-better',
    scoreRange: [0, 80],
    screenPositiveAt: 31,
    citation:
      'PCL-5: Blevins et al. (2015); Bovin et al. (2016). α≈0.94; provisional cut ≈31–33.',
    normStatus: 'published',
  },
  {
    key: 'alcohol',
    displayName: 'Alcohol use risk (AUDIT convention)',
    aliases: ['alcohol', 'audit', 'alcohol_use'],
    sd: 6.5,
    reliability: 0.8,
    polarity: 'lower-is-better',
    scoreRange: [0, 40],
    screenPositiveAt: 8,
    citation:
      'AUDIT: Saunders et al. (1993); Babor et al. WHO. Zone cutoffs 8/16/20.',
    normStatus: 'published',
  },
  {
    key: 'perinatal_depression',
    displayName: 'Perinatal depression screen (EPDS convention)',
    aliases: ['epds', 'perinatal', 'perinatal_depression', 'postpartum'],
    sd: 5.5,
    reliability: 0.87,
    polarity: 'lower-is-better',
    scoreRange: [0, 30],
    screenPositiveAt: 13,
    citation:
      'EPDS: Cox, Holden & Sagovsky (1987); common cut 12/13 for possible depression.',
    normStatus: 'published',
  },
];

const ALIAS_INDEX = new Map<string, ConstructPsychometrics>();
for (const entry of CONSTRUCT_REGISTRY) {
  for (const alias of entry.aliases) {
    ALIAS_INDEX.set(alias.toLowerCase(), entry);
  }
  ALIAS_INDEX.set(entry.key.toLowerCase(), entry);
}

export function resolveConstructPsychometrics(
  construct: string,
): ConstructPsychometrics | null {
  return ALIAS_INDEX.get(construct.trim().toLowerCase()) ?? null;
}

/**
 * Jacobson & Truax (1991) Reliable Change Index.
 * Returns null rci when psychometrics are unknown — never invent reliability.
 */
export function computeReliableChangeIndex(
  construct: string,
  previousValue: number,
  currentValue: number,
): {
  rci: number | null;
  classification:
    | 'reliably-improved'
    | 'reliably-worsened'
    | 'no-reliable-change'
    | 'unknown-reliability'
    | 'baseline';
  citation: string | null;
  algorithmVersion: string;
} {
  const psych = resolveConstructPsychometrics(construct);
  if (!psych) {
    return {
      rci: null,
      classification: 'unknown-reliability',
      citation: null,
      algorithmVersion: '1.2.0',
    };
  }
  const sem = psych.sd * Math.sqrt(1 - psych.reliability);
  const seDiff = sem * Math.sqrt(2);
  const rci = Number(((currentValue - previousValue) / seDiff).toFixed(4));
  if (Math.abs(rci) < 1.96) {
    return {
      rci,
      classification: 'no-reliable-change',
      citation: psych.citation,
      algorithmVersion: '1.2.0',
    };
  }
  const improved = psych.polarity === 'lower-is-better' ? rci < 0 : rci > 0;
  return {
    rci,
    classification: improved ? 'reliably-improved' : 'reliably-worsened',
    citation: psych.citation,
    algorithmVersion: '1.2.0',
  };
}
