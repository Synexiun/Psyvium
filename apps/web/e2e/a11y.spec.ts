import { test, expect } from '@playwright/test';
import { scanPage, splitViolations, logReportOnly, describeViolations } from './utils';

/**
 * Accessibility scans (docs/technical/12-testing-strategy.md §10) of the four
 * screens the audit calls out: /login (anonymous), /home, /risk, /session
 * (authenticated). Serious/critical axe-core violations fail the build;
 * moderate/minor are logged as report-only findings, never silently dropped
 * and never weakened into the blocking threshold (out of scope to fix
 * apps/web src this pass — real findings are reported, not hidden).
 */

test.describe('a11y: /login (anonymous)', () => {
  test('no serious/critical violations', async ({ page }) => {
    const results = await scanPage(page, '/login');
    const { blocking, reportOnly } = splitViolations(results);
    logReportOnly('/login', reportOnly);
    expect(blocking, describeViolations(blocking)).toEqual([]);
  });
});

test.describe('a11y: /home (client)', () => {
  test.use({ storageState: 'e2e/.auth/client.json' });

  test('no serious/critical violations', async ({ page }) => {
    const results = await scanPage(page, '/home');
    const { blocking, reportOnly } = splitViolations(results);
    logReportOnly('/home', reportOnly);
    expect(blocking, describeViolations(blocking)).toEqual([]);
  });
});

test.describe('a11y: /risk (psychologist)', () => {
  test.use({ storageState: 'e2e/.auth/psychologist.json' });

  test('no serious/critical violations', async ({ page }) => {
    const results = await scanPage(page, '/risk');
    const { blocking, reportOnly } = splitViolations(results);
    logReportOnly('/risk', reportOnly);
    expect(blocking, describeViolations(blocking)).toEqual([]);
  });
});

test.describe('a11y: /session (psychologist)', () => {
  test.use({ storageState: 'e2e/.auth/psychologist.json' });

  test('no serious/critical violations', async ({ page }) => {
    const results = await scanPage(page, '/session');
    const { blocking, reportOnly } = splitViolations(results);
    logReportOnly('/session', reportOnly);
    expect(blocking, describeViolations(blocking)).toEqual([]);
  });
});
