import { Injectable } from '@nestjs/common';
import { SeverityBand, type QuestionnaireCutoffs } from '@vpsy/contracts';

export interface ClassicalScoreResult {
  rawScore: number;
  severityBand: SeverityBand | null;
  interpretation: string;
}

/**
 * Deterministic classical (raw-sum) scoring. AI never touches this path —
 * severity banding is a pure function of the raw score against the published
 * QuestionnaireVersion's cutoffs, so results are reproducible and auditable.
 * Bands are inclusive [min, max] ranges; the first matching band wins.
 */
@Injectable()
export class ScoringService {
  score(answers: Record<string, number>, cutoffs: QuestionnaireCutoffs): ClassicalScoreResult {
    const rawScore = Object.values(answers).reduce((sum, v) => sum + v, 0);

    const band = cutoffs.bands.find((b) => rawScore >= b.min && rawScore <= b.max);
    if (!band) {
      return {
        rawScore,
        severityBand: null,
        interpretation: `No severity band configured for raw score ${rawScore}`,
      };
    }

    return {
      rawScore,
      severityBand: band.band,
      interpretation: `Raw score ${rawScore} falls in the ${band.band} band (${band.min}-${band.max}).`,
    };
  }
}
