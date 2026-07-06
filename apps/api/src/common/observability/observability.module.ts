import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { metrics } from '@opentelemetry/api';
import { VPSY_METER } from './observability.tokens';
import { VpsyMetrics } from './vpsy-metrics.service';
import { VpsyMetricsBridgeService } from './vpsy-metrics-bridge.service';
import { AuthLoginFailureMetricsInterceptor } from './auth-login-failure.interceptor';

/**
 * Global cross-cutting observability module — same minimal `@Global()` shape
 * as `common/audit/audit.module.ts`. Registers:
 *
 *  - `VPSY_METER`: a `Meter` resolved from the process-global OTel API (which
 *    `common/observability/otel.ts` configured as a side effect at the very
 *    top of `main.ts`, before Nest even exists). `VpsyMetrics` depends on this
 *    TOKEN, not on `metrics.getMeter(...)` directly, so tests can substitute a
 *    locally-scoped `Meter` (see `vpsy-metrics-bridge.service.spec.ts`).
 *  - `VpsyMetrics` — the named counters (exported for any future context that
 *    wants to record its own domain metric).
 *  - `VpsyMetricsBridgeService` — subscribes 3 of those counters to EventBus
 *    events (`OnModuleInit`, mirrors `RealtimeBridgeService`).
 *  - `AuthLoginFailureMetricsInterceptor` as an `APP_INTERCEPTOR` — Nest
 *    applies any `APP_INTERCEPTOR` provider GLOBALLY regardless of which
 *    module declares it, so registering it here (rather than adding provider
 *    wiring to `app.module.ts`) keeps this task's `app.module.ts` diff to a
 *    single import + a one-line addition to the global-infrastructure imports
 *    block, matching every other cross-cutting module in that file.
 */
@Global()
@Module({
  providers: [
    { provide: VPSY_METER, useFactory: () => metrics.getMeter('vpsy-api') },
    VpsyMetrics,
    VpsyMetricsBridgeService,
    { provide: APP_INTERCEPTOR, useClass: AuthLoginFailureMetricsInterceptor },
  ],
  exports: [VpsyMetrics],
})
export class ObservabilityModule {}
