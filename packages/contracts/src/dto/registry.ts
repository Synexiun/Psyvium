import { z } from 'zod';

/**
 * Registry (contexts 3/4 — Client Registry, Psychologist Registry, Wave E):
 * the ADMIN write surface for person master records. Distinct from the
 * existing `clients`/`clinicians` modules, which are read-only self-service
 * summaries (a client's own `ClinicalSummary`, a psychologist's own
 * caseload) — this module is where a MANAGER/ADMIN creates a person record,
 * edits demographics/profile fields, and soft-deletes one.
 *
 * Permission note (rbac.ts is out of scope for this wave — see
 * `documents.controller.ts` for the established precedent of reusing an
 * existing permission rather than adding one): `Permission.CLIENT_WRITE` was
 * considered first but rejected — its `ROLE_PERMISSIONS` grant is
 * PSYCHOLOGIST-only, so gating on it at the controller would 403 the very
 * MANAGER/ADMIN principals this surface is for, while doing nothing to stop
 * a PSYCHOLOGIST. Every write and list route below is instead gated at the
 * controller by `Permission.CRM_WRITE` — the closest existing "write a
 * person-adjacent business record" permission that both MANAGER and ADMIN
 * actually hold (`ROLE_PERMISSIONS[MANAGER]` and `[ADMIN]` both include it;
 * PSYCHOLOGIST and CLIENT hold neither, so both are correctly 403'd at the
 * guard) — AND an explicit MANAGER/ADMIN role check inside
 * `RegistryService.assertRegistryWriter` as defense-in-depth, since CRM_WRITE
 * is semantically about CRM/referral records, not person master records.
 * Flagged gap: a dedicated `registry:manage` permission granted to exactly
 * MANAGER+ADMIN would let rbac.ts express this natively instead of
 * overloading CRM_WRITE plus a service-layer check.
 */

// ── Pagination (audit-flagged: registry lists must never be unbounded) ──
export const DEFAULT_REGISTRY_PAGE_SIZE = 25;
export const MAX_REGISTRY_PAGE_SIZE = 100;

export const registryListQuerySchema = z.object({
  take: z.coerce.number().int().positive().max(MAX_REGISTRY_PAGE_SIZE).default(DEFAULT_REGISTRY_PAGE_SIZE),
  cursor: z.string().optional(),
});
export type RegistryListQuery = z.infer<typeof registryListQuerySchema>;

/** Reusable cursor-paginated envelope shape for every Registry list endpoint. */
export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

// ── Client Registry (context 3) ──

export const createClientRegistrySchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(2).max(120),
  locale: z.string().default('en'),
  timezone: z.string().default('UTC'),
  preferredLanguage: z.string().default('en'),
  culturalContext: z.string().max(500).optional(),
  demographics: z.record(z.unknown()).default({}),
  /**
   * Client location jurisdiction (e.g. "US-NY") stamped onto the CLIENT role
   * assignment — required for matching's scope-of-practice credential gate to
   * ever produce candidates for this client (matching.service.ts).
   */
  jurisdiction: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}(?:-[A-Za-z0-9]{1,6})?$/)
    .transform((v) => v.toUpperCase())
    .optional(),
});
export type CreateClientRegistryInput = z.infer<typeof createClientRegistrySchema>;

export const CLIENT_REGISTRY_STATUSES = ['active', 'inactive', 'discharged'] as const;

export const patchClientRegistrySchema = z
  .object({
    preferredLanguage: z.string().min(2).max(10).optional(),
    culturalContext: z.string().max(500).nullable().optional(),
    demographics: z.record(z.unknown()).optional(),
    status: z.enum(CLIENT_REGISTRY_STATUSES).optional(),
  })
  .strict();
export type PatchClientRegistryInput = z.infer<typeof patchClientRegistrySchema>;

export const clientRegistryDto = z.object({
  id: z.string(),
  userId: z.string(),
  email: z.string(),
  fullName: z.string(),
  userStatus: z.string(),
  status: z.string(),
  preferredLanguage: z.string(),
  culturalContext: z.string().nullable(),
  demographics: z.record(z.unknown()),
  riskLevel: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});
export type ClientRegistryDto = z.infer<typeof clientRegistryDto>;

export const clientRegistryListDto = z.object({
  items: z.array(clientRegistryDto),
  nextCursor: z.string().nullable(),
});
export type ClientRegistryListDto = z.infer<typeof clientRegistryListDto>;

// ── Psychologist Registry (context 4) ──

export const createPsychologistRegistrySchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(2).max(120),
  locale: z.string().default('en'),
  timezone: z.string().default('UTC'),
  specialties: z.array(z.string()).default([]),
  languages: z.array(z.string()).default(['en']),
  bio: z.string().max(2000).optional(),
  caseloadCap: z.number().int().positive().max(500).default(30),
});
export type CreatePsychologistRegistryInput = z.infer<typeof createPsychologistRegistrySchema>;

export const patchPsychologistRegistrySchema = z
  .object({
    specialties: z.array(z.string()).optional(),
    languages: z.array(z.string()).optional(),
    bio: z.string().max(2000).nullable().optional(),
    caseloadCap: z.number().int().positive().max(500).optional(),
    acceptingClients: z.boolean().optional(),
  })
  .strict();
export type PatchPsychologistRegistryInput = z.infer<typeof patchPsychologistRegistrySchema>;

/** Read-only rollup of the psychologist's most recent Credential row — never written via this surface (ctx 5 owns credential writes). */
export const credentialSummarySchema = z
  .object({
    jurisdiction: z.string(),
    verificationStatus: z.string(),
    malpracticeStatus: z.string(),
    expiresAt: z.string().nullable(),
  })
  .nullable();
export type CredentialSummary = z.infer<typeof credentialSummarySchema>;

export const psychologistRegistryDto = z.object({
  id: z.string(),
  userId: z.string(),
  email: z.string(),
  fullName: z.string(),
  userStatus: z.string(),
  specialties: z.array(z.string()),
  languages: z.array(z.string()),
  bio: z.string().nullable(),
  caseloadCap: z.number(),
  currentCaseload: z.number(),
  acceptingClients: z.boolean(),
  credentialSummary: credentialSummarySchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});
export type PsychologistRegistryDto = z.infer<typeof psychologistRegistryDto>;

export const psychologistRegistryListDto = z.object({
  items: z.array(psychologistRegistryDto),
  nextCursor: z.string().nullable(),
});
export type PsychologistRegistryListDto = z.infer<typeof psychologistRegistryListDto>;

/**
 * Invite activation for INVITED registry users. Reuses the PasswordResetToken
 * store (same SHA-256 digest + expiry model as auth password reset). Public —
 * no JWT required (the token is the credential).
 */
export const completeInviteSchema = z.object({
  token: z.string().min(20).max(200),
  password: z.string().min(8).max(200),
});
export type CompleteInviteInput = z.infer<typeof completeInviteSchema>;
