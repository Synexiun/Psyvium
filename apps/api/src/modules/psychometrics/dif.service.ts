import { BadRequestException, Injectable } from '@nestjs/common';
import { stampAlgorithm } from '../../common/clinical';

/**
 * Differential Item Functioning (DIF) analysis skeleton (doc 07).
 *
 * Implements a Mantel–Haenszel style contingency framework with honest
 * minimum-sample gates. Full multi-group IRT DIF / TIF reporting is a research
 * pipeline; this service never fabricates significance from thin data.
 *
 * Best-case professional posture: run offline on de-identified response
 * extracts; surface results to psychometricians, not patients.
 */

export interface DifCell {
  /** Focal group endorsement count for this item at this score level. */
  focalYes: number;
  focalNo: number;
  /** Reference group. */
  refYes: number;
  refNo: number;
  /** Matching score / total raw score stratum. */
  stratum: number;
}

export interface DifItemInput {
  itemId: string;
  linkId?: string;
  cells: DifCell[];
}

export interface DifAnalysisRequest {
  instrumentCode: string;
  groupLabel: string; // e.g. "language:es vs en"
  items: DifItemInput[];
  /** Minimum total N per item across strata (default 200). */
  minN?: number;
}

export interface DifItemResult {
  itemId: string;
  linkId?: string;
  mantelHaenszelAlpha: number | null;
  classification: 'negligible' | 'moderate' | 'large' | 'insufficient_sample' | 'undefined';
  nTotal: number;
  note: string;
}

export interface DifAnalysisResult {
  instrumentCode: string;
  groupLabel: string;
  items: DifItemResult[];
  algorithm: ReturnType<typeof stampAlgorithm>;
  disclaimer: string;
}

@Injectable()
export class DifService {
  /**
   * Mantel–Haenszel common odds ratio across score strata.
   * Returns null alpha when sample is inadequate.
   */
  analyze(request: DifAnalysisRequest): DifAnalysisResult {
    if (!request.items?.length) {
      throw new BadRequestException('At least one item is required for DIF analysis');
    }
    const minN = request.minN ?? 200;
    const items = request.items.map((item) => this.analyzeItem(item, minN));

    return {
      instrumentCode: request.instrumentCode,
      groupLabel: request.groupLabel,
      items,
      algorithm: stampAlgorithm(
        'scoring.classical',
        '1.0.0-dif-mh',
        'Mantel–Haenszel DIF (Holland & Thayer tradition); sample-size gated.',
      ),
      disclaimer:
        'DIF results are psychometric research outputs — never used for automated clinical decisions. ' +
        'Insufficient samples are classified honestly, never forced to significance.',
    };
  }

  private analyzeItem(item: DifItemInput, minN: number): DifItemResult {
    let nTotal = 0;
    let num = 0;
    let den = 0;

    for (const c of item.cells) {
      const nF = c.focalYes + c.focalNo;
      const nR = c.refYes + c.refNo;
      const n = nF + nR;
      if (n === 0) continue;
      nTotal += n;
      // MH weights
      num += (c.focalYes * c.refNo) / n;
      den += (c.focalNo * c.refYes) / n;
    }

    if (nTotal < minN) {
      return {
        itemId: item.itemId,
        linkId: item.linkId,
        mantelHaenszelAlpha: null,
        classification: 'insufficient_sample',
        nTotal,
        note: `N=${nTotal} < minN=${minN}; DIF not estimated.`,
      };
    }
    if (den === 0) {
      return {
        itemId: item.itemId,
        linkId: item.linkId,
        mantelHaenszelAlpha: null,
        classification: 'undefined',
        nTotal,
        note: 'Zero denominator in Mantel–Haenszel sum — cannot compute α.',
      };
    }

    const alpha = num / den;
    // ETS-style rough |log(alpha)| thresholds (approx on odds-ratio scale)
    const logA = Math.abs(Math.log(alpha));
    let classification: DifItemResult['classification'] = 'negligible';
    if (logA >= Math.log(1.5)) classification = 'moderate';
    if (logA >= Math.log(2.0)) classification = 'large';

    return {
      itemId: item.itemId,
      linkId: item.linkId,
      mantelHaenszelAlpha: Number(alpha.toFixed(4)),
      classification,
      nTotal,
      note: `MH α=${alpha.toFixed(4)} (log|α|=${logA.toFixed(3)}).`,
    };
  }
}
