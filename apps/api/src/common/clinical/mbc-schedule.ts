/**
 * Measurement-Based Care (MBC) schedule helpers.
 * Aligns treatment-plan measurement schedules with recommended reassessment
 * cadence from outcome monitoring literature (Lambert, Scott & Lewis, etc.).
 */

export type MbcCadence = 'every_session' | 'biweekly' | 'monthly' | 'quarterly' | 'custom';

export interface MbcRecommendation {
  construct: string;
  cadence: MbcCadence;
  nextDueAt: string;
  rationale: string;
  algorithmVersion: string;
}

export interface MbcScheduleInput {
  constructs: string[];
  sessionFrequency?: string;
  lastMeasuredAtByConstruct?: Record<string, string | Date | null | undefined>;
  now?: Date;
}

const DEFAULT_DAYS: Record<MbcCadence, number> = {
  every_session: 7,
  biweekly: 14,
  monthly: 30,
  quarterly: 90,
  custom: 14,
};

export function recommendMbcSchedule(input: MbcScheduleInput): MbcRecommendation[] {
  const now = input.now ?? new Date();
  const sessionFreq = (input.sessionFrequency ?? 'weekly').toLowerCase();
  const baseCadence: MbcCadence =
    sessionFreq.includes('week') ? 'every_session' : sessionFreq.includes('month') ? 'monthly' : 'biweekly';

  return input.constructs.map((construct) => {
    const lastRaw = input.lastMeasuredAtByConstruct?.[construct];
    const last = lastRaw ? new Date(lastRaw) : null;
    const days = DEFAULT_DAYS[baseCadence];
    const next = new Date(now);
    if (last && !Number.isNaN(last.getTime())) {
      next.setTime(last.getTime() + days * 86_400_000);
      if (next < now) next.setTime(now.getTime());
    } else {
      next.setUTCDate(next.getUTCDate() + days);
    }
    return {
      construct,
      cadence: baseCadence,
      nextDueAt: next.toISOString(),
      rationale:
        'Routine outcome monitoring improves detection of non-response (Lambert; Scott & Lewis). Reassess on a fixed cadence tied to session frequency.',
      algorithmVersion: '1.0.0',
    };
  });
}

export function isMbcOverdue(
  lastMeasuredAt: string | Date | null | undefined,
  cadence: MbcCadence = 'biweekly',
  now = new Date(),
): boolean {
  if (!lastMeasuredAt) return true;
  const last = new Date(lastMeasuredAt);
  if (Number.isNaN(last.getTime())) return true;
  const days = DEFAULT_DAYS[cadence];
  return now.getTime() - last.getTime() > days * 86_400_000;
}
