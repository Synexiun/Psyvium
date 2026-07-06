-- IRT latent-trait scoring (docs/technical/07-psychometrics-engine.md §3/§5).
-- Purely ADDITIVE: one new catalog table (ItemParameter) + one nullable column
-- on Item (linkId). No existing column is altered or dropped; classical
-- raw-sum scoring is untouched.
--
-- ItemParameter is instrument-catalog data (not PHI) and is deliberately NOT
-- covered by the RLS tenant-isolation backstop — the same documented exclusion
-- as Item / QuestionnaireVersion (see 20260706120000_rls_tenant_isolation_backstop).

-- AlterTable
ALTER TABLE "Item" ADD COLUMN "linkId" TEXT;

-- CreateTable
CREATE TABLE "ItemParameter" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "calibrationId" TEXT NOT NULL DEFAULT 'cal_default',
    "model" "IrtModel" NOT NULL,
    "a" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "b" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "thresholds" DOUBLE PRECISION[] DEFAULT ARRAY[]::DOUBLE PRECISION[],
    "c" DOUBLE PRECISION,
    "seEstimates" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemParameter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ItemParameter_itemId_calibrationId_key" ON "ItemParameter"("itemId", "calibrationId");

-- AddForeignKey
ALTER TABLE "ItemParameter" ADD CONSTRAINT "ItemParameter_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
