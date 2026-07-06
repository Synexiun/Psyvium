-- WAVE CR — Clinical Rigor: coded Formulation/Diagnosis + golden-thread
-- enforcement (docs/10-10-PROGRAM.md "WAVE CR", P0 items 7/8, plus the
-- cheap P1 amendment-semantics item). Purely ADDITIVE: new enum, new table,
-- new nullable columns with safe defaults. No existing column is
-- altered/dropped, no table is renamed. Existing SessionNote/
-- DiagnosisHypothesis/TreatmentPlan rows are unaffected and remain fully
-- readable/writable exactly as before.

-- CreateEnum
CREATE TYPE "FormulationStatus" AS ENUM ('PROVISIONAL', 'CONFIRMED', 'RULED_OUT');

-- CreateTable: Formulation — the clinician's ACTUAL coded diagnosis
-- (DSM-5-TR/ICD-10/11), distinct from the assistive DiagnosisHypothesis
-- differential. No AI-write path exists to this table anywhere in the code.
CREATE TABLE "Formulation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "icdCode" TEXT NOT NULL,
    "dsmCode" TEXT,
    "description" TEXT NOT NULL,
    "status" "FormulationStatus" NOT NULL DEFAULT 'PROVISIONAL',
    "basedOnHypothesisId" TEXT,
    "specifiers" JSONB,
    "onsetDate" TIMESTAMP(3),
    "resolvedDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Formulation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Formulation_tenantId_clientId_idx" ON "Formulation"("tenantId", "clientId");

-- AddForeignKey
ALTER TABLE "Formulation" ADD CONSTRAINT "Formulation_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Formulation" ADD CONSTRAINT "Formulation_basedOnHypothesisId_fkey" FOREIGN KEY ("basedOnHypothesisId") REFERENCES "DiagnosisHypothesis"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: SessionNote — golden-thread anchors (diagnosis -> plan -> note)
-- plus note-time snapshot fields and amendment semantics.
ALTER TABLE "SessionNote" ADD COLUMN "planId" TEXT;
ALTER TABLE "SessionNote" ADD COLUMN "goalIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "SessionNote" ADD COLUMN "formulationId" TEXT;
ALTER TABLE "SessionNote" ADD COLUMN "riskStatusAtNote" TEXT;
ALTER TABLE "SessionNote" ADD COLUMN "sessionSnapshot" JSONB;
ALTER TABLE "SessionNote" ADD COLUMN "amendsVersionId" TEXT;
ALTER TABLE "SessionNote" ADD COLUMN "amendmentReason" TEXT;

-- CreateIndex
CREATE INDEX "SessionNote_planId_idx" ON "SessionNote"("planId");

-- AddForeignKey
ALTER TABLE "SessionNote" ADD CONSTRAINT "SessionNote_planId_fkey" FOREIGN KEY ("planId") REFERENCES "TreatmentPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SessionNote" ADD CONSTRAINT "SessionNote_formulationId_fkey" FOREIGN KEY ("formulationId") REFERENCES "Formulation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
