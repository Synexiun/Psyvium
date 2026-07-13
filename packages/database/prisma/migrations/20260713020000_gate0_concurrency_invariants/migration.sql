-- Gate 0 concurrency backstops (production-readiness audit 2026-07-12).
-- Service-level checks alone cannot prevent two concurrent writers from both
-- winning a money or clinical state transition. These partial unique indexes
-- are the database-enforced arbiter.

-- At most one captured payment per invoice (double-capture of OPEN→PAID).
-- Failed / requires_payment_method attempts may still stack as history.
CREATE UNIQUE INDEX IF NOT EXISTS "Payment_one_captured_per_invoice"
  ON "Payment" ("tenantId", "invoiceId")
  WHERE "deletedAt" IS NULL
    AND "status" = 'captured';

-- At most one active treatment plan per client (concurrent plan creation).
CREATE UNIQUE INDEX IF NOT EXISTS "TreatmentPlan_one_active_per_client"
  ON "TreatmentPlan" ("tenantId", "clientId")
  WHERE "deletedAt" IS NULL
    AND "status" = 'active';
