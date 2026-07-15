import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * API lint gate (doc 10 §4). Replaces the `echo 'lint ok'` stub the
 * 2026-07-13 audit flagged (Lint quality 3/10 — "API lint is a stub").
 *
 * Philosophy: a BLOCKING gate must be honest and sustainable, so the base is
 * the recommended sets plus the type-aware ASYNC-CORRECTNESS rules that
 * matter most in a NestJS clinical codebase — a dropped promise in a
 * consent/audit/risk path is a patient-safety bug, not a style issue.
 * Deliberately NOT enabled (would flood a mature codebase without adding
 * clinical safety): the no-unsafe-* family (Prisma JSON columns are cast
 * deliberately at persistence boundaries) and stylistic preferences.
 */
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'eslint.config.mjs'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // ── Async correctness (type-aware; the reason this gate exists) ──
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        // Nest route handlers / event subscribers commonly pass async fns
        // where void-returns are expected; the checksVoidReturn family of
        // false positives outweighs its catch-rate here.
        { checksVoidReturn: false },
      ],
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/require-await': 'off', // Nest interfaces force async signatures

      // ── Hygiene ──
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // Prisma JSON columns / mock harnesses use `any` deliberately at
      // persistence + test boundaries; banning it here would only breed
      // eslint-disable noise, not safety.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },
  {
    // Test files: mocks legitimately return naked values where promises are
    // expected and abuse `require`-style casts; keep correctness rules that
    // still catch real test bugs (floating promises hide failed assertions).
    files: ['**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
);
