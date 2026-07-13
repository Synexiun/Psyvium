import { z } from 'zod';
import { ConsentType } from '../enums';

/**
 * Consent DTOs (Intake & Screening, Phase 2). Consent is versioned and
 * append-only: granting a new version supersedes a prior grant for the same
 * type but never deletes it — revocation only ever sets `revokedAt`.
 *
 * `REQUIRED_CONSENT_VERSIONS` is the single source of truth for which consent
 * types + versions are mandatory before purpose-scoped clinical intake can
 * proceed (`ConsentService.assertRequiredConsents`). Bump a version here when
 * the underlying policy text changes; clients must re-grant to stay current.
 */
export const REQUIRED_CONSENT_VERSIONS: Partial<Record<ConsentType, string>> = {
  [ConsentType.TELEPSYCHOLOGY]: '1.0.0',
  [ConsentType.DATA_PROCESSING]: '1.0.0',
};

/**
 * WAVE CR — AI-consent remediation (APA AI guidance 2025 / GDPR Art.22).
 * Current required version for `ConsentType.AI_ASSISTED_ANALYSIS`, checked by
 * `ConsentService.hasActiveAiConsent`. This is intentionally kept OUT of
 * `REQUIRED_CONSENT_VERSIONS`: it must never block intake or any clinical
 * workflow. It gates ONE thing only — whether `AiGatewayService` may send a
 * client-linked inference to a real model. Missing/revoked consent means the
 * AI Gateway degrades honestly to its rule-based path; care proceeds as
 * normal.
 */
export const AI_CONSENT_VERSION = '1.0.0';

export const grantConsentSchema = z.object({
  type: z.nativeEnum(ConsentType),
  version: z.string().min(1).max(20),
  documentUrl: z.string().url().optional(),
  /** SHA-256 hex of the policy text presented to the client at grant time. */
  policyContentHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .optional(),
});
export type GrantConsentInput = z.infer<typeof grantConsentSchema>;

export const consentSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  type: z.nativeEnum(ConsentType),
  version: z.string(),
  grantedAt: z.string(),
  revokedAt: z.string().nullable(),
  documentUrl: z.string().nullable(),
  policyContentHash: z.string().nullable().optional(),
});
export type ConsentDto = z.infer<typeof consentSchema>;
