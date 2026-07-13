/**
 * Stanley–Brown Safety Planning Intervention (SPI) completeness scoring.
 * Joint Commission / Zero Suicide aligned checklist — assistive quality metric
 * for clinicians, never a gate that blocks saving a partial plan in crisis.
 */

export interface SafetyPlanFields {
  warningSigns?: string[] | null;
  copingStrategies?: string[] | null;
  distractionContacts?: unknown;
  supportContacts?: unknown;
  helpContacts?: unknown;
  professionalContacts?: unknown;
  meansRestriction?: unknown;
  environmentSafety?: string | null;
  crisisLineInfo?: unknown;
  clientAcknowledgedAt?: Date | string | null;
}

export interface SafetyPlanCompleteness {
  score: number; // 0–100
  maxScore: number;
  steps: Array<{
    step: number;
    name: string;
    complete: boolean;
    weight: number;
  }>;
  missing: string[];
  algorithmVersion: string;
  citation: string;
}

function hasItems(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  if (value && typeof value === 'object') return Object.keys(value as object).length > 0;
  return false;
}

export function scoreSafetyPlanCompleteness(plan: SafetyPlanFields): SafetyPlanCompleteness {
  const steps = [
    { step: 1, name: 'Warning signs', complete: hasItems(plan.warningSigns), weight: 12 },
    { step: 2, name: 'Internal coping strategies', complete: hasItems(plan.copingStrategies), weight: 12 },
    {
      step: 3,
      name: 'Social distraction contacts/places',
      complete: hasItems(plan.distractionContacts) || hasItems(plan.supportContacts),
      weight: 12,
    },
    {
      step: 4,
      name: 'People to ask for help',
      complete: hasItems(plan.helpContacts) || hasItems(plan.supportContacts),
      weight: 12,
    },
    {
      step: 5,
      name: 'Professional / agency contacts',
      complete: hasItems(plan.professionalContacts),
      weight: 12,
    },
    {
      step: 6,
      name: 'Means restriction / environment safety',
      complete: hasItems(plan.meansRestriction) || hasItems(plan.environmentSafety),
      weight: 16,
    },
    {
      step: 7,
      name: 'Crisis line information',
      complete: hasItems(plan.crisisLineInfo),
      weight: 12,
    },
    {
      step: 8,
      name: 'Client collaborative acknowledgment',
      complete: Boolean(plan.clientAcknowledgedAt),
      weight: 12,
    },
  ];

  const maxScore = steps.reduce((s, x) => s + x.weight, 0);
  const score = steps.reduce((s, x) => s + (x.complete ? x.weight : 0), 0);
  const missing = steps.filter((s) => !s.complete).map((s) => s.name);

  return {
    score: Math.round((score / maxScore) * 100),
    maxScore: 100,
    steps,
    missing,
    algorithmVersion: '1.0.0',
    citation:
      'Stanley B, Brown GK. Safety Planning Intervention (SPI). Cognitive and Behavioral Practice, 2012; Zero Suicide / Joint Commission NPSG 15.01.01.',
  };
}
