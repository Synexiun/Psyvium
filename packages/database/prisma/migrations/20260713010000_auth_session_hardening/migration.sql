-- Tenant-aware onboarding and stateful authentication sessions.
--
-- Tenant.slug is intentionally nullable: existing tenants must explicitly
-- choose a public routing identifier before they can accept registrations.
-- Public registration is opt-in and defaults off.
ALTER TABLE "Tenant"
  ADD COLUMN "slug" TEXT,
  ADD COLUMN "selfRegistrationEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

ALTER TABLE "User"
  ADD COLUMN "authVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "mfaPendingSecret" TEXT;

-- Preserve the original Prisma constraint while also preventing identities
-- that differ only by case/outer whitespace inside one tenant.
CREATE UNIQUE INDEX "User_tenantId_email_normalized_key"
  ON "User" ("tenantId", lower(btrim("email")));

CREATE INDEX "User_tenantId_status_idx" ON "User"("tenantId", "status");

CREATE TABLE "RefreshSession" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "familyId" TEXT NOT NULL,
  "tokenHash" VARCHAR(64) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "lastUsedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "replacedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "userAgent" VARCHAR(512),
  "ipHash" VARCHAR(64),

  CONSTRAINT "RefreshSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RefreshSession_tenantId_fkey" FOREIGN KEY ("tenantId")
    REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RefreshSession_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "RefreshSession_tokenHash_key" ON "RefreshSession"("tokenHash");
CREATE INDEX "RefreshSession_tenantId_userId_idx" ON "RefreshSession"("tenantId", "userId");
CREATE INDEX "RefreshSession_familyId_idx" ON "RefreshSession"("familyId");
CREATE INDEX "RefreshSession_expiresAt_idx" ON "RefreshSession"("expiresAt");

-- Refresh and logout are pre-authentication operations. The unset-context
-- branch is narrowly acceptable because every lookup is bound to the
-- cryptographically signed session id, tenant id, user id and token digest.
ALTER TABLE "RefreshSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RefreshSession" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RefreshSession"
  USING (
    "tenantId" = NULLIF(current_setting('app.current_tenant', true), '')
    OR NULLIF(current_setting('app.current_tenant', true), '') IS NULL
  )
  WITH CHECK (
    "tenantId" = NULLIF(current_setting('app.current_tenant', true), '')
    OR NULLIF(current_setting('app.current_tenant', true), '') IS NULL
  );

-- Keep the development/demo tenant usable without baking its id into runtime
-- auth code. Real tenants remain opt-in and must configure their own slug.
UPDATE "Tenant"
SET "slug" = 'vpsy-demo', "selfRegistrationEnabled" = true
WHERE "id" = 'tenant_demo' AND "slug" IS NULL;
