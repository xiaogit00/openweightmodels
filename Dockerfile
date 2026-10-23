# syntax=docker/dockerfile:1
#
# `dev` is the local stack image (ticket 05). `web` and `worker` are the
# production images used by ECS Fargate (ticket 13). The worker image also runs
# the one-off database bootstrap task.
#
# The repo is bind-mounted over /app in the dev target, so changes hot-reload.
# The image still owns node_modules (copied into anonymous volumes by compose).

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@12.14.0 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
COPY infra/package.json infra/
RUN pnpm install --frozen-lockfile

FROM base AS dev
ENV NODE_ENV=development
# pnpm keeps per-package node_modules symlink farms, not only the root store,
# so copy the workspace manifests alongside the installed dependencies.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps ./apps
COPY --from=deps /app/packages ./packages
COPY . .
EXPOSE 3000 3001
CMD ["apps/web/node_modules/.bin/next", "dev", "apps/web", "-H", "0.0.0.0", "-p", "3000"]

# --- production -----------------------------------------------------------------

FROM deps AS build
COPY . .
# `next build` imports route modules; it needs syntactically valid values, not
# a reachable database. Runtime configuration is injected by ECS.
ENV NODE_ENV=production \
    DATABASE_URL=postgres://build:build@127.0.0.1:5432/build \
    APP_URL=https://build.invalid \
    BETTER_AUTH_SECRET=openweightmodels-build-time-placeholder
RUN pnpm --filter @owm/web build

FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
COPY infra/package.json infra/
RUN pnpm install --frozen-lockfile --prod

# Next's standalone server carries its own traced node_modules.
FROM base AS web
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

# The worker speaks TypeScript through tsx at runtime, so it ships the source
# for the worker and @owm/core plus production dependencies. The migration task
# reuses this image with `packages/core/src/db/bootstrap.ts`.
FROM base AS worker
ENV NODE_ENV=production
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=prod-deps --chown=node:node /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=prod-deps --chown=node:node /app/packages/core/node_modules ./packages/core/node_modules
COPY --chown=node:node package.json pnpm-workspace.yaml ./
COPY --chown=node:node apps/worker/package.json ./apps/worker/package.json
COPY --chown=node:node apps/worker/src ./apps/worker/src
COPY --chown=node:node packages/core/package.json ./packages/core/package.json
COPY --chown=node:node packages/core/tsconfig.json ./packages/core/tsconfig.json
COPY --chown=node:node packages/core/src ./packages/core/src
COPY --chown=node:node packages/core/drizzle ./packages/core/drizzle
USER node
EXPOSE 3001
CMD ["apps/worker/node_modules/.bin/tsx", "apps/worker/src/index.ts"]
