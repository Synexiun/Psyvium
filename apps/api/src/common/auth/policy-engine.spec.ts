import { evaluatePolicy, type PolicyContext } from './policy-engine';

const base: PolicyContext = {
  resourceTenantId: 'tenant_a',
  subjectTenantId: 'tenant_a',
  purpose: 'care',
  consentState: 'active',
  relationship: 'assigned',
  mfaSatisfied: true,
  deviceTrust: 'trusted',
};

describe('PolicyEngine.evaluatePolicy (doc 06 §4.4)', () => {
  it('hard-denies cross-tenant access even with every other attribute green', () => {
    const decision = evaluatePolicy({
      ...base,
      resourceTenantId: 'tenant_b',
      emergencyOverride: true,
    });
    expect(decision.allow).toBe(false);
    expect(decision.matchedRule).toBe('tenant.isolation');
  });

  it('allows break-glass with high-severity audit obligations', () => {
    const decision = evaluatePolicy({
      ...base,
      relationship: 'none',
      emergencyOverride: true,
    });
    expect(decision.allow).toBe(true);
    expect(decision.matchedRule).toBe('emergency.break_glass');
    expect(decision.obligations).toEqual(
      expect.arrayContaining([
        'audit.high_severity',
        'emit.break_glass_alert',
        'limit.minimum_necessary',
      ]),
    );
  });

  it('denies untrusted devices', () => {
    const decision = evaluatePolicy({ ...base, deviceTrust: 'untrusted' });
    expect(decision.allow).toBe(false);
    expect(decision.matchedRule).toBe('device.untrusted');
  });

  it('denies cross-border residency without consent', () => {
    const decision = evaluatePolicy({
      ...base,
      dataResidency: { subject: 'US', resource: 'EU', crossBorderConsent: false },
    });
    expect(decision.allow).toBe(false);
    expect(decision.matchedRule).toBe('residency.cross_border');
  });

  it('denies missing care relationship', () => {
    const decision = evaluatePolicy({ ...base, relationship: 'none' });
    expect(decision.allow).toBe(false);
    expect(decision.matchedRule).toBe('relationship.missing');
  });

  it('denies revoked consent for non-safety purposes', () => {
    const decision = evaluatePolicy({ ...base, consentState: 'revoked' });
    expect(decision.allow).toBe(false);
    expect(decision.matchedRule).toBe('consent.required');
  });

  it('allows safety purpose even when consent is missing', () => {
    const decision = evaluatePolicy({
      ...base,
      purpose: 'safety',
      consentState: 'missing',
    });
    expect(decision.allow).toBe(true);
  });

  it('allows assigned clinician with minimum-necessary obligations', () => {
    const decision = evaluatePolicy(base);
    expect(decision.allow).toBe(true);
    expect(decision.matchedRule).toBe('relationship.assigned');
    expect(decision.obligations).toEqual(
      expect.arrayContaining(['audit.mandatory', 'limit.minimum_necessary']),
    );
  });
});
