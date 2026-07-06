/**
 * ── DEMO MOCK DATA ─────────────────────────────────────────────────────────
 * Typed local fixtures for the patient PWA home. No live endpoint exists yet
 * for sessions, exercises, or wearable ingest; when the API ships, replace
 * these with calls through `src/lib/api.ts`. Everything here is fabricated.
 * ───────────────────────────────────────────────────────────────────────────
 */

export interface NextSession {
  /** ISO datetime — computed relative to "now" so the demo never goes stale. */
  startsAt: string;
  clinicianName: string;
  format: 'video' | 'inPerson';
  durationMin: number;
}

export interface Exercise {
  id: string;
  title: string;
  detail: string;
  minutes: number;
}

export interface WearableSnapshot {
  /** Milliseconds; null = not reported last night (render as —, never 0). */
  hrvMs: number | null;
  /** Minutes asleep; null = not reported. */
  sleepMin: number | null;
  /** Beats per minute; null = not reported. */
  restingHr: number | null;
  capturedAt: string;
}

function daysFromNow(days: number, hour: number, minute = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

export const MOCK_NEXT_SESSION: NextSession = {
  startsAt: daysFromNow(2, 15, 30),
  clinicianName: 'Dr. Elena Rivera',
  format: 'video',
  durationMin: 50,
};

export const MOCK_EXERCISES: Exercise[] = [
  { id: 'ex-breathing', title: 'Paced breathing', detail: '4 seconds in, 6 seconds out — once in the morning, once before bed.', minutes: 5 },
  { id: 'ex-thought-log', title: 'Thought record', detail: 'When a panic wave starts, note the trigger, the thought, and what actually happened.', minutes: 10 },
  { id: 'ex-walk', title: 'Daylight walk', detail: 'A short walk outside before noon — movement and light both count.', minutes: 15 },
];

export const MOCK_WEARABLE: WearableSnapshot = {
  hrvMs: 48,
  sleepMin: 412, // 6 h 52 min
  restingHr: null, // deliberately absent — the UI must show —, not 0
  capturedAt: daysFromNow(0, 7, 10),
};

/**
 * Seed history for the 7-day mood strip (1–5, null = no check-in that day).
 * Today's value comes from localStorage once the user checks in.
 */
export const MOCK_MOOD_HISTORY: (number | null)[] = [3, 4, 2, null, 3, 4];
