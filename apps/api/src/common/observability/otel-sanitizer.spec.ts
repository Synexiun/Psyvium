import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { PhiSanitizingSpanProcessor, sanitizeSpanAttributes } from './otel-sanitizer';

/**
 * Proves the one non-negotiable rule from doc 10-observability-and-devops.md
 * §7 ("PHI is never placed in telemetry") by driving REAL spans through a
 * REAL `BasicTracerProvider` + `InMemorySpanExporter`, wrapped by our
 * sanitizing processor exactly as `otel.ts` wires it in production — not a
 * mock of the sanitizer, the actual span pipeline. If a future change swaps
 * in a raw `SimpleSpanProcessor`/forgets to wrap it, or loosens the denylist,
 * this spec fails loudly instead of PHI silently reaching an exported span.
 */
describe('PhiSanitizingSpanProcessor (via a real TracerProvider + InMemorySpanExporter)', () => {
  let exporter: InMemorySpanExporter;
  let provider: BasicTracerProvider;

  beforeEach(() => {
    exporter = new InMemorySpanExporter();
    provider = new BasicTracerProvider({
      spanProcessors: [new PhiSanitizingSpanProcessor(new SimpleSpanProcessor(exporter))],
    });
  });

  afterEach(async () => {
    await provider.shutdown();
  });

  it('strips Authorization/Cookie header-shaped attributes before export', async () => {
    const tracer = provider.getTracer('spec');
    const span = tracer.startSpan('POST /auth/login');
    span.setAttribute('http.request.header.authorization', 'Bearer eyJhbGciOiJIUzI1NiJ9.super-secret-token');
    span.setAttribute('http.request.header.cookie', 'session=abc123; refresh=def456');
    span.setAttribute('http.response.header.set-cookie', 'session=xyz789');
    span.end();
    await provider.forceFlush();

    const [finished] = exporter.getFinishedSpans();
    expect(finished).toBeDefined();
    expect(finished.attributes['http.request.header.authorization']).toBeUndefined();
    expect(finished.attributes['http.request.header.cookie']).toBeUndefined();
    expect(finished.attributes['http.response.header.set-cookie']).toBeUndefined();
  });

  it('truncates query-string-bearing URL attributes to path-only, never exporting the raw query', async () => {
    const tracer = provider.getTracer('spec');
    const span = tracer.startSpan('GET /clients/search');
    span.setAttribute('url.query', 'ssn=123-45-6789&name=Jane+Doe');
    span.setAttribute('http.target', '/clients/search?ssn=123-45-6789&name=Jane+Doe');
    span.setAttribute('url.full', 'https://api.vpsy.example/clients/search?ssn=123-45-6789');
    span.end();
    await provider.forceFlush();

    const [finished] = exporter.getFinishedSpans();
    const serialized = JSON.stringify(finished.attributes);
    expect(serialized).not.toContain('123-45-6789');
    expect(serialized).not.toContain('Jane');
    // path-only forms are kept, not deleted wholesale — they're still useful for routing/debugging
    expect(finished.attributes['http.target']).toBe('/clients/search');
    expect(finished.attributes['url.full']).toBe('https://api.vpsy.example/clients/search');
    // `url.query` has nothing left once the query is removed — dropped entirely rather than kept as ''.
    expect(finished.attributes['url.query']).toBeUndefined();
  });

  it('drops any attribute that looks like a captured request/response body', async () => {
    const tracer = provider.getTracer('spec');
    const span = tracer.startSpan('POST /clinical-documentation/notes');
    span.setAttribute('http.request.body', JSON.stringify({ note: 'Client reports severe depression and SI.' }));
    span.setAttribute('custom.response_body', 'diagnosis: F32.2');
    span.end();
    await provider.forceFlush();

    const [finished] = exporter.getFinishedSpans();
    const serialized = JSON.stringify(finished.attributes);
    expect(serialized).not.toContain('depression');
    expect(serialized).not.toContain('F32.2');
    expect(finished.attributes['http.request.body']).toBeUndefined();
    expect(finished.attributes['custom.response_body']).toBeUndefined();
  });

  it('leaves ids, status codes, and non-PHI classification tags untouched', async () => {
    const tracer = provider.getTracer('spec');
    const span = tracer.startSpan('GET /clients/:id');
    span.setAttribute('client.id', 'cli_cmr90h0zs0038dav4ge6mugrw');
    span.setAttribute('http.response.status_code', 200);
    span.setAttribute('vpsy.bounded_context', 'risk-and-crisis');
    span.setAttribute('vpsy.cache_hit', true);
    span.end();
    await provider.forceFlush();

    const [finished] = exporter.getFinishedSpans();
    expect(finished.attributes['client.id']).toBe('cli_cmr90h0zs0038dav4ge6mugrw');
    expect(finished.attributes['http.response.status_code']).toBe(200);
    expect(finished.attributes['vpsy.bounded_context']).toBe('risk-and-crisis');
    expect(finished.attributes['vpsy.cache_hit']).toBe(true);
  });
});

describe('sanitizeSpanAttributes (unit-level, no tracer/exporter involved)', () => {
  it('mutates the attributes object in place and returns nothing', () => {
    const attrs: Record<string, string | undefined> = {
      authorization: 'Bearer token-should-not-survive',
      'url.query': 'foo=bar',
      'client.id': 'cli_123',
    };
    const result = sanitizeSpanAttributes(attrs);
    expect(result).toBeUndefined();
    expect(attrs.authorization).toBeUndefined();
    expect(attrs['url.query']).toBeUndefined();
    expect(attrs['client.id']).toBe('cli_123');
  });
});
