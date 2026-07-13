# External pen-test readiness pack

VPSY OS target for an external application pen-test (web + API).  
Automated probes: `GET /api/v1/admin/security/status` → `penTest` + `productionFindings`.  
Admin UI: **Security posture** card.

## Scope (in)

- `apps/web` (Next.js portal) + `apps/api` (Nest modular monolith)
- Auth (JWT cookie/bearer, MFA, refresh rotation)
- Clinical ABAC / RBAC surfaces
- Documents presign + blob + virus-scan status
- Messaging, finance webhooks (Stripe signature), telehealth tokens
- Audit chain + SIEM export paths

## Scope (out / infra)

- Cloud account IAM, network ACLs, WAF rules (provide separately)
- BAAs, legal, physical DC
- Mobile clients (none shipped)

## Pre-engagement checklist (ops)

| Item | Status |
|------|--------|
| Dedicated staging with **no real PHI** | ☐ |
| `ALLOW_DEMO_SEED` only if isolated; never on shared prod | ☐ |
| `WEB_ORIGIN` = exact staging origin | ☐ |
| `REDIS_URL` set (shared rate limits) | ☐ |
| Field encryption key or KMS DEK unwrap works | ☐ |
| Swagger disabled (`VPSY_ENABLE_SWAGGER` unset) | ☐ |
| SIEM channel configured (webhook / JSONL / S3) | ☐ |
| Document virus scan real path (not stub) if blobs enabled | ☐ |
| Production boot assertions green (`assertProductionSecurityPosture`) | ☐ |
| Rate-limit / lockout behavior documented for testers | ☐ |
| Break-glass + SLA paths exercised once (audit + SIEM events visible) | ☐ |

## Attack surface inventory (high level)

| Surface | Notes |
|---------|--------|
| `POST /api/v1/auth/login` | Credential stuffing; progressive lockout |
| Refresh cookie family | Rotation + reuse detection |
| MFA enroll/verify | TOTP + recovery codes |
| Clinical routes | ClinicalAccessGuard ABAC |
| `POST /documents/presign-upload` + blob PUT | Signed URLs; size limits |
| Stripe webhook | `rawBody` + signature |
| Socket.IO realtime | Cookie/legacy token shim |
| Admin feature flags | Kill-switch; ADMIN_CONFIG only |
| Audit/SIEM | Integrity + export (not PHI free text) |

## Known intentional constraints (brief testers)

1. **AI never diagnoses autonomously** — human decision gate on recommendations.  
2. **Manager minimum-necessary** is optional (`VPSY_MANAGER_MINIMUM_NECESSARY`).  
3. **Metadata-only documents** are fail-closed in production without blob backend.  
4. **Virus-scan stub** is refused in production without explicit allow.  
5. **Demo seed** refuses production without `ALLOW_DEMO_SEED` + explicit non-PHI allow.

## Exit criteria (engagement)

- No critical/high unmitigated findings on auth, tenancy, or PHI access  
- Medium findings triaged with owners and dates  
- Re-test of criticals  
- SIEM still receiving break-glass / chain-anchor events after fixes  

## Related

- [`STAGING-PHI-RUNBOOK.md`](STAGING-PHI-RUNBOOK.md)  
- [`RESTORE-DRILL-CHECKLIST.md`](RESTORE-DRILL-CHECKLIST.md)  
- Security headers + body limits: `apps/api/src/main.ts`  
- Boot posture: `apps/api/src/common/config/production-security.ts`  
