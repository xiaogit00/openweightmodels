# syntax=docker/dockerfile:1
#
# Development image for the local stack (ticket 05). Web and worker are the
# same build; compose only changes the command. Production images arrive with
# the AWS deployment (ticket 13).
#
# The repo is bind-mounted over /app at runtime, so changes hot-reload. The
# image still owns node_modules (copied into anonymous volumes by compose).

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
