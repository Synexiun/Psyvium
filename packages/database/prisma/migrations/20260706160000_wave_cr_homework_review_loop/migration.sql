-- WAVE CR — Clinical Rigor: Kazantzis homework-loop remediation
-- (docs/10-10-PROGRAM.md "WAVE CR", P1). The meta-analytic homework->outcome
-- effect is driven by assignment rationale, difficulty calibration, and
-- clinician review-at-next-session — none of which were modeled. Purely
-- ADDITIVE: new nullable columns on Homework only, no defaults that change
-- existing semantics, no column altered/dropped, no table renamed. Existing
-- Homework rows remain fully readable/writable exactly as before.

-- AlterTable
ALTER TABLE "Homework" ADD COLUMN "rationale" TEXT;
ALTER TABLE "Homework" ADD COLUMN "difficulty" TEXT;
ALTER TABLE "Homework" ADD COLUMN "reviewedAt" TIMESTAMP(3);
ALTER TABLE "Homework" ADD COLUMN "reviewedBy" TEXT;
ALTER TABLE "Homework" ADD COLUMN "reviewNotes" TEXT;
ALTER TABLE "Homework" ADD COLUMN "reviewOutcome" TEXT;
