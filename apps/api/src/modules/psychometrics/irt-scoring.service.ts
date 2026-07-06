import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { IrtModel, irtItemParameterSchema, type IrtItemParameter, type IrtScoreResult } from '@vpsy/contracts';

/**
 * IRT latent-trait scoring engine (docs/technical/07-psychometrics-engine.md §5).
 *
 * Deterministic and pure — the AI layer NEVER touches this path, exactly like
 * classical scoring. Every number here is a closed-form function of the stored
 * calibration parameters and the observed responses:
 *
 *   Response models
 *     RASCH  : P(u=1|θ) = 1 / (1 + e^{-(θ-b)})                (a fixed at 1)
 *     2PL    : P(u=1|θ) = 1 / (1 + e^{-a(θ-b)})
 *     3PL    : P(u=1|θ) = c + (1-c) / (1 + e^{-a(θ-b)})
 *     GRM    : P*(x≥k|θ) = 1 / (1 + e^{-a(θ-b_k)}),  b_1 < … < b_m
 *              P(x=k|θ) = P*(x≥k) − P*(x≥k+1),  with P*(x≥0)=1, P*(x≥m+1)=0
 *
 *   Ability estimation — EAP (Expected A Posteriori) over a fixed θ grid
 *   [-4, 4] (step 0.05, 161 points) with a standard-normal prior:
 *     θ̂  = Σ θ_k·w_k / Σ w_k          where w_k ∝ φ(θ_k)·L(responses|θ_k)
 *     SE = sqrt( Σ (θ_k−θ̂)²·w_k / Σ w_k )   (posterior SD)
 *   Log-space likelihoods with max-subtraction guard against underflow, so
 *   long response strings can never collapse the posterior to all-zeros.
 *
 * Calibration rows are validated LOUDLY (422) before any math runs — a wrong
 * IRT score is worse than none, so a mis-stored parameter (unordered GRM
 * thresholds, RASCH with a≠1, c outside [0,1), …) refuses to score instead of
 * silently producing a plausible-looking wrong θ.
 */

export interface IrtScorableItem {
  /** Key into the response's `answers` record (Item.linkId ?? Item.id). */
  linkId: string;
  params: IrtItemParameter;
}

const THETA_MIN = -4;
const THETA_MAX = 4;
const THETA_STEP = 0.05;
/** Probability clamp so log-likelihoods stay finite (3PL asymptotes, extreme θ). */
const P_EPS = 1e-10;

const DICHOTOMOUS: ReadonlySet<string> = new Set([IrtModel.RASCH, IrtModel.TWO_PL, IrtModel.THREE_PL]);

@Injectable()
export class IrtScoringService {
  /**
   * Validates a raw stored ItemParameter row into a scorable parameter set.
   * Throws 422 (configuration error, not caller error) on any violation.
   */
  parseParams(raw: unknown, itemLabel: string): IrtItemParameter {
    const parsed = irtItemParameterSchema.safeParse(raw);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((i) => i.message).join('; ');
      throw new UnprocessableEntityException(
        `IRT calibration for item "${itemLabel}" is invalid and cannot be scored: ${detail}`,
      );
    }
    return parsed.data;
  }

  /** Dichotomous response probability P(u=1|θ). Always within (0, 1). */
  probCorrect(params: IrtItemParameter, theta: number): number {
    const a = params.model === IrtModel.RASCH ? 1 : params.a;
    const c = params.model === IrtModel.THREE_PL ? (params.c ?? 0) : 0;
    const p = c + (1 - c) / (1 + Math.exp(-a * (theta - params.b)));
    return Math.min(1 - P_EPS, Math.max(P_EPS, p));
  }

  /**
   * GRM category probabilities [P(x=0|θ), …, P(x=m|θ)] from the m ordered
   * thresholds. Sums to 1 by construction; each entry clamped into (0, 1).
   */
  categoryProbabilities(params: IrtItemParameter, theta: number): number[] {
    const { a, thresholds } = params;
    // Cumulative curves P*(x≥k) for k = 1..m, monotonically decreasing in k
    // because thresholds are strictly increasing (validated upstream).
    const pStar = thresholds.map((b) => 1 / (1 + Math.exp(-a * (theta - b))));
    const probs: number[] = [];
    for (let k = 0; k <= thresholds.length; k++) {
      const upper = k === 0 ? 1 : pStar[k - 1]!;
      const lower = k === thresholds.length ? 0 : pStar[k]!;
      probs.push(Math.min(1 - P_EPS, Math.max(P_EPS, upper - lower)));
    }
    return probs;
  }

  /** log P(observed response | θ) for one item; validates the response range. */
  private logLikelihood(item: IrtScorableItem, response: number, theta: number): number {
    const { params } = item;
    if (DICHOTOMOUS.has(params.model)) {
      if (response !== 0 && response !== 1) {
        throw new UnprocessableEntityException(
          `Item "${item.linkId}" uses the dichotomous ${params.model} model — response must be 0 or 1, got ${response}`,
        );
      }
      const p = this.probCorrect(params, theta);
      return response === 1 ? Math.log(p) : Math.log(1 - p);
    }
    // GRM: response is a category index 0..m
    const m = params.thresholds.length;
    if (!Number.isInteger(response) || response < 0 || response > m) {
      throw new UnprocessableEntityException(
        `Item "${item.linkId}" uses the GRM model with ${m} thresholds — response must be an integer in [0, ${m}], got ${response}`,
      );
    }
    return Math.log(this.categoryProbabilities(params, theta)[response]!);
  }

  /**
   * EAP ability estimation over the answered items. Returns null when no
   * calibrated item was answered (caller falls back to classical scoring);
   * otherwise θ̂ (posterior mean), SE (posterior SD), the EAP reliability
   * (1 − SE², i.e. 1 − posterior variance / prior variance with a N(0,1)
   * prior) and the normal-metric percentile Φ(θ̂)·100.
   */
  scoreEap(items: IrtScorableItem[], answers: Record<string, number>): IrtScoreResult | null {
    const answered = items.filter((it) => typeof answers[it.linkId] === 'number');
    if (answered.length === 0) return null;

    const nGrid = Math.round((THETA_MAX - THETA_MIN) / THETA_STEP) + 1;
    const logPost: number[] = new Array(nGrid);
    const grid: number[] = new Array(nGrid);

    for (let k = 0; k < nGrid; k++) {
      const theta = THETA_MIN + k * THETA_STEP;
      grid[k] = theta;
      // N(0,1) log-prior up to an additive constant (normalization cancels).
      let lp = -0.5 * theta * theta;
      for (const item of answered) {
        lp += this.logLikelihood(item, answers[item.linkId]!, theta);
      }
      logPost[k] = lp;
    }

    // Softmax-style normalization in log space to avoid underflow.
    const maxLp = Math.max(...logPost);
    let sumW = 0;
    let sumWTheta = 0;
    const w: number[] = new Array(nGrid);
    for (let k = 0; k < nGrid; k++) {
      const wk = Math.exp(logPost[k]! - maxLp);
      w[k] = wk;
      sumW += wk;
      sumWTheta += wk * grid[k]!;
    }
    const theta = sumWTheta / sumW;

    let sumWVar = 0;
    for (let k = 0; k < nGrid; k++) {
      const d = grid[k]! - theta;
      sumWVar += w[k]! * d * d;
    }
    const variance = sumWVar / sumW;
    const standardError = Math.sqrt(variance);

    if (!Number.isFinite(theta) || !Number.isFinite(standardError)) {
      // Cannot happen with clamped probabilities + max-subtraction, but a
      // diverged θ must never be persisted as a clinical score.
      throw new UnprocessableEntityException('IRT ability estimation diverged; response not scored');
    }

    return {
      thetaEstimate: theta,
      standardError,
      // EAP reliability with a N(0,1) prior: 1 − posteriorVar / priorVar.
      reliabilityAtTheta: Math.min(1, Math.max(0, 1 - variance)),
      percentile: this.normalCdf(theta) * 100,
      itemsUsed: answered.length,
      irtModelsUsed: [...new Set(answered.map((it) => it.params.model))],
    };
  }

  /** Standard-normal CDF Φ(x) via the Abramowitz–Stegun 7.1.26 erf approximation (|err| < 1.5e-7). */
  normalCdf(x: number): number {
    const z = x / Math.SQRT2;
    const t = 1 / (1 + 0.3275911 * Math.abs(z));
    const y =
      1 -
      (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) *
        Math.exp(-z * z);
    const erf = z >= 0 ? y : -y;
    return 0.5 * (1 + erf);
  }
}
