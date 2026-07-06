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

export const grantConsentSchema = z.object({
  type: z.nativeEnum(ConsentType),
  version: z.string().min(1).max(20),
  documentUrl: z.string().url().optional(),
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
});
export type ConsentDto = z.infer<typeof consentSchema>;
