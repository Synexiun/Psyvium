# Vendor BAA / DPA register

Engineering inventory: `apps/api/src/common/compliance/vendor-baa-register.ts`  
API: `GET /api/v1/admin/compliance/vendors`  
Admin UI: **Subprocessors** card  

## Purpose

Track every subprocessor that may touch PHI or special-category data before production PHI GA.  
Statuses default to **honest unsigned** until legal records a signed agreement.

## Status values

| Status | Meaning |
|--------|---------|
| `required-not-signed` | Needed before production PHI |
| `signed` | BAA/DPA on file |
| `under-negotiation` | In progress |
| `not-required` | Counsel determined not required |
| `n-a-self-hosted` | In-boundary self-hosted component |

## Recording status

```bash
VPSY_BAA_STATUS_JSON='{
  "resend": { "status": "signed", "signedAt": "2026-07-15", "agreementRef": "BAA-RESEND-001" },
  "twilio": { "status": "under-negotiation" },
  "aws-s3": { "status": "signed", "agreementRef": "AWS-HIPAA-BAA" }
}'
```

## Core vendors (see API for full list)

| Id | Category | Typical data |
|----|----------|--------------|
| render / vercel | hosting | App hosting |
| postgres | database | Clinical store + audit |
| aws-s3 / aws-kms | storage | Blobs, SIEM archive, DEKs |
| resend | email | Reset links, DPO alerts |
| twilio | sms-voice | E.164, SMS bodies |
| livekit | video | Real-time media |
| stripe | payments | Billing |
| anthropic | ai | Consent-gated prompts |
| redis | hosting | Rate-limit keys |
| otel | observability | Hashed labels only |
| clamav | storage | Transient scan bytes |

## Production PHI GA gate

`summary.productionPhiReady === true` only when **zero** vendors remain `required-not-signed`.

This is an **operational register**, not legal advice. Confirm each agreement with counsel.
