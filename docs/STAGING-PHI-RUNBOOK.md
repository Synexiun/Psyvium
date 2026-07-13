# Staging PHI readiness runbook

Operational checklist to run a **supervised staging environment** with encryption, email, and document storage — without claiming production GA.

> Clinical principle remains: **AI assists, licensed clinicians decide.**

---

## 1. Required secrets (fail-fast in production)

| Variable | Purpose |
|----------|---------|
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | ≥16 chars each |
| `DATABASE_URL` | Postgres 16 |
| `REDIS_URL` | Shared rate-limit + idempotency (required in prod multi-instance) |
| `VPSY_FIELD_KEY` | `openssl rand -base64 32` — field-level PHI encryption |

Optional deliberate demos only:

- `VPSY_ALLOW_PLAINTEXT_PHI=true` — **never** with real PHI  
- `VPSY_ALLOW_INMEMORY_RATE_LIMIT=true` — single-instance demos only  
- `ALLOW_DEMO_SEED=true` — shared demo passwords (local/CI only)

---

## 2. Transactional email

```bash
RESEND_API_KEY=re_xxx
EMAIL_FROM="Psyvium Staging <noreply@yourdomain.com>"
WEB_ORIGIN=https://staging.yourdomain.com
DPO_ALERT_EMAIL=security@yourdomain.com
```

Without Resend, password resets log console-only and return `devResetToken` in non-production.

---

## 3. Document storage

### Staging (local disk)

```bash
VPSY_DOCUMENT_BLOB_BACKEND=local
VPSY_DOCUMENT_LOCAL_DIR=./data/document-blobs
VPSY_DOCUMENT_SIGNING_SECRET=<random 32+ chars>
```

Flow:

1. `POST /documents/presign-upload`  
2. `PUT` to returned `uploadUrl` (signed local path)  
3. `POST /documents` with `storageKey` from step 1  
4. `POST /documents/:id/presign-download` when scan allows  

### Production-shaped (S3 or MinIO)

```bash
VPSY_DOCUMENT_BLOB_BACKEND=s3
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
VPSY_DOCUMENT_S3_BUCKET=vpsy-docs-staging
# MinIO / path-style:
# VPSY_DOCUMENT_S3_ENDPOINT=http://localhost:9000
# VPSY_DOCUMENT_S3_FORCE_PATH_STYLE=true
```

---

## 4. Malware scan worker

```bash
VPSY_DOCUMENT_VIRUS_SCAN=true
# Staging stub (marks clean; EICAR in key → infected):
VPSY_DOCUMENT_VIRUS_SCAN_STUB=true
# Or ClamAV reachability check (full byte stream still fail-closed until wired):
# CLAMAV_HOST=clamav
# CLAMAV_PORT=3310
```

- Background sweep every 30s for `virusScanStatus=pending`  
- Manual: `POST /documents/:id/virus-scan`  
- Downloads of `infected` rows are **403**  

**Never use the stub against real PHI.** Production stub requires explicit `VPSY_ALLOW_VIRUS_SCAN_STUB_IN_PROD=true`.

---

## 5. Manager minimum-necessary (optional)

```bash
VPSY_MANAGER_MINIMUM_NECESSARY=true
```

Managers then need break-glass for client PHI reads (matching boards stay de-identified).

---

## 6. Migrate + seed (staging)

```bash
pnpm --filter @vpsy/database exec prisma migrate deploy
ALLOW_DEMO_SEED=true pnpm --filter @vpsy/database run seed   # staging only
pnpm --filter @vpsy/api start
```

---

## 7. Smoke checklist

| Check | Expect |
|-------|--------|
| `GET /api/v1/healthz` | 200 |
| `GET /api/v1/documents/status` | `mode: blob` when backend set |
| Password reset with Resend | Email arrives; no `devResetToken` in prod |
| Break-glass | Audit + DPO log/email |
| Field key set | Notes / intake free text / SMS / messages encrypted at rest |
| Virus scan stub | pending → clean (or infected for EICAR key) |

---

## 8. Still required for production PHI GA

- BAAs (host, email, SMS, video, AI, storage)  
- External pen test + remediation  
- Cloud malware stream (S3 → ClamAV/Lambda) end-to-end  
- KMS-backed field keys + rotation  
- PITR restore drill  
- Clinical algorithm sign-off for marketed claims  
- No shared demo seed on any public DB  

---

## 9. Related code

- Email: `apps/api/src/common/email/`  
- Blobs: `apps/api/src/modules/documents/adapters/`  
- Virus scan: `apps/api/src/modules/documents/document-virus-scan.service.ts`  
- Field cipher: `apps/api/src/common/crypto/field-cipher.ts`  
