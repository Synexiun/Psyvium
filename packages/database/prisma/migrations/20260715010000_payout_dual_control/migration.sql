-- Payout approval workflow with dual control (audit G2 "Payouts: approval").
-- COMPUTED → APPROVED (a DIFFERENT user than computedBy) → future disburse;
-- or COMPUTED → REJECTED (with note). Disbursement requires APPROVED.
ALTER TYPE "PayoutStatus" ADD VALUE IF NOT EXISTS 'APPROVED';
ALTER TYPE "PayoutStatus" ADD VALUE IF NOT EXISTS 'REJECTED';

ALTER TABLE "Payout"
  ADD COLUMN IF NOT EXISTS "computedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "approvedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "decisionNote" TEXT;
