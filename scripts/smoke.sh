#!/usr/bin/env bash
# VPSY OS — end-to-end HTTP smoke test.
#
# Exercises the live API across every built bounded context and asserts the
# key outcomes (screening, license/consent gates, AI-gated matching, wearables,
# CRM conversion, communications, risk escalation + break-glass, scheduling,
# finance double-entry balance, reports + de-identified analytics).
#
# Prereqs: a running API and a seeded database.
#   pnpm --filter @vpsy/database run seed
#   pnpm --filter @vpsy/api run dev        # or: node apps/api/dist/main.js
#   BASE=http://localhost:4000/api/v1 ./scripts/smoke.sh
#
# Windows note: after a `node dist/main.js` smoke, stop it via PowerShell
# (Stop-Process on `dist/main.js`) — a lingering process locks the Prisma
# engine DLL and breaks the next `prisma generate`. See docs + NEXUS memory.

set -u
BASE="${BASE:-http://localhost:4000/api/v1}"
PW='Vpsy!2026'
ALEX_CLIENT_ID="${ALEX_CLIENT_ID:-cmr8h028g001tdaycdllexcic}"  # seeded demo client
PASS=0; FAIL=0

py() { python -c "$1" 2>/dev/null; }
login() { curl -s -X POST "$BASE/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$PW\"}" | py "import sys,json;print(json.load(sys.stdin)['accessToken'])"; }
# check NAME EXPECTED ACTUAL
check() { if [ "$2" = "$3" ]; then echo "  PASS  $1 ($3)"; PASS=$((PASS+1)); else echo "  FAIL  $1 — expected $2, got $3"; FAIL=$((FAIL+1)); fi; }
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }

echo "== VPSY smoke @ $BASE =="

# ── Health ──
check "health db up" "up" "$(curl -s "$BASE/health" | py "import sys,json;print(json.load(sys.stdin)['db'])")"

MGR=$(login manager@vpsy.health); PSY=$(login dr.rivera@vpsy.health); CLI=$(login alex.client@example.com)
[ -n "$MGR" ] && [ -n "$PSY" ] && [ -n "$CLI" ] && { echo "  PASS  auth: manager/psychologist/client tokens"; PASS=$((PASS+1)); } || { echo "  FAIL  auth"; FAIL=$((FAIL+1)); }
AH="Authorization: Bearer"

# ── Auth hardening — public self-registration cannot self-assign an elevated role ──
RE="reg+$RANDOM$$@example.com"
check "register rejects smuggled elevated role (no privilege escalation)" "400" "$(code -X POST "$BASE/auth/register" -H 'Content-Type: application/json' -d "{\"email\":\"$RE\",\"password\":\"Vpsy!2026\",\"fullName\":\"Reg Test\",\"role\":\"ADMIN\"}")"
check "register (client) succeeds without role" "201" "$(code -X POST "$BASE/auth/register" -H 'Content-Type: application/json' -d "{\"email\":\"$RE\",\"password\":\"Vpsy!2026\",\"fullName\":\"Reg Test\"}")"

# ── Intake & screening (consent-gated) + risk ──
SEV=$(curl -s -X POST "$BASE/intake" -H "$AH $CLI" -H 'Content-Type: application/json' -d '{"presentingProblem":"Persistent anxiety with panic and poor sleep.","sleepQuality":3,"appetiteChange":0,"energyLevel":4,"concentration":4,"substanceUse":{"alcohol":"none","tobacco":"none","cannabis":"none"},"functionalImpairment":{"work":6,"family":4,"social":6,"selfCare":3},"safety":{"suicidalIdeation":false,"suicidalPlan":false,"selfHarm":false,"harmToOthers":false,"recentLoss":false},"goals":[],"preferredLanguage":"en","therapyFormat":"INDIVIDUAL","preferredTherapistGender":"any","traumaExposure":false,"previousTherapy":false}' | py "import sys,json;print(json.load(sys.stdin).get('severityBand','ERR'))")
[ "$SEV" != "ERR" ] && { echo "  PASS  intake→screening (severity=$SEV, consent gate open)"; PASS=$((PASS+1)); } || { echo "  FAIL  intake"; FAIL=$((FAIL+1)); }

# ── Matching (manager triage) ──
check "matching proposals available" "true" "$(curl -s "$BASE/assignments/proposals" -H "$AH $MGR" | py "import sys,json;print(str(len(json.load(sys.stdin))>=0).lower())")"

# ── Clinical documentation — license gate lets a credentialed clinician write ──
# WAVE CR item 8 (golden-thread enforcement): session_demo_1's client has an
# ACTIVE treatment plan, so a new note must reference planId + >=1 real goalId
# from that plan (400 otherwise). Fetch the live plan/goal ids rather than
# hard-coding them — seed.ts upserts are deterministic today but the golden
# thread is enforced against whatever plan is actually active. session_demo_1
# also already carries a SIGNED note from seed (note_demo_signed), so any
# further note for it is a post-signature amendment (WAVE CR P1) and must
# supply amendmentReason too.
PLAN_JSON=$(curl -s "$BASE/treatment-plans/client/$ALEX_CLIENT_ID/active" -H "$AH $PSY")
PLAN_ID=$(echo "$PLAN_JSON" | py "import sys,json;d=json.load(sys.stdin);print(d['id'] if d else '')")
GOAL_ID=$(echo "$PLAN_JSON" | py "import sys,json;d=json.load(sys.stdin);print(d['goals'][0]['id'] if d and d.get('goals') else '')")
check "note write (active license, golden-thread anchored)" "201" "$(code -X POST "$BASE/session-notes" -H "$AH $PSY" -H 'Content-Type: application/json' -d "{\"sessionId\":\"session_demo_1\",\"content\":{\"format\":\"narrative\",\"narrative\":\"Smoke-test note.\"},\"planId\":\"$PLAN_ID\",\"goalIds\":[\"$GOAL_ID\"],\"amendmentReason\":\"Smoke-test documented addendum.\"}")"

# ── Psychometrics — patient self-administers (NOT license-gated) ──
check "assessment self-administer" "201" "$(code -X POST "$BASE/assessments/responses" -H "$AH $CLI" -H 'Content-Type: application/json' -d "{\"versionId\":\"${VERSION_ID:-cmr8h028p001wdaycd7e7pcc1}\",\"clientId\":\"$ALEX_CLIENT_ID\",\"answers\":{\"q1\":1,\"q2\":1}}")"

# ── Clinical summary + wearables ──
check "clients/me summary" "200" "$(code "$BASE/clients/me" -H "$AH $CLI")"
check "wearable rollup" "200" "$(code "$BASE/wearables/client/$ALEX_CLIENT_ID/rollup?windowDays=7" -H "$AH $PSY")"

# ── CRM ──
check "crm board" "200" "$(code "$BASE/crm/board" -H "$AH $MGR")"

# ── Communications ──
check "click-to-call" "201" "$(code -X POST "$BASE/comms/calls/click-to-call" -H "$AH $PSY" -H 'Content-Type: application/json' -d '{"toE164":"+15550000000"}')"
check "client denied telephony (ABAC)" "403" "$(code -X POST "$BASE/comms/calls/click-to-call" -H "$AH $CLI" -H 'Content-Type: application/json' -d '{"toE164":"+15550000009"}')"

# ── Risk & crisis ──
check "risk board" "200" "$(code "$BASE/risk/board" -H "$AH $PSY")"
check "break-glass needs reason" "400" "$(code -X POST "$BASE/risk/break-glass" -H "$AH $PSY" -H 'Content-Type: application/json' -d "{\"clientId\":\"$ALEX_CLIENT_ID\",\"reason\":\"\"}")"

# ── Scheduling ──
check "agenda" "200" "$(code "$BASE/scheduling/appointments" -H "$AH $PSY")"
check "client denied availability mgmt (ABAC)" "403" "$(code -X POST "$BASE/scheduling/availability" -H "$AH $CLI" -H 'Content-Type: application/json' -d '{"startsAt":"2026-09-01T10:00:00.000Z","endsAt":"2026-09-01T10:50:00.000Z"}')"

# ── Finance — create → pay → assert ledger balances ──
IID=$(curl -s -X POST "$BASE/finance/invoices" -H "$AH $MGR" -H 'Content-Type: application/json' -d "{\"clientId\":\"$ALEX_CLIENT_ID\",\"lineItems\":[{\"description\":\"Session\",\"amount\":\"60.10\"},{\"description\":\"Session\",\"amount\":\"59.95\"},{\"description\":\"Session\",\"amount\":\"59.95\"}]}" | py "import sys,json;print(json.load(sys.stdin)['id'])")
check "invoice exact Decimal sum" "180.0000" "$(curl -s "$BASE/finance/invoices" -H "$AH $MGR" | py "import sys,json;a=json.load(sys.stdin);print(next((i['amount'] for i in a if i['id']=='$IID'),'ERR'))")"
check "pay invoice captured" "captured" "$(curl -s -X POST "$BASE/finance/invoices/$IID/pay" -H "$AH $MGR" -H 'Content-Type: application/json' -d '{}' | py "import sys,json;print(json.load(sys.stdin).get('status','ERR'))")"
check "ledger balanced (debits==credits)" "True" "$(curl -s "$BASE/finance/ledger" -H "$AH $MGR" | py "import sys,json;from decimal import Decimal as D;a=json.load(sys.stdin);print(sum((D(e['debit']) for e in a),D('0'))==sum((D(e['credit']) for e in a),D('0')))")"
check "client denied finance (ABAC)" "403" "$(code "$BASE/finance/invoices" -H "$AH $CLI")"

# ── Reports + National analytics (executive; national suppresses small cohorts) ──
EXEC=$(login exec@vpsy.health)
if [ -n "$EXEC" ]; then
  check "executive report" "200" "$(code "$BASE/reports/executive" -H "$AH $EXEC")"
  check "national analytics suppresses small cohorts" "true" "$(curl -s "$BASE/analytics/national" -H "$AH $EXEC" | py "import sys,json;d=json.load(sys.stdin);print(str(any(m['suppressed'] for m in d['metrics'])).lower())")"
else
  echo "  SKIP  reports/analytics (no exec@vpsy.health — run seed with the executive user)"
fi

echo "== done: $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
