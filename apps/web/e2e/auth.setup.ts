import { test as setup, expect } from '@playwright/test';

/**
 * Auth setup project (docs/technical/12-testing-strategy.md §10 E2E).
 * Logs in once per role via the REAL /login form (email + password + optional
 * tenant slug). Demo one-click buttons were removed for production safety;
 * credentials match the local seed (`ALLOW_DEMO_SEED` / CI).
 */

const DEMO_PASSWORD = 'Vpsy!2026';
const TENANT_SLUG = 'vpsy-demo';

const DEMO: {
  role: 'client' | 'psychologist' | 'manager';
  email: string;
  landing: RegExp;
}[] = [
  { role: 'client', email: 'alex.client@example.com', landing: /\/home$/ },
  { role: 'psychologist', email: 'dr.rivera@vpsy.health', landing: /\/session$/ },
  { role: 'manager', email: 'manager@vpsy.health', landing: /\/manager$/ },
];

for (const { role, email, landing } of DEMO) {
  setup(`authenticate as ${role}`, async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/tenant|clinic|slug/i).fill(TENANT_SLUG).catch(async () => {
      // Label may vary by locale — fall back to first text inputs.
      const inputs = page.locator('input[type="text"], input:not([type])');
      if ((await inputs.count()) > 0) await inputs.first().fill(TENANT_SLUG);
    });
    await page.locator('input[type="email"], input[name="email"]').first().fill(email);
    await page.locator('input[type="password"]').first().fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: /sign in|log in|continue/i }).click();
    // Mandatory MFA enroll may redirect clinical roles — still land in portal.
    await expect(page).toHaveURL(/\/(home|session|manager|security\/mfa)/, { timeout: 20_000 });
    if (page.url().includes('/security/mfa')) {
      // Skip full TOTP for e2e by accepting that MFA enroll page is authenticated.
      await page.context().storageState({ path: `e2e/.auth/${role}.json` });
      return;
    }
    await expect(page).toHaveURL(landing, { timeout: 15_000 });
    await page.context().storageState({ path: `e2e/.auth/${role}.json` });
  });
}
