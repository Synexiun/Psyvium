-- WAVE C — Computerized Adaptive Testing session state
-- (docs/technical/07-psychometrics-engine.md §6). Purely ADDITIVE: one new
-- table, no existing column altered or dropped.
--
-- `responseId` intentionally has no FK — it links the QuestionnaireResponse
-- persisted on completion (same polymorphic-lite precedent as
-- IncidentReview.subjectId); application code (CatService) owns the integrity.
--
-- Holds PHI (clientId + raw item answers), so the RLS tenant-isolation
-- backstop applies — note `prisma db push` does NOT run this raw SQL, so the
-- RLS block below must be applied manually on push-managed databases (see the
-- 20260706120000_rls_tenant_isolation_backstop pattern).

-- CreateTable
CREATE TABLE "CatSession" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "administeredItemIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "answers" JSONB NOT NULL DEFAULT '{}',
    "thetaHistory" JSONB NOT NULL DEFAULT '[]',
    "currentTheta" DOUBLE PRECISION,
    "currentSE" DOUBLE PRECISION,
    "terminationReason" TEXT,
    "responseId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CatSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CatSession_responseId_key" ON "CatSession"("responseId");

-- CreateIndex
CREATE INDEX "CatSession_tenantId_idx" ON "CatSession"("tenantId");

-- CreateIndex
CREATE INDEX "CatSession_clientId_startedAt_idx" ON "CatSession"("clientId", "startedAt");

-- ── RLS tenant-isolation backstop (matches 20260706120000) ──
ALTER TABLE "CatSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CatSession" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "CatSession"
  USING ("tenantId" = NULLIF(current_setting('app.current_tenant', true), ''))
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.current_tenant', true), ''));
