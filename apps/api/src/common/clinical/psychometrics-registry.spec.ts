import { computeReliableChangeIndex, resolveConstructPsychometrics } from './psychometrics-registry';

describe('psychometrics registry', () => {
  it('resolves PHQ-9 aliases onto depression psychometrics', () => {
    expect(resolveConstructPsychometrics('phq-9')?.key).toBe('depression');
  });

  it('computes reliable worsening for a large PHQ-9 increase', () => {
    // SE_diff ≈ 6.1 * sqrt(1-0.86) * sqrt(2) ≈ 3.23; delta 12 → RCI ≈ 3.7
    const result = computeReliableChangeIndex('depression', 5, 17);
    expect(result.classification).toBe('reliably-worsened');
    expect(result.rci).not.toBeNull();
    expect(Math.abs(result.rci!)).toBeGreaterThanOrEqual(1.96);
  });

  it('never fabricates reliability for unknown constructs', () => {
    const result = computeReliableChangeIndex('my-custom-mood-blob', 1, 99);
    expect(result.classification).toBe('unknown-reliability');
    expect(result.rci).toBeNull();
  });
});
