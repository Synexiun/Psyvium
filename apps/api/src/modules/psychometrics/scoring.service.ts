import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { RiskType, SeverityBand, type QuestionnaireCutoffs } from '@vpsy/contracts';

export interface ClassicalScoreResult {
  rawScore: number;
  severityBand: SeverityBand | null;
  interpretation: string;
}

/**
 * Safety-item scoring hook (docs/technical/07-psychometrics-engine.md §4).
 * Lives *inside* the questionnaire version's existing scoring JSON (the
 * `cutoffs` column) as a sibling of `bands` — no new contract/table:
 * `{ bands: [...], safetyItems: [{ itemId: "q9", minAnswer: 1, category: "suicidal_ideation" }] }`.
 * `category` is matched case-insensitively against the existing `RiskType`
 * enum so a hit maps deterministically onto a real RiskFlag.type — never a
 * free-text value. Validated inline here; `@vpsy/contracts` is untouched.
 */
const safetyItemSchema = z.object({
  itemId: z.string(),
  minAnswer: z.number(),
  category: z.preprocess(
    (v) => (typeof v === 'string' ? v.toUpperCase() : v),
    z.nativeEnum(RiskType),
  ),
});
export type SafetyItemSpec = z.infer<typeof safetyItemSchema>;

const scoringSpecSafetySchema = z
  .object({ safetyItems: z.array(safetyItemSchema).optional() })
  .passthrough();

export interface SafetyItemHit {
  itemId: string;
  category: RiskType;
  answer: number;
  minAnswer: number;
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

    // Optional sub-band (WAVE CR — "PHQ-9 5-tier collapse"): when the
    // published instrument convention distinguishes a finer tier within this
    // SeverityBand (e.g. "moderately severe" vs "severe" inside SEVERE), the
    // matching label is threaded into the *persisted* interpretation — never
    // left as metadata-only JSON nobody reads.
    const subBand = cutoffs.subBands?.find(
      (sb) => sb.parentBand === band.band && rawScore >= sb.min && rawScore <= sb.max,
    );

    return {
      rawScore,
      severityBand: band.band,
      interpretation:
        `Raw score ${rawScore} falls in the ${band.band} band (${band.min}-${band.max})` +
        (subBand ? `, sub-band ${subBand.label} (${subBand.min}-${subBand.max}).` : '.'),
    };
  }

  /**
   * Deterministic safety-item check — never delegated to the AI layer, same
   * principle as the intake safety screen. `rawScoringSpec` is the
   * QuestionnaireVersion's raw `cutoffs` JSON (may or may not carry
   * `safetyItems`); malformed/absent config safely yields no hits rather than
   * throwing, so a mis-configured instrument fails safe to "no signal" instead
   * of blocking scoring — the classical band above still stands on its own.
   */
  checkSafetyItems(answers: Record<string, number>, rawScoringSpec: unknown): SafetyItemHit[] {
    const parsed = scoringSpecSafetySchema.safeParse(rawScoringSpec);
    if (!parsed.success || !parsed.data.safetyItems?.length) return [];

    const hits: SafetyItemHit[] = [];
    for (const item of parsed.data.safetyItems) {
      const answer = answers[item.itemId];
      if (typeof answer === 'number' && answer >= item.minAnswer) {
        hits.push({ itemId: item.itemId, category: item.category, answer, minAnswer: item.minAnswer });
      }
    }
    return hits;
  }
}
