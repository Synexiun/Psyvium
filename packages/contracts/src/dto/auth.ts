import { z } from 'zod';
import { Role } from '../enums';

/**
 * Name of the httpOnly session cookie carrying the access token (doc
 * 06-security-and-rbac.md §3 — "secure token storage"). Shared between the
 * API (sets/reads it) and the web app's middleware (verifies it) so the two
 * never drift.
 */
export const ACCESS_TOKEN_COOKIE = 'vpsy_at';
export const REFRESH_TOKEN_COOKIE = 'vpsy_rt';

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
  /** 6-digit TOTP or a one-time MFA recovery code (8–32 chars). */
  totp: z.string().min(6).max(32).optional(),
  /** Required only when the same email belongs to more than one tenant. */
  tenantSlug: z.string().trim().min(2).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

/**
 * Public self-registration. There is deliberately NO `role` field: a caller must
 * never be able to choose their own role (that would be privilege escalation).
 * Self-registration always yields a CLIENT; elevated roles (clinician, manager,
 * admin, executive) are provisioned by an authorized admin through a separate,
 * authenticated flow.
 */
export const registerSchema = z
  .object({
    email: z.string().email(),
    password: z.string().min(8).max(200),
    fullName: z.string().min(2).max(120),
    locale: z.string().default('en'),
    timezone: z.string().default('UTC'),
    /**
     * Public, non-secret tenant routing identifier. It may be omitted only
     * when exactly one active tenant explicitly enables public registration.
     */
    tenantSlug: z.string().trim().min(2).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  })
  .strict(); // reject unknown keys (e.g. a smuggled `role`) rather than silently drop them
export type RegisterInput = z.infer<typeof registerSchema>;

/**
 * Non-sensitive identity summary echoed in the login/register JSON body so the
 * client can route the UI without ever decoding the token itself — the access
 * token now lives only in the httpOnly cookie (doc 06 §3 "secure token
 * storage"; never persisted client-side).
 */
export const authPrincipalSummarySchema = z.object({
  userId: z.string(),
  tenantId: z.string(),
  roles: z.array(z.string()),
  permissions: z.array(z.string()),
  /**
   * True when the principal holds a mandatory clinical/admin role and has not
   * yet completed TOTP enrollment. The API permits only auth/MFA endpoints
   * until this becomes false.
   */
  mfaEnrollmentRequired: z.boolean().optional(),
});
export type AuthPrincipalSummary = z.infer<typeof authPrincipalSummarySchema>;

export const authTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number(),
  refreshExpiresIn: z.number().optional(),
  // Optional so any older consumer of this schema keeps working unchanged.
  principal: authPrincipalSummarySchema.optional(),
});
export type AuthTokens = z.infer<typeof authTokensSchema>;

export const refreshInputSchema = z
  .object({
    /** API clients send this; browsers use the httpOnly refresh cookie. */
    refreshToken: z.string().min(1).optional(),
  })
  .strict();
export type RefreshInput = z.infer<typeof refreshInputSchema>;

export const logoutInputSchema = refreshInputSchema;
export type LogoutInput = RefreshInput;

export interface AuthPrincipal {
  userId: string;
  tenantId: string;
  roles: Role[];
  permissions: string[];
  /** See authPrincipalSummarySchema.mfaEnrollmentRequired. */
  mfaEnrollmentRequired?: boolean;
  clinicId?: string;
  jurisdiction?: string;
}

// ── MFA / TOTP (doc 06-security-and-rbac.md §3) ──

/**
 * Machine-readable codes distinct from generic "invalid credentials" so the
 * UI can tell "prompt for a code" apart from "the code you gave was wrong"
 * apart from "wrong password entirely".
 */
export const MfaErrorCode = {
  MFA_REQUIRED: 'MFA_REQUIRED',
  MFA_INVALID: 'MFA_INVALID',
  /** Mandatory clinical/admin role must complete TOTP enrollment before full access. */
  MFA_ENROLLMENT_REQUIRED: 'MFA_ENROLLMENT_REQUIRED',
} as const;
export type MfaErrorCode = (typeof MfaErrorCode)[keyof typeof MfaErrorCode];

/**
 * Roles that must enroll TOTP before using the platform in production
 * (doc 06-security-and-rbac.md §3). CLIENT is intentionally excluded —
 * patient adoption must not be gated by authenticator apps.
 */
export const MFA_MANDATORY_ROLES = [
  Role.PSYCHOLOGIST,
  Role.MANAGER,
  Role.SUPERVISOR,
  Role.ADMIN,
  Role.EXECUTIVE,
] as const;

export const mfaVerifyInputSchema = z.object({
  code: z.string().length(6),
});
export type MfaVerifyInput = z.infer<typeof mfaVerifyInputSchema>;

/** Public password-reset request. Always returns 200 to avoid account enumeration. */
export const passwordResetRequestSchema = z.object({
  email: z.string().email(),
  tenantSlug: z.string().trim().min(2).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
});
export type PasswordResetRequestInput = z.infer<typeof passwordResetRequestSchema>;

export const passwordResetCompleteSchema = z.object({
  token: z.string().min(20).max(200),
  newPassword: z.string().min(8).max(200),
});
export type PasswordResetCompleteInput = z.infer<typeof passwordResetCompleteSchema>;

export interface MfaEnrollResponse {
  /** Base32 secret — shown to the user for manual entry as a fallback to the QR code. */
  secret: string;
  /** otpauth:// URI for the authenticator app to scan as a QR code. */
  otpauthUrl: string;
}
