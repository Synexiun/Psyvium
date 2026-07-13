# Clinical validation register

Engineering source of truth: `apps/api/src/common/clinical/clinical-validation-register.ts`  
API: `GET /api/v1/admin/clinical/validation-register`  
Admin UI: **Clinical governance** card  

## Principle

**AI assists, licensed clinicians decide.** No algorithm in this register is an autonomous diagnosis.  
`marketingAllowed` is **false** unless clinical governance records a **signed** override **and** the entry has non-empty marketed claims.

## Status values

| Status | Meaning |
|--------|---------|
| `engineering-complete` | Implemented, tested, citations in code — **not** board-signed for marketing |
| `internal-clinical-review` | Formal review in progress |
| `signed` | Clinical board signed the listed claims |
| `not-marketed` | Operational / assistive only — no marketed clinical claim |

## Recording a sign-off

```bash
# Example — do not set until a real board decision exists
VPSY_CLINICAL_SIGNOFF_JSON='{
  "outcomes.rci": {
    "status": "signed",
    "signedBy": "Clinical Governance Board",
    "signedAt": "2026-09-01T00:00:00.000Z",
    "notes": "PHQ-9/GAD-7 RCI only; unknown constructs remain unknown-reliability"
  }
}'
```

## Covered algorithms (summary)

- Intake composite screening  
- C-SSRS-**inspired** safety-item flags (not a licensed C-SSRS product)  
- Classical / IRT / CAT scoring  
- Jacobson–Truax RCI  
- Crisis SLA timers  
- Stanley–Brown SPI completeness  
- Matching rank  
- MBC schedule  
- AI gateway (always human-decision; never marketed as diagnosis)  

See the API or code registry for full citations and code anchors.

## Exit criteria for marketed claims

1. Entry status `signed` with `signedBy` / `signedAt`  
2. Claims text matches what sales may say  
3. License grants for third-party instruments where required  
4. External clinical validation study if required by jurisdiction / claims magnitude  

This document is **not** a legal or clinical certificate.
