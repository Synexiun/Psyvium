/**
 * DI token for the process's `Meter` (see `vpsy-metrics.service.ts` for why
 * this is injected rather than read from the global `@opentelemetry/api`
 * singleton directly). Kept in its own file (no runtime logic) so both the
 * production provider (`observability.module.ts`) and test files can import
 * just the token without pulling in the module's other providers.
 */
export const VPSY_METER = Symbol('VPSY_METER');
