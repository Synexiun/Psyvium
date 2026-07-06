-- WAVE CR — Post-incident review (Joint Commission NPSG 15.01.01 / TJC
-- sentinel-event review practice; docs/10-10-PROGRAM.md WAVE CR: "the
-- Journey-4 doc promises supervisor review that has no code"). Purely
-- ADDITIVE: one new table, no existing column altered or dropped.
--
-- `subjectId` intentionally has no FK — a review's subject is either an
-- Escalation.id or a BreakGlassGrant.id (see IncidentReview.kind), and
-- Prisma/Postgres have no first-class polymorphic relation. Application code
-- (RiskService) validates the subject exists in the right table before
-- writing the review.
--
-- Does NOT block resolveEscalation/breakGlass — those must stay fast in a
-- crisis. RLS-scoped like the rest of the Risk & Crisis tables (RiskFlag,
-- Escalation, SafetyPlan, BreakGlassGrant) since a review's findings can
-- reference PHI.

-- CreateTable
CREATE TABLE "IncidentReview" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "findings" TEXT NOT NULL,
    "actionItems" JSONB,
    "cosignedBy" TEXT,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "IncidentReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IncidentReview_tenantId_idx" ON "IncidentReview"("tenantId");

-- CreateIndex
CREATE INDEX "IncidentReview_subjectId_idx" ON "IncidentReview"("subjectId");

-- ── RLS tenant-isolation backstop (matches 20260706120000) ──
ALTER TABLE "IncidentReview" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IncidentReview" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "IncidentReview"
  USING ("tenantId" = NULLIF(current_setting('app.current_tenant', true), ''))
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.current_tenant', true), ''));
