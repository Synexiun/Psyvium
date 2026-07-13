-- SMS STOP/opt-out suppression list (doc 15 §4).
CREATE TABLE IF NOT EXISTS "SmsOptOut" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "e164" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'KEYWORD',
  "reason" TEXT,
  "optedOutAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "optedInAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SmsOptOut_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SmsOptOut_tenantId_e164_key"
  ON "SmsOptOut"("tenantId", "e164");

CREATE INDEX IF NOT EXISTS "SmsOptOut_tenantId_optedInAt_idx"
  ON "SmsOptOut"("tenantId", "optedInAt");
