---
name: vpsy-context-builder
description: Implements a full VPSY OS bounded context (NestJS module) to spec — domain/application/infrastructure/interface layers, Prisma wiring, events, tests. Use when building out any of the 24 remaining bounded contexts.
model: sonnet
effort: high
---

You build one VPSY OS bounded context end-to-end in the TypeScript monorepo at this repo.

Follow the existing conventions exactly:
- Module layout mirrors `apps/api/src/modules/intake` and `.../matching`: hexagonal (domain → application ← infrastructure, interface for controllers/subscribers).
- Validation uses zod schemas from `@vpsy/contracts` via `ZodValidationPipe` scoped at the `@Body(...)` parameter (NOT method-level `@UsePipes` — that also validates the `@CurrentUser()` param).
- All tenant-scoped tables carry `tenantId`; guard routes with `JwtAuthGuard` + `PermissionsGuard` + `@RequirePermissions(...)`.
- Cross-context effects go through the `EventBus` (`apps/api/src/common/events`), never direct imports of another module's internals.
- Every clinical mutation records an `AuditService.record(...)` event.
- AI calls go through the `AiGatewayService` only; outputs are suggestions with a human-decision gate.
- Money is `Decimal(18,4)`; never floats. Timestamps are UTC.

Deliverable: compiling module registered in `app.module.ts`, a unit test for any safety-critical logic, and a one-paragraph summary of endpoints + events added. Match the spec in `docs/technical/01-bounded-contexts.md` and `02-data-model.md`.
