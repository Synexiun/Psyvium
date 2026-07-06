import { z } from 'zod';
import { Role } from '../enums';

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

export const authTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number(),
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
