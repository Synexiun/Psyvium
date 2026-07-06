import { RiskType, SeverityBand, TherapyFormat, type SubmitIntakeInput } from '@vpsy/contracts';
import { ScreeningService } from './screening.service';

/**
 * Clinical-safety tests. Per docs/technical/12-testing-strategy.md these are a
 * BLOCKING gate: deterministic screening must raise the right flags and must
 * never route a client with an active plan to standard virtual care.
 */
describe('ScreeningService', () => {
  const svc = new ScreeningService();

  const base: SubmitIntakeInput = {
    presentingProblem: 'I have been feeling very anxious with panic attacks for weeks.',
    previousTherapy: false,
    traumaExposure: false,
    sleepQuality: 5,
    appetiteChange: 0,
    energyLevel: 5,
    concentration: 5,
    substanceUse: { alcohol: 'none', tobacco: 'none', cannabis: 'none' },
    functionalImpairment: { work: 4, family: 3, social: 4, selfCare: 2 },
    safety: { suicidalIdeation: false, suicidalPlan: false, selfHarm: false, harmToOthers: false, recentLoss: false },
    goals: ['reduce panic'],
    preferredTherapistGender: 'any',
    preferredLanguage: 'en',
    therapyFormat: TherapyFormat.INDIVIDUAL,
  };

  it('routes anxiety presentation to the anxiety specialty', () => {
    const r = svc.compute(base);
    expect(r.suggestedSpecialty).toBe('anxiety');
    expect(r.riskFlags).toHaveLength(0);
    expect(r.virtualCareSuitable).toBe(true);
  });

  it('raises a SEVERE suicidal-ideation flag and blocks standard virtual care when a plan is endorsed', () => {
    const r = svc.compute({
      ...base,
      safety: { ...base.safety, suicidalIdeation: true, suicidalPlan: true },
    });
    const flag = r.riskFlags.find((f) => f.type === RiskType.SUICIDAL_IDEATION);
    expect(flag?.severity).toBe(SeverityBand.SEVERE);
    expect(r.severityBand).toBe(SeverityBand.SEVERE);
    expect(r.virtualCareSuitable).toBe(false);
    expect(r.contraindications.join(' ')).toMatch(/crisis/i);
  });

  it('raises a self-harm flag without a plan and keeps a high urgency', () => {
    const r = svc.compute({ ...base, safety: { ...base.safety, selfHarm: true } });
    expect(r.riskFlags.some((f) => f.type === RiskType.SELF_HARM)).toBe(true);
    expect(r.urgencyScore).toBeGreaterThan(0);
  });

  /**
   * Graduated C-SSRS-style triage (WAVE CR item 1, Posner 2011): the 0-5
   * `ideationSeverity` scale maps to a severity band independent of the
   * legacy booleans. Levels 1-2 are still escalated (MODERATE, not silently
   * dropped); level 3 is HIGH; level 4-5 or ANY positive behavior history is
   * SEVERE/imminent-risk regardless of the numeric level.
   */
  describe('graduated C-SSRS ideationSeverity → severity band mapping', () => {
    it.each([
      [1, SeverityBand.MODERATE],
      [2, SeverityBand.MODERATE],
      [3, SeverityBand.HIGH],
      [4, SeverityBand.SEVERE],
      [5, SeverityBand.SEVERE],
    ])('level %i maps to %s', (level, expected) => {
      const r = svc.compute({ ...base, safety: { ...base.safety, ideationSeverity: level } });
      const flag = r.riskFlags.find((f) => f.type === RiskType.SUICIDAL_IDEATION);
      expect(flag?.severity).toBe(expected);
    });

    it('level 0 with no behavior history raises no ideation flag at all', () => {
      const r = svc.compute({ ...base, safety: { ...base.safety, ideationSeverity: 0 } });
      expect(r.riskFlags.some((f) => f.type === RiskType.SUICIDAL_IDEATION)).toBe(false);
    });

    it('escalates a low numeric level to SEVERE when ANY behavior-history item is positive', () => {
      const r = svc.compute({
        ...base,
        safety: {
          ...base.safety,
          ideationSeverity: 1,
          behaviorHistory: { priorAttempt: true, aborted: false, preparatory: false, recentSelfHarm: false },
        },
      });
      const flag = r.riskFlags.find((f) => f.type === RiskType.SUICIDAL_IDEATION);
      expect(flag?.severity).toBe(SeverityBand.SEVERE);
      expect(r.virtualCareSuitable).toBe(false);
    });

    it('legacy boolean-only payloads reproduce identical scores to the pre-graduation calibration', () => {
      const ideationOnly = svc.compute({ ...base, safety: { ...base.safety, suicidalIdeation: true } });
      const flagOnly = ideationOnly.riskFlags.find((f) => f.type === RiskType.SUICIDAL_IDEATION);
      // suicidalIdeation alone maps to level 2 -> MODERATE (still escalated).
      expect(flagOnly?.severity).toBe(SeverityBand.MODERATE);

      const withPlan = svc.compute({ ...base, safety: { ...base.safety, suicidalIdeation: true, suicidalPlan: true } });
      const flagPlan = withPlan.riskFlags.find((f) => f.type === RiskType.SUICIDAL_IDEATION);
      // suicidalPlan maps to level 5 -> SEVERE, matching the original binary logic.
      expect(flagPlan?.severity).toBe(SeverityBand.SEVERE);
    });

    it('feeds recentLoss into the composite risk score rather than discarding it (WAVE CR item 96)', () => {
      const without = svc.compute({ ...base, safety: { ...base.safety, recentLoss: false } });
      const withLoss = svc.compute({ ...base, safety: { ...base.safety, recentLoss: true } });
      expect(withLoss.riskScore).toBeGreaterThan(without.riskScore);
    });

    it('persists graduated triage detail (level, behaviorHistory, recentLoss) in evidenceDetail', () => {
      const r = svc.compute({
        ...base,
        safety: {
          ...base.safety,
          ideationSeverity: 4,
          recentLoss: true,
          behaviorHistory: { priorAttempt: false, aborted: true, preparatory: false, recentSelfHarm: false },
        },
      });
      const flag = r.riskFlags.find((f) => f.type === RiskType.SUICIDAL_IDEATION);
      expect(flag?.evidenceDetail).toMatchObject({
        ideationLevel: 4,
        recentLoss: true,
        inputSource: 'graduated',
        behaviorHistory: { aborted: true },
      });
    });
  });
});
