import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/** axe-core `impact` levels this suite treats as build-breaking. */
export const BLOCKING_IMPACTS = ['serious', 'critical'] as const;

/**
 * Runs an axe-core scan of the given path on an already-authenticated (or
 * intentionally anonymous) page. Waits for network idle first so the
 * live-data screens (which render a loading skeleton, then fetch) are scanned
 * in their settled state, not mid-skeleton.
 */
export async function scanPage(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState('networkidle').catch(() => {
    // Some screens keep a live WebSocket/polling connection open — this is a
    // best-effort settle, not a hard requirement.
  });
  return new AxeBuilder({ page }).analyze();
}

export type AxeResults = Awaited<ReturnType<typeof scanPage>>;

/** Splits violations into (fails-the-build) vs (report-only) by impact. */
export function splitViolations(results: AxeResults) {
  const blocking = results.violations.filter((v) => BLOCKING_IMPACTS.includes(v.impact as (typeof BLOCKING_IMPACTS)[number]));
  const reportOnly = results.violations.filter((v) => !BLOCKING_IMPACTS.includes(v.impact as (typeof BLOCKING_IMPACTS)[number]));
  return { blocking, reportOnly };
}

/** Logs moderate/minor violations to the test output — visible, never silently dropped, never failing the build. */
export function logReportOnly(label: string, reportOnly: AxeResults['violations']) {
  if (reportOnly.length === 0) return;
  // eslint-disable-next-line no-console
  console.log(`\n[a11y][${label}] ${reportOnly.length} moderate/minor violation(s) — report-only, non-blocking:`);
  for (const v of reportOnly) {
    // eslint-disable-next-line no-console
    console.log(`  - [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s)) — ${v.helpUrl}`);
  }
}

/** Formats a violation list for a readable assertion-failure message. */
export function describeViolations(violations: AxeResults['violations']) {
  return violations
    .map((v) => `[${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s)) — ${v.helpUrl}`)
    .join('\n');
}
