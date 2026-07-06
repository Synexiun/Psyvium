/**
 * JWT secret resolution. There is intentionally NO hardcoded fallback: a missing
 * secret must crash loudly rather than silently sign tokens with a publicly-known
 * value (which would let anyone forge tokens for any user/role). Set
 * JWT_ACCESS_SECRET / JWT_REFRESH_SECRET in the environment (see .env.example).
 */
function requiredSecret(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length < 16) {
    throw new Error(
      `[security] ${name} is not set (or is too short). Refusing to start with an insecure default — ` +
        `set a strong ${name} in the environment before running the API.`,
    );
  }
  return value;
}

export const jwtAccessSecret = (): string => requiredSecret('JWT_ACCESS_SECRET');
export const jwtRefreshSecret = (): string => requiredSecret('JWT_REFRESH_SECRET');

/** Call at startup so a misconfiguration fails fast at boot, not on first login. */
export function assertJwtSecretsPresent(): void {
  jwtAccessSecret();
  jwtRefreshSecret();
}
