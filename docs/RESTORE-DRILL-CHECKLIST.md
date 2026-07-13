# PITR / restore drill checklist

Use this after any staging or production restore. Automated probes are also exposed at:

- `GET /api/v1/admin/security/status` → `restoreDrill`
- Admin portal → **Security posture** card

## Before restore

1. Confirm a snapshot / PITR point exists for the target database.
2. Confirm field encryption material is available for the restored epoch:
   - Env DEK: `VPSY_FIELD_KEY` (+ previous key if rotating)
   - Or KMS: `VPSY_FIELD_KEY_PROVIDER=kms` + `VPSY_FIELD_DEK_CIPHERTEXT`
3. Prepare an **isolated** restore target (never overwrite live write path first).

## Restore steps

| Step | Owner | Done |
|------|-------|------|
| Restore DB to isolated instance | Ops | ☐ |
| Point staging API `DATABASE_URL` at restored DB | Ops | ☐ |
| `pnpm --filter @vpsy/database exec prisma migrate deploy` | Ops | ☐ |
| Boot API; confirm healthz 200 | Ops | ☐ |
| `GET /admin/security/status` — field cipher active | Ops | ☐ |
| `GET /admin/security/status` — audit chain ok | Ops | ☐ |
| Clinician login + caseload read | Clin/ops | ☐ |
| Document status mode=blob (if PHI files in scope) | Ops | ☐ |
| Optional: `POST /admin/security/field-reencrypt` after key rotation | Ops | ☐ |
| Record measured **RTO** / **RPO** | Ops | ☐ |
| SIEM receives a test break-glass or daily anchor event | Sec | ☐ |

## After restore

- Do **not** re-seed demo data on a restore that will be promoted.
- Keep previous DEK configured until re-encrypt reports `rewritten` complete and errors=0.
- Export daily audit tip hashes to SIEM/WORM before discarding the restore environment.

## Automated vs manual

See `restoreDrill.items[]` from security status:

- **pass / fail / warn** — API probes
- **manual** — require human attestation (this document)
