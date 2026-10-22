# OpenWeightModels

A forum where people publish side-by-side comparisons of open-weight model outputs to the same prompt.

This repository is the production-intended implementation of the design handoff in `design_handoff_openweightmodels/`. The `v2` HTML files are the visual source of truth; `designs/styles.css` is only the prototype's base sheet and its tokens are overridden by every v2 screen.

**Status: Milestone 1 in progress.** The Board and Comparison screens, the New Comparison form, the live author-only Job page (SSE, Retry/Skip, Publish), the backend API and the generation worker exist. Docker Compose is not built yet. See `docs/IMPLEMENTATION-STATUS.md` for an exact snapshot.

## Stack

- Next.js 16 App Router, React 19, TypeScript
- Tailwind v4 + Radix primitives + Phosphor icons
- Postgres 17 + Drizzle ORM
- Redis + BullMQ (one job per Run)
- SSE with Redis pub/sub and Postgres replay
- AWS ECS Fargate + RDS + ElastiCache + SES target (ADR 0006)

## Local setup

### With Docker (when `docker-compose.yml` is added)

```bash
docker compose up --build
```

### With Homebrew Postgres and Redis

```bash
brew services start postgresql@17
brew services start redis
createdb openweightmodels
cp .env.example .env        # then set DATABASE_URL/REDIS_URL if needed
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev                    # web + worker
# or run them separately:
pnpm dev:web
pnpm dev:worker
```

Open <http://localhost:3000>. The development identity defaults to `@mira`; `POST /api/dev/user` with `{ "handle": "kev" }` switches it. The endpoint is disabled in production.

### Checks

```bash
pnpm typecheck
pnpm test                    # unit + integration tests (needs Postgres and Redis)
pnpm build
pnpm test:e2e                # browser journey, with an isolated database and Redis DB
```

The browser suite seeds `openweightmodels_e2e` and Redis database `1`, then starts its own web and
worker servers on port 3100. Install the browser once with `pnpm exec playwright install chromium`.
It needs `psql` and `redis-cli` on `PATH` (Homebrew installs both). Override the targets with
`E2E_DATABASE_URL` and `E2E_REDIS_URL`; the suite refuses to seed the development database or
flush the development Redis DB index.

## Scripts

| Script | Purpose |
|---|---|
| `pnpm dev:web` | Next.js dev server |
| `pnpm dev:worker` | BullMQ worker consuming the generation queue |
| `pnpm db:generate` | Generate Drizzle SQL from schema |
| `pnpm db:migrate` | Apply migrations |
| `pnpm db:seed` | Reset and seed dev data |
| `pnpm db:reset` | Drop and recreate the public schema (refuses production) |
| `pnpm test` | Run the core and worker test suites |
| `pnpm test:e2e` | Run the Playwright journey against an isolated database |
| `pnpm typecheck` | Typecheck all workspace packages and the E2E suite |
| `pnpm build` | Build all packages |

## Documentation

| File | Purpose |
|---|---|
| `BACKEND.md` | Concrete data model, API, jobs, SSE, quotas and edge-case semantics |
| `GLOSSARY.md` | Canonical domain vocabulary |
| `docs/DECISIONS.md` | Every settled decision, rejected alternative, edge case and open question |
| `docs/adr/` | Architectural decisions 0001–0006 |
| `docs/IMPLEMENTATION-STATUS.md` | What is built, what is missing, known issues, next steps |

## Repository layout

```
apps/web                 Next.js app, API routes, UI
apps/worker              BullMQ consumer for queued Runs
packages/core            Drizzle schema, domain logic, queries, services, seed
packages/core/drizzle    Generated SQL migrations
docs/                    ADRs, decision log, implementation status
design_handoff_openweightmodels/   Read-only design handoff
```

## Core rules

- A Comparison is a user-authored post; duplicate Prompts are allowed.
- Prompt and Base output freeze after scheduling; title/categories/effort stay editable.
- Publish requires at least one Done Challenger; drafts are author-only and return `404` to everyone else.
- Annotations are stored as UTF-16 offsets into raw markdown and must fit within one annotatable text node or fenced code block.
- Votes live only in the `votes` table; self-voting is rejected.
- Discussion replies are one level deep.
- Postgres is canonical; Redis is transport and pub/sub only.
