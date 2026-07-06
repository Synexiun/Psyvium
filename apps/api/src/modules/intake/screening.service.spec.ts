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
});
