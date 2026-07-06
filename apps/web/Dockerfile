# syntax=docker/dockerfile:1
#
# VPSY OS — Web image (Next.js 15 App Router, standalone output).
#
# Build from the MONOREPO ROOT (not this directory) so `turbo prune` can see
# the whole pnpm workspace:
#
#   docker build -f apps/web/Dockerfile -t vpsy-web .
#
# Required runtime env:
#   NEXT_PUBLIC_API_URL   base URL the browser bundle calls (baked in at build time —
#                         rebuild the image if this changes)
#   API_URL               server-side rewrite target for /api/backend/* (apps/web/next.config.mjs)
# Optional: PORT (default 3000)
#
# Same turbo-prune shape as apps/api/Dockerfile (see its comments for why):
# base -> pruner -> installer -> builder -> runtime. Next's `output: 'standalone'`
# (apps/web/next.config.mjs) does the equivalent of a prod-dep prune for us —
# it traces the app's actual runtime imports and copies only those into
# .next/standalone, so the runtime stage never needs the full node_modules tree.

FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
WORKDIR /app

# ---------------------------------------------------------------------------
FROM base AS pruner
COPY . .
# Pinned to the version resolved by the root lockfile (package.json declares
# "^2.3.3"; keep this in sync if that range's resolution moves) so the prune
# step is reproducible instead of silently picking up whatever is newest.
RUN pnpm dlx turbo@2.10.3 prune @vpsy/web --docker

# ---------------------------------------------------------------------------
FROM base AS installer
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
FROM installer AS builder
COPY --from=pruner /app/out/full/ .
# See apps/api/Dockerfile for why this is needed: `turbo prune --docker`
# doesn't carry root-level globalDependencies (turbo.json) into out/full, and
# packages/contracts' tsconfig.json `extends` this file.
COPY tsconfig.base.json ./tsconfig.base.json
ENV NEXT_TELEMETRY_DISABLED=1
# @vpsy/contracts must be built (real dist/*.js) before Next's build — transpilePackages
# transpiles already-compiled package output for bundling, it doesn't compile raw
# TS from source. `turbo run build --filter=@vpsy/web...` builds contracts first
# (turbo.json's build task depends on `^build`, i.e. workspace deps first).
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
RUN pnpm exec turbo run build --filter=@vpsy/web...

# ---------------------------------------------------------------------------
FROM node:22-slim AS runtime
RUN groupadd --system --gid 1001 vpsy \
  && useradd --system --uid 1001 --gid vpsy --home-dir /app vpsy
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
# Standalone output mirrors the monorepo path back to the workspace root, so
# the entrypoint is apps/web/server.js relative to this WORKDIR, not ./server.js.
COPY --from=builder --chown=vpsy:vpsy /app/apps/web/.next/standalone ./
COPY --from=builder --chown=vpsy:vpsy /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=vpsy:vpsy /app/apps/web/public ./apps/web/public
USER vpsy
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "apps/web/server.js"]
