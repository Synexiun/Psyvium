import { UnprocessableEntityException } from '@nestjs/common';
import { IrtModel, type IrtItemParameter } from '@vpsy/contracts';
import { IrtScoringService, type IrtScorableItem } from './irt-scoring.service';

/**
 * IRT math-validation suite (docs/technical/07-psychometrics-engine.md §5).
 * A wrong IRT implementation is worse than none, so these tests pin the
 * response-model probabilities to HAND-COMPUTED values and the EAP estimator
 * to INDEPENDENT reference values (fine trapezoid integration over [-8, 8],
 * step 1e-3 — wider domain + different quadrature than the service's fixed
 * [-4, 4] grid, so both the formulas and the truncation are validated).
 */

const svc = new IrtScoringService();

const p2 = (a: number, b: number): IrtItemParameter => ({ model: IrtModel.TWO_PL, a, b, c: null, thresholds: [] });
const p3 = (a: number, b: number, c: number): IrtItemParameter => ({ model: IrtModel.THREE_PL, a, b, c, thresholds: [] });
const pR = (b: number): IrtItemParameter => ({ model: IrtModel.RASCH, a: 1, b, c: null, thresholds: [] });
const pG = (a: number, thresholds: number[]): IrtItemParameter => ({ model: IrtModel.GRM, a, b: 0, c: null, thresholds });

const items = (params: IrtItemParameter[]): IrtScorableItem[] =>
  params.map((p, i) => ({ linkId: `q${i + 1}`, params: p }));

describe('IrtScoringService — response-model probabilities (hand-computed)', () => {
  it('2PL: a=1.2, b=0.5 at theta=0.5 gives P=0.5 exactly', () => {
    expect(svc.probCorrect(p2(1.2, 0.5), 0.5)).toBeCloseTo(0.5, 12);
  });

  it('2PL: a=1, b=0 at theta=1 gives the logistic value 0.7310585786', () => {
    expect(svc.probCorrect(p2(1, 0), 1)).toBeCloseTo(0.7310585786300049, 10);
  });

  it('2PL: a=2, b=-1 at theta=0 gives 1/(1+e^-2) = 0.8807970780', () => {
    expect(svc.probCorrect(p2(2, -1), 0)).toBeCloseTo(0.8807970779778823, 10);
  });

  it('3PL: guessing c=0.2 floors the curve at 0.2 and gives c+(1-c)/2 = 0.6 at theta=b', () => {
    const params = p3(1.5, 0, 0.2);
    expect(svc.probCorrect(params, 0)).toBeCloseTo(0.6, 12); // theta = b
    // Low-ability floor: approaches c from above, never dips below it.
    expect(svc.probCorrect(params, -4)).toBeCloseTo(0.2 + 0.8 / (1 + Math.exp(6)), 10);
    for (let th = -4; th <= 4; th += 0.25) {
      expect(svc.probCorrect(params, th)).toBeGreaterThanOrEqual(0.2);
    }
  });

  it('Rasch: identical to 2PL with a=1', () => {
    for (let th = -3; th <= 3; th += 0.5) {
      expect(svc.probCorrect(pR(0.7), th)).toBeCloseTo(svc.probCorrect(p2(1, 0.7), th), 12);
    }
  });

  it('GRM: a=1.5, thresholds [-1,0,1] at theta=0 gives the hand-computed category probabilities', () => {
    // P*(>=1)=1/(1+e^-1.5)=0.8175744762, P*(>=2)=0.5, P*(>=3)=1/(1+e^1.5)=0.1824255238
    const probs = svc.categoryProbabilities(pG(1.5, [-1, 0, 1]), 0);
    expect(probs).toHaveLength(4);
    expect(probs[0]).toBeCloseTo(0.18242552380635635, 9);
    expect(probs[1]).toBeCloseTo(0.31757447619364365, 9);
    expect(probs[2]).toBeCloseTo(0.31757447619364365, 9);
    expect(probs[3]).toBeCloseTo(0.18242552380635635, 9);
  });

  it('GRM: category probabilities are a proper distribution (each in [0,1], sum to 1) across the trait range', () => {
    const params = pG(2.2, [-1.8, -0.4, 0.9, 2.1]);
    for (let th = -4; th <= 4; th += 0.2) {
      const probs = svc.categoryProbabilities(params, th);
      let sum = 0;
      for (const p of probs) {
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
        sum += p;
      }
      expect(sum).toBeCloseTo(1, 9);
    }
  });

  it('probabilities never leave [0,1] even for extreme parameters/theta', () => {
    const extremes = [p2(2.5, -3), p2(2.5, 3), p3(2.5, 3, 0.25), pR(-3)];
    for (const params of extremes) {
      for (const th of [-4, -3.95, 0, 3.95, 4]) {
        const p = svc.probCorrect(params, th);
        expect(p).toBeGreaterThan(0);
        expect(p).toBeLessThan(1);
      }
    }
  });
});

describe('IrtScoringService — EAP ability estimation (independent reference values)', () => {
  // References computed with trapezoid integration over [-8, 8], step 1e-3
  // (see scratchpad eap-ref.js methodology in the module docblock).
  const TOL = 5e-3;

  it('5 Rasch items b=[-1,-0.5,0,0.5,1], all correct -> theta=1.28615, SE=0.74681', () => {
    const r = svc.scoreEap(items([pR(-1), pR(-0.5), pR(0), pR(0.5), pR(1)]), { q1: 1, q2: 1, q3: 1, q4: 1, q5: 1 })!;
    expect(r.thetaEstimate).toBeCloseTo(1.2861510161694576, 2);
    expect(Math.abs(r.thetaEstimate - 1.2861510161694576)).toBeLessThan(TOL);
    expect(Math.abs(r.standardError - 0.7468106129888165)).toBeLessThan(TOL);
    expect(r.itemsUsed).toBe(5);
  });

  it('same Rasch set, all incorrect -> exact mirror image theta=-1.28615 (posterior symmetry)', () => {
    const params = items([pR(-1), pR(-0.5), pR(0), pR(0.5), pR(1)]);
    const hi = svc.scoreEap(params, { q1: 1, q2: 1, q3: 1, q4: 1, q5: 1 })!;
    const lo = svc.scoreEap(params, { q1: 0, q2: 0, q3: 0, q4: 0, q5: 0 })!;
    expect(Math.abs(lo.thetaEstimate + 1.2861510161694576)).toBeLessThan(TOL);
    expect(lo.thetaEstimate).toBeCloseTo(-hi.thetaEstimate, 8);
    expect(lo.standardError).toBeCloseTo(hi.standardError, 8);
    // all-correct clearly above all-incorrect, both informative (SE < prior SD 1)
    expect(hi.thetaEstimate).toBeGreaterThan(1);
    expect(lo.thetaEstimate).toBeLessThan(-1);
    expect(hi.standardError).toBeLessThan(1);
  });

  it('2PL mixed pattern a=[1.2,0.8,1.5,1,2], b=[-1.5,-0.5,0,0.5,1.5], u=[1,1,1,0,0] -> theta=0.30942, SE=0.65280', () => {
    const r = svc.scoreEap(items([p2(1.2, -1.5), p2(0.8, -0.5), p2(1.5, 0), p2(1, 0.5), p2(2, 1.5)]), {
      q1: 1, q2: 1, q3: 1, q4: 0, q5: 0,
    })!;
    expect(Math.abs(r.thetaEstimate - 0.30941909953882624)).toBeLessThan(TOL);
    expect(Math.abs(r.standardError - 0.6527957218430864)).toBeLessThan(TOL);
  });

  it('3PL pattern a=[1.4,1.1], b=[0,1], c=[0.2,0.25], u=[1,0] -> theta=0.05808, SE=0.87229', () => {
    const r = svc.scoreEap(items([p3(1.4, 0, 0.2), p3(1.1, 1, 0.25)]), { q1: 1, q2: 0 })!;
    expect(Math.abs(r.thetaEstimate - 0.05807693062882497)).toBeLessThan(TOL);
    expect(Math.abs(r.standardError - 0.8722933618253284)).toBeLessThan(TOL);
  });

  it('GRM pattern (3 polytomous items, x=[2,1,3]) -> theta=0.56026, SE=0.52040', () => {
    const r = svc.scoreEap(
      items([pG(1.8, [-1.2, 0, 1.1]), pG(1.4, [-0.8, 0.3, 1.5]), pG(2.1, [-1.5, -0.4, 0.7])]),
      { q1: 2, q2: 1, q3: 3 },
    )!;
    expect(Math.abs(r.thetaEstimate - 0.5602645996038873)).toBeLessThan(TOL);
    expect(Math.abs(r.standardError - 0.5204017879877768)).toBeLessThan(TOL);
    expect(r.irtModelsUsed).toEqual([IrtModel.GRM]);
  });

  it('seeded 7-item GRM demo instrument, answers [2,1,3,1,2,2,3] -> theta=0.80290, SE=0.38529', () => {
    // Exact parameters seeded for VPSY-ANX-IRT-7 (prisma/seed.ts) — the live
    // instrument must reproduce this worked example end-to-end.
    const r = svc.scoreEap(
      items([
        pG(1.8, [-1.2, 0.0, 1.1]),
        pG(1.4, [-0.8, 0.3, 1.5]),
        pG(2.1, [-1.5, -0.4, 0.7]),
        pG(1.1, [-0.3, 0.8, 1.9]),
        pG(1.6, [-1.0, 0.2, 1.3]),
        pG(1.3, [-0.5, 0.6, 1.7]),
        pG(1.9, [-1.3, -0.2, 0.9]),
      ]),
      { q1: 2, q2: 1, q3: 3, q4: 1, q5: 2, q6: 2, q7: 3 },
    )!;
    expect(Math.abs(r.thetaEstimate - 0.8029009175913591)).toBeLessThan(TOL);
    expect(Math.abs(r.standardError - 0.38528542460586723)).toBeLessThan(TOL);
    expect(r.reliabilityAtTheta).toBeCloseTo(1 - 0.38528542460586723 ** 2, 2);
    expect(r.itemsUsed).toBe(7);
  });

  it('more items shrink the posterior SD (SE decreases with information)', () => {
    const bank = items([pR(-1.5), pR(-1), pR(-0.5), pR(0), pR(0.5), pR(1), pR(1.5), pR(-0.25), pR(0.25), pR(0.75)]);
    const few = svc.scoreEap(bank.slice(0, 3), { q1: 1, q2: 0, q3: 1 })!;
    const many = svc.scoreEap(bank, { q1: 1, q2: 0, q3: 1, q4: 1, q5: 0, q6: 1, q7: 0, q8: 1, q9: 0, q10: 1 })!;
    expect(many.standardError).toBeLessThan(few.standardError);
    expect(few.standardError).toBeLessThan(1); // any informative response beats the prior SD
  });

  it('skips unanswered items: a partial pattern scores identically to the same items alone', () => {
    const three = items([p2(1.2, -0.5), p2(1.6, 0.2), p2(0.9, 1.0)]);
    const withExtra = [...three, { linkId: 'q99', params: p2(1.4, 0) }];
    const a = svc.scoreEap(three, { q1: 1, q2: 0, q3: 1 })!;
    const b = svc.scoreEap(withExtra, { q1: 1, q2: 0, q3: 1 })!; // q99 never answered
    expect(b.thetaEstimate).toBeCloseTo(a.thetaEstimate, 12);
    expect(b.standardError).toBeCloseTo(a.standardError, 12);
    expect(b.itemsUsed).toBe(3);
  });

  it('returns null when no calibrated item was answered (caller falls back to classical)', () => {
    expect(svc.scoreEap(items([p2(1, 0)]), { other: 1 })).toBeNull();
    expect(svc.scoreEap([], { q1: 1 })).toBeNull();
  });

  it('is deterministic — identical inputs always produce identical estimates', () => {
    const set = items([pG(1.8, [-1.2, 0, 1.1]), p2(1.3, 0.4)]);
    const answers = { q1: 2, q2: 1 };
    expect(svc.scoreEap(set, answers)).toEqual(svc.scoreEap(set, answers));
  });

  it('theta and SE are always finite, and percentile maps theta onto (0,100) via the normal CDF', () => {
    const r0 = svc.scoreEap(items([pR(1), pR(-1)]), { q1: 1, q2: 0 })!; // symmetric -> theta ~ 0
    expect(r0.thetaEstimate).toBeCloseTo(0, 8);
    expect(r0.percentile).toBeCloseTo(50, 5);
    // 3 Rasch items all-correct: EAP shrinks toward the N(0,1) prior -> theta ~0.96, percentile ~83
    const hi = svc.scoreEap(items([pR(-1), pR(0), pR(1)]), { q1: 1, q2: 1, q3: 1 })!;
    expect(hi.percentile).toBeGreaterThan(75);
    expect(hi.percentile).toBeLessThan(100);
    expect(Number.isFinite(hi.thetaEstimate)).toBe(true);
    expect(Number.isFinite(hi.standardError)).toBe(true);
  });

  it('normalCdf matches known values (Phi(0)=0.5, Phi(1.96)~0.975)', () => {
    expect(svc.normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(svc.normalCdf(1.96)).toBeCloseTo(0.9750021, 5);
    expect(svc.normalCdf(-1.96)).toBeCloseTo(0.0249979, 5);
  });
});

describe('IrtScoringService — fails LOUDLY on invalid calibration or responses (never a silent wrong theta)', () => {
  it.each([
    ['RASCH with a != 1', { model: IrtModel.RASCH, a: 1.4, b: 0, c: null, thresholds: [] }],
    ['non-positive discrimination', { model: IrtModel.TWO_PL, a: 0, b: 0, c: null, thresholds: [] }],
    ['3PL without a guessing parameter', { model: IrtModel.THREE_PL, a: 1.2, b: 0, c: null, thresholds: [] }],
    ['3PL with c >= 1', { model: IrtModel.THREE_PL, a: 1.2, b: 0, c: 1, thresholds: [] }],
    ['3PL with negative c', { model: IrtModel.THREE_PL, a: 1.2, b: 0, c: -0.1, thresholds: [] }],
    ['guessing on a 2PL item', { model: IrtModel.TWO_PL, a: 1.2, b: 0, c: 0.2, thresholds: [] }],
    ['GRM without thresholds', { model: IrtModel.GRM, a: 1.2, b: 0, c: null, thresholds: [] }],
    ['GRM with unordered thresholds', { model: IrtModel.GRM, a: 1.2, b: 0, c: null, thresholds: [-0.5, 1.2, 0.3] }],
    ['GRM with duplicated thresholds', { model: IrtModel.GRM, a: 1.2, b: 0, c: null, thresholds: [0, 0, 1] }],
    ['thresholds on a dichotomous item', { model: IrtModel.TWO_PL, a: 1.2, b: 0, c: null, thresholds: [0.5] }],
  ])('rejects %s at parse time (422)', (_label, raw) => {
    expect(() => svc.parseParams(raw, 'qX')).toThrow(UnprocessableEntityException);
  });

  it('accepts a well-formed calibration row and strips unknown storage columns', () => {
    const parsed = svc.parseParams(
      { id: 'ip_1', itemId: 'item_1', calibrationId: 'cal_1', model: 'GRM', a: 1.7, b: 0, c: null, thresholds: [-1, 0.2, 1.4] },
      'q1',
    );
    expect(parsed).toEqual({ model: IrtModel.GRM, a: 1.7, b: 0, c: null, thresholds: [-1, 0.2, 1.4] });
  });

  it('rejects an out-of-range dichotomous response (only 0/1 is scorable)', () => {
    expect(() => svc.scoreEap(items([p2(1.2, 0)]), { q1: 2 })).toThrow(UnprocessableEntityException);
  });

  it('rejects an out-of-range or non-integer GRM response', () => {
    const set = items([pG(1.5, [-1, 0, 1])]); // valid categories: 0..3
    expect(() => svc.scoreEap(set, { q1: 4 })).toThrow(UnprocessableEntityException);
    expect(() => svc.scoreEap(set, { q1: -1 })).toThrow(UnprocessableEntityException);
    expect(() => svc.scoreEap(set, { q1: 1.5 })).toThrow(UnprocessableEntityException);
  });
});
