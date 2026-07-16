-- Assessment assignment workflow (doc 07 §9): clinician assigns a published
-- instrument version to a client; the client completes it from their
-- dashboard; the clinician reviews answers + score + governed AI briefing.
CREATE TABLE IF NOT EXISTS "AssessmentAssignment" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "questionnaireVersionId" TEXT NOT NULL,
  "assignedBy" TEXT NOT NULL,
  "note" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ASSIGNED',
  "dueAt" TIMESTAMP(3),
  "responseId" TEXT,
  "completedAt" TIMESTAMP(3),
  "cancelledBy" TEXT,
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),

  CONSTRAINT "AssessmentAssignment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AssessmentAssignment_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AssessmentAssignment_questionnaireVersionId_fkey"
    FOREIGN KEY ("questionnaireVersionId") REFERENCES "QuestionnaireVersion"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "AssessmentAssignment_responseId_key"
  ON "AssessmentAssignment"("responseId");
CREATE INDEX IF NOT EXISTS "AssessmentAssignment_tenantId_clientId_status_idx"
  ON "AssessmentAssignment"("tenantId", "clientId", "status");
CREATE INDEX IF NOT EXISTS "AssessmentAssignment_tenantId_status_createdAt_idx"
  ON "AssessmentAssignment"("tenantId", "status", "createdAt");

-- Tenant-isolation backstop (same pattern as the other PHI tables).
ALTER TABLE "AssessmentAssignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AssessmentAssignment" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "assessment_assignment_tenant_isolation" ON "AssessmentAssignment";
CREATE POLICY "assessment_assignment_tenant_isolation" ON "AssessmentAssignment"
  USING ("tenantId" = NULLIF(current_setting('app.current_tenant', true), ''))
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.current_tenant', true), ''));
