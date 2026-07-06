import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { IrtModel, type IrtItemParameter } from '@vpsy/contracts';

/**
 * CAT item selection — Maximum Fisher Information at the current θ̂
 * (docs/technical/07-psychometrics-engine.md §6). Deterministic, closed-form
 * math, validated in cat-selection.service.spec.ts against hand-computed
 * values (2PL/3PL) and numerical differentiation (GRM) — a wrong information
 * function silently degrades measurement (the CAT would ask uninformative
 * items), so this gets the same correctness bar as the EAP estimator.
 *
 * Item information functions:
 *   2PL   : I(θ) = a²·P·Q                       (Q = 1−P; at θ=b this is a²/4)
 *   3PL   : I(θ) = a²·(Q/P)·((P−c)/(1−c))²      (reduces to 2PL at c=0)
 *   RASCH : the a=1 case of 2PL → P·Q
 *   GRM   : I(θ) = Σ_k (P'_k)² / P_k            (Samejima)
 *
 * GRM derivation (boundary-derivative formulation): with cumulative curves
 * P*_k(θ) = 1/(1+e^{−a(θ−b_k)}) and category probabilities
 * P_k = P*_k − P*_{k+1} (P*_0 ≡ 1, P*_{m+1} ≡ 0), the logistic derivative is
 * dP*_k/dθ = a·P*_k·(1−P*_k) (and 0 for the constant boundaries), so
 * P'_k = a·[P*_k(1−P*_k) − P*_{k+1}(1−P*_{k+1})]. Fisher information of the
 * item score is I(θ) = E[(∂ log P_X/∂θ)²] = Σ_k P_k·(P'_k/P_k)² = Σ_k (P'_k)²/P_k
 * (the −Σ P''_k observed-information term vanishes in expectation because
 * Σ_k P_k = 1 ⇒ Σ_k P''_k = 0).
 */

/** Doc §6 exposure policy: `{"method": "randomesque", "n": 3}`. */
const RANDOMESQUE_TOP_N = 3;
/** Guard against division by a numerically-zero category probability at extreme θ. */
const INFO_EPS = 1e-10;

export interface CatCandidate {
  /** Item row id (exposure bookkeeping / administeredItemIds). */
  itemId: string;
  /** Answer key — Item.linkId ?? Item.id, same convention as batch scoring. */
  linkId: string;
  params: IrtItemParameter;
}

@Injectable()
export class CatSelectionService {
  /**
   * Injectable RNG for the randomesque draw so tests pin selection
   * deterministically; production keeps Math.random. Only ever used to pick
   * WITHIN the top-`RANDOMESQUE_TOP_N` most informative items — never to
   * influence scoring.
   */
  rng: () => number = Math.random;

  /** Fisher information I(θ) contributed by one calibrated item. Always ≥ 0. */
  itemInformation(params: IrtItemParameter, theta: number): number {
    if (params.model === IrtModel.GRM) {
      const { a, thresholds } = params;
      const pStar = thresholds.map((b) => 1 / (1 + Math.exp(-a * (theta - b))));
      // dP*_k/dθ = a·P*_k·(1−P*_k); the constant boundaries P*_0=1, P*_{m+1}=0 have derivative 0.
      const dStar = pStar.map((p) => a * p * (1 - p));
      let info = 0;
      for (let k = 0; k <= thresholds.length; k++) {
        const upper = k === 0 ? 1 : pStar[k - 1]!;
        const lower = k === thresholds.length ? 0 : pStar[k]!;
        const pk = Math.max(upper - lower, INFO_EPS);
        const dUpper = k === 0 ? 0 : dStar[k - 1]!;
        const dLower = k === thresholds.length ? 0 : dStar[k]!;
        const dpk = dUpper - dLower; // P'_k
        info += (dpk * dpk) / pk;
      }
      return info;
    }

    // Dichotomous family. RASCH is the a=1 case (validated upstream); c only
    // exists for 3PL.
    const a = params.model === IrtModel.RASCH ? 1 : params.a;
    const c = params.model === IrtModel.THREE_PL ? (params.c ?? 0) : 0;
    const p = c + (1 - c) / (1 + Math.exp(-a * (theta - params.b)));
    const q = 1 - p;
    if (c === 0) return a * a * p * q; // 2PL / RASCH — exactly a²/4 at θ=b
    // 3PL: the guessing floor deflates information below θ=b.
    const pSafe = Math.max(p, INFO_EPS);
    const ratio = (p - c) / (1 - c);
    return a * a * (q / pSafe) * ratio * ratio;
  }

  /**
   * Selects the next item: ranks eligible candidates by Fisher information at
   * the current θ̂ (descending; ties broken by input order, which callers keep
   * stable by orderIndex) and draws randomly among the top 3 (randomesque
   * exposure control, doc §6) so the single most informative item is not
   * administered to every respondent and the bank is not compromised.
   */
  selectNextItem<T extends CatCandidate>(candidates: readonly T[], theta: number): T {
    if (candidates.length === 0) {
      // Callers terminate on bank exhaustion BEFORE selecting; reaching this is a bug.
      throw new UnprocessableEntityException('CAT item selection called with an empty candidate set');
    }
    const ranked = candidates
      .map((candidate, order) => ({ candidate, order, info: this.itemInformation(candidate.params, theta) }))
      .sort((x, y) => y.info - x.info || x.order - y.order);
    const topN = Math.min(RANDOMESQUE_TOP_N, ranked.length);
    const draw = Math.min(topN - 1, Math.max(0, Math.floor(this.rng() * topN)));
    return ranked[draw]!.candidate;
  }
}
