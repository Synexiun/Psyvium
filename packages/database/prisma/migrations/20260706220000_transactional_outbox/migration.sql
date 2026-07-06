-- Transactional outbox (ADR-005, doc 00-architecture-overview.md §"Event
-- delivery"). Today the in-process EventBus publishes AFTER a $transaction
-- commits — a crash between commit and publish silently drops events (risk
-- escalations, payment captures, realtime pushes). Purely ADDITIVE: one new
-- table, no existing column altered or dropped.
--
-- `EventBus.publishDurable(tx, ...)` writes a row here USING THE CALLER'S
-- transaction client, so "state changed <=> event exists" is a DB-level
-- guarantee. `OutboxRelayService` (an @Interval sweep, ~2s) then republishes
-- PENDING rows through the existing in-process `EventBus.publish()` so all
-- current subscribers (realtime bridge, metrics bridge, matching) keep
-- working unchanged. RLS-scoped like every other tenant-owned table — the
-- JSON payload can carry PHI-adjacent ids/refs.

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id"          TEXT NOT NULL,
    "tenantId"    TEXT NOT NULL,
    "eventName"   TEXT NOT NULL,
    "payload"     JSONB NOT NULL,
    "status"      TEXT NOT NULL DEFAULT 'PENDING',
    "attempts"    INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "lastError"   TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OutboxEvent_status_availableAt_idx" ON "OutboxEvent"("status", "availableAt");

-- CreateIndex
CREATE INDEX "OutboxEvent_tenantId_idx" ON "OutboxEvent"("tenantId");

-- ── RLS tenant-isolation backstop (matches 20260706120000 / 20260706190000) ──
ALTER TABLE "OutboxEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OutboxEvent" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "OutboxEvent"
  USING ("tenantId" = NULLIF(current_setting('app.current_tenant', true), ''))
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.current_tenant', true), ''));
