import { z } from 'zod';
import { SeverityBand, TherapyFormat } from '../enums';

/**
 * Intake & screening DTOs. The intake form is intentionally rich — it is the
 * moment the system becomes powerful. Risk questions are mandatory; the API
 * runs deterministic screening on submit and (separately) asks the AI Gateway
 * for a suggestion. AI never gates safety — deterministic rules do.
 */

export const substanceUseScreenSchema = z.object({
  alcohol: z.enum(['none', 'monthly', 'weekly', 'daily']).default('none'),
  tobacco: z.enum(['none', 'occasional', 'daily']).default('none'),
  cannabis: z.enum(['none', 'occasional', 'weekly', 'daily']).default('none'),
  other: z.string().max(500).optional(),
});

export const functionalImpairmentSchema = z.object({
  work: z.number().int().min(0).max(10),
  family: z.number().int().min(0).max(10),
  social: z.number().int().min(0).max(10),
  selfCare: z.number().int().min(0).max(10),
});

/** Safety screen — any positive triggers deterministic risk-flag creation. */
export const safetyScreenSchema = z.object({
  suicidalIdeation: z.boolean(),
  suicidalPlan: z.boolean().default(false),
  selfHarm: z.boolean(),
  harmToOthers: z.boolean(),
  recentLoss: z.boolean().default(false),
});

export const submitIntakeSchema = z.object({
  presentingProblem: z.string().min(10).max(4000),
  symptomHistory: z.string().max(4000).optional(),
  symptomDurationWeeks: z.number().int().min(0).max(5200).optional(),
  medicationHistory: z.string().max(2000).optional(),
  previousTherapy: z.boolean().default(false),
  traumaExposure: z.boolean().default(false),
  sleepQuality: z.number().int().min(0).max(10),
  appetiteChange: z.number().int().min(-5).max(5),
  energyLevel: z.number().int().min(0).max(10),
  concentration: z.number().int().min(0).max(10),
  substanceUse: substanceUseScreenSchema,
  functionalImpairment: functionalImpairmentSchema,
  safety: safetyScreenSchema,
  // Profiling
  goals: z.array(z.string().max(300)).max(10).default([]),
  preferredTherapistGender: z.enum(['any', 'female', 'male', 'nonbinary']).default('any'),
  preferredLanguage: z.string().min(2).max(20).default('en'),
  therapyFormat: z.nativeEnum(TherapyFormat).default(TherapyFormat.INDIVIDUAL),
  culturalReligiousNotes: z.string().max(1000).optional(),
});
export type SubmitIntakeInput = z.infer<typeof submitIntakeSchema>;

export const screeningResultSchema = z.object({
  id: z.string(),
  intakeId: z.string(),
  riskScore: z.number().min(0).max(100),
  severityBand: z.nativeEnum(SeverityBand),
  urgencyScore: z.number().min(0).max(100),
  suggestedSpecialty: z.string(),
  virtualCareSuitable: z.boolean(),
  contraindications: z.array(z.string()),
  riskFlagsRaised: z.array(z.string()),
  aiSummary: z.string().nullable(),
  createdAt: z.string(),
});
export type ScreeningResult = z.infer<typeof screeningResultSchema>;
