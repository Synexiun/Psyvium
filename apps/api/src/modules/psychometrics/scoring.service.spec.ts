import { SeverityBand, type QuestionnaireCutoffs } from '@vpsy/contracts';
import { ScoringService } from './scoring.service';

/**
 * Deterministic classical scoring is safety-relevant (it feeds severityBand
 * on the PsychometricScore). These tests pin the raw-sum + cutoff-boundary
 * behavior so banding never silently drifts.
 */
describe('ScoringService (classical scoring)', () => {
  const svc = new ScoringService();

  // PHQ-9-shaped cutoffs: 0-4 LOW, 5-9 MODERATE, 10-14 HIGH, 15-27 SEVERE
  const cutoffs: QuestionnaireCutoffs = {
    bands: [
      { band: SeverityBand.LOW, min: 0, max: 4 },
      { band: SeverityBand.MODERATE, min: 5, max: 9 },
      { band: SeverityBand.HIGH, min: 10, max: 14 },
      { band: SeverityBand.SEVERE, min: 15, max: 27 },
    ],
  };

  it('sums item answers into a raw score', () => {
    const r = svc.score({ q1: 1, q2: 2, q3: 0 }, cutoffs);
    expect(r.rawScore).toBe(3);
  });

  it.each([
    [0, SeverityBand.LOW],
    [4, SeverityBand.LOW],
    [5, SeverityBand.MODERATE],
    [9, SeverityBand.MODERATE],
    [10, SeverityBand.HIGH],
    [14, SeverityBand.HIGH],
    [15, SeverityBand.SEVERE],
    [27, SeverityBand.SEVERE],
  ])('classifies raw score %i as %s at the cutoff boundary', (raw, expected) => {
    const r = svc.score({ q1: raw as number }, cutoffs);
    expect(r.severityBand).toBe(expected);
  });

  it('returns a null band with an explanatory interpretation when the raw score exceeds all bands', () => {
    const r = svc.score({ q1: 999 }, cutoffs);
    expect(r.severityBand).toBeNull();
    expect(r.interpretation).toMatch(/no severity band/i);
  });

  it('is a pure function — identical answers always produce identical scoring', () => {
    const a = svc.score({ q1: 3, q2: 6 }, cutoffs);
    const b = svc.score({ q1: 3, q2: 6 }, cutoffs);
    expect(a).toEqual(b);
  });
});
