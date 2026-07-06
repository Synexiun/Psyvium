/**
 * OTel SDK bootstrap — closes a P0 audit finding: the running VPSY API
 * currently emits ZERO traces/metrics (docs/technical/10-observability-and-
 * devops.md §7). This file is imported for its SIDE EFFECT ONLY.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ORDERING — READ BEFORE MOVING THIS IMPORT OUT OF FIRST PLACE
 * ══════════════════════════════════════════════════════════════════════════
 * This module MUST be the very first line imported by `main.ts` — even before
 * `import 'reflect-metadata'`. OTel's http/express/nestjs-core instrumentations
 * work by monkey-patching Node's module loader (`require-in-the-middle`): the
 * NEXT time `http`, `express`, or `@nestjs/core` is `require()`-d anywhere in
 * the process, the patched version is returned instead of the original. That
 * patch has to be installed BEFORE those modules are first required anywhere
 * in the import graph. `main.ts`'s second import is `@nestjs/core`, which
 * transitively requires `http`/`express` while building the Nest application;
 * if this file were imported even one line later, the instrumentation would
 * attach to nothing — every HTTP span and the free `http.server.duration`
 * metric would silently be missing, with no error to explain why. This is a
 * correctness requirement, not a style preference — do not "clean up" the
 * import order in main.ts without re-reading this comment.
 * ══════════════════════════════════════════════════════════════════════════
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core';
import { defaultResource, resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader, type IMetricReader } from '@opentelemetry/sdk-metrics';
import { BatchSpanProcessor, NoopSpanProcessor, type SpanProcessor } from '@opentelemetry/sdk-trace-base';
import { Logger } from '@nestjs/common';
import { PhiSanitizingSpanProcessor } from './otel-sanitizer';

// Read the running package's own version at runtime via `require` rather than
// an ES `import … from '../../../package.json'`. An ES JSON import needs
// `resolveJsonModule` to be honored by whichever TS compilation is active —
// true for the real `tsconfig.json` used by `nest build`, but ts-jest's
// per-file transform override in `jest.config.cjs` passes its OWN narrower
// `compilerOptions` object that omits it. A plain `require()` sidesteps that
// entirely (Node resolves + parses the JSON itself; TS just sees `any`),
// so this line behaves identically under `nest build`, `ts-jest`, and `ts-node`.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { version: API_PACKAGE_VERSION } = require('../../../package.json') as { version: string };

const logger = new Logger('OTel');

// `main.ts`'s `NestFactory.create(AppModule)` is what triggers `@nestjs/config`'s
// `ConfigModule.forRoot()` to load `apps/api/.env` into `process.env` — but that
// happens AFTER this file (by the ordering rule above). Without pre-loading here,
// an operator who sets OTEL_EXPORTER_OTLP_ENDPOINT in `.env` (rather than a real
// shell/container env var) would see this module log "no-op mode" even though
// they configured an endpoint — dishonest, and exactly the kind of silent
// misconfiguration this whole task exists to prevent. `process.loadEnvFile()`
// is a built-in Node API (stable since Node 20.6) — no new dependency, and it
// is a no-op merge: it does not override a variable that's already set, so a
// real container-injected env var still always wins over `.env`. Guarded
// because the file legitimately won't exist in production containers (which
// inject real env vars directly) — that is the expected, not-an-error case.
try {
  // Cast: `process.loadEnvFile` (stable since Node 20.6) isn't declared by the
  // `@types/node@22.10.2` pinned in this repo yet, so we type it ourselves
  // rather than bumping a shared type-package version just for this one call.
  const nodeProcess = process as unknown as { loadEnvFile?: (path?: string) => void };
  nodeProcess.loadEnvFile?.();
} catch {
  // No `.env` file found — expected in production; real env vars are already set.
}

const SERVICE_NAME = 'vpsy-api';
const rawEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
const endpoint = rawEndpoint ? rawEndpoint.replace(/\/+$/, '') : undefined;
const deploymentEnvironment = process.env.NODE_ENV ?? 'development';

const resource = defaultResource().merge(
  resourceFromAttributes({
    [ATTR_SERVICE_NAME]: SERVICE_NAME,
    [ATTR_SERVICE_VERSION]: API_PACKAGE_VERSION,
    // Doc 10 §7 names this attribute literally `deployment.environment` (the
    // pre-2023 semantic-conventions key). Current stable semconv renamed it to
    // `deployment.environment.name`; we set the doc's literal key here to match
    // the written spec verbatim, since that's what this org's dashboards/alerts
    // (per the doc's own mermaid diagram) are assumed to key off today. If the
    // collector config is later confirmed on the new key, ADD it alongside —
    // never replace, to avoid breaking existing dashboards silently.
    'deployment.environment': deploymentEnvironment,
    // tenant.id is intentionally NOT a resource attribute: a Resource is fixed
    // for the whole process, but one API process serves MANY tenants — baking
    // a single tenant.id in here would be both wrong (which tenant?) and a
    // cardinality/PHI-adjacency mistake. Per-tenant labeling instead happens
    // per-event as a low-cardinality HASH (see `tenant-hash.ts`), attached to
    // the specific span/metric it belongs to — never to the process-wide Resource.
  }),
);

/**
 * PHI SAFETY (non-negotiable, doc 10 §7): every span this process ever
 * produces funnels through exactly one `PhiSanitizingSpanProcessor`,
 * regardless of export mode. See `otel-sanitizer.ts` for what it strips and
 * why `onEnd` is the correct choke point. Wrapping applies even in no-op mode
 * — cheap insurance against a future exporter swap forgetting to re-wrap.
 */
const rawSpanProcessor: SpanProcessor = endpoint
  ? new BatchSpanProcessor(new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }))
  : new NoopSpanProcessor();

/**
 * Metrics: NodeSDK, if given NO `metricReaders` at all, falls back to reading
 * `OTEL_METRICS_EXPORTER`/`OTEL_EXPORTER_OTLP_*` env vars ITSELF and defaults
 * to a REAL otlp exporter pointed at `http://localhost:4318` (see
 * `getMetricReadersFromEnv()` in `@opentelemetry/sdk-node`). That would make
 * "no-op mode" a lie — the process would still make outbound calls to a
 * collector nobody configured. So `metricReaders` is ALWAYS passed explicitly:
 * an empty array in no-op mode (which the SDK short-circuits to "don't even
 * construct a MeterProvider" — confirmed by reading its source — leaving
 * `@opentelemetry/api`'s global no-op Meter/Counter in place, which is exactly
 * the safe, inert default we want), or the one real reader when configured.
 */
const metricReaders: IMetricReader[] = endpoint
  ? [new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }) })]
  : [];

const sdk = new NodeSDK({
  resource,
  spanProcessors: [new PhiSanitizingSpanProcessor(rawSpanProcessor)],
  metricReaders,
  // Logs are explicitly OUT of scope here: doc 10 §7.3's "structured JSON
  // logs + redaction middleware" is the existing Nest `Logger` + JSON output
  // path, not the OTel Logs SDK. Passing an empty array (rather than leaving
  // this unset) disables the SAME env-var-driven default-otlp-log-exporter
  // fallback described above for metrics — otherwise no-op mode would still
  // silently dial out for logs even though this task never wires log export.
  logRecordProcessors: [],
  instrumentations: [new HttpInstrumentation(), new ExpressInstrumentation(), new NestInstrumentation()],
});

// Registers instrumentations (patches http/express/@nestjs/core's module
// exports) and — when configured — the trace/metric pipelines. Synchronous:
// by the time this line returns, every later `require()` of an instrumented
// module in this process returns the patched version.
sdk.start();

if (endpoint) {
  logger.log(`OTel: exporting traces+metrics to ${endpoint}`);
} else {
  logger.log('OTel: no exporter configured (OTEL_EXPORTER_OTLP_ENDPOINT unset) — running in no-op mode');
}

/**
 * Graceful shutdown (doc 10-observability-and-devops.md §5's "Graceful
 * shutdown" row: "SIGTERM → stop accepting → drain → flush OTel → close
 * pools"). Without this, spans/metrics still buffered in the batch
 * processor/periodic reader at the moment a deploy sends SIGTERM would be
 * dropped instead of exported — exactly the last few seconds of traffic an
 * on-call engineer would want visibility into during a deploy-triggered incident.
 */
process.on('SIGTERM', () => {
  sdk
    .shutdown()
    .then(() => logger.log('OTel: SDK shut down cleanly (SIGTERM)'))
    .catch((err) => logger.error(`OTel: shutdown failed: ${(err as Error).message}`));
});

/**
 * DEFERRED — trace-id/log correlation: stamping the active span's traceId
 * onto every `Logger.log(...)` line (so a log entry and its trace line up in
 * OpenSearch without a manual correlationId lookup) would need either a
 * custom Nest `LoggerService` wrapping every call site, or swapping Nest's
 * global logger factory in `main.ts` — ~30 files today construct their own
 * `new Logger('Context')` instance directly. That's a real, non-trivial
 * refactor across the codebase, not a "cheap, if trivial" addition, so per
 * this task's own instruction it is deliberately deferred rather than done
 * half-way. The read side, once someone picks this up, is
 * `trace.getActiveSpan()?.spanContext().traceId` from `@opentelemetry/api`.
 */
