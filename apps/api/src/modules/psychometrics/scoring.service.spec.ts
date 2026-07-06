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

  // WAVE CR — "PHQ-9 5-tier collapse": an optional `subBands` array lets the
  // published instrument convention's finer tier inside SEVERE reach the
  // persisted interpretation, without widening the shared 4-valued
  // SeverityBand enum.
  describe('optional sub-bands (WAVE CR — finer tiers within a SeverityBand)', () => {
    const cutoffsWithSubBands: QuestionnaireCutoffs = {
      ...cutoffs,
      subBands: [
        { parentBand: SeverityBand.SEVERE, label: 'MODERATELY_SEVERE', min: 15, max: 19 },
        { parentBand: SeverityBand.SEVERE, label: 'SEVERE', min: 20, max: 27 },
      ],
    };

    it('threads the matching sub-band label into the persisted interpretation', () => {
      const moderatelySevere = svc.score({ q1: 17 }, cutoffsWithSubBands);
      expect(moderatelySevere.severityBand).toBe(SeverityBand.SEVERE);
      expect(moderatelySevere.interpretation).toMatch(/sub-band MODERATELY_SEVERE \(15-19\)/);

      const severe = svc.score({ q1: 24 }, cutoffsWithSubBands);
      expect(severe.severityBand).toBe(SeverityBand.SEVERE);
      expect(severe.interpretation).toMatch(/sub-band SEVERE \(20-27\)/);
    });

    it('omits the sub-band clause when no configured sub-band matches (e.g. bands without subBands at all)', () => {
      const r = svc.score({ q1: 7 }, cutoffsWithSubBands); // MODERATE — no subBands defined for it
      expect(r.interpretation).not.toMatch(/sub-band/);
      expect(r.interpretation).toMatch(/^Raw score 7 falls in the MODERATE band \(5-9\)\.$/);
    });
  });
});
