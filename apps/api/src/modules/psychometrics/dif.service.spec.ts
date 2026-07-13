import { DifService } from './dif.service';

describe('DifService (Mantel–Haenszel skeleton)', () => {
  const svc = new DifService();

  it('refuses to invent DIF when sample is thin', () => {
    const result = svc.analyze({
      instrumentCode: 'PHQ9',
      groupLabel: 'language:es-vs-en',
      minN: 200,
      items: [
        {
          itemId: 'q1',
          cells: [{ stratum: 5, focalYes: 2, focalNo: 3, refYes: 4, refNo: 1 }],
        },
      ],
    });
    expect(result.items[0].classification).toBe('insufficient_sample');
    expect(result.items[0].mantelHaenszelAlpha).toBeNull();
  });

  it('computes MH alpha when sample is adequate', () => {
    // Balanced large strata with mild elevation in focal yes
    const cells = Array.from({ length: 10 }, (_, i) => ({
      stratum: i,
      focalYes: 40,
      focalNo: 60,
      refYes: 30,
      refNo: 70,
    }));
    const result = svc.analyze({
      instrumentCode: 'PHQ9',
      groupLabel: 'sex:f-vs-m',
      minN: 100,
      items: [{ itemId: 'q9', cells }],
    });
    expect(result.items[0].nTotal).toBeGreaterThanOrEqual(100);
    expect(result.items[0].mantelHaenszelAlpha).not.toBeNull();
    expect(result.disclaimer).toMatch(/never used for automated clinical decisions/i);
  });
});
