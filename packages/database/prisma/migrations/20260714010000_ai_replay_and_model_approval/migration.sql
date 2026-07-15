-- WAVE CR (10-10 program): true AI replay + real model-approval columns.
-- 1) Persist the de-identified signal bundle (not just its hash) so any
--    recommendation can be replayed and audited months later (doc 05 §5).
ALTER TABLE "AIRecommendation"
  ADD COLUMN IF NOT EXISTS "inputSignals" JSONB NOT NULL DEFAULT '{}';

-- 2) Promote approvedForProduction/approvedBy from registry-JSON aspiration
--    to real columns (doc 05 §5, doc 12 §6 — no production model without a
--    passing eval run + clinical governance sign-off).
ALTER TABLE "AIModelVersion"
  ADD COLUMN IF NOT EXISTS "approvedForProduction" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "approvedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3);
