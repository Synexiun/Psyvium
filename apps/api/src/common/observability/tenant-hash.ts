import { createHash } from 'crypto';

/**
 * Turns a raw `tenantId` into a short, stable, one-way hash safe to attach to
 * spans/metrics as a label (doc 10-observability-and-devops.md §7: "tenant.id
 * as low-cardinality-safe hash"). Two properties matter here:
 *
 *  1. One-way: telemetry backends (traces/metrics vendors, on-call dashboards)
 *     are OUTSIDE the PHI/audit trust boundary in this architecture — they
 *     must never be able to recover a tenant identifier from what they store,
 *     so a raw or reversibly-encoded tenantId can never appear on a span or
 *     metric attribute, full stop.
 *  2. Deterministic + stable: the SAME tenant must always hash to the SAME
 *     value so dashboards can group/filter "all events for tenant X" over
 *     time without ever learning what "X" actually is — a random per-process
 *     salt would make that impossible (every restart would re-shuffle every
 *     tenant's label, silently breaking every saved dashboard/alert).
 *
 * Truncated to 10 hex chars (40 bits) — enough to avoid collisions across the
 * handful of tenants this system will ever have, while staying low-cardinality
 * per the doc's explicit requirement (a full 256-bit hex hash is technically
 * "safe" too, but needlessly wide for a metric label's cardinality budget).
 *
 * Deliberately NOT keyed/HMAC'd: a keyed hash would let whoever holds the key
 * de-anonymize the label, which defeats the point of hashing it in the first
 * place. Plain SHA-256 is a one-way function; that's the whole property we need.
 */
export function hashTenantId(tenantId: string): string {
  return createHash('sha256').update(tenantId).digest('hex').slice(0, 10);
}
