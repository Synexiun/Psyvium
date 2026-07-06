import { test as setup, expect } from '@playwright/test';

/**
 * Auth setup project (docs/technical/12-testing-strategy.md §10 E2E). Logs
 * in once per role via the REAL /login page — the one-click demo buttons,
 * which are genuine `/auth/login` calls (see apps/web/src/app/login/page.tsx
 * — "these are real logins, not fake sessions") — and saves each resulting
 * browser storage state (this captures the httpOnly session cookie the API
 * sets, plus the non-sensitive principal hint) so journey/a11y specs can
 * `test.use({ storageState: 'e2e/.auth/<role>.json' })` instead of
 * re-authenticating per test.
 *
 * Only the three roles this pass's journeys need (client, psychologist,
 * manager) — executive/reports is out of scope here.
 */

const DEMO: { role: 'client' | 'psychologist' | 'manager'; email: string; landing: RegExp }[] = [
  { role: 'client', email: 'alex.client@example.com', landing: /\/home$/ },
  { role: 'psychologist', email: 'dr.rivera@vpsy.health', landing: /\/session$/ },
  { role: 'manager', email: 'manager@vpsy.health', landing: /\/manager$/ },
];

for (const { role, email, landing } of DEMO) {
  setup(`authenticate as ${role}`, async ({ page }) => {
    await page.goto('/login');
    // Accessible-name selector (no data-testid in this markup) — the demo
    // button's name is the email + role label text it renders.
    await page.getByRole('button', { name: new RegExp(email.replace(/\./g, '\\.')) }).click();
    await expect(page).toHaveURL(landing, { timeout: 15_000 });
    await page.context().storageState({ path: `e2e/.auth/${role}.json` });
  });
}
