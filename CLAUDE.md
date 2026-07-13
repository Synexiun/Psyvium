# VPSY OS — working agreement

VPSY OS is a Clinical Psychology Operating System (see `docs/`). Core principle everywhere: **AI assists, licensed clinicians decide** — no autonomous diagnosis; the manager is the final assignment authority; every clinical action emits a tamper-evident audit event. Stack is a TypeScript monorepo (NestJS + Prisma + Next.js); never introduce Kotlin.

## Dynamic model routing (automatic — do this every turn without being asked)

The main thread stays on **Opus 4.8** (pinned in `.claude/settings.json`). I do NOT ask the user to switch models. Instead, **before acting on any non-trivial task, I classify it and dispatch the work to the right-priced subagent** below. The user never runs `/model`; routing is my job.

**Routing table — match the task, dispatch the agent:**

| Task shape | Agent | Model · effort |
|------------|-------|----------------|
| Boilerplate, scaffolding, barrel files, running builds/tests, log/output parsing | `vpsy-scaffolder` | Haiku · low |
| Documentation authoring/updates (`docs/**`) | `vpsy-doc-writer` | Sonnet · medium |
| Substantial UI/UX or i18n work in `apps/web` | `vpsy-ux-designer` | **Fable · xhigh** (user directive) |
| Implement a bounded-context module / feature to spec | `vpsy-context-builder` | Sonnet · high |
| Pre-merge review of PHI/risk/payments/AI/RBAC code | `vpsy-reviewer` | Opus · high |
| Hardest reasoning: subtle bug Opus couldn't crack, gnarly architecture call, one-pass end-to-end build of a fully-specified system | `vpsy-hard-reasoner` | Fable · max |
| Quick conversational answer, tiny edit, or a decision only I can make | *(stay on main thread — no dispatch)* | Opus · high |

**Rules of thumb:**
- Fan out independent work to multiple agents in one message (parallel).
- Escalate, don't downgrade: if a Sonnet `vpsy-context-builder` pass stalls on something genuinely hard, re-dispatch that specific piece to `vpsy-hard-reasoner` (Fable). Everyday work never touches Fable.
- **Never route SynexSec / MythicSec / ZeroMythic security tooling to `vpsy-hard-reasoner`** — Fable's classifiers can false-positive-refuse benign cyber work; keep that on Opus.
- Cost discipline: verbose/mechanical work goes to cheap agents so the expensive main thread only holds conclusions.

Honest limitation (stated once): Claude Code has no per-prompt model switch on the *main* thread — this routing is achieved by delegating each task to a model-pinned subagent, which produces the same outcome (the right model does each piece of work) with zero manual `/model` changes.

## Build & verify
- `pnpm build` (turbo: contracts → database → api + web). Web build needs the heap flag — already baked into its script via `cross-env`.
- `pnpm test` runs clinical-safety unit tests. Prisma: `pnpm --filter @vpsy/database exec prisma db push` + `run seed`.
- Local demo DB is an isolated `vpsy` database/role in local Postgres; demo password `Vpsy!2026`.
- Current handoff note (2026-07-09): `/messages` has secure text-thread UI wired to the messaging API. The latest fix keeps the conversation mounted during background thread refreshes to stop visible flicker, and guards read-receipt marking until `myUserId` is loaded. Targeted TS check for `apps/web/src/app/(portal)/messages/page.tsx` passed; a full browser regression was blocked by the known web middleware build requirement that `JWT_ACCESS_SECRET` be present at `next build` time.

## Conventions (match a sibling file before writing)
- Modules are hexagonal (`domain → application ← infrastructure`, `interface` for controllers/subscribers); contexts interact only via `@vpsy/contracts` + the `EventBus`, never cross-imports.
- Validate with zod at the `@Body(new ZodValidationPipe(schema))` **parameter** (not method-level `@UsePipes` — it wrongly validates `@CurrentUser` too).
- Money is `Decimal(18,4)`; timestamps UTC; AI output always logged as `AIRecommendation` behind a `PENDING` human-decision gate.
