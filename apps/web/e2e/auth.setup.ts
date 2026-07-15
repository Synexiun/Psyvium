import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test as setup, expect, type Page } from '@playwright/test';
import { totp } from './utils';

/**
 * Auth setup project (docs/technical/12-testing-strategy.md §10 E2E).
 * Logs in once per role via the REAL /login form (email + password + tenant
 * slug — demo one-click buttons were removed for production safety), then
 * completes the REAL MFA ceremony for mandatory clinical/admin roles:
 * enrolls TOTP through the actual API (`/auth/mfa/enroll` → `/auth/mfa/verify`)
 * and computes RFC 6238 codes locally (utils.ts `totp`), exactly like a human
 * with an authenticator app. No test-only auth bypass exists in the product.
 *
 * The enrolled TOTP secret is persisted next to the storage state
 * (e2e/.auth/<role>.totp.txt) so RE-RUNS against the same database — where
 * login now demands a current code — stay deterministic.
 */

const DEMO_PASSWORD = 'Vpsy!2026';
const TENANT_SLUG = 'vpsy-demo';
const AUTH_DIR = path.resolve(__dirname, '.auth');

const DEMO: {
  role: 'client' | 'psychologist' | 'manager';
  email: string;
  landing: RegExp;
  landingPath: string;
}[] = [
  { role: 'client', email: 'alex.client@example.com', landing: /\/home$/, landingPath: '/home' },
  { role: 'psychologist', email: 'dr.rivera@vpsy.health', landing: /\/session$/, landingPath: '/session' },
  { role: 'manager', email: 'manager@vpsy.health', landing: /\/manager$/, landingPath: '/manager' },
];

function totpSecretFile(role: string): string {
  return path.join(AUTH_DIR, `${role}.totp.txt`);
}

async function submitLoginForm(page: Page, email: string) {
  await page.locator('#login-tenant').fill(TENANT_SLUG);
  await page.locator('#login-email').fill(email);
  await page.locator('#login-password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: /sign in|log in|continue/i }).click();
}

/**
 * First run against a fresh seed: the MFA-mandatory login lands on the
 * enrollment page with a RESTRICTED session. Complete real enrollment through
 * the same proxy the UI uses (`/api/backend/*`), so the httpOnly session
 * cookies rotate inside this browser context.
 */
async function enrollMfa(page: Page, role: string): Promise<void> {
  const enroll = await page.request.post('/api/backend/auth/mfa/enroll', { data: {} });
  expect(enroll.ok(), `mfa/enroll failed: ${enroll.status()}`).toBe(true);
  const { secret } = (await enroll.json()) as { secret: string };
  expect(secret, 'mfa/enroll returned no secret').toBeTruthy();
  mkdirSync(AUTH_DIR, { recursive: true });
  writeFileSync(totpSecretFile(role), secret, 'utf8');

  const verify = await page.request.post('/api/backend/auth/mfa/verify', {
    data: { code: totp(secret) },
  });
  expect(verify.ok(), `mfa/verify failed: ${verify.status()}`).toBe(true);
  const body = (await verify.json()) as {
    principal?: { userId: string; tenantId: string; roles: string[]; permissions: string[]; mfaEnrollmentRequired?: boolean };
  };

  // The UI's verify flow calls rememberPrincipal() with the fresh principal;
  // mirror that here so the portal layout's mfaEnrollmentRequired check sees
  // the enrolled state (storage key/shape from apps/web/src/lib/api.ts).
  if (body.principal) {
    await page.evaluate((principal) => {
      localStorage.setItem(
        'vpsy.principalHint',
        JSON.stringify({
          sub: principal.userId,
          tenantId: principal.tenantId,
          roles: principal.roles,
          permissions: principal.permissions,
          mfaEnrollmentRequired: principal.mfaEnrollmentRequired,
        }),
      );
    }, body.principal);
  }
}

for (const { role, email, landing, landingPath } of DEMO) {
  setup(`authenticate as ${role}`, async ({ page }) => {
    await page.goto('/login');
    await submitLoginForm(page, email);

    // Re-run case: this account already enrolled TOTP in an earlier run, so
    // login itself now demands a current code (the #login-totp prompt).
    const totpInput = page.locator('#login-totp');
    const mfaPromptAppeared = await totpInput
      .waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    if (mfaPromptAppeared) {
      const secretFile = totpSecretFile(role);
      expect(
        existsSync(secretFile),
        `${email} has MFA enabled but no saved secret (${secretFile}). Reseed the database or restore the secret file.`,
      ).toBe(true);
      await totpInput.fill(totp(readFileSync(secretFile, 'utf8').trim()));
      await page.getByRole('button', { name: /sign in|log in|continue/i }).click();
    }

    await expect(page).toHaveURL(/\/(home|session|manager|security\/mfa)/, { timeout: 20_000 });

    // First-run case for MFA-mandatory roles: complete REAL enrollment.
    if (page.url().includes('/security/mfa')) {
      await enrollMfa(page, role);
      await page.goto(landingPath);
    }

    await expect(page).toHaveURL(landing, { timeout: 15_000 });
    await page.context().storageState({ path: `e2e/.auth/${role}.json` });
  });
}
