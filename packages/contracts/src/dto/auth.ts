import { z } from 'zod';
import { Role } from '../enums';

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
  totp: z.string().length(6).optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
  fullName: z.string().min(2).max(120),
  role: z.nativeEnum(Role).default(Role.CLIENT),
  locale: z.string().default('en'),
  timezone: z.string().default('UTC'),
});
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
