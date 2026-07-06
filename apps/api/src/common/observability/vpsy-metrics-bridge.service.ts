import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventBus, Events, type DomainEvent } from '../events/event-bus.service';
import { VpsyMetrics } from './vpsy-metrics.service';
import { hashTenantId } from './tenant-hash';

/**
 * Bridges the in-process EventBus (see `common/events/event-bus.service.ts`)
 * to OTel counters — same shape as `common/realtime/realtime-bridge.service.ts`
 * (constructor-injects `EventBus`, wires handlers in `onModuleInit`, wraps
 * each in try/catch so a malformed payload can never crash the process or
 * take down any other subscriber on the same event).
 *
 * Only reads ids/enums off each payload (never clinical free text — there
 * isn't any on these three events to begin with, but the discipline matters
 * even here) and attaches `tenantIdHash` — the low-cardinality one-way hash
 * from `tenant-hash.ts`, NEVER the raw `tenantId` — as a metric attribute so
 * per-tenant dashboards are possible without a telemetry backend ever
 * learning which tenant is which (doc 10-observability-and-devops.md §7).
 *
 * `auth.login.failed` is NOT wired here: there is no bus event for a failed
 * login (see `auth-login-failure.interceptor.ts`'s doc comment for why) — it
 * increments the same `VpsyMetrics.authLoginFailed` counter directly from
 * that interceptor instead.
 */
@Injectable()
export class VpsyMetricsBridgeService implements OnModuleInit {
  private readonly logger = new Logger(VpsyMetricsBridgeService.name);

  constructor(
    private readonly bus: EventBus,
    private readonly metrics: VpsyMetrics,
  ) {}

  onModuleInit(): void {
    // ── Risk & Crisis (context 21) ──
    this.wire(Events.RiskFlagRaised, (e) => {
      this.metrics.riskFlagRaised.add(1, { tenantIdHash: hashTenantId(e.tenantId) });
    });

    // Raw string literal — NOT `Events.EscalationSlaBreached` (no such key exists).
    // Published in `modules/risk/risk-sla.service.ts` as a literal string using
    // the `noun.verb` convention (see that file's own comment on why it isn't
    // added to the shared `Events` registry); this bridge subscribes to the
    // exact same literal so it stays in sync with the one publisher.
    this.wire('escalation.sla_breached', (e) => {
      const payload = e.payload as { severity?: string };
      this.metrics.escalationSlaBreached.add(1, {
        tenantIdHash: hashTenantId(e.tenantId),
        severity: payload.severity ?? 'unknown',
      });
    });

    // ── AI Gateway (ADR-007) ──
    this.wire(Events.AIRecommendationCreated, (e) => {
      const payload = e.payload as { agent: string };
      // `source` = the recommendation's `agent` field, passed through AS-IS.
      // There is no separate ai|rule-based|withheld field on this event today
      // (the `source` distinction lives inside `AIRecommendation.output`,
      // which we must not read here — that's the model's actual output, out
      // of scope for a metric label). An honest passthrough of the real
      // `agent` value (e.g. `INTAKE`, `ALLOCATION`, `CRISIS_RISK`) beats
      // inventing a mapping the data doesn't support.
      this.metrics.aiRecommendationCreated.add(1, {
        source: payload.agent,
        tenantIdHash: hashTenantId(e.tenantId),
      });
    });
  }

  /** Subscribes once to `eventName`; a handler failure is logged, never rethrown into the EventBus. */
  private wire(eventName: string, handle: (event: DomainEvent) => void): void {
    this.bus.subscribe(eventName, (event) => {
      try {
        handle(event);
      } catch (err) {
        this.logger.error(`metrics bridge failed for ${eventName}: ${(err as Error).message}`);
      }
    });
  }
}
