import {
  listVendorBaaRegister,
  parseBaaStatusOverrides,
  vendorBaaSummary,
} from './vendor-baa-register';

describe('vendor-baa-register', () => {
  it('lists core subprocessors with honest unsigned defaults', () => {
    const entries = listVendorBaaRegister({});
    expect(entries.find((e) => e.id === 'resend')).toBeTruthy();
    expect(entries.find((e) => e.id === 'twilio')).toBeTruthy();
    expect(entries.find((e) => e.id === 'anthropic')).toBeTruthy();
    const summary = vendorBaaSummary(entries);
    expect(summary.requiredNotSigned).toBeGreaterThan(0);
    expect(summary.productionPhiReady).toBe(false);
  });

  it('applies signed overrides', () => {
    const entries = listVendorBaaRegister({
      resend: { status: 'signed', signedAt: '2026-07-01', agreementRef: 'BAA-001' },
    });
    const resend = entries.find((e) => e.id === 'resend')!;
    expect(resend.baaOrDpa).toBe('signed');
    expect(resend.agreementRef).toBe('BAA-001');
  });

  it('parseBaaStatusOverrides fails on bad JSON', () => {
    expect(() => parseBaaStatusOverrides('{')).toThrow(/valid JSON/);
  });
});
