import { validateClinicalCode } from './clinical-coding';

describe('clinical coding format validation', () => {
  it('accepts well-formed ICD-10-CM codes', () => {
    expect(validateClinicalCode('F32.1').valid).toBe(true);
    expect(validateClinicalCode('f41.1').normalized).toBe('F41.1');
  });

  it('rejects free-text pseudo-diagnoses', () => {
    expect(validateClinicalCode('depression maybe').valid).toBe(false);
  });
});
