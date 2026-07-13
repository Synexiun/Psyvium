import { scoreSafetyPlanCompleteness } from './safety-plan-completeness';

describe('Stanley-Brown safety plan completeness', () => {
  it('scores a complete plan at 100', () => {
    const result = scoreSafetyPlanCompleteness({
      warningSigns: ['insomnia'],
      copingStrategies: ['breathing'],
      distractionContacts: ['walk'],
      helpContacts: ['sister'],
      professionalContacts: ['clinician'],
      meansRestriction: [{ means: 'meds', secured: true }],
      crisisLineInfo: { phone: '988' },
      clientAcknowledgedAt: new Date().toISOString(),
    });
    expect(result.score).toBe(100);
    expect(result.missing).toEqual([]);
  });

  it('lists missing SPI steps without blocking', () => {
    const result = scoreSafetyPlanCompleteness({ warningSigns: ['x'] });
    expect(result.score).toBeLessThan(100);
    expect(result.missing.length).toBeGreaterThan(0);
  });
});
