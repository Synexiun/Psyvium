import { z } from 'zod';
import { Role } from '../enums';

/**
 * Name of the httpOnly session cookie carrying the access token (doc
 * 06-security-and-rbac.md §3 — "secure token storage"). Shared between the
 * API (sets/reads it) and the web app's middleware (verifies it) so the two
 * never drift.
 */
export const ACCESS_TOKEN_COOKIE = 'vpsy_at';

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
  totp: z.string().length(6).optional(),
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
  roles: z.array(z.string()),
  permissions: z.array(z.string()),
});
export type AuthPrincipalSummary = z.infer<typeof authPrincipalSummarySchema>;

export const authTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number(),
  // Optional so any older consumer of this schema keeps working unchanged.
  principal: authPrincipalSummarySchema.optional(),
});
export type AuthTokens = z.infer<typeof authTokensSchema>;

export interface AuthPrincipal {
  userId: string;
  tenantId: string;
  roles: Role[];
  permissions: string[];
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
} as const;
export type MfaErrorCode = (typeof MfaErrorCode)[keyof typeof MfaErrorCode];

export const mfaVerifyInputSchema = z.object({
  code: z.string().length(6),
});
export type MfaVerifyInput = z.infer<typeof mfaVerifyInputSchema>;

export interface MfaEnrollResponse {
  /** Base32 secret — shown to the user for manual entry as a fallback to the QR code. */
  secret: string;
  /** otpauth:// URI for the authenticator app to scan as a QR code. */
  otpauthUrl: string;
}
