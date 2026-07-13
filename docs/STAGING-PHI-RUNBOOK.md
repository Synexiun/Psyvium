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
# Or real ClamAV INSTREAM for local blob objects:
# CLAMAV_HOST=clamav
# CLAMAV_PORT=3310
# VPSY_DOCUMENT_BLOB_BACKEND=local   # required for byte load → clamd
# VPSY_DOCUMENT_VIRUS_SCAN_MAX_BYTES=26214400
```

- Background sweep every 30s for `virusScanStatus=pending`  
- Manual: `POST /documents/:id/virus-scan` (CLIENT_READ; tenant-scoped ops triage)  
- Local + `CLAMAV_HOST`: loads object bytes from the local blob dir and streams zINSTREAM to clamd  
- S3 + `CLAMAV_HOST`: server-side SigV4 GET → same INSTREAM path (in-process; keep max-bytes bound)  
- Downloads of `infected` rows are **403**  
- UI: Admin → Documents card (status + pending queue); Session workspace → client vault (presign upload)  

**Never use the stub against real PHI.** Production stub requires explicit `VPSY_ALLOW_VIRUS_SCAN_STUB_IN_PROD=true`.

---

## 4b. Field-key rotation (env dual-key)

```bash
# After minting a new key, keep the old one for decrypt during re-encrypt window:
VPSY_FIELD_KEY=<new base64 32-byte>
VPSY_FIELD_KEY_ID=v2
VPSY_FIELD_KEY_PREVIOUS=<old base64 32-byte>
VPSY_FIELD_KEY_PREVIOUS_ID=v1
```

New writes get `kid` on the envelope; decrypt tries current then previous.

### KMS-wrapped DEK (production-shaped)

```bash
VPSY_FIELD_KEY_PROVIDER=kms
# 32-byte DEK encrypted with your CMK (aws kms encrypt --key-id ... --plaintext fileb://dek.bin)
VPSY_FIELD_DEK_CIPHERTEXT=<base64 CiphertextBlob>
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
# Optional LocalStack / VPC endpoint:
# VPSY_KMS_ENDPOINT=http://localhost:4566
```

Boot calls `kms:Decrypt` once (pure Node SigV4), caches the DEK in memory. Fail-fast if unwrap fails.

---

## 4c. Daily audit chain anchor

```bash
# Enabled by default. Disable cron only:
VPSY_AUDIT_DAILY_ANCHOR=false
```

- Cron: midnight UTC tip-hash anchor per tenant (`audit.daily_anchor`)  
- Ops: `GET /api/v1/audit/chain/verify`, `POST /api/v1/audit/chain/anchor` (AUDIT_READ)  
- Broken chains publish `audit.chain_broken` → DPO email + SIEM  

---

## 4d. SIEM export

```bash
VPSY_SIEM_WEBHOOK_URL=https://siem.example/ingest
VPSY_SIEM_WEBHOOK_SECRET=<hmac secret>
# and/or append-only JSONL:
VPSY_SIEM_LOCAL_DIR=./data/siem-export
# and/or immutable per-event S3 objects (enable Object Lock on the bucket for true WORM):
VPSY_SIEM_S3_BUCKET=vpsy-siem-archive
# VPSY_SIEM_S3_OBJECT_LOCK_MODE=GOVERNANCE
# VPSY_SIEM_S3_OBJECT_LOCK_DAYS=2555
DPO_ALERT_EMAIL=security@example.com
```

Emitted (PHI-minimized): break-glass, escalation assigned, SLA breach, daily audit anchors, chain broken.

## 4e. Production boot refusals

In `NODE_ENV=production` the API refuses to start when:

- `ALLOW_DEMO_SEED=true` without `VPSY_ALLOW_DEMO_SEED_IN_PROD=true`
- Swagger enabled without `VPSY_ALLOW_SWAGGER_IN_PROD=true`
- Virus-scan stub without `VPSY_ALLOW_VIRUS_SCAN_STUB_IN_PROD=true`
- `VPSY_ALLOW_PLAINTEXT_PHI=true`

See `apps/api/src/common/config/production-security.ts` and [`PEN-TEST-READINESS.md`](PEN-TEST-READINESS.md).

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
| Admin Documents card | mode blob + pending queue + client vault load |
| Session document vault | upload → pending/clean → download clean only |
| ClamAV local | clean file → clean; EICAR bytes → infected |
| `GET /audit/chain/verify` | `{ ok: true }` on healthy chain |
| SIEM local dir | JSONL line after break-glass or daily anchor |

---

## 8b. Field re-encrypt after DEK rotation

```bash
# Keep previous key for decrypt, set new active key, then:
VPSY_FIELD_REENCRYPT=true
# Optional background seal of leftover plaintext:
# VPSY_FIELD_REENCRYPT_SEAL_PLAINTEXT=true

# Or one-shot (ADMIN):
# POST /api/v1/admin/security/field-reencrypt
# POST /api/v1/admin/security/field-reencrypt?sealPlaintext=true
# POST /api/v1/admin/security/field-reencrypt?scope=all
```

Covers SessionNote, SafetyPlan, Message, SmsMessage, Intake free text, User.mfaSecret.

## 8c. Restore drill

See [`RESTORE-DRILL-CHECKLIST.md`](RESTORE-DRILL-CHECKLIST.md) and Admin → Security posture.

---

## 8d. Clinical validation + BAA registers

- Algorithms: [`CLINICAL-VALIDATION-REGISTER.md`](CLINICAL-VALIDATION-REGISTER.md) · `GET /admin/clinical/validation-register`  
- Vendors: [`VENDOR-BAA-REGISTER.md`](VENDOR-BAA-REGISTER.md) · `GET /admin/compliance/vendors`  
- Overrides: `VPSY_CLINICAL_SIGNOFF_JSON`, `VPSY_BAA_STATUS_JSON`  

---

## 8. Still required for production PHI GA

- **Signed** BAAs/DPAs recorded in the vendor register (inventory is live; signatures are legal)  
- External pen test execution + remediation (readiness pack: [`PEN-TEST-READINESS.md`](PEN-TEST-READINESS.md))  
- Dedicated stream worker for multi-GB fleets (API in-process S3→ClamAV is fine for staging/single-node)  
- Bucket-level Object Lock / compliance mode on SIEM S3 (app can send lock headers when enabled)  
- Operator-attested PITR restore drill (checklist + automated probes are live)  
- Clinical board **sign-off** for any marketed claims (register + overrides live)  
- No shared demo seed on any public DB 

---

## 9. Related code

- Email: `apps/api/src/common/email/`  
- Blobs: `apps/api/src/modules/documents/adapters/`  
- Virus scan: `apps/api/src/modules/documents/document-virus-scan.service.ts`  
- Field cipher: `apps/api/src/common/crypto/field-cipher.ts`  
