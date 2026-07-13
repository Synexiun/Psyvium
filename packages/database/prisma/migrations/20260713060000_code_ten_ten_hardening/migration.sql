-- Clinical deterioration risk type (outcomes RCI reliably-worsened path).
ALTER TYPE "RiskType" ADD VALUE IF NOT EXISTS 'CLINICAL_DETERIORATION';

-- Account lockout + MFA recovery hashes (doc 06).
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lockedUntil" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "mfaRecoveryHashes" JSONB NOT NULL DEFAULT '[]';

-- Consent policy content hash (prove what was shown).
ALTER TABLE "Consent"
  ADD COLUMN IF NOT EXISTS "policyContentHash" TEXT;

-- Session note version uniqueness (race-safe append).
CREATE UNIQUE INDEX IF NOT EXISTS "SessionNote_sessionId_version_key"
  ON "SessionNote"("sessionId", "version");

-- Safety plan version uniqueness per client.
CREATE UNIQUE INDEX IF NOT EXISTS "SafetyPlan_clientId_version_key"
  ON "SafetyPlan"("clientId", "version");
