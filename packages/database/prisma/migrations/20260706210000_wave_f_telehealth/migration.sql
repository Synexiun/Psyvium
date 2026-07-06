-- WAVE F — Telehealth (context 12, `08-telehealth-and-realtime.md`), the
-- LAST unbuilt bounded context. Purely ADDITIVE: one new table, no existing
-- column altered or dropped.
--
-- `TeleSession` is the connectivity/media lifecycle layer (waiting room ->
-- live LiveKit room -> ended) — parallel to, and never mutating, the
-- existing `Session` (clinical encounter/note anchor) table. `roomName` is
-- globally unique (one LiveKit room per session attempt); `status` is a
-- plain TEXT column (DTO-validated, see TeleSessionStatus) so a future state
-- never needs a migration, matching `IncidentReview.kind`'s convention.
--
-- RLS-scoped like every other tenant-scoped clinical table (Appointment,
-- Session, RiskFlag, ...) since a session's participant linkage and event
-- log can reference PHI.

-- CreateTable
CREATE TABLE "TeleSession" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "psychologistId" TEXT NOT NULL,
    "roomName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "participantEvents" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "TeleSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TeleSession_roomName_key" ON "TeleSession"("roomName");

-- CreateIndex
CREATE INDEX "TeleSession_tenantId_status_idx" ON "TeleSession"("tenantId", "status");

-- CreateIndex
CREATE INDEX "TeleSession_appointmentId_idx" ON "TeleSession"("appointmentId");

-- CreateIndex
CREATE INDEX "TeleSession_clientId_idx" ON "TeleSession"("clientId");

-- CreateIndex
CREATE INDEX "TeleSession_psychologistId_idx" ON "TeleSession"("psychologistId");

-- AddForeignKey
ALTER TABLE "TeleSession" ADD CONSTRAINT "TeleSession_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeleSession" ADD CONSTRAINT "TeleSession_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeleSession" ADD CONSTRAINT "TeleSession_psychologistId_fkey" FOREIGN KEY ("psychologistId") REFERENCES "Psychologist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── RLS tenant-isolation backstop (matches 20260706190000) ──
ALTER TABLE "TeleSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TeleSession" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "TeleSession"
  USING ("tenantId" = NULLIF(current_setting('app.current_tenant', true), ''))
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.current_tenant', true), ''));
