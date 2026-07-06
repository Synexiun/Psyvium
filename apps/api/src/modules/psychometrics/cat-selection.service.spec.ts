import { IrtModel, type IrtItemParameter } from '@vpsy/contracts';
import { CatSelectionService, type CatCandidate } from './cat-selection.service';
import { IrtScoringService } from './irt-scoring.service';

/**
 * CAT item-selection math validation (docs/technical/07-psychometrics-engine.md
 * §6) — same correctness bar as the EAP suite: information functions are
 * pinned to HAND-COMPUTED values (2PL/3PL/Rasch) and, for the GRM
 * category-information sum, cross-checked against NUMERICAL DIFFERENTIATION of
 * the already-validated IrtScoringService.categoryProbabilities (an
 * independent implementation of the derivative — if either the probabilities
 * or the closed-form P'_k are wrong, the two disagree).
 */

const svc = new CatSelectionService();
const irt = new IrtScoringService();

const p2 = (a: number, b: number): IrtItemParameter => ({ model: IrtModel.TWO_PL, a, b, c: null, thresholds: [] });
const p3 = (a: number, b: number, c: number): IrtItemParameter => ({ model: IrtModel.THREE_PL, a, b, c, thresholds: [] });
const pR = (b: number): IrtItemParameter => ({ model: IrtModel.RASCH, a: 1, b, c: null, thresholds: [] });
const pG = (a: number, thresholds: number[]): IrtItemParameter => ({ model: IrtModel.GRM, a, b: 0, c: null, thresholds });

describe('CatSelectionService — Fisher information (hand-computed)', () => {
  it('2PL: information at theta = b is exactly a²/4 (P = 0.5, c = 0)', () => {
    // I(θ) = a²·P·Q with P = Q = 0.5 at θ = b.
    expect(svc.itemInformation(p2(1.7, 0.3), 0.3)).toBe((1.7 * 1.7) / 4);
    expect(svc.itemInformation(p2(1, -2), -2)).toBe(0.25);
    expect(svc.itemInformation(p2(2.5, 1.4), 1.4)).toBe((2.5 * 2.5) / 4);
  });

  it('2PL: a=1.2, b=0 at theta=1 matches the hand-computed a²·P·Q', () => {
    // P = 1/(1+e^{-1.2}) = 0.76852478..., Q = 0.23147521...
    // I = 1.44 · P · Q = 0.25616799453140032
    expect(svc.itemInformation(p2(1.2, 0), 1)).toBeCloseTo(0.25616799453140032, 12);
  });

  it('3PL: a=1.5, b=0, c=0.2 at theta=0 gives the hand-computed 0.375', () => {
    // P = c + (1-c)/2 = 0.6, Q = 0.4
    // I = a²·(Q/P)·((P-c)/(1-c))² = 2.25·(0.4/0.6)·(0.4/0.8)² = 2.25·(2/3)·0.25 = 0.375
    expect(svc.itemInformation(p3(1.5, 0, 0.2), 0)).toBeCloseTo(0.375, 12);
  });

  it('3PL: guessing strictly reduces information relative to 2PL with the same a, b', () => {
    for (const th of [-2, -1, 0, 1, 2]) {
      expect(svc.itemInformation(p3(1.5, 0, 0.2), th)).toBeLessThan(svc.itemInformation(p2(1.5, 0), th));
    }
  });

  it('3PL with c=0 reduces exactly to the 2PL information', () => {
    for (const th of [-2, -0.5, 0, 0.5, 2]) {
      expect(svc.itemInformation(p3(1.3, 0.4, 0), th)).toBeCloseTo(svc.itemInformation(p2(1.3, 0.4), th), 12);
    }
  });

  it('Rasch: the a=1 case — P·Q, maximal (0.25) at theta = b, identical to 2PL a=1', () => {
    expect(svc.itemInformation(pR(0.7), 0.7)).toBe(0.25);
    for (let th = -3; th <= 3; th += 0.5) {
      expect(svc.itemInformation(pR(0.7), th)).toBeCloseTo(svc.itemInformation(p2(1, 0.7), th), 12);
    }
  });

  it('dichotomous information peaks at theta = b and decays on both sides', () => {
    const params = p2(1.6, 0.5);
    const atB = svc.itemInformation(params, 0.5);
    for (const off of [0.5, 1, 2, 3]) {
      expect(svc.itemInformation(params, 0.5 - off)).toBeLessThan(atB);
      expect(svc.itemInformation(params, 0.5 + off)).toBeLessThan(atB);
      // and monotone decay with distance
      expect(svc.itemInformation(params, 0.5 + off)).toBeLessThan(svc.itemInformation(params, 0.5 + off - 0.5));
    }
  });
});

describe('CatSelectionService — GRM information vs numerical differentiation (reference)', () => {
  /**
   * Independent reference: I(θ) = Σ_k (P'_k)²/P_k with P'_k computed by CENTRAL
   * DIFFERENCE over IrtScoringService.categoryProbabilities (h = 1e-5), the
   * probability implementation already validated against hand-computed values
   * in irt-scoring.service.spec.ts.
   */
  function numericalGrmInfo(params: IrtItemParameter, theta: number, h = 1e-5): number {
    const pk = irt.categoryProbabilities(params, theta);
    const up = irt.categoryProbabilities(params, theta + h);
    const dn = irt.categoryProbabilities(params, theta - h);
    let info = 0;
    for (let k = 0; k < pk.length; k++) {
      const d = (up[k]! - dn[k]!) / (2 * h);
      info += (d * d) / pk[k]!;
    }
    return info;
  }

  const paramSets = [
    pG(1.5, [-1, 0, 1]),
    pG(2.2, [-1.8, -0.4, 0.9, 2.1]),
    pG(0.9, [0.5]),
    // the seeded demo calibration's strongest and weakest items
    pG(2.1, [-1.5, -0.4, 0.7]),
    pG(1.1, [-0.3, 0.8, 1.9]),
  ];

  it.each(paramSets.map((p, i) => [i, p] as const))(
    'closed-form GRM information matches the numerical derivative within 1e-4 (param set %d)',
    (_i, params) => {
      for (const theta of [-2.5, -1.5, -0.5, 0, 0.5, 1.5, 2.5]) {
        const closed = svc.itemInformation(params, theta);
        const numeric = numericalGrmInfo(params, theta);
        expect(Math.abs(closed - numeric)).toBeLessThan(1e-4);
        expect(closed).toBeGreaterThan(0);
      }
    },
  );

  it('GRM information scales with discrimination (higher a ⇒ more information at the center)', () => {
    expect(svc.itemInformation(pG(2.1, [-1, 0, 1]), 0)).toBeGreaterThan(svc.itemInformation(pG(1.1, [-1, 0, 1]), 0));
  });
});

describe('CatSelectionService — max-information selection with randomesque exposure control', () => {
  const bank: CatCandidate[] = [
    { itemId: 'i_far', linkId: 'q1', params: p2(1.5, 2.5) }, // far from θ=0 → least informative
    { itemId: 'i_best', linkId: 'q2', params: p2(2.0, 0) }, // I(0) = 1.0 — the maximum
    { itemId: 'i_second', linkId: 'q3', params: p2(1.8, 0) }, // I(0) = 0.81
    { itemId: 'i_third', linkId: 'q4', params: p2(1.6, 0) }, // I(0) = 0.64
    { itemId: 'i_fifth', linkId: 'q5', params: p2(1.0, 1.5) },
  ];

  it('rng pinned to 0 selects THE maximum-information item at the current theta', () => {
    svc.rng = () => 0;
    expect(svc.selectNextItem(bank, 0).itemId).toBe('i_best');
    // At θ=2.5 the "far" item (b=2.5) becomes the most informative instead.
    expect(svc.selectNextItem(bank, 2.5).itemId).toBe('i_far');
  });

  it('randomesque draw stays WITHIN the top-3 most informative items (never the 4th/5th)', () => {
    svc.rng = () => 0.34; // → index 1 of top-3
    expect(svc.selectNextItem(bank, 0).itemId).toBe('i_second');
    svc.rng = () => 0.99; // → index 2 of top-3
    expect(svc.selectNextItem(bank, 0).itemId).toBe('i_third');
    for (const r of [0, 0.2, 0.5, 0.8, 0.999]) {
      svc.rng = () => r;
      expect(['i_best', 'i_second', 'i_third']).toContain(svc.selectNextItem(bank, 0).itemId);
    }
  });

  it('with fewer than 3 candidates the draw is over what remains', () => {
    svc.rng = () => 0.99;
    const two = bank.slice(0, 2);
    expect(['i_far', 'i_best']).toContain(svc.selectNextItem(two, 0).itemId);
    expect(svc.selectNextItem([bank[1]!], 0).itemId).toBe('i_best');
  });

  it('refuses an empty candidate set loudly (callers must terminate on bank exhaustion first)', () => {
    expect(() => svc.selectNextItem([], 0)).toThrow(/empty candidate set/i);
  });
});
