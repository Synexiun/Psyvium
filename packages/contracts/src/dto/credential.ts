import { z } from 'zod';

/**
 * Credentialing & Contracts DTOs (Phase 2, bounded context 7). A Credential is
 * captured against a Psychologist and must be independently verified before it
 * can gate any clinical write — see `CredentialingService.assertClinicalEligibility`
 * and `ClinicalWriteGuard`. Verification and malpractice status are free-text
 * (not enums) in the data model, but only the values below are meaningful to
 * the eligibility check.
 */

export const credentialVerificationStatusSchema = z.enum(['pending', 'verified', 'rejected']);
export type CredentialVerificationStatus = z.infer<typeof credentialVerificationStatusSchema>;

export const malpracticeStatusSchema = z.enum(['active', 'lapsed', 'unknown']);
export type MalpracticeStatus = z.infer<typeof malpracticeStatusSchema>;

export const createCredentialSchema = z.object({
  /** Omit to capture the credential for the caller's own psychologist profile. */
  psychologistId: z.string().optional(),
  licenseNumber: z.string().min(2).max(100),
  jurisdiction: z.string().min(2).max(20),
  issuingBody: z.string().min(2).max(200),
  expiresAt: z.string().datetime().optional(),
  malpracticeStatus: malpracticeStatusSchema.default('unknown'),
});
export type CreateCredentialInput = z.infer<typeof createCredentialSchema>;

export const verifyCredentialSchema = z.object({
  verificationStatus: credentialVerificationStatusSchema,
  malpracticeStatus: malpracticeStatusSchema.optional(),
});
export type VerifyCredentialInput = z.infer<typeof verifyCredentialSchema>;

export const credentialSchema = z.object({
  id: z.string(),
  psychologistId: z.string(),
  licenseNumber: z.string(),
  jurisdiction: z.string(),
  issuingBody: z.string(),
  expiresAt: z.string().nullable(),
  verificationStatus: z.string(),
  malpracticeStatus: z.string(),
  createdAt: z.string(),
});
export type CredentialDto = z.infer<typeof credentialSchema>;
