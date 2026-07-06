import { MeterProvider, MetricReader, type CollectionResult } from '@opentelemetry/sdk-metrics';
import { EventBus, Events } from '../events/event-bus.service';
import { VpsyMetrics } from './vpsy-metrics.service';
import { VpsyMetricsBridgeService } from './vpsy-metrics-bridge.service';

/**
 * Minimal, deterministic, PULL-based `MetricReader`: no periodic export
 * timers to fake/flush, just an explicit `collect()` call whenever the test
 * wants to see the current aggregated values. `MetricReader` is abstract
 * (only `onShutdown`/`onForceFlush` need implementing) — this is the
 * lightest concrete subclass that satisfies it, i.e. the "manual reader"
 * pattern for this SDK version.
 */
class TestMetricReader extends MetricReader {
  protected async onShutdown(): Promise<void> {}
  protected async onForceFlush(): Promise<void> {}
}

/** Reads back the current summed value across ALL attribute sets for one counter (a Counter always aggregates as Sum). */
function sumOf(result: CollectionResult, metricName: string): number {
  let total = 0;
  for (const scope of result.resourceMetrics.scopeMetrics) {
    for (const metric of scope.metrics) {
      if (metric.descriptor.name !== metricName) continue;
      for (const point of metric.dataPoints as Array<{ value: number }>) {
        total += point.value;
      }
    }
  }
  return total;
}

describe('VpsyMetricsBridgeService (real EventBus + a local test MeterProvider — no global OTel API mutation)', () => {
  let reader: TestMetricReader;
  let bus: EventBus;
  let metrics: VpsyMetrics;
  let bridge: VpsyMetricsBridgeService;

  beforeEach(() => {
    reader = new TestMetricReader();
    const meterProvider = new MeterProvider({ readers: [reader] });
    const meter = meterProvider.getMeter('vpsy-api-spec');
    bus = new EventBus();
    // `VpsyMetrics`/`VpsyMetricsBridgeService` are plain injectable classes —
    // constructing them directly (no Nest TestingModule) is enough here since
    // neither has any other DI dependency besides what we're passing by hand.
    metrics = new VpsyMetrics(meter);
    bridge = new VpsyMetricsBridgeService(bus, metrics);
    bridge.onModuleInit();
  });

  it('increments risk.flag.raised by 1 when risk.flag.raised is published', async () => {
    await bus.publish(Events.RiskFlagRaised, 'tenant_demo', { riskFlagId: 'rf_1', clientId: 'client_1' });

    const result = await reader.collect();
    expect(sumOf(result, 'risk.flag.raised')).toBe(1);
  });

  it('increments escalation.sla.breached by 1 when the raw escalation.sla_breached event is published', async () => {
    await bus.publish('escalation.sla_breached', 'tenant_demo', {
      escalationId: 'esc_1',
      riskFlagId: 'rf_1',
      clientId: 'client_1',
      severity: 'HIGH',
    });

    const result = await reader.collect();
    expect(sumOf(result, 'escalation.sla.breached')).toBe(1);
  });

  it('increments ai.recommendation.created by 1, labeled with the passthrough agent as `source`', async () => {
    await bus.publish(Events.AIRecommendationCreated, 'tenant_demo', {
      recommendationId: 'rec_1',
      agent: 'INTAKE',
    });

    const result = await reader.collect();
    expect(sumOf(result, 'ai.recommendation.created')).toBe(1);
    const metric = result.resourceMetrics.scopeMetrics[0].metrics.find((m) => m.descriptor.name === 'ai.recommendation.created');
    const point = (metric as { dataPoints: Array<{ attributes: Record<string, unknown> }> }).dataPoints[0];
    expect(point.attributes.source).toBe('INTAKE');
  });

  it('never lets tenantId leak raw onto a metric attribute — only the low-cardinality hash', async () => {
    await bus.publish(Events.RiskFlagRaised, 'tenant_demo', { riskFlagId: 'rf_2', clientId: 'client_2' });

    const result = await reader.collect();
    const metric = result.resourceMetrics.scopeMetrics[0].metrics.find((m) => m.descriptor.name === 'risk.flag.raised');
    const point = (metric as { dataPoints: Array<{ attributes: Record<string, unknown> }> }).dataPoints[0];
    expect(point.attributes.tenantId).toBeUndefined();
    expect(point.attributes.tenantIdHash).toBeDefined();
    expect(point.attributes.tenantIdHash).not.toBe('tenant_demo');
  });

  it('swallows a handler failure without crashing (bad payload shape) and logs instead of throwing', async () => {
    // `escalation.sla_breached`'s handler reads `payload.severity` — publishing
    // `undefined` as the payload must not throw synchronously out of `publish()`,
    // matching the same try/catch discipline as `realtime-bridge.service.ts`.
    await expect(bus.publish('escalation.sla_breached', 'tenant_demo', undefined as never)).resolves.not.toThrow();
  });
});
