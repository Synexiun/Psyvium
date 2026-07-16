import type { PrismaClient } from '@prisma/client';

/**
 * Standard instrument pack (doc 07 §2/§9) — the widely used, freely
 * reproducible screening instruments, seeded VERBATIM with their published
 * item text, scoring keys, and cut-score conventions.
 *
 * LICENSING — every instrument here is free to reproduce for clinical use:
 *  - PHQ-9 / GAD-7 / PHQ-15: developed by Drs. Spitzer, Kroenke, Williams et
 *    al. with an educational grant from Pfizer; no permission required to
 *    reproduce, translate, display or distribute.
 *  - PCL-5: U.S. National Center for PTSD — public domain.
 *  - AUDIT: World Health Organization — may be reproduced with citation.
 *  - K10: Kessler — public domain.
 *  - WHODAS 2.0: WHO — free to use with attribution.
 *  - EPDS: Cox, Holden & Sagovsky 1987 — reproducible with citation.
 *  - Rosenberg Self-Esteem Scale: public domain (Morris Rosenberg Foundation).
 *  - SWLS: Diener et al. 1985 — free for professional use.
 * Instruments that require a paid license (BDI-II, MMPI, PSQI, ISI …) are
 * deliberately NOT seeded — they enter through `InstrumentLicenseGrant` when
 * a tenant actually holds the license (the 403 gate already enforces this).
 *
 * SCORING KEY DESIGN: every response option is an explicit `{label, value}`
 * pair, so reverse-keyed items (EPDS, Rosenberg) and non-linear keys (AUDIT
 * items 9–10: 0/2/4) are encoded in the option VALUES the client submits —
 * the deterministic raw-sum ScoringService then needs no per-item transform,
 * and the stored answers ARE the keyed values.
 *
 * Each version's `cutoffs` carries: `bands` (the platform's 4-band severity
 * mapping of the published convention), optional `subBands`, an EXPLICIT
 * `safetyItems` array (empty = reviewed, none — required by
 * validateSafetyConfiguration), and `guide` — the clinician-facing scoring
 * key + interpretation reference surfaced through the instrument catalog.
 */

type Option = { label: string; value: number };
type PackItem = { stem: string; options: Option[] };

interface PackInstrument {
  code: string;
  name: string;
  construct: string;
  itemIdPrefix: string;
  cutoffs: Record<string, unknown>;
  items: PackItem[];
}

const opts = (...pairs: Array<[string, number]>): Option[] =>
  pairs.map(([label, value]) => ({ label, value }));

/** PHQ-9 / GAD-7 frequency anchors (0–3). */
const FREQ_0_3 = opts(
  ['Not at all', 0],
  ['Several days', 1],
  ['More than half the days', 2],
  ['Nearly every day', 3],
);

/** AUDIT items 3–8 frequency anchors (0–4). */
const AUDIT_FREQ = opts(
  ['Never', 0],
  ['Less than monthly', 1],
  ['Monthly', 2],
  ['Weekly', 3],
  ['Daily or almost daily', 4],
);

/** K10 anchors (1–5). */
const K10_FREQ = opts(
  ['None of the time', 1],
  ['A little of the time', 2],
  ['Some of the time', 3],
  ['Most of the time', 4],
  ['All of the time', 5],
);

/** PCL-5 anchors (0–4). */
const PCL5_SEVERITY = opts(
  ['Not at all', 0],
  ['A little bit', 1],
  ['Moderately', 2],
  ['Quite a bit', 3],
  ['Extremely', 4],
);

/** WHODAS 2.0 difficulty anchors (0–4). */
const WHODAS_DIFFICULTY = opts(
  ['None', 0],
  ['Mild', 1],
  ['Moderate', 2],
  ['Severe', 3],
  ['Extreme or cannot do', 4],
);

/** PHQ-15 bother anchors (0–2). */
const PHQ15_BOTHER = opts(['Not bothered at all', 0], ['Bothered a little', 1], ['Bothered a lot', 2]);

/** SWLS agreement anchors (1–7). */
const SWLS_AGREE = opts(
  ['Strongly disagree', 1],
  ['Disagree', 2],
  ['Slightly disagree', 3],
  ['Neither agree nor disagree', 4],
  ['Slightly agree', 5],
  ['Agree', 6],
  ['Strongly agree', 7],
);

const INSTRUMENTS: PackInstrument[] = [
  // ── PHQ-9 — depression ────────────────────────────────────────────────
  {
    code: 'PHQ-9',
    name: 'Patient Health Questionnaire-9 (PHQ-9)',
    construct: 'depression',
    itemIdPrefix: 'item_phq9',
    cutoffs: {
      bands: [
        { band: 'LOW', min: 0, max: 4 },
        { band: 'MODERATE', min: 5, max: 9 },
        { band: 'HIGH', min: 10, max: 14 },
        { band: 'SEVERE', min: 15, max: 27 },
      ],
      subBands: [
        { parentBand: 'SEVERE', label: 'MODERATELY_SEVERE', min: 15, max: 19 },
        { parentBand: 'SEVERE', label: 'SEVERE', min: 20, max: 27 },
      ],
      safetyItems: [{ itemId: 'q9', minAnswer: 1, category: 'suicidal_ideation' }],
      guide: {
        scoringKey:
          'Sum of 9 items, each 0–3 (Not at all → Nearly every day), total 0–27. Stem: "Over the last 2 weeks, how often have you been bothered by any of the following problems?"',
        bandGuide:
          '0–4 minimal; 5–9 mild; 10–14 moderate; 15–19 moderately severe; 20–27 severe. A score ≥10 has ~88% sensitivity/specificity for major depression. Item 9 (self-harm/suicidal ideation) at any endorsement warrants direct risk assessment regardless of total — the platform raises a deterministic risk flag automatically.',
        reference:
          'Kroenke K, Spitzer RL, Williams JB (2001). The PHQ-9: validity of a brief depression severity measure. J Gen Intern Med 16(9):606-13.',
        psychometrics:
          'Internal consistency α ≈ .86–.89; test-retest r ≈ .84; criterion validity against structured interview well established across primary-care and specialty samples.',
        cautions:
          'A severity screen, not a diagnostic interview — DSM-5 MDD diagnosis requires clinical assessment of criteria, duration, and functional impact. Somatic items (sleep, energy, appetite) can inflate scores in medical illness.',
      },
    },
    items: [
      { stem: 'Little interest or pleasure in doing things', options: FREQ_0_3 },
      { stem: 'Feeling down, depressed, or hopeless', options: FREQ_0_3 },
      { stem: 'Trouble falling or staying asleep, or sleeping too much', options: FREQ_0_3 },
      { stem: 'Feeling tired or having little energy', options: FREQ_0_3 },
      { stem: 'Poor appetite or overeating', options: FREQ_0_3 },
      {
        stem: 'Feeling bad about yourself — or that you are a failure or have let yourself or your family down',
        options: FREQ_0_3,
      },
      {
        stem: 'Trouble concentrating on things, such as reading the newspaper or watching television',
        options: FREQ_0_3,
      },
      {
        stem:
          'Moving or speaking so slowly that other people could have noticed? Or the opposite — being so fidgety or restless that you have been moving around a lot more than usual',
        options: FREQ_0_3,
      },
      {
        stem: 'Thoughts that you would be better off dead or of hurting yourself in some way',
        options: FREQ_0_3,
      },
    ],
  },

  // ── GAD-7 — anxiety ───────────────────────────────────────────────────
  {
    code: 'GAD-7',
    name: 'Generalized Anxiety Disorder-7 (GAD-7)',
    construct: 'anxiety',
    itemIdPrefix: 'item_gad7',
    cutoffs: {
      bands: [
        { band: 'LOW', min: 0, max: 4 },
        { band: 'MODERATE', min: 5, max: 9 },
        { band: 'HIGH', min: 10, max: 14 },
        { band: 'SEVERE', min: 15, max: 21 },
      ],
      safetyItems: [],
      guide: {
        scoringKey:
          'Sum of 7 items, each 0–3 (Not at all → Nearly every day), total 0–21. Stem: "Over the last 2 weeks, how often have you been bothered by the following problems?"',
        bandGuide:
          '0–4 minimal; 5–9 mild; 10–14 moderate; 15–21 severe. A score ≥10 is the recommended further-evaluation threshold (sensitivity 89%, specificity 82% for GAD). Also useful as a severity screen for panic, social anxiety, and PTSD.',
        reference:
          'Spitzer RL, Kroenke K, Williams JB, Löwe B (2006). A brief measure for assessing generalized anxiety disorder: the GAD-7. Arch Intern Med 166(10):1092-7.',
        psychometrics: 'Internal consistency α = .92; test-retest r = .83; strong convergent validity with anxiety scales.',
        cautions: 'Screens severity, not diagnosis; does not differentiate anxiety disorders from each other.',
      },
    },
    items: [
      { stem: 'Feeling nervous, anxious, or on edge', options: FREQ_0_3 },
      { stem: 'Not being able to stop or control worrying', options: FREQ_0_3 },
      { stem: 'Worrying too much about different things', options: FREQ_0_3 },
      { stem: 'Trouble relaxing', options: FREQ_0_3 },
      { stem: 'Being so restless that it is hard to sit still', options: FREQ_0_3 },
      { stem: 'Becoming easily annoyed or irritable', options: FREQ_0_3 },
      { stem: 'Feeling afraid, as if something awful might happen', options: FREQ_0_3 },
    ],
  },

  // ── PHQ-15 — somatic symptoms ─────────────────────────────────────────
  {
    code: 'PHQ-15',
    name: 'Patient Health Questionnaire-15 (PHQ-15, somatic symptoms)',
    construct: 'somatic_symptoms',
    itemIdPrefix: 'item_phq15',
    cutoffs: {
      bands: [
        { band: 'LOW', min: 0, max: 4 },
        { band: 'MODERATE', min: 5, max: 9 },
        { band: 'HIGH', min: 10, max: 14 },
        { band: 'SEVERE', min: 15, max: 30 },
      ],
      safetyItems: [],
      guide: {
        scoringKey:
          'Sum of 15 somatic symptom items, each 0–2 (Not bothered at all / Bothered a little / Bothered a lot), total 0–30. Stem: "During the past 4 weeks, how much have you been bothered by any of the following problems?"',
        bandGuide: '0–4 minimal; 5–9 low; 10–14 medium; 15–30 high somatic symptom severity.',
        reference:
          'Kroenke K, Spitzer RL, Williams JB (2002). The PHQ-15: validity of a new measure for evaluating the severity of somatic symptoms. Psychosom Med 64(2):258-66.',
        psychometrics: 'α ≈ .80; severity bands track disability days, symptom-related difficulty, and healthcare use.',
        cautions:
          'Item 4 (menstrual problems) applies to menstruating patients only — interpret totals accordingly. Elevated scores warrant medical differential, not automatic somatization attribution.',
      },
    },
    items: [
      { stem: 'Stomach pain', options: PHQ15_BOTHER },
      { stem: 'Back pain', options: PHQ15_BOTHER },
      { stem: 'Pain in your arms, legs, or joints (knees, hips, etc.)', options: PHQ15_BOTHER },
      { stem: 'Menstrual cramps or other problems with your periods', options: PHQ15_BOTHER },
      { stem: 'Headaches', options: PHQ15_BOTHER },
      { stem: 'Chest pain', options: PHQ15_BOTHER },
      { stem: 'Dizziness', options: PHQ15_BOTHER },
      { stem: 'Fainting spells', options: PHQ15_BOTHER },
      { stem: 'Feeling your heart pound or race', options: PHQ15_BOTHER },
      { stem: 'Shortness of breath', options: PHQ15_BOTHER },
      { stem: 'Pain or problems during sexual intercourse', options: PHQ15_BOTHER },
      { stem: 'Constipation, loose bowels, or diarrhea', options: PHQ15_BOTHER },
      { stem: 'Nausea, gas, or indigestion', options: PHQ15_BOTHER },
      { stem: 'Feeling tired or having low energy', options: PHQ15_BOTHER },
      { stem: 'Trouble sleeping', options: PHQ15_BOTHER },
    ],
  },

  // ── PCL-5 — PTSD ──────────────────────────────────────────────────────
  {
    code: 'PCL-5',
    name: 'PTSD Checklist for DSM-5 (PCL-5)',
    construct: 'ptsd',
    itemIdPrefix: 'item_pcl5',
    cutoffs: {
      bands: [
        { band: 'LOW', min: 0, max: 30 },
        { band: 'HIGH', min: 31, max: 80 },
      ],
      safetyItems: [],
      guide: {
        scoringKey:
          'Sum of 20 items mapped to the DSM-5 PTSD symptom clusters, each 0–4 (Not at all → Extremely), total 0–80. Stem: "In the past month, how much were you bothered by:" Cluster scores: B intrusion = items 1–5; C avoidance = 6–7; D negative cognitions/mood = 8–14; E arousal/reactivity = 15–20.',
        bandGuide:
          'A total of 31–33 or higher suggests probable PTSD and warrants full diagnostic assessment (band HIGH here uses ≥31). DSM-5 provisional-diagnosis method: count items rated ≥2 ("Moderately") as endorsed — requires ≥1 B, ≥1 C, ≥2 D, ≥2 E. A ≥10-point change is reliable; ≥20 points clinically meaningful.',
        reference:
          'Weathers FW, Litz BT, Keane TM, Palmieri PA, Marx BP, Schnurr PP (2013). The PTSD Checklist for DSM-5 (PCL-5). National Center for PTSD.',
        psychometrics: 'α ≈ .95; test-retest r ≈ .82; strong convergent/discriminant validity (Blevins et al. 2015).',
        cautions:
          'Presumes an index Criterion-A trauma — administer with trauma history established. Not a substitute for CAPS-5 structured assessment.',
      },
    },
    items: [
      { stem: 'Repeated, disturbing, and unwanted memories of the stressful experience?', options: PCL5_SEVERITY },
      { stem: 'Repeated, disturbing dreams of the stressful experience?', options: PCL5_SEVERITY },
      {
        stem:
          'Suddenly feeling or acting as if the stressful experience were actually happening again (as if you were actually back there reliving it)?',
        options: PCL5_SEVERITY,
      },
      { stem: 'Feeling very upset when something reminded you of the stressful experience?', options: PCL5_SEVERITY },
      {
        stem:
          'Having strong physical reactions when something reminded you of the stressful experience (for example, heart pounding, trouble breathing, sweating)?',
        options: PCL5_SEVERITY,
      },
      { stem: 'Avoiding memories, thoughts, or feelings related to the stressful experience?', options: PCL5_SEVERITY },
      {
        stem:
          'Avoiding external reminders of the stressful experience (for example, people, places, conversations, activities, objects, or situations)?',
        options: PCL5_SEVERITY,
      },
      { stem: 'Trouble remembering important parts of the stressful experience?', options: PCL5_SEVERITY },
      {
        stem:
          'Having strong negative beliefs about yourself, other people, or the world (for example, having thoughts such as: I am bad, there is something seriously wrong with me, no one can be trusted, the world is completely dangerous)?',
        options: PCL5_SEVERITY,
      },
      {
        stem: 'Blaming yourself or someone else for the stressful experience or what happened after it?',
        options: PCL5_SEVERITY,
      },
      { stem: 'Having strong negative feelings such as fear, horror, anger, guilt, or shame?', options: PCL5_SEVERITY },
      { stem: 'Loss of interest in activities that you used to enjoy?', options: PCL5_SEVERITY },
      { stem: 'Feeling distant or cut off from other people?', options: PCL5_SEVERITY },
      {
        stem:
          'Trouble experiencing positive feelings (for example, being unable to feel happiness or have loving feelings for people close to you)?',
        options: PCL5_SEVERITY,
      },
      { stem: 'Irritable behavior, angry outbursts, or acting aggressively?', options: PCL5_SEVERITY },
      { stem: 'Taking too many risks or doing things that could cause you harm?', options: PCL5_SEVERITY },
      { stem: 'Being "superalert" or watchful or on guard?', options: PCL5_SEVERITY },
      { stem: 'Feeling jumpy or easily startled?', options: PCL5_SEVERITY },
      { stem: 'Having difficulty concentrating?', options: PCL5_SEVERITY },
      { stem: 'Trouble falling or staying asleep?', options: PCL5_SEVERITY },
    ],
  },

  // ── AUDIT — alcohol use ───────────────────────────────────────────────
  {
    code: 'AUDIT',
    name: 'Alcohol Use Disorders Identification Test (AUDIT)',
    construct: 'alcohol_use',
    itemIdPrefix: 'item_audit',
    cutoffs: {
      bands: [
        { band: 'LOW', min: 0, max: 7 },
        { band: 'MODERATE', min: 8, max: 15 },
        { band: 'HIGH', min: 16, max: 19 },
        { band: 'SEVERE', min: 20, max: 40 },
      ],
      safetyItems: [],
      guide: {
        scoringKey:
          'Sum of 10 items, total 0–40. Items 1–8 are scored 0–4; items 9–10 are scored 0 / 2 / 4 (No / Yes, but not in the last year / Yes, during the last year) — the non-linear key is encoded in the option values.',
        bandGuide:
          'WHO risk zones: 0–7 low risk (Zone I — alcohol education); 8–15 hazardous (Zone II — simple advice); 16–19 harmful (Zone III — brief counseling + monitoring); 20–40 possible dependence (Zone IV — diagnostic evaluation for alcohol use disorder). Some guidelines use ≥7 for women and adults over 65.',
        reference:
          'Babor TF, Higgins-Biddle JC, Saunders JB, Monteiro MG (2001). AUDIT: The Alcohol Use Disorders Identification Test, 2nd ed. World Health Organization.',
        psychometrics: 'Sensitivity ~92%, specificity ~94% at the ≥8 cut for hazardous/harmful drinking (original 6-country WHO study).',
        cautions: 'Self-report; consider collateral information where dependence is suspected. "A drink" = one standard drink.',
      },
    },
    items: [
      {
        stem: 'How often do you have a drink containing alcohol?',
        options: opts(
          ['Never', 0],
          ['Monthly or less', 1],
          ['2 to 4 times a month', 2],
          ['2 to 3 times a week', 3],
          ['4 or more times a week', 4],
        ),
      },
      {
        stem: 'How many drinks containing alcohol do you have on a typical day when you are drinking?',
        options: opts(['1 or 2', 0], ['3 or 4', 1], ['5 or 6', 2], ['7 to 9', 3], ['10 or more', 4]),
      },
      { stem: 'How often do you have six or more drinks on one occasion?', options: AUDIT_FREQ },
      {
        stem:
          'How often during the last year have you found that you were not able to stop drinking once you had started?',
        options: AUDIT_FREQ,
      },
      {
        stem:
          'How often during the last year have you failed to do what was normally expected from you because of drinking?',
        options: AUDIT_FREQ,
      },
      {
        stem:
          'How often during the last year have you needed a first drink in the morning to get yourself going after a heavy drinking session?',
        options: AUDIT_FREQ,
      },
      {
        stem: 'How often during the last year have you had a feeling of guilt or remorse after drinking?',
        options: AUDIT_FREQ,
      },
      {
        stem:
          'How often during the last year have you been unable to remember what happened the night before because you had been drinking?',
        options: AUDIT_FREQ,
      },
      {
        stem: 'Have you or someone else been injured as a result of your drinking?',
        options: opts(['No', 0], ['Yes, but not in the last year', 2], ['Yes, during the last year', 4]),
      },
      {
        stem:
          'Has a relative or friend, or a doctor or another health worker, been concerned about your drinking or suggested you cut down?',
        options: opts(['No', 0], ['Yes, but not in the last year', 2], ['Yes, during the last year', 4]),
      },
    ],
  },

  // ── K10 — psychological distress ──────────────────────────────────────
  {
    code: 'K10',
    name: 'Kessler Psychological Distress Scale (K10)',
    construct: 'psychological_distress',
    itemIdPrefix: 'item_k10',
    cutoffs: {
      bands: [
        { band: 'LOW', min: 10, max: 19 },
        { band: 'MODERATE', min: 20, max: 24 },
        { band: 'HIGH', min: 25, max: 29 },
        { band: 'SEVERE', min: 30, max: 50 },
      ],
      safetyItems: [],
      guide: {
        scoringKey:
          'Sum of 10 items, each 1–5 (None of the time → All of the time), total 10–50. Stem: "In the past 4 weeks, about how often did you feel…"',
        bandGuide:
          '10–19 likely to be well; 20–24 likely mild disorder; 25–29 likely moderate disorder; 30–50 likely severe disorder (widely used Australian convention, Andrews & Slade 2001).',
        reference:
          'Kessler RC et al. (2002). Short screening scales to monitor population prevalences and trends in non-specific psychological distress. Psychol Med 32(6):959-76.',
        psychometrics: 'Excellent internal consistency (α ≈ .93); strong discrimination of DSM disorder in population samples.',
        cautions: 'Non-specific distress — elevated scores indicate further assessment, not a specific diagnosis.',
      },
    },
    items: [
      { stem: 'In the past 4 weeks, about how often did you feel tired out for no good reason?', options: K10_FREQ },
      { stem: 'In the past 4 weeks, about how often did you feel nervous?', options: K10_FREQ },
      {
        stem: 'In the past 4 weeks, about how often did you feel so nervous that nothing could calm you down?',
        options: K10_FREQ,
      },
      { stem: 'In the past 4 weeks, about how often did you feel hopeless?', options: K10_FREQ },
      { stem: 'In the past 4 weeks, about how often did you feel restless or fidgety?', options: K10_FREQ },
      {
        stem: 'In the past 4 weeks, about how often did you feel so restless you could not sit still?',
        options: K10_FREQ,
      },
      { stem: 'In the past 4 weeks, about how often did you feel depressed?', options: K10_FREQ },
      { stem: 'In the past 4 weeks, about how often did you feel that everything was an effort?', options: K10_FREQ },
      {
        stem: 'In the past 4 weeks, about how often did you feel so sad that nothing could cheer you up?',
        options: K10_FREQ,
      },
      { stem: 'In the past 4 weeks, about how often did you feel worthless?', options: K10_FREQ },
    ],
  },

  // ── WHODAS 2.0 (12-item) — functioning/disability ─────────────────────
  {
    code: 'WHODAS-2.0-12',
    name: 'WHO Disability Assessment Schedule 2.0 (12-item)',
    construct: 'functioning',
    itemIdPrefix: 'item_whodas12',
    cutoffs: {
      bands: [
        { band: 'LOW', min: 0, max: 9 },
        { band: 'MODERATE', min: 10, max: 19 },
        { band: 'HIGH', min: 20, max: 33 },
        { band: 'SEVERE', min: 34, max: 48 },
      ],
      safetyItems: [],
      guide: {
        scoringKey:
          'Simple scoring: sum of 12 items, each 0–4 (None → Extreme or cannot do), total 0–48. Stem: "In the past 30 days, how much difficulty did you have in:" Covers the six WHODAS domains (cognition, mobility, self-care, getting along, life activities, participation) with two items each.',
        bandGuide:
          'Higher = greater disability. The bands here are DESCRIPTIVE severity strata for tracking, not validated diagnostic cutoffs — the validated approach is comparison against population norms (WHODAS manual percentile tables) or the IRT-based complex scoring. Use for change-over-time within a client and as the DSM-5 recommended cross-cutting disability measure.',
        reference:
          'Üstün TB, Kostanjsek N, Chatterji S, Rehm J, eds. (2010). Measuring Health and Disability: Manual for WHO Disability Assessment Schedule (WHODAS 2.0). WHO. DSM-5 Section III adopts WHODAS 2.0 as its disability measure.',
        psychometrics: 'α ≈ .96 (36-item), 12-item version explains ~81% of the full version\'s variance; strong cross-cultural validity.',
        cautions: 'Bands are descriptive only (flagged above); population-norm percentiles are the validated interpretation.',
      },
    },
    items: [
      { stem: 'Standing for long periods such as 30 minutes?', options: WHODAS_DIFFICULTY },
      { stem: 'Taking care of your household responsibilities?', options: WHODAS_DIFFICULTY },
      { stem: 'Learning a new task, for example, learning how to get to a new place?', options: WHODAS_DIFFICULTY },
      {
        stem:
          'How much of a problem did you have joining in community activities (for example, festivities, religious or other activities) in the same way as anyone else can?',
        options: WHODAS_DIFFICULTY,
      },
      { stem: 'How much have you been emotionally affected by your health problems?', options: WHODAS_DIFFICULTY },
      { stem: 'Concentrating on doing something for ten minutes?', options: WHODAS_DIFFICULTY },
      { stem: 'Walking a long distance such as a kilometre (or equivalent)?', options: WHODAS_DIFFICULTY },
      { stem: 'Washing your whole body?', options: WHODAS_DIFFICULTY },
      { stem: 'Getting dressed?', options: WHODAS_DIFFICULTY },
      { stem: 'Dealing with people you do not know?', options: WHODAS_DIFFICULTY },
      { stem: 'Maintaining a friendship?', options: WHODAS_DIFFICULTY },
      { stem: 'Your day-to-day work?', options: WHODAS_DIFFICULTY },
    ],
  },

  // ── EPDS — perinatal depression ───────────────────────────────────────
  {
    code: 'EPDS',
    name: 'Edinburgh Postnatal Depression Scale (EPDS)',
    construct: 'perinatal_depression',
    itemIdPrefix: 'item_epds',
    cutoffs: {
      bands: [
        { band: 'LOW', min: 0, max: 9 },
        { band: 'MODERATE', min: 10, max: 12 },
        { band: 'HIGH', min: 13, max: 30 },
      ],
      safetyItems: [{ itemId: 'q10', minAnswer: 1, category: 'self_harm' }],
      guide: {
        scoringKey:
          'Sum of 10 items, each 0–3, total 0–30. Items 3 and 5–10 are REVERSE-keyed per the published instrument — the key is encoded in the option values, so the displayed option order matches the printed scale while stored answers are already the scored values. Stem: "In the past 7 days:"',
        bandGuide:
          '≥10 possible depression (re-screen in 2 weeks); ≥13 probable depression — clinical assessment indicated. Item 10 (self-harm thoughts) at ANY endorsement requires immediate risk assessment regardless of total — the platform raises a deterministic risk flag automatically.',
        reference:
          'Cox JL, Holden JM, Sagovsky R (1987). Detection of postnatal depression: development of the 10-item Edinburgh Postnatal Depression Scale. Br J Psychiatry 150:782-6.',
        psychometrics: 'Sensitivity 86%, specificity 78% at ≥13 (original validation); validated antenatally and postnatally, and in fathers (lower cutoffs).',
        cautions:
          'Designed for perinatal populations; deliberately omits somatic items confounded by pregnancy/postpartum. Anxiety subscale (items 3–5) may be examined separately.',
      },
    },
    items: [
      {
        stem: 'I have been able to laugh and see the funny side of things',
        options: opts(
          ['As much as I always could', 0],
          ['Not quite so much now', 1],
          ['Definitely not so much now', 2],
          ['Not at all', 3],
        ),
      },
      {
        stem: 'I have looked forward with enjoyment to things',
        options: opts(
          ['As much as I ever did', 0],
          ['Rather less than I used to', 1],
          ['Definitely less than I used to', 2],
          ['Hardly at all', 3],
        ),
      },
      {
        stem: 'I have blamed myself unnecessarily when things went wrong',
        options: opts(
          ['Yes, most of the time', 3],
          ['Yes, some of the time', 2],
          ['Not very often', 1],
          ['No, never', 0],
        ),
      },
      {
        stem: 'I have been anxious or worried for no good reason',
        options: opts(['No, not at all', 0], ['Hardly ever', 1], ['Yes, sometimes', 2], ['Yes, very often', 3]),
      },
      {
        stem: 'I have felt scared or panicky for no very good reason',
        options: opts(['Yes, quite a lot', 3], ['Yes, sometimes', 2], ['No, not much', 1], ['No, not at all', 0]),
      },
      {
        stem: 'Things have been getting on top of me',
        options: opts(
          ["Yes, most of the time I haven't been able to cope at all", 3],
          ["Yes, sometimes I haven't been coping as well as usual", 2],
          ['No, most of the time I have coped quite well', 1],
          ['No, I have been coping as well as ever', 0],
        ),
      },
      {
        stem: 'I have been so unhappy that I have had difficulty sleeping',
        options: opts(['Yes, most of the time', 3], ['Yes, sometimes', 2], ['Not very often', 1], ['No, not at all', 0]),
      },
      {
        stem: 'I have felt sad or miserable',
        options: opts(['Yes, most of the time', 3], ['Yes, quite often', 2], ['Not very often', 1], ['No, not at all', 0]),
      },
      {
        stem: 'I have been so unhappy that I have been crying',
        options: opts(['Yes, most of the time', 3], ['Yes, quite often', 2], ['Only occasionally', 1], ['No, never', 0]),
      },
      {
        stem: 'The thought of harming myself has occurred to me',
        options: opts(['Yes, quite often', 3], ['Sometimes', 2], ['Hardly ever', 1], ['Never', 0]),
      },
    ],
  },

  // ── Rosenberg Self-Esteem Scale ───────────────────────────────────────
  {
    code: 'RSES',
    name: 'Rosenberg Self-Esteem Scale (RSES)',
    construct: 'self_esteem',
    itemIdPrefix: 'item_rses',
    cutoffs: {
      // INVERSE POLARITY instrument: higher total = HIGHER self-esteem, so
      // the clinical-severity signal is a LOW total. Band labels here are the
      // platform's severity semantics (HIGH = clinically notable), spelled
      // out in the guide so the mapping can never be misread.
      bands: [
        { band: 'HIGH', min: 0, max: 14 },
        { band: 'LOW', min: 15, max: 30 },
      ],
      safetyItems: [],
      guide: {
        scoringKey:
          'Sum of 10 items on a 4-point agreement scale (Strongly agree ↔ Strongly disagree), total 0–30. Items 2, 5, 6, 8, 9 are REVERSE-keyed — the key is encoded in the option values. HIGHER totals mean HIGHER self-esteem (inverse of the platform\'s usual severity polarity).',
        bandGuide:
          'Totals below 15 suggest clinically notable LOW self-esteem (mapped to the HIGH severity band on this platform); 15–25 is the typical range; 26–30 high self-esteem. Interpret alongside mood measures — low self-esteem is transdiagnostic.',
        reference: 'Rosenberg M (1965). Society and the Adolescent Self-Image. Princeton University Press. Public domain.',
        psychometrics: 'α ≈ .88–.90; test-retest r ≈ .85; the most widely used global self-esteem measure with cross-cultural validation in 50+ nations.',
        cautions:
          'POLARITY: on this platform the severity band HIGH means LOW self-esteem (see bandGuide). Attitude measure, not a diagnostic scale; no formal clinical cutoffs — <15 is a convention.',
      },
    },
    items: [
      {
        stem: 'On the whole, I am satisfied with myself.',
        options: opts(['Strongly agree', 3], ['Agree', 2], ['Disagree', 1], ['Strongly disagree', 0]),
      },
      {
        stem: 'At times I think I am no good at all.',
        options: opts(['Strongly agree', 0], ['Agree', 1], ['Disagree', 2], ['Strongly disagree', 3]),
      },
      {
        stem: 'I feel that I have a number of good qualities.',
        options: opts(['Strongly agree', 3], ['Agree', 2], ['Disagree', 1], ['Strongly disagree', 0]),
      },
      {
        stem: 'I am able to do things as well as most other people.',
        options: opts(['Strongly agree', 3], ['Agree', 2], ['Disagree', 1], ['Strongly disagree', 0]),
      },
      {
        stem: 'I feel I do not have much to be proud of.',
        options: opts(['Strongly agree', 0], ['Agree', 1], ['Disagree', 2], ['Strongly disagree', 3]),
      },
      {
        stem: 'I certainly feel useless at times.',
        options: opts(['Strongly agree', 0], ['Agree', 1], ['Disagree', 2], ['Strongly disagree', 3]),
      },
      {
        stem: "I feel that I'm a person of worth, at least on an equal plane with others.",
        options: opts(['Strongly agree', 3], ['Agree', 2], ['Disagree', 1], ['Strongly disagree', 0]),
      },
      {
        stem: 'I wish I could have more respect for myself.',
        options: opts(['Strongly agree', 0], ['Agree', 1], ['Disagree', 2], ['Strongly disagree', 3]),
      },
      {
        stem: 'All in all, I am inclined to feel that I am a failure.',
        options: opts(['Strongly agree', 0], ['Agree', 1], ['Disagree', 2], ['Strongly disagree', 3]),
      },
      {
        stem: 'I take a positive attitude toward myself.',
        options: opts(['Strongly agree', 3], ['Agree', 2], ['Disagree', 1], ['Strongly disagree', 0]),
      },
    ],
  },

  // ── SWLS — life satisfaction ──────────────────────────────────────────
  {
    code: 'SWLS',
    name: 'Satisfaction With Life Scale (SWLS)',
    construct: 'life_satisfaction',
    itemIdPrefix: 'item_swls',
    cutoffs: {
      // Inverse polarity: LOWER totals = greater dissatisfaction (the
      // clinical signal). Bands map Diener's published ranges onto the
      // platform's severity semantics; spelled out in the guide.
      bands: [
        { band: 'SEVERE', min: 5, max: 9 },
        { band: 'HIGH', min: 10, max: 14 },
        { band: 'MODERATE', min: 15, max: 20 },
        { band: 'LOW', min: 21, max: 35 },
      ],
      safetyItems: [],
      guide: {
        scoringKey: 'Sum of 5 items on a 7-point agreement scale (1 Strongly disagree → 7 Strongly agree), total 5–35.',
        bandGuide:
          'Diener\'s ranges: 31–35 extremely satisfied; 26–30 satisfied; 21–25 slightly satisfied; 20 neutral; 15–19 slightly dissatisfied; 10–14 dissatisfied; 5–9 extremely dissatisfied. Platform severity mapping: SEVERE = extremely dissatisfied (5–9); HIGH = dissatisfied (10–14); MODERATE = neutral-to-slightly-dissatisfied (15–20); LOW = satisfied ranges (21–35).',
        reference: 'Diener E, Emmons RA, Larsen RJ, Griffin S (1985). The Satisfaction With Life Scale. J Pers Assess 49(1):71-5.',
        psychometrics: 'α ≈ .87; 2-month test-retest r ≈ .82; the standard global life-satisfaction measure across hundreds of studies.',
        cautions: 'POLARITY: lower totals are the clinical signal. A wellbeing measure — complements, never replaces, symptom scales.',
      },
    },
    items: [
      { stem: 'In most ways my life is close to my ideal.', options: SWLS_AGREE },
      { stem: 'The conditions of my life are excellent.', options: SWLS_AGREE },
      { stem: 'I am satisfied with my life.', options: SWLS_AGREE },
      { stem: 'So far I have gotten the important things I want in life.', options: SWLS_AGREE },
      { stem: 'If I could live my life over, I would change almost nothing.', options: SWLS_AGREE },
    ],
  },
];

/**
 * Idempotent (upsert-keyed) seeding of the pack. Every instrument is
 * PUBLIC_DOMAIN + CLASSICAL; versions are published 1.0.0; items carry
 * linkIds q1..qN with fixed ids so re-seeding never duplicates.
 */
export async function seedInstrumentPack(prisma: PrismaClient): Promise<{ instruments: number; items: number }> {
  let itemCount = 0;
  for (const inst of INSTRUMENTS) {
    const q = await prisma.questionnaire.upsert({
      where: { code: inst.code },
      update: { name: inst.name, construct: inst.construct },
      create: {
        code: inst.code,
        name: inst.name,
        construct: inst.construct,
        licensing: 'PUBLIC_DOMAIN',
        scoringMethod: 'CLASSICAL',
      },
    });
    const version = await prisma.questionnaireVersion.upsert({
      where: { questionnaireId_version: { questionnaireId: q.id, version: '1.0.0' } },
      // Cutoffs/guide fixes must reach already-seeded databases too.
      update: { cutoffs: inst.cutoffs as object, published: true },
      create: {
        questionnaireId: q.id,
        version: '1.0.0',
        published: true,
        cutoffs: inst.cutoffs as object,
      },
    });
    for (let i = 0; i < inst.items.length; i++) {
      const item = inst.items[i]!;
      await prisma.item.upsert({
        where: { id: `${inst.itemIdPrefix}_${i + 1}` },
        update: { stem: item.stem, responseOptions: item.options },
        create: {
          id: `${inst.itemIdPrefix}_${i + 1}`,
          questionnaireVersionId: version.id,
          linkId: `q${i + 1}`,
          stem: item.stem,
          responseOptions: item.options,
          orderIndex: i,
        },
      });
      itemCount += 1;
    }
  }
  return { instruments: INSTRUMENTS.length, items: itemCount };
}
