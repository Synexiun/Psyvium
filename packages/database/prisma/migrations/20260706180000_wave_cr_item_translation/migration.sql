-- WAVE CR — ItemTranslation infrastructure (docs/technical/07-psychometrics-
-- engine.md §9; docs/10-10-PROGRAM.md WAVE CR: "UI i18n is NOT validated
-- clinical-item translation"). Purely ADDITIVE: one new catalog table keyed
-- off Item, no existing column altered or dropped.
--
-- Like Item / QuestionnaireVersion / ItemParameter, ItemTranslation is
-- instrument-catalog data (not PHI) and is deliberately NOT covered by the
-- RLS tenant-isolation backstop (see 20260706120000_rls_tenant_isolation_backstop).
--
-- A row here is served to the assessment UI as a real localization ONLY when
-- its `provenance->>'status'` is 'validated' (enforced in
-- PsychometricsService.getVersionItems, not at the DB layer) — a 'draft' row
-- still falls back to the source-language stem with an honest
-- 'unvalidated-source-language' marker.

-- CreateTable
CREATE TABLE "ItemTranslation" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "stem" TEXT NOT NULL,
    "responseOptions" JSONB NOT NULL DEFAULT '[]',
    "provenance" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ItemTranslation_itemId_idx" ON "ItemTranslation"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "ItemTranslation_itemId_locale_key" ON "ItemTranslation"("itemId", "locale");

-- AddForeignKey
ALTER TABLE "ItemTranslation" ADD CONSTRAINT "ItemTranslation_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
