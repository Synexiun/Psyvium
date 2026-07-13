-- Instrument licensing grants (doc 07 §2).
CREATE TABLE IF NOT EXISTS "InstrumentLicenseGrant" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "questionnaireId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "jurisdiction" TEXT,
  "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "InstrumentLicenseGrant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InstrumentLicenseGrant_questionnaireId_fkey"
    FOREIGN KEY ("questionnaireId") REFERENCES "Questionnaire"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "InstrumentLicenseGrant_tenantId_questionnaireId_key"
  ON "InstrumentLicenseGrant"("tenantId", "questionnaireId");

CREATE INDEX IF NOT EXISTS "InstrumentLicenseGrant_tenantId_status_idx"
  ON "InstrumentLicenseGrant"("tenantId", "status");

-- Treatment plan client acknowledgment.
ALTER TABLE "TreatmentPlan"
  ADD COLUMN IF NOT EXISTS "clientAcknowledgedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "clientAcknowledgedBy" TEXT;

-- SMS templates.
CREATE TABLE IF NOT EXISTS "SmsTemplate" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "locale" TEXT NOT NULL DEFAULT 'en',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SmsTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SmsTemplate_tenantId_key_locale_key"
  ON "SmsTemplate"("tenantId", "key", "locale");

CREATE INDEX IF NOT EXISTS "SmsTemplate_tenantId_active_idx"
  ON "SmsTemplate"("tenantId", "active");
