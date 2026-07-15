-- WAVE D (10-10 program): doc 02 AuditEvent forensic fields. All nullable —
-- populated where the call site actually knows them, never fabricated.
-- Historical rows stay valid: chain verification checks prevHash linkage,
-- and new-row hashes simply cover the extra material.
ALTER TABLE "AuditEvent"
  ADD COLUMN IF NOT EXISTS "licenseSnapshot" JSONB,
  ADD COLUMN IF NOT EXISTS "jurisdiction" TEXT,
  ADD COLUMN IF NOT EXISTS "purpose" TEXT,
  ADD COLUMN IF NOT EXISTS "consentRef" TEXT,
  ADD COLUMN IF NOT EXISTS "abacRuleMatched" TEXT,
  ADD COLUMN IF NOT EXISTS "deviceId" TEXT,
  ADD COLUMN IF NOT EXISTS "sessionId" TEXT,
  ADD COLUMN IF NOT EXISTS "authLevel" TEXT,
  ADD COLUMN IF NOT EXISTS "obligations" JSONB;
