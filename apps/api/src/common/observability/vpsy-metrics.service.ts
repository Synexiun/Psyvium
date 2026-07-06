import { Inject, Injectable } from '@nestjs/common';
import type { Counter, Meter } from '@opentelemetry/api';
import { VPSY_METER } from './observability.tokens';

/**
 * Domain metrics (doc 10-observability-and-devops.md §7.2's "Domain"/"AI"/
 * "Availability" categories — RED per-endpoint metrics and Saturation are
 * free from `instrumentation-http`/`instrumentation-express`, no code needed
 * for those; this class covers the metrics that only application code knows
 * how to raise). One `Counter` field per metric this wave implements:
 *
 *  - `risk.flag.raised`            — Risk & Crisis (context 21)
 *  - `escalation.sla.breached`     — Risk & Crisis SLA sweep
 *  - `ai.recommendation.created`   — AI Gateway (ADR-007), labeled by `source`
 *                                     (the recommendation's `agent` field,
 *                                     passed through verbatim — see
 *                                     `vpsy-metrics-bridge.service.ts`)
 *  - `auth.login.failed`           — incremented by `auth-login-failure.
 *                                     interceptor.ts`, NOT this file's bridge
 *                                     (no bus event exists for a failed login;
 *                                     see that interceptor's doc comment)
 *
 * Injects a `Meter` via the `VPSY_METER` DI token (see `observability.module.ts`)
 * rather than calling `metrics.getMeter('vpsy-api')` from `@opentelemetry/api`
 * directly in this constructor. That indirection is what lets tests swap in a
 * `Meter` built from a locally-scoped `MeterProvider` + manual test reader
 * (see `vpsy-metrics-bridge.service.spec.ts`) WITHOUT mutating the process-
 * global OTel API — mutating global state from a unit test would leak into
 * every other spec file that runs in the same Jest worker.
 */
@Injectable()
export class VpsyMetrics {
  readonly riskFlagRaised: Counter;
  readonly escalationSlaBreached: Counter;
  readonly aiRecommendationCreated: Counter;
  readonly authLoginFailed: Counter;

  constructor(@Inject(VPSY_METER) meter: Meter) {
    this.riskFlagRaised = meter.createCounter('risk.flag.raised', {
      description: 'Risk flags raised (Risk & Crisis, context 21).',
    });
    this.escalationSlaBreached = meter.createCounter('escalation.sla.breached', {
      description: 'Crisis escalations whose SLA timer expired before assignment/resolution.',
    });
    this.aiRecommendationCreated = meter.createCounter('ai.recommendation.created', {
      description: 'AI Gateway recommendations logged behind the PENDING human-decision gate, by agent.',
    });
    this.authLoginFailed = meter.createCounter('auth.login.failed', {
      description: 'Failed POST /auth/login attempts (bad credentials, MFA required/invalid).',
    });
  }
}
