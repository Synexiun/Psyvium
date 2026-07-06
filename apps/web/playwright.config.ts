import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * VPSY OS — browser E2E + a11y suite (Wave D, docs/technical/12-testing-strategy.md §10).
 *
 * Closes the audit P0 that `scripts/smoke.sh` only exercises HTTP and never
 * the web UI: this config drives the REAL Next.js app (no mocks) against a
 * REAL API + seeded Postgres, the same stack smoke.sh describes.
 *
 * ── webServer design decision (Windows-local + Linux-CI) ──────────────────
 * Two servers are required: the API (`node dist/main.js`, run from
 * `apps/api` — the cwd gotcha is real, `@nestjs/config` loads `apps/api/.env`
 * relative to cwd, not the repo root) and the web app (`next start`, which
 * serves the ALREADY-BUILT `.next` output — this config never runs `next
 * build` itself).
 *
 * Why not build-then-start in-process here: `JWT_ACCESS_SECRET` (verified by
 * `src/middleware.ts` via Web Crypto HS256) must match the API's secret and,
 * for an Edge-runtime `middleware.ts`, must be present in `process.env` at
 * `next build` time — Next statically inlines the env vars a middleware
 * bundle references, it does not read them fresh from the OS environment at
 * request time the way a Node server would. Rebuilding inside `webServer`
 * would silently bake in whatever (possibly wrong or absent) secret happens
 * to be in the invoking shell, which is exactly the kind of flaky,
 * environment-dependent failure this suite exists to avoid.
 *
 * So the contract is: something upstream already ran `pnpm build` with
 * `JWT_ACCESS_SECRET` set (CI's `ci.yml` sets it at job level before its
 * `Build` step, matching `apps/api/.env`'s dev value for local runs — see
 * that file's "Ops note"), plus `pnpm --filter @vpsy/database run seed`.
 * This config then only *starts* those pre-built artifacts, with
 * `reuseExistingServer: !process.env.CI`:
 *   - **CI (Linux)**: always spawns fresh `node dist/main.js` +
 *     `next start` processes against the just-built output — deterministic,
 *     no leftover state between runs.
 *   - **Local (Windows)**: if a developer already has the stack running
 *     (`pnpm --filter @vpsy/api run dev` / `pnpm --filter @vpsy/web run
 *     dev`, or a prior `build` + `start`), this reuses it instead of
 *     double-binding :3000/:4000 — the fast local iteration loop the task
 *     asks for. If nothing is listening, it starts the built artifacts the
 *     same way CI does.
 *
 * Known local gap (not this pass's to fix — no `apps/web/.env` exists and
 * touching the web build pipeline is out of scope): a fresh `pnpm build` on
 * a shell that never exported `JWT_ACCESS_SECRET` will produce a `.next`
 * whose middleware can't verify any token, and every authenticated journey
 * here will bounce to `/login`. Export it (matching `apps/api/.env`) before
 * building, e.g. `JWT_ACCESS_SECRET=dev-access-secret-change-me`.
 */

const API_DIR = path.resolve(__dirname, '../api');
// Standard project ports (3000 web / 4000 api), env-overridable because a
// multi-project dev machine may have unrelated stacks parked on them (found
// the hard way: another project's API answers :4000 with a healthy-looking
// /health, and the suite happily ran against the wrong backend). CI never
// needs the overrides.
const PORT_WEB = Number(process.env.E2E_WEB_PORT ?? 3000);
const PORT_API = Number(process.env.E2E_API_PORT ?? 4000);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  // One worker (see task): the suite shares seeded, stateful demo data
  // (caseload, risk board, triage queue) across specs — parallel workers
  // racing the same seeded rows would be a source of flakiness, not speed.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  outputDir: 'test-results',

  use: {
    baseURL: `http://localhost:${PORT_WEB}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  // Chromium only this pass (per task scope).
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
  ],

  webServer: [
    {
      command: 'node dist/main.js',
      cwd: API_DIR,
      url: `http://localhost:${PORT_API}/api/v1/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
      // PORT beats apps/api/.env (dotenv never overwrites a pre-set env
      // var; main.ts reads process.env.PORT) — honors E2E_API_PORT.
      env: { PORT: String(PORT_API) },
    },
    {
      // Runs from apps/web (this file's directory) — serves the pre-built
      // `.next` output. See the file-level comment for why this never runs
      // `next build` itself.
      command: `npx next start -p ${PORT_WEB}`,
      url: `http://localhost:${PORT_WEB}/login`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        // NOTE: the /api/backend/* rewrite destination is resolved from
        // API_URL at BUILD time (next stores it in routes-manifest.json) —
        // this runtime copy is only useful for `next dev`-style runs. If you
        // override E2E_API_PORT, the web app must have been BUILT with a
        // matching API_URL, or its API calls will still hit the default
        // :4000. Verified the hard way against a stranger's API on :4000.
        API_URL: `http://localhost:${PORT_API}`,
        // Runtime copy of the middleware verification secret (belt to the
        // build-time inlining braces documented above). Defaults to the
        // apps/api/.env dev value so a plain local run just works; CI's
        // job-level env overrides it.
        JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret-change-me',
      },
    },
  ],
});
