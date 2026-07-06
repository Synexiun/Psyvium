import { test, expect } from '@playwright/test';

/**
 * Core clinical journeys against the REAL stack (no mocks) — the browser
 * layer smoke.sh never exercises (docs/technical/12-testing-strategy.md §10;
 * audit P0). Runs in the `chromium` project, which depends on the `setup`
 * project (e2e/auth.setup.ts) that has already logged in each demo role once
 * and saved its storageState.
 */

test.describe('Auth boundary (middleware)', () => {
  // No storageState override here — a fresh, signed-out context.
  test('unauthenticated visit to a portal route redirects to /login', async ({ page }) => {
    await page.goto('/home');
    await expect(page).toHaveURL(/\/login(\?|$)/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });
});

test.describe('Login + sign-out', () => {
  test('demo client login lands on /home with live data, then signs out to /login', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: /alex\.client@example\.com/ }).click();
    await expect(page).toHaveURL(/\/home$/);

    // The page's three honest states are loading/error/live — assert we
    // actually reached "live", not a silently-stuck skeleton or error panel.
    await expect(page.getByText('Live data', { exact: true }).first()).toBeVisible({ timeout: 15_000 });

    // Sign out (command-strip button, visible at sm+ viewport) returns to /login.
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('Clinician journey (dr.rivera)', () => {
  test.use({ storageState: 'e2e/.auth/psychologist.json' });

  test('session workspace shows the caseload and client timeline', async ({ page }) => {
    await page.goto('/session');
    await expect(page.getByRole('heading', { name: 'Session workspace' })).toBeVisible();

    // Real seeded caseload (dr.rivera ↔ alex.client, seed.ts assignment_demo_1)
    // — assert the live timeline rendered, not the "no clients yet" empty state.
    await expect(page.getByText('Client timeline')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('No clients are assigned to you yet.')).toHaveCount(0);
  });

  test('risk board renders with SLA text', async ({ page }) => {
    await page.goto('/risk');
    await expect(page.getByRole('heading', { name: 'Escalation board' })).toBeVisible();

    // seed.ts seeds a SEVERE RiskFlag + an SLA-tracked Escalation
    // (escalation_demo_sla_due) specifically so this board never renders empty.
    await expect(page.getByText(/SLA breached|Response due/).first()).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('Patient journey (alex.client)', () => {
  test.use({ storageState: 'e2e/.auth/client.json' });

  test('home shows the next session, safety plan, and real crisis links', async ({ page }) => {
    await page.goto('/home');
    await expect(page.getByText('Next session')).toBeVisible();

    // seed.ts seeds a Stanley-Brown safety plan for alex.client — assert the
    // live plan renders (or its honest empty state — either is acceptable,
    // but the card itself must be present, never silently missing).
    await expect(page.getByText('My safety plan')).toBeVisible({ timeout: 15_000 });

    // Emergency/crisis card is always in the main flow, never collapsible.
    const emergency = page.locator('section', { hasText: 'Help is available right now' });
    await expect(emergency).toBeVisible();

    const telHref = await emergency.locator('a[href^="tel:"]').first().getAttribute('href');
    expect(telHref, 'crisis call link must be a real tel: href').toMatch(/^tel:\+?\d+$/);

    const chatHref = await emergency.locator('a[href^="https://"]').first().getAttribute('href');
    expect(chatHref, 'crisis chat link must be a real https: href').toMatch(/^https:\/\//);

    // NOTE (finding, not a bug this suite fixes): the seed tenant is US, and
    // EmergencyCard's `entry` branch (apps/web/.../home/page.tsx ~L601) is
    // only used for a NON-US resolved country — the US/loading/error default
    // branch renders only tel:988 + the 988lifeline chat link, no `sms:`
    // link, even though the API's US crisis-line registry entry does carry
    // `smsNumber: '988'` (apps/api/.../risk/crisis-lines.ts). So a US patient
    // in this app currently has no in-app way to text the crisis line. No
    // `sms:` assertion here for that reason — flagged in the final report.
  });
});

test.describe('Manager journey (manager@vpsy.health)', () => {
  test.use({ storageState: 'e2e/.auth/manager.json' });

  test('triage board renders and the approve flow is visible and actionable', async ({ page, browser }) => {
    await page.goto('/manager');
    await expect(page.getByRole('heading', { name: 'Triage & assignment' })).toBeVisible();

    const approveButtons = page.getByRole('button', { name: 'Approve' });
    const before = await approveButtons.count();

    // seed.ts's only Assignment is already APPROVED, so a fresh install's
    // triage queue starts empty — seed a real pending proposal the same way
    // the product does: a client submits an intake (matching.service.ts
    // subscribes to IntakeSubmitted and proposes an assignment for manager
    // review). Driven through the real /intake UI in its own authenticated
    // context, not a bypassed API call.
    const clientContext = await browser.newContext({ storageState: 'e2e/.auth/client.json' });
    const clientPage = await clientContext.newPage();
    try {
      await clientPage.goto('/intake');
      await clientPage
        .getByLabel('What brings you here?')
        .fill('New persistent anxiety with panic attacks and poor sleep — requesting an assessment.');
      await clientPage.getByRole('button', { name: 'Next' }).click();
      await clientPage.getByRole('button', { name: 'Next' }).click();
      await clientPage.getByRole('button', { name: 'Next' }).click();
      await clientPage.getByRole('button', { name: 'Finish and run screening' }).click();
      await expect(clientPage.getByText('Screening result')).toBeVisible({ timeout: 20_000 });
    } finally {
      await clientContext.close();
    }

    await page.reload();
    await expect(approveButtons.first()).toBeVisible({ timeout: 20_000 });
    expect(await approveButtons.count()).toBeGreaterThan(before);

    await approveButtons.first().click();
    // A successful approve removes that proposal card from the board —
    // the count settles back down rather than an error panel appearing.
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(approveButtons).toHaveCount(before, { timeout: 15_000 });
  });
});

test.describe('RBAC in the browser', () => {
  test.use({ storageState: 'e2e/.auth/client.json' });

  test('a client navigating to /finance is redirected by the role gate, not shown finance data', async ({ page }) => {
    await page.goto('/finance');
    // middleware.ts: authenticated but unentitled (CLIENT lacks FINANCE_READ/
    // FINANCE_MANAGE) → bounced to the client's own landing space, /home.
    await expect(page).toHaveURL(/\/home$/);
    await expect(page.getByRole('heading', { name: 'Billing & payouts' })).toHaveCount(0);
  });
});
