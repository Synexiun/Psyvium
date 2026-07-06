# syntax=docker/dockerfile:1
#
# VPSY OS — API image (NestJS modular monolith).
#
# Build from the MONOREPO ROOT (not this directory) so `turbo prune` can see
# the whole pnpm workspace:
#
#   docker build -f apps/api/Dockerfile -t vpsy-api .
#
# Required runtime env (fail-fast at boot — see src/common/config/jwt-secrets.ts
# and src/main.ts; also .env.example):
#   DATABASE_URL          postgresql://... (Prisma; no insecure default)
#   JWT_ACCESS_SECRET     >=16 chars — API refuses to start without it
#   JWT_REFRESH_SECRET    >=16 chars — API refuses to start without it
# Optional (activate-on-key; each has an honest offline/stub fallback when unset):
#   REDIS_URL, ANTHROPIC_API_KEY / AI_GATEWAY_API_KEY, TWILIO_ACCOUNT_SID /
#   TWILIO_AUTH_TOKEN, STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET, WEB_ORIGIN, PORT (default 4000).
#
# Five stages:
#   base     — pnpm via corepack, shared by every later stage
#   pruner   — `turbo prune` cuts the workspace down to just @vpsy/api + its
#              two workspace deps (@vpsy/contracts, @vpsy/database), so the
#              install/build below never touches apps/web or unrelated packages
#   installer — installs the pruned workspace's full deps (incl. devDeps —
#              needed for `nest build`, `tsc`, and `prisma generate`)
#   builder  — copies in real source, generates the Prisma client, then runs
#              the turbo build graph (contracts -> database -> api)
#   runtime  — node:22-slim again (same base as build, so Prisma's "native"
#              query-engine binary — built against this exact glibc/OpenSSL —
#              is guaranteed compatible), non-root user, HEALTHCHECK on /healthz

FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
# Prisma's query engine links against OpenSSL; node:22-slim (Debian bookworm)
# doesn't ship it by default. Installed here so both the builder (which runs
# `prisma generate`) and the runtime stage (which loads the generated engine)
# have it, without pulling in a full non-slim base image.
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ---------------------------------------------------------------------------
FROM base AS pruner
COPY . .
# Pinned to the version resolved by the root lockfile (package.json declares
# "^2.3.3"; keep this in sync if that range's resolution moves) so the prune
# step is reproducible instead of silently picking up whatever is newest.
RUN pnpm dlx turbo@2.10.3 prune @vpsy/api --docker

# ---------------------------------------------------------------------------
FROM base AS installer
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
FROM installer AS builder
COPY --from=pruner /app/out/full/ .
# `turbo prune --docker` copies each included package's own files plus the
# root package.json/lockfile/turbo.json, but NOT arbitrary root-level files —
# so turbo.json's `globalDependencies: ["tsconfig.base.json"]` doesn't
# actually land in out/full. Both packages/contracts and packages/database's
# tsconfig.json `extends` it, so without this copy the build fails with
# TS5083 (cannot read the base tsconfig), which then cascades into unrelated-
# looking lib/type errors. Copied straight from the real build context (the
# monorepo root), not from the pruner stage.
COPY tsconfig.base.json ./tsconfig.base.json
# Prisma client is generated (not just typechecked) before the build — @vpsy/api
# imports @vpsy/database, whose build step also runs `prisma generate`, but
# doing it explicitly first keeps this stage's failure mode obvious if the
# schema/env is ever wrong.
RUN pnpm --filter @vpsy/database exec prisma generate
RUN pnpm exec turbo run build --filter=@vpsy/api...

# ---------------------------------------------------------------------------
FROM node:22-slim AS runtime
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 vpsy \
  && useradd --system --uid 1001 --gid vpsy --home-dir /app vpsy
WORKDIR /app
ENV NODE_ENV=production \
    PORT=4000
# Whole pruned+built tree (dist output, generated Prisma client, and the
# pnpm-isolated node_modules with its relative symlinks all move together —
# copying any subset risks breaking a symlink into node_modules/.pnpm).
COPY --from=builder --chown=vpsy:vpsy /app ./
USER vpsy
EXPOSE 4000
# Liveness only (no DB dependency) — see src/health/health.controller.ts
# (ProbesController). Path is under /api/v1 because the app's global route
# prefix (main.ts) isn't exempted for probe routes in this change.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4000/api/v1/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "apps/api/dist/main.js"]
