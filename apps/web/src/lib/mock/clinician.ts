/**
 * ── DEMO MOCK DATA ─────────────────────────────────────────────────────────
 * Typed local fixtures for the clinician Session Workspace. Timeline, plan,
 * risk alerts, and the AI formulation draft have no live endpoints yet; when
 * they ship, replace these with calls through `src/lib/api.ts`.
 * Everything here is fabricated — no real client data.
 * ───────────────────────────────────────────────────────────────────────────
 */

export type TimelineKind = 'intake' | 'assessment' | 'session' | 'risk' | 'plan';

export interface TimelineEvent {
  id: string;
  kind: TimelineKind;
  daysAgo: number;
  title: string;
  detail: string;
}

export interface PlanGoal {
  id: string;
  label: string;
  /** 0..1 measured progress; null = no measurement yet (render —, never 0). */
  progress: number | null;
  measure: string;
}

export interface RiskAlert {
  id: string;
  daysAgo: number;
  title: string;
  detail: string;
  severity: 'attention' | 'high';
}

export interface AiFormulation {
  /** 0..1 — always displayed with the human-confirmation gate. */
  confidence: number;
  modelVersion: string;
  promptVersion: string;
  summary: string;
  factors: { label: string; text: string }[];
}

export const MOCK_CLIENT = {
  name: 'Alex Morgan',
  careStartDaysAgo: 63,
  week: 9,
  riskBand: 'MODERATE' as const,
  nextSessionDays: 2,
};

export const MOCK_TIMELINE: TimelineEvent[] = [
  { id: 'tl-1', kind: 'intake', daysAgo: 63, title: 'Clinical intake', detail: 'Panic episodes 3–4×/week, sleep disruption. Deterministic screen: MODERATE.' },
  { id: 'tl-2', kind: 'assessment', daysAgo: 58, title: 'GAD-7 · PHQ-9 baseline', detail: 'GAD-7 15 (severe range) · PHQ-9 11 (moderate). Validity scales clean.' },
  { id: 'tl-3', kind: 'plan', daysAgo: 55, title: 'Treatment plan v1', detail: 'CBT with interoceptive exposure, weekly cadence, 12-week review.' },
  { id: 'tl-4', kind: 'session', daysAgo: 21, title: 'Session 6', detail: 'First full exposure exercise completed in session. Homework adherence improving.' },
  { id: 'tl-5', kind: 'risk', daysAgo: 9, title: 'PHQ-9 item 9 elevated', detail: 'Score 1 ("several days"). Safety plan reviewed and current. Flag routed to human review.' },
  { id: 'tl-6', kind: 'session', daysAgo: 7, title: 'Session 8', detail: 'Panic frequency down to 1×/week. Sleep still fragmented; discussed stimulus control.' },
  { id: 'tl-7', kind: 'assessment', daysAgo: 2, title: 'GAD-7 · PHQ-9 follow-up', detail: 'GAD-7 9 (−6 from baseline) · PHQ-9 8 (−3). Reliable change on GAD-7.' },
];

export const MOCK_PLAN: { goals: PlanGoal[]; reviewInDays: number } = {
  goals: [
    { id: 'g-1', label: 'Reduce panic frequency to ≤1/week', progress: 0.75, measure: 'Self-report diary' },
    { id: 'g-2', label: 'GAD-7 below clinical threshold (<10)', progress: 0.6, measure: 'GAD-7 biweekly' },
    { id: 'g-3', label: 'Restore consolidated sleep (≥6.5 h)', progress: null, measure: 'Wearable + diary — first measurement at week 10' },
  ],
  reviewInDays: 19,
};

export const MOCK_ALERTS: RiskAlert[] = [
  {
    id: 'al-1',
    daysAgo: 9,
    title: 'PHQ-9 item 9 elevated',
    detail: 'Passive ideation reported "several days". Safety plan is current (reviewed session 7). Deterministic router opened a human review — acknowledge to confirm you have seen it.',
    severity: 'attention',
  },
];

export const MOCK_FORMULATION: AiFormulation = {
  confidence: 0.74,
  modelVersion: 'vpsy-formulation-2.3',
  promptVersion: 'p-118',
  summary:
    'Presentation is consistent with panic disorder maintained by interoceptive avoidance and catastrophic misinterpretation of somatic cues. Fragmented sleep appears to act as a vulnerability factor rather than a primary driver; response pattern across sessions 4–8 supports continued exposure emphasis.',
  factors: [
    { label: 'Predisposing', text: 'Family history of anxiety; high trait sensitivity to bodily sensations.' },
    { label: 'Precipitating', text: 'Workload escalation and first panic episode in transit (~4 months ago).' },
    { label: 'Perpetuating', text: 'Interoceptive avoidance, safety behaviors (phone GPS, exit mapping), sleep fragmentation.' },
    { label: 'Protective', text: 'Strong homework adherence, supportive partner, stable employment.' },
  ],
};
