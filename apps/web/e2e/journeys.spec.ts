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
  test('client credential login lands on /home with live data, then signs out to /login', async ({ page }) => {
    // Real credential form — demo one-click buttons were removed (Gate 0).
    await page.goto('/login');
    await page.locator('#login-tenant').fill('vpsy-demo');
    await page.locator('#login-email').fill('alex.client@example.com');
    await page.locator('#login-password').fill('Vpsy!2026');
    await page.getByRole('button', { name: /sign in|log in|continue/i }).click();
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

    // Gate 0 browser-PHI isolation removed auto patient selection — the
    // workspace intentionally renders NO client data until the clinician
    // explicitly picks a patient. Assert the caseload is populated (real
    // seeded assignment dr.rivera ↔ alex.client), select the first patient,
    // and only then expect the live timeline.
    const clientSelect = page.locator('#workspace-client');
    await expect(clientSelect).toBeVisible({ timeout: 15_000 });
    const options = clientSelect.locator('option');
    expect(await options.count()).toBeGreaterThan(1);
    const value = await options.nth(1).getAttribute('value');
    await clientSelect.selectOption(value!);

    await expect(page.getByText('Client timeline')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('No clients are assigned to you yet.')).toHaveCount(0);
  });

  test('session workspace shows secure document vault for a selected client', async ({ page }) => {
    await page.goto('/session');
    await expect(page.getByRole('heading', { name: 'Session workspace' })).toBeVisible();

    const clientSelect = page.locator('#workspace-client');
    await expect(clientSelect).toBeVisible({ timeout: 15_000 });
    // Pick the first real caseload option (skip placeholder).
    const options = clientSelect.locator('option');
    const count = await options.count();
    expect(count).toBeGreaterThan(1);
    const value = await options.nth(1).getAttribute('value');
    await clientSelect.selectOption(value!);

    await expect(page.getByText('Secure document vault')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Choose file|Uploading/i).first()).toBeVisible();
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

    // ROOT CAUSE (found by this suite, not a server bug): the heading above
    // renders synchronously, but the triage list itself is fetched
    // asynchronously (manager/page.tsx's `load()`) and a loading skeleton +
    // the context panel's "Connecting to the live record…" status text show
    // until that resolves. Reading `approveButtons.count()` immediately after
    // the heading check races that fetch and can capture `before` as 0
    // regardless of the board's true state — and since prisma/seed.ts is
    // purely additive and never clears E2E-created PROPOSED assignments
    // between local runs, any pre-existing backlog from earlier invocations
    // of this exact test then makes a later *absolute* `toHaveCount(before)`
    // assertion compare against the wrong baseline. Waiting for the loading
    // status to clear first, and asserting a *delta* (see below) instead of
    // an absolute count, makes this test correct regardless of the shared
    // dev database's accumulated state.
    await expect(page.getByText('Connecting to the live record…')).toHaveCount(0, { timeout: 15_000 });

    const approveButtons = page.getByRole('button', { name: 'Approve' });
    const before = await approveButtons.count();

    // seed.ts's only Assignment is already APPROVED, and matching correctly
    // refuses to propose for a client already in care (open-assignment
    // uniqueness + "existing APPROVED/ACTIVE wins" in matching.service.ts's
    // proposeForClient) — so alex.client can never generate a fresh proposal.
    // Instead, walk the REAL new-patient path end-to-end: register a brand-new
    // client through the public tenant-aware registration API (the same
    // endpoint a registration UI will call — no web form exists yet, Wave E),
    // grant the two intake-required consents through the real consent API,
    // then submit intake through the real /intake UI. matching.service.ts
    // reacts to IntakeSubmitted and proposes an assignment for manager review.
    const clientContext = await browser.newContext();
    const clientPage = await clientContext.newPage();
    try {
      const uniqueEmail = `e2e.patient.${Date.now()}@example.com`;
      // Land on the app origin first so page.request carries/sets cookies there.
      await clientPage.goto('/login');
      const register = await clientPage.request.post('/api/backend/auth/register', {
        data: {
          email: uniqueEmail,
          password: 'E2e!Patient2026',
          fullName: 'E2E Registered Patient',
          tenantSlug: 'vpsy-demo',
          // Self-reported location — without a client jurisdiction, matching's
          // scope-of-practice gate correctly yields ZERO candidates (both seed
          // psychologists are credentialed US-NY).
          jurisdiction: 'US-NY',
        },
      });
      expect(register.ok(), `register failed: ${register.status()}`).toBe(true);
      const tokens = (await register.json()) as {
        principal?: { userId: string; tenantId: string; roles: string[]; permissions: string[] };
      };
      // Mirror the login page's rememberPrincipal so portal role-routing works.
      if (tokens.principal) {
        await clientPage.evaluate((principal) => {
          localStorage.setItem(
            'vpsy.principalHint',
            JSON.stringify({
              sub: principal.userId,
              tenantId: principal.tenantId,
              roles: principal.roles,
              permissions: principal.permissions,
            }),
          );
        }, tokens.principal);
      }
      // Consent-gated intake (Phase 2 DoD): grant the two required consents
      // through the real consent API before the intake UI will accept a submit.
      for (const type of ['TELEPSYCHOLOGY', 'DATA_PROCESSING']) {
        const consent = await clientPage.request.post('/api/backend/consents', {
          data: { type, version: '1.0.0' },
        });
        expect(consent.ok(), `consent ${type} failed: ${consent.status()}`).toBe(true);
      }

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
    await expect(page.getByText('Connecting to the live record…')).toHaveCount(0, { timeout: 15_000 });
    await expect(approveButtons.first()).toBeVisible({ timeout: 20_000 });
    const afterSubmit = await approveButtons.count();
    expect(afterSubmit).toBeGreaterThan(before);

    // Each triage card renders one "Approve" button PER CANDIDATE (here: Dr.
    // Rivera + Dr. Okafor, so 2), but approving any one candidate removes the
    // WHOLE card from the board (manager/page.tsx's approve() does
    // `setProposals((prev) => prev.filter((x) => x.id !== p.id))` — it filters
    // out the entire proposal, not just the clicked candidate row). So one
    // click removes as many buttons as that card had candidates, not just 1.
    // The API orders proposals `createdAt: 'desc'` (matching.service.ts's
    // listProposals), so the first card in DOM order is always the one this
    // test just created — scope to it explicitly rather than assuming a
    // fixed candidate count.
    const newestCard = page.locator('#portal-content article').first();
    const newestCardApproveButtons = newestCard.getByRole('button', { name: 'Approve' });
    const candidatesInNewestCard = await newestCardApproveButtons.count();
    expect(candidatesInNewestCard).toBeGreaterThan(0);

    await newestCardApproveButtons.first().click();
    // A successful approve removes that proposal card from the board —
    // the count settles back down rather than an error panel appearing.
    //
    // Scoped to #portal-content (main), not the whole page: Next.js's App
    // Router injects its own always-present accessibility route announcer
    // (next/dist/client/components/app-router-announcer.js) as a hidden
    // `role="alert"` live region in a shadow root appended directly to
    // `document.body` — outside the app's own tree — purely to announce
    // client-side title changes to screen readers. Playwright's getByRole
    // pierces open shadow roots by default, so an unscoped query against the
    // whole `page` always matches that announcer too (empty text, but still
    // one `alert`-role node), making `toHaveCount(0)` fail even on a clean
    // approve with zero app-level errors. The app's own ErrorPanel
    // (apps/web/src/components/ErrorPanel.tsx) is always rendered inside
    // `<main id="portal-content">`, so scoping there is the actual assertion
    // this test wants: no error panel — not "no accessibility live region
    // exists anywhere on the page," which is never true here.
    await expect(page.locator('#portal-content').getByRole('alert')).toHaveCount(0);
    // Delta, not a return to the original `before`: approving exactly one
    // card must remove exactly that card's candidate buttons. Asserting an
    // absolute return to `before` would silently assume the dev database
    // starts (or returns to) empty, which prisma/seed.ts's purely-additive
    // design does not guarantee across repeated local runs — see the comment
    // above `before`.
    await expect(approveButtons).toHaveCount(afterSubmit - candidatesInNewestCard, { timeout: 15_000 });
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
