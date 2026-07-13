# VPSY OS — Demo Walkthrough

A guided tour of everything built. Every screen is multilingual (10 languages) and RTL-ready — switch to **العربية** anywhere to see the whole UI mirror.

## Run it

```bash
# 1. Infra (or use a local Postgres and skip compose)
docker compose up -d                     # Postgres :5433, Redis :6380

# 2. Point DATABASE_URL (packages/database/.env + apps/api/.env), then:
pnpm --filter @vpsy/database exec prisma db push
pnpm --filter @vpsy/database run seed

# 3. Run both apps
pnpm --filter @vpsy/api run dev           # http://localhost:4000  (Swagger at /api/docs)
pnpm --filter @vpsy/web run dev           # http://localhost:3000
```

**Demo accounts** — password `Vpsy!2026`:

| Account | Role | Lands on |
|---|---|---|
| `manager@vpsy.health` | Clinical Director | `/manager` |
| `dr.rivera@vpsy.health` | Psychologist | `/session` |
| `alex.client@example.com` | Client | `/home` |

> Sign in through `/login` with one of the demo buttons, then navigate to the route you want to inspect. Authenticated portal routes depend on the web build having the same `JWT_ACCESS_SECRET` as the API.

## The tour (10 routes)

### 🏠 `/` — Public landing
The category thesis, the six operating layers, the eight AI agents, the governance strip. Watch the **lifecycle waveform** (the signature). Use the **language switcher** (top right) → pick العربية to see full RTL; the waveform stays left-to-right (it's a chart, not prose).

### 🔐 `/login`
Role-aware: sign in and you're routed to the right workspace. Show/hide password, localized errors, one-click demo accounts.

### 📝 `/intake` — Client intake (Layer 2)
A calm 4-step flow (your story / daily life / **safety** / preferences). The safety screen is handled supportively. Submit → **deterministic screening** returns a severity band, risk score, urgency, suggested specialty. Positive safety answers open a **risk escalation** and can block standard virtual care. *(Intake is consent-gated — the demo client's consents are seeded.)*

### 🧭 `/manager` — Triage & assignment (command center)
The AI proposes **ranked clinician candidates** with rationale; toggle the **risk lens** to sort by attention. **You approve** — the manager is the final authority. Approving writes a tamper-evident audit event.

### 🩺 `/session` — Clinician workspace (the center of the system)
Real client timeline (notes + outcomes), a treatment-plan snapshot, latest assessment, and the **AI case-formulation panel** — which always shows a confidence and a locked **"requires clinician confirmation"** gate. **File a note → sign it** (immutable, versioned). *A clinician write is blocked unless their license is active and in-jurisdiction.*

### 📱 `/home` — Patient PWA
Next session, a daily **mood check-in** (with a 7-day signal strip), exercises, a **wearable insight card** (HRV / sleep / resting HR — framed as *context, not diagnosis*, with `—` for absent data), the outcome trend, and a calm **emergency help** card.

### 📈 `/crm` — CRM & Referrals
A **pipeline board** (kanban) of leads, a **referrer registry** (doctors/schools/employers/courts/institutions) with referral-share %, a new-lead form, and **Convert to client** — a one-way, audited handoff into care.

### ☎️ `/comms` — Communications Hub
**Click-to-call** and **SMS** (logged to the unified timeline), an in-house **live video/voice** panel (grant camera/mic → your local preview appears; the second participant streams through the self-hosted SFU in a real deployment), and **async voice/video messages** — record with your mic/camera, and they upload and play back.

### 💬 `/messages` — Secure messages
Client↔clinician text threads inside the platform clinical record. The latest conversation opens by default, incoming unread messages are marked read once the signed-in user is known, and background thread-list refreshes no longer unmount the conversation pane.

### 🚨 `/risk` — Risk & Crisis
Open **escalations** most-urgent-first (SEVERE in red/amber). **Assign** and **resolve** — resolve *requires a written resolution*; nothing is ever auto-resolved. Author an append-only **safety plan**. The **break-glass** panel grants time-boxed emergency access (reason required) — high-priority audited, alerts the DPO.

### 🗓 `/schedule` — Scheduling
Your **agenda** with confirm / complete / no-show / cancel and **send reminder**; open **availability** slots clients can book into. Times render in your locale/timezone.

## What to notice across all of it
- **AI assists, licensed clinicians decide** — every AI output is a suggestion behind a human gate.
- **Compliance is enforced, not decorative** — try a clinical write without a valid license (403), or intake with a withdrawn consent (409).
- **Multilingual + RTL** — switch languages anywhere; nothing shows a raw key.
- **Absent ≠ zero** — missing metrics render `—`, never a misleading `0`.

See [`BUILD-STATUS.md`](./BUILD-STATUS.md) for the full context-by-context build state.
