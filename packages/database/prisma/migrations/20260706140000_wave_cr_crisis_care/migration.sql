-- WAVE CR — Clinical Rigor: crisis-care remediations (docs/10-10-PROGRAM.md
-- "WAVE CR", P0 items 1/3/4/5). Purely ADDITIVE: every new column is nullable
-- (or has a safe default), no existing column is altered/dropped, and no
-- table is renamed. Existing rows on RiskFlag/Escalation/SafetyPlan are
-- unaffected and remain fully readable/writable exactly as before.
--
-- RiskFlag.evidenceDetail: structured C-SSRS triage / raw safety-item-answer
-- payload (Posner 2011 C-SSRS), alongside the existing human-readable
-- `evidence` string.
--
-- Escalation.slaDueAt / slaLevelAtResolution.. : real per-severity SLA target
-- (SEVERE 60min / HIGH 4h / else 24h) + SAFE-T/Joint Commission NPSG
-- 15.01.01 structured resolution + Zero Suicide caring-contact follow-up.
--
-- SafetyPlan.*: Stanley-Brown SPI completeness — distraction vs help
-- contacts split, structured means-restriction inventory, crisis-line info,
-- and client-acknowledgment timestamp.

-- AlterTable: RiskFlag
ALTER TABLE "RiskFlag" ADD COLUMN "evidenceDetail" JSONB;

-- AlterTable: Escalation
ALTER TABLE "Escalation" ADD COLUMN "slaDueAt" TIMESTAMP(3);
ALTER TABLE "Escalation" ADD COLUMN "riskLevelAtResolution" "SeverityBand";
ALTER TABLE "Escalation" ADD COLUMN "interventionsApplied" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Escalation" ADD COLUMN "followUpDueAt" TIMESTAMP(3);
ALTER TABLE "Escalation" ADD COLUMN "followUpCompletedAt" TIMESTAMP(3);

-- AlterTable: SafetyPlan
ALTER TABLE "SafetyPlan" ADD COLUMN "distractionContacts" JSONB;
ALTER TABLE "SafetyPlan" ADD COLUMN "helpContacts" JSONB;
ALTER TABLE "SafetyPlan" ADD COLUMN "crisisLineInfo" JSONB;
ALTER TABLE "SafetyPlan" ADD COLUMN "meansRestriction" JSONB;
ALTER TABLE "SafetyPlan" ADD COLUMN "clientAcknowledgedAt" TIMESTAMP(3);
