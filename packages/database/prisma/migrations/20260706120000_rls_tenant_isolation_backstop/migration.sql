-- RLS tenant-isolation backstop (docs/technical/00-architecture-overview.md
-- §4 "Multi-tenancy model", 02-data-model.md, 06-security-and-rbac.md).
-- Defense-in-depth: even if application code forgets a `where: { tenantId }`
-- filter, Postgres itself refuses to return/accept rows for another tenant.
--
-- Context-setting mechanism (app side): apps/api sets the TRANSACTION-LOCAL
-- GUC `app.current_tenant` (`SELECT set_config('app.current_tenant', $1,
-- true)`) before every model operation, driven by the authenticated
-- principal's tenantId — see apps/api/src/common/prisma/tenant-context.ts
-- (AsyncLocalStorage), apps/api/src/common/tenant-context.interceptor.ts
-- (global NestJS interceptor, populates it from `req.principal.tenantId`),
-- and apps/api/src/common/prisma/rls.extension.ts (the Prisma Client
-- Extension that actually issues the `set_config` immediately before each
-- query, on the same connection/transaction).
--
-- FORCE ROW LEVEL SECURITY is required (not just ENABLE): the `vpsy` role
-- that owns every table below is not a superuser and does not have
-- BYPASSRLS, but Postgres exempts a table OWNER from its own RLS policies
-- unless FORCE is also set — without FORCE the app's own connection would
-- silently see every tenant's rows.
--
-- Policy shapes used below:
--   STRICT        tenant_id must equal the GUC. No exceptions. An unset GUC
--                 (NULL, normalized from '') yields ZERO rows on SELECT and
--                 a rejected write on INSERT/UPDATE — the fail-safe
--                 direction for PHI (never "all tenants").
--   STRICT+UNSET  tenant_id must equal the GUC, OR the GUC is unset. Reserved
--                 for the handful of tables touched by the UNAUTHENTICATED
--                 pre-auth flows (POST /auth/login, POST /auth/register —
--                 apps/api/src/auth/auth.service.ts), which run before any
--                 JwtAuthGuard/tenant context exists: User (cross-tenant
--                 email lookup on login is intentional), AuditEvent (audit
--                 records written from those same flows). RoleAssignment
--                 (no tenantId column) gets the same exception via a
--                 join to User, below.
--   NULLABLE      tenant_id IS NULL (shared/global reference row) OR matches
--                 the GUC. For ItemBank / Questionnaire / FeatureFlag.
--   JOIN          no tenantId column; enforced via EXISTS against the
--                 tenant-scoped parent row. For EmergencyContact/Consent
--                 (→ Client), Credential (→ Psychologist), Message (→ Thread).
--
-- Intentionally EXCLUDED from RLS (documented, not an oversight):
--   Tenant                          the tenant directory itself — nothing
--                                   scopes a Tenant row to another Tenant.
--   Role, Permission, RolePermission  global RBAC reference data, shared by
--                                   every tenant.
--   AIModelVersion, PromptVersion   global model/prompt registries.
--   PopulationMetric                de-identified national aggregate; no
--                                   tenantId by design (doc 02-data-model.md).
--   Item, QuestionnaireVersion      instrument-definition/catalog data (not
--                                   PHI), joined only through the already-
--                                   nullable ItemBank/Questionnaire — a
--                                   2-hop EXISTS for comparatively low
--                                   sensitivity data. Residual/follow-up.

-- ── Enable + FORCE RLS on every strict tenant-scoped table ──
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'Clinic','User','Client','Psychologist','Contract','Intake','ScreeningResult',
    'ClinicalProfile','Assignment','AvailabilitySlot','Appointment','Session','SessionNote',
    'DiagnosisHypothesis','TreatmentPlan','Goal','Intervention','Homework','OutcomeMeasure',
    'RiskFlag','Escalation','SafetyPlan','BreakGlassGrant','QuestionnaireResponse',
    'PsychometricScore','WearableDevice','WearableMetric','Thread','Document','Report',
    'Invoice','Payment','LedgerAccount','AccountingEntry','RevenueShareRule','Payout',
    'AIRecommendation','AuditEvent','PipelineStage','Referrer','Campaign','Lead',
    'EngagementActivity','PhoneNumber','CallSession','SmsMessage','MediaMessage'
  ])
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- ── STRICT policy — every table above EXCEPT User and AuditEvent (those two
--    get the STRICT+UNSET exception, created separately below) ──
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'Clinic','Client','Psychologist','Contract','Intake','ScreeningResult',
    'ClinicalProfile','Assignment','AvailabilitySlot','Appointment','Session','SessionNote',
    'DiagnosisHypothesis','TreatmentPlan','Goal','Intervention','Homework','OutcomeMeasure',
    'RiskFlag','Escalation','SafetyPlan','BreakGlassGrant','QuestionnaireResponse',
    'PsychometricScore','WearableDevice','WearableMetric','Thread','Document','Report',
    'Invoice','Payment','LedgerAccount','AccountingEntry','RevenueShareRule','Payout',
    'AIRecommendation','PipelineStage','Referrer','Campaign','Lead',
    'EngagementActivity','PhoneNumber','CallSession','SmsMessage','MediaMessage'
  ])
  LOOP
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("tenantId" = NULLIF(current_setting(''app.current_tenant'', true), '''')) WITH CHECK ("tenantId" = NULLIF(current_setting(''app.current_tenant'', true), ''''))',
      t
    );
  END LOOP;
END $$;

-- ── STRICT+UNSET — User, AuditEvent (unauthenticated login/register touch
--    these before any tenant context is established) ──
CREATE POLICY tenant_isolation ON "User"
  USING (
    "tenantId" = NULLIF(current_setting('app.current_tenant', true), '')
    OR NULLIF(current_setting('app.current_tenant', true), '') IS NULL
  )
  WITH CHECK (
    "tenantId" = NULLIF(current_setting('app.current_tenant', true), '')
    OR NULLIF(current_setting('app.current_tenant', true), '') IS NULL
  );

CREATE POLICY tenant_isolation ON "AuditEvent"
  USING (
    "tenantId" = NULLIF(current_setting('app.current_tenant', true), '')
    OR NULLIF(current_setting('app.current_tenant', true), '') IS NULL
  )
  WITH CHECK (
    "tenantId" = NULLIF(current_setting('app.current_tenant', true), '')
    OR NULLIF(current_setting('app.current_tenant', true), '') IS NULL
  );

-- ── RoleAssignment — no tenantId column; join to User, same unset exception
--    (read inside AuthService#issueTokens for both login and register) ──
ALTER TABLE "RoleAssignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RoleAssignment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RoleAssignment"
  USING (
    NULLIF(current_setting('app.current_tenant', true), '') IS NULL
    OR EXISTS (
      SELECT 1 FROM "User" u
      WHERE u.id = "RoleAssignment"."userId"
        AND u."tenantId" = NULLIF(current_setting('app.current_tenant', true), '')
    )
  )
  WITH CHECK (
    NULLIF(current_setting('app.current_tenant', true), '') IS NULL
    OR EXISTS (
      SELECT 1 FROM "User" u
      WHERE u.id = "RoleAssignment"."userId"
        AND u."tenantId" = NULLIF(current_setting('app.current_tenant', true), '')
    )
  );

-- ── NULLABLE — shared/global reference data with an optional tenant owner ──
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['ItemBank','Questionnaire','FeatureFlag'])
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("tenantId" IS NULL OR "tenantId" = NULLIF(current_setting(''app.current_tenant'', true), '''')) WITH CHECK ("tenantId" IS NULL OR "tenantId" = NULLIF(current_setting(''app.current_tenant'', true), ''''))',
      t
    );
  END LOOP;
END $$;

-- ── JOIN — no tenantId column; strict via EXISTS against the tenant-scoped
--    parent (no unset exception; these are never touched pre-auth) ──
ALTER TABLE "EmergencyContact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EmergencyContact" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "EmergencyContact"
  USING (EXISTS (SELECT 1 FROM "Client" c WHERE c.id = "EmergencyContact"."clientId" AND c."tenantId" = NULLIF(current_setting('app.current_tenant', true), '')))
  WITH CHECK (EXISTS (SELECT 1 FROM "Client" c WHERE c.id = "EmergencyContact"."clientId" AND c."tenantId" = NULLIF(current_setting('app.current_tenant', true), '')));

ALTER TABLE "Consent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Consent" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Consent"
  USING (EXISTS (SELECT 1 FROM "Client" c WHERE c.id = "Consent"."clientId" AND c."tenantId" = NULLIF(current_setting('app.current_tenant', true), '')))
  WITH CHECK (EXISTS (SELECT 1 FROM "Client" c WHERE c.id = "Consent"."clientId" AND c."tenantId" = NULLIF(current_setting('app.current_tenant', true), '')));

ALTER TABLE "Credential" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Credential" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Credential"
  USING (EXISTS (SELECT 1 FROM "Psychologist" p WHERE p.id = "Credential"."psychologistId" AND p."tenantId" = NULLIF(current_setting('app.current_tenant', true), '')))
  WITH CHECK (EXISTS (SELECT 1 FROM "Psychologist" p WHERE p.id = "Credential"."psychologistId" AND p."tenantId" = NULLIF(current_setting('app.current_tenant', true), '')));

ALTER TABLE "Message" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Message" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Message"
  USING (EXISTS (SELECT 1 FROM "Thread" th WHERE th.id = "Message"."threadId" AND th."tenantId" = NULLIF(current_setting('app.current_tenant', true), '')))
  WITH CHECK (EXISTS (SELECT 1 FROM "Thread" th WHERE th.id = "Message"."threadId" AND th."tenantId" = NULLIF(current_setting('app.current_tenant', true), '')));
