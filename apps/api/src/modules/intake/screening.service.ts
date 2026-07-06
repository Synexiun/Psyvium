import { Injectable } from '@nestjs/common';
import { RiskSource, RiskType, SeverityBand, type SubmitIntakeInput } from '@vpsy/contracts';

export interface ScreeningComputation {
  riskScore: number;
  severityBand: SeverityBand;
  urgencyScore: number;
  suggestedSpecialty: string;
  virtualCareSuitable: boolean;
  contraindications: string[];
  riskFlags: Array<{ type: RiskType; severity: SeverityBand; source: RiskSource; evidence: string }>;
}

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
    if (s.suicidalIdeation) {
      riskFlags.push({
        type: RiskType.SUICIDAL_IDEATION,
        severity: s.suicidalPlan ? SeverityBand.SEVERE : SeverityBand.HIGH,
        source: RiskSource.SCREENING,
        evidence: s.suicidalPlan ? 'Endorsed ideation with a plan' : 'Endorsed suicidal ideation',
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

    // Safety endorsements dominate the score.
    if (s.suicidalIdeation) riskScore += s.suicidalPlan ? 45 : 30;
    if (s.selfHarm) riskScore += 18;
    if (s.harmToOthers) riskScore += 22;

    riskScore = Math.min(100, Math.round(riskScore));

    const severityBand = this.band(riskScore, s.suicidalPlan);
    const urgencyScore = Math.min(
      100,
      Math.round(riskScore * 0.7 + (s.suicidalPlan ? 30 : s.suicidalIdeation ? 15 : 0)),
    );

    // ── Suitability for virtual care ──
    const contraindications: string[] = [];
    let virtualCareSuitable = true;
    if (s.suicidalPlan) {
      virtualCareSuitable = false;
      contraindications.push('Active suicidal plan — requires immediate in-person/crisis pathway');
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

  private band(score: number, plan: boolean): SeverityBand {
    if (plan || score >= 70) return SeverityBand.SEVERE;
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
