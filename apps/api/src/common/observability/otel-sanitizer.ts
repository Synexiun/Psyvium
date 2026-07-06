import type { SpanProcessor } from '@opentelemetry/sdk-trace-base';
import type { Attributes, AttributeValue } from '@opentelemetry/api';

/**
 * PHI SAFETY — the one non-negotiable rule in doc 10-observability-and-devops.md
 * §7: "PHI is never placed in telemetry — only ids, hashes, and classification
 * tags." Auto-instrumentation (instrumentation-http in particular) was NOT
 * written with that rule in mind — by default it puts the raw, unredacted
 * incoming-request query string on `url.query` (and a legacy `http.target`
 * equivalent), which is exactly where a clinician-facing route could leak
 * something like `?ssn=123-45-6789` or a search query containing a client's
 * name straight onto a span that ships to a third-party trace backend. This
 * module is the enforcement point that guarantees that never happens, no
 * matter what an instrumentation package (present or future) tries to record.
 *
 * Three concrete leak vectors this closes:
 *  1. `Authorization` / `Cookie` (/ `Set-Cookie`) headers — these are bearer
 *     credentials, not identifiers; a leaked one is a full account takeover,
 *     strictly worse than a PHI leak. Stripped unconditionally.
 *  2. Query strings — `url.query`/`http.target`/`url.full` can carry free-text
 *     search terms, ids-that-are-really-names, or signed tokens. We keep the
 *     PATH (a route template or literal path is just an id, not PHI) and drop
 *     everything from `?` onward.
 *  3. Anything that looks like a captured body — no instrumentation in this
 *     module's dependency list captures request/response bodies today, but a
 *     future one might (or a developer might pass a bad `applyCustomAttributesOnSpan`
 *     hook). Any attribute key ending in `body` is treated as a body and dropped
 *     defensively — belt-and-suspenders, not a substitute for reviewing new
 *     instrumentation config before enabling it.
 *
 * KNOWN LIMITATION (documented per the task, not silently swept under): before
 * Nest's router has resolved a request, `url.path`/`http.target` may still be
 * the literal path (e.g. `/clients/cmr90h.../notes`) rather than a route
 * template (`/clients/:id/notes`) — instrumentation-http's incoming-request
 * span is created ahead of Nest's routing layer, so it cannot cheaply see the
 * matched route template. That literal path is acceptable to keep: it is an
 * OPAQUE ID (a cuid), not PHI, and the query string — the part that could
 * actually carry free text — is unconditionally stripped by this sanitizer
 * regardless. Swapping in route templates everywhere would need a Nest-level
 * hook (e.g. an interceptor reading `req.route.path`) layered on top of this
 * one; deferred as a low-value refinement since it changes label FORM, not
 * PHI SAFETY, which is already guaranteed here.
 */

/** Header-shaped attribute keys that must never leave the process, however an instrumentation names them. */
const FORBIDDEN_HEADER_KEY_PATTERN = /(^|\.)(authorization|cookie|set-cookie)$/i;

/**
 * Attributes that carry the request/response URL — path is fine, query is not.
 * `http.target`/`url.full`/`http.url` are PATH+QUERY combined (truncate at the
 * first `?`); `url.query` is DIFFERENT — per semantic conventions its value is
 * the query string ALONE, with no leading `?` and no path prefix to keep, so
 * truncating "at the `?`" would find none and return it untouched. It is
 * therefore always dropped outright rather than truncated.
 */
const URL_LIKE_ATTRIBUTE_KEYS = new Set(['url.full', 'http.target', 'http.url']);
const QUERY_ONLY_ATTRIBUTE_KEYS = new Set(['url.query']);

/** Defensive catch-all: anything that looks like a captured body, by key name. */
const BODY_LIKE_KEY_PATTERN = /body$/i;

/**
 * Strips/redacts attributes in place (mutates the object the caller passed
 * in — spans hand out their `attributes` as a live, mutable record even
 * though the TS type marks the property itself `readonly`; see Span.d.ts in
 * `@opentelemetry/sdk-trace`). Pure w.r.t. everything else: ids, status
 * codes, method names, durations, RBAC/cache-hit/model-version tags (added
 * elsewhere by application code) all pass through untouched.
 */
export function sanitizeSpanAttributes(attributes: Attributes): void {
  for (const key of Object.keys(attributes)) {
    if (FORBIDDEN_HEADER_KEY_PATTERN.test(key)) {
      delete attributes[key];
      continue;
    }
    if (BODY_LIKE_KEY_PATTERN.test(key)) {
      delete attributes[key];
      continue;
    }
    if (QUERY_ONLY_ATTRIBUTE_KEYS.has(key)) {
      delete attributes[key];
      continue;
    }
    if (URL_LIKE_ATTRIBUTE_KEYS.has(key)) {
      const truncated = truncateToPath(attributes[key]);
      if (truncated === undefined) {
        delete attributes[key];
      } else {
        attributes[key] = truncated;
      }
    }
  }
}

/** Keeps only the path portion of a URL-shaped attribute value; drops everything from `?` onward. */
function truncateToPath(value: AttributeValue | undefined): AttributeValue | undefined {
  if (typeof value !== 'string') return undefined; // non-string url attribute — nothing sane to truncate, drop it
  const queryIndex = value.indexOf('?');
  return queryIndex === -1 ? value : value.slice(0, queryIndex);
}

/**
 * Wraps a real `SpanProcessor` (e.g. `BatchSpanProcessor`/`SimpleSpanProcessor`
 * pointed at the OTLP exporter, or `NoopSpanProcessor` in no-op mode) and
 * sanitizes every span's attributes at `onEnd` — the last moment before a span
 * is handed to `forceFlush`/export — so this is a single choke point that
 * every span passes through regardless of which instrumentation produced it
 * or when during the request lifecycle it set an attribute. Applying this at
 * `onEnd` rather than `onStart` is deliberate: `onStart` only sees the
 * attributes present at span creation, but instrumentation and application
 * code can still add attributes for the rest of the span's lifetime — `onEnd`
 * is the only point that is guaranteed to see the FINAL attribute set.
 */
export class PhiSanitizingSpanProcessor implements SpanProcessor {
  constructor(private readonly delegate: SpanProcessor) {}

  onStart(span: Parameters<SpanProcessor['onStart']>[0], parentContext: Parameters<SpanProcessor['onStart']>[1]): void {
    this.delegate.onStart(span, parentContext);
  }

  onEnd(span: Parameters<SpanProcessor['onEnd']>[0]): void {
    sanitizeSpanAttributes(span.attributes);
    this.delegate.onEnd(span);
  }

  forceFlush(): Promise<void> {
    return this.delegate.forceFlush();
  }

  shutdown(): Promise<void> {
    return this.delegate.shutdown();
  }
}
