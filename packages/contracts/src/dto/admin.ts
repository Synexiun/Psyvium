import { z } from 'zod';

/**
 * Admin Configuration (context 27, Wave E) — the tenant self-service admin
 * surface: tenant profile, clinic network (context 2 — Tenant / Clinic
 * Network), and feature flags (the EU-AI-Act kill-switch seam —
 * `AI_ASSISTED_ANALYSIS` and any future per-tenant AI/compliance toggle are
 * ordinary `FeatureFlag` rows read/flipped here). Gated end-to-end by
 * `Permission.ADMIN_CONFIG`, which rbac.ts already grants to ADMIN only —
 * no rbac.ts change needed for this context.
 */

// ── Tenant (context 2) ──

export const patchTenantSchema = z
  .object({
    name: z.string().min(2).max(200).optional(),
    countryCode: z
      .string()
      .length(2)
      .transform((v) => v.toUpperCase())
      .optional(),
    residencyRegion: z.string().min(2).max(50).optional(),
  })
  .strict();
export type PatchTenantInput = z.infer<typeof patchTenantSchema>;

export const tenantDto = z.object({
  id: z.string(),
  name: z.string(),
  countryCode: z.string(),
  residencyRegion: z.string(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TenantDto = z.infer<typeof tenantDto>;

// ── Clinics (context 2) ──

export const CLINIC_TYPES = ['VIRTUAL', 'PHYSICAL', 'HYBRID'] as const;

export const createClinicSchema = z.object({
  name: z.string().min(2).max(200),
  type: z.enum(CLINIC_TYPES).default('VIRTUAL'),
  timezone: z.string().min(2).max(50).default('UTC'),
});
export type CreateClinicInput = z.infer<typeof createClinicSchema>;

export const patchClinicSchema = z
  .object({
    name: z.string().min(2).max(200).optional(),
    type: z.enum(CLINIC_TYPES).optional(),
    timezone: z.string().min(2).max(50).optional(),
  })
  .strict();
export type PatchClinicInput = z.infer<typeof patchClinicSchema>;

export const clinicDto = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: z.string(),
  type: z.string(),
  timezone: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ClinicDto = z.infer<typeof clinicDto>;

// ── Feature flags (context 27 — the EU-AI-Act kill-switch seam) ──

export const upsertFeatureFlagSchema = z.object({
  key: z.string().min(2).max(100),
  enabled: z.boolean(),
});
export type UpsertFeatureFlagInput = z.infer<typeof upsertFeatureFlagSchema>;

export const featureFlagDto = z.object({
  id: z.string(),
  key: z.string(),
  enabled: z.boolean(),
  updatedAt: z.string(),
});
export type FeatureFlagDto = z.infer<typeof featureFlagDto>;
