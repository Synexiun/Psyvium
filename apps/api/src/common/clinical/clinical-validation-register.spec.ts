import {
  applySignOffOverrides,
  clinicalValidationSummary,
  listClinicalValidationRegister,
  parseSignOffOverrides,
} from './clinical-validation-register';

describe('clinical-validation-register', () => {
  it('lists algorithms with engineering-complete defaults and human decision required', () => {
    const entries = listClinicalValidationRegister({});
    expect(entries.length).toBeGreaterThan(5);
    expect(entries.every((e) => e.requiresHumanDecision === true)).toBe(true);
    expect(entries.every((e) => e.marketingAllowed === false)).toBe(true);
    const rci = entries.find((e) => e.id === 'outcomes.rci');
    expect(rci?.citations.some((c) => /Jacobson/i.test(c))).toBe(true);
  });

  it('applies sign-off overrides and enables marketing only when signed with claims', () => {
    const entries = applySignOffOverrides(listClinicalValidationRegister({}), {
      'outcomes.rci': {
        status: 'signed',
        signedBy: 'Clinical Board',
        signedAt: '2026-08-01T00:00:00.000Z',
      },
      'ai.gateway': {
        status: 'signed',
        signedBy: 'Should not market empty claims',
      },
    });
    const rci = entries.find((e) => e.id === 'outcomes.rci')!;
    expect(rci.signOffStatus).toBe('signed');
    expect(rci.marketingAllowed).toBe(true);
    expect(rci.signedBy).toBe('Clinical Board');

    const ai = entries.find((e) => e.id === 'ai.gateway')!;
    expect(ai.signOffStatus).toBe('signed');
    // Empty marketedClaims → still not marketingAllowed
    expect(ai.marketingAllowed).toBe(false);
  });

  it('parseSignOffOverrides fails fast on bad JSON', () => {
    expect(() => parseSignOffOverrides('{not json')).toThrow(/valid JSON/);
    expect(parseSignOffOverrides(undefined)).toEqual({});
  });

  it('summary reports governance honesty', () => {
    const summary = clinicalValidationSummary(listClinicalValidationRegister({}));
    expect(summary.governanceHonest).toBe(true);
    expect(summary.marketableCount).toBe(0);
    expect(summary.byStatus['engineering-complete']).toBeGreaterThan(0);
  });
});
