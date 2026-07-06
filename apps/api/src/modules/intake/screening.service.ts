import { Injectable } from '@nestjs/common';
import {
  RiskSource,
  RiskType,
  SeverityBand,
  type BehaviorHistoryInput,
  type SubmitIntakeInput,
} from '@vpsy/contracts';

export interface ScreeningComputation {
  riskScore: number;
  severityBand: SeverityBand;
  urgencyScore: number;
  suggestedSpecialty: string;
  virtualCareSuitable: boolean;
  contraindications: string[];
  riskFlags: Array<{
    type: RiskType;
    severity: SeverityBand;
    source: RiskSource;
    evidence: string;
    evidenceDetail?: Record<string, unknown>;
  }>;
}

/**
 * Graduated ideation-level → score/urgency contribution (WAVE CR item 1,
 * C-SSRS Posner 2011). Deliberately calibrated so the two boolean-derived
 * levels (2 = suicidalIdeation alone, 5 = suicidalPlan) reproduce the exact
 * pre-graduation numbers (30/45 score, 15/30 urgency) — legacy callers that
 * only ever send the booleans see byte-identical results.
 */
const IDEATION_SCORE_BY_LEVEL: Record<number, number> = { 0: 0, 1: 12, 2: 30, 3: 38, 4: 42, 5: 45 };
const IDEATION_URGENCY_BY_LEVEL: Record<number, number> = { 0: 0, 1: 5, 2: 15, 3: 20, 4: 25, 5: 30 };
const BEHAVIOR_HISTORY_SCORE_BONUS = 15;
const RECENT_LOSS_SCORE_BONUS = 6;

/**
 * Deterministic clinical screening. Safety-critical decisions (risk flags,
 * escalation, in-person redirection) are computed by explicit rules — NEVER by
 * the AI layer. The AI summary is additive and clinician-confirmed.
 * See docs/technical/05-ai-clinical-layer.md and 06-security-and-rbac.md.
 */
@Injectable()
export class ScreeningService {
  compute(intake: SubmitIntakeInput): ScreeningComputation {
    const riskFlags: ScreeningComputation['riskFlags'] = [];

    // ── Safety screen → deterministic risk flags ──
    const s = intake.safety;

    // Graduated C-SSRS-style triage (WAVE CR item 1): the effective ideation
    // level is whichever the caller provided — the 0-5 `ideationSeverity`
    // takes precedence; legacy boolean-only callers are mapped onto the same
    // scale (suicidalIdeation → 2, suicidalPlan → 5).
    const ideationLevel =
      typeof s.ideationSeverity === 'number'
        ? s.ideationSeverity
        : s.suicidalPlan
          ? 5
          : s.suicidalIdeation
            ? 2
            : 0;
    const behaviorHistory: BehaviorHistoryInput | undefined = s.behaviorHistory;
    const behaviorPositive = !!(
      behaviorHistory &&
      (behaviorHistory.priorAttempt ||
        behaviorHistory.aborted ||
        behaviorHistory.preparatory ||
        behaviorHistory.recentSelfHarm)
    );

    // C-SSRS decision logic: level 4-5 or ANY positive behavior history is an
    // imminent-risk signal → SEVERE; level 3 → HIGH; level 1-2 → MODERATE
    // (still escalated to a human, just a lower-priority lane); level 0 with
    // no behavior history → no ideation flag at all.
    let ideationSeverity: SeverityBand | null = null;
    if (ideationLevel >= 4 || behaviorPositive) ideationSeverity = SeverityBand.SEVERE;
    else if (ideationLevel === 3) ideationSeverity = SeverityBand.HIGH;
    else if (ideationLevel >= 1) ideationSeverity = SeverityBand.MODERATE;

    if (ideationSeverity) {
      riskFlags.push({
        type: RiskType.SUICIDAL_IDEATION,
        severity: ideationSeverity,
        source: RiskSource.SCREENING,
        evidence:
          ideationLevel >= 4 || behaviorPositive
            ? 'Active suicidal ideation at a severe/imminent C-SSRS level (intent/plan and/or a positive behavior history)'
            : ideationLevel === 3
              ? 'Suicidal ideation with a method, no intent to act disclosed'
              : 'Passive/nonspecific suicidal ideation endorsed',
        evidenceDetail: {
          ideationLevel,
          behaviorHistory: behaviorHistory ?? null,
          recentLoss: s.recentLoss,
          inputSource: typeof s.ideationSeverity === 'number' ? 'graduated' : 'boolean-derived',
        },
      });
    }
    if (s.selfHarm) {
      riskFlags.push({
        type: RiskType.SELF_HARM,
        severity: SeverityBand.HIGH,
        source: RiskSource.SCREENING,
        evidence: 'Endorsed self-harm',
      });
    }
    if (s.harmToOthers) {
      riskFlags.push({
        type: RiskType.HOMICIDAL,
        severity: SeverityBand.HIGH,
        source: RiskSource.SCREENING,
        evidence: 'Endorsed harm-to-others',
      });
    }

    // ── Symptom burden → base risk score (0..100) ──
    const impair = intake.functionalImpairment;
    const impairAvg = (impair.work + impair.family + impair.social + impair.selfCare) / 4; // 0..10
    const sleepBurden = 10 - intake.sleepQuality; // higher worse
    const energyBurden = 10 - intake.energyLevel;
    const concentrationBurden = 10 - intake.concentration;

    let riskScore =
      impairAvg * 4 + // up to 40
      sleepBurden * 1.5 +
      energyBurden * 1.5 +
      concentrationBurden * 1.5 +
      (intake.traumaExposure ? 8 : 0);

    // Safety endorsements dominate the score. Graduated ideation level
    // replaces the old plan/no-plan binary; behavior history and the
    // previously-discarded `recentLoss` now feed the score directly
    // (docs/10-10-PROGRAM.md WAVE CR item 96: "feed recentLoss in or remove it").
    riskScore += IDEATION_SCORE_BY_LEVEL[ideationLevel] ?? 0;
    if (behaviorPositive) riskScore += BEHAVIOR_HISTORY_SCORE_BONUS;
    if (s.selfHarm) riskScore += 18;
    if (s.harmToOthers) riskScore += 22;
    if (s.recentLoss) riskScore += RECENT_LOSS_SCORE_BONUS;

    riskScore = Math.min(100, Math.round(riskScore));

    const criticalOverride = ideationSeverity === SeverityBand.SEVERE;
    const severityBand = this.band(riskScore, criticalOverride);
    const urgencyScore = Math.min(100, Math.round(riskScore * 0.7 + (IDEATION_URGENCY_BY_LEVEL[ideationLevel] ?? 0)));

    // ── Suitability for virtual care ──
    const contraindications: string[] = [];
    let virtualCareSuitable = true;
    if (criticalOverride) {
      virtualCareSuitable = false;
      contraindications.push('Severe/imminent suicide risk — requires immediate in-person/crisis pathway');
    }
    if (s.harmToOthers) {
      contraindications.push('Harm-to-others endorsed — safety and duty-to-warn review required');
    }
    if (intake.substanceUse.alcohol === 'daily' || intake.substanceUse.cannabis === 'daily') {
      contraindications.push('Daily substance use — consider integrated/medical support');
    }

    return {
      riskScore,
      severityBand,
      urgencyScore,
      suggestedSpecialty: this.suggestSpecialty(intake),
      virtualCareSuitable,
      contraindications,
      riskFlags,
    };
  }

  private band(score: number, criticalOverride: boolean): SeverityBand {
    if (criticalOverride || score >= 70) return SeverityBand.SEVERE;
    if (score >= 45) return SeverityBand.HIGH;
    if (score >= 20) return SeverityBand.MODERATE;
    return SeverityBand.LOW;
  }

  /** Lightweight keyword routing; the AI layer refines, clinicians confirm. */
  private suggestSpecialty(intake: SubmitIntakeInput): string {
    const text = `${intake.presentingProblem} ${intake.symptomHistory ?? ''} ${intake.goals.join(' ')}`.toLowerCase();
    const rules: Array<[RegExp, string]> = [
      [/panic|anxious|anxiety|worry|phobia/, 'anxiety'],
      [/depress|hopeless|sad|mood|empty/, 'depression'],
      [/trauma|ptsd|abuse|assault|flashback/, 'trauma'],
      [/adhd|attention|focus|concentrat/, 'ADHD'],
      [/ocd|obsess|compuls|intrusive/, 'OCD'],
      [/couple|partner|marriage|relationship/, 'couples'],
      [/drink|alcohol|drug|substance|addict/, 'addiction'],
      [/child|adolescent|teen|parent/, 'child psychology'],
    ];
    for (const [re, specialty] of rules) if (re.test(text)) return specialty;
    if (intake.traumaExposure) return 'trauma';
    return 'general';
  }
}
