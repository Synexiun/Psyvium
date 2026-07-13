-- A client can have only one open matching lifecycle at a time. This is the
-- database backstop for concurrent intake retries and approvals; service-level
-- checks alone cannot prevent two different proposal rows from both winning.
--
-- The migration intentionally fails if legacy duplicate open assignments
-- exist. Those records require an explicit clinical/operational decision
-- (close or transfer the superseded assignment), never automatic deletion.
CREATE UNIQUE INDEX "Assignment_one_open_per_client"
  ON "Assignment" ("tenantId", "clientId")
  WHERE "deletedAt" IS NULL
    AND "status" IN ('PROPOSED', 'APPROVED', 'ACTIVE');
