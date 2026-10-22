# OpenWeightModels

A forum where people publish side-by-side comparisons of open-weight model outputs to the same prompt.

This repository is the production-intended implementation of the design handoff in `design_handoff_openweightmodels/`. The `v2` HTML files are the visual source of truth; `designs/styles.css` is only the prototype's base sheet and its tokens are overridden by every v2 screen.

**Status: Milestone 1 feature-complete locally; M2 work has started with Board pagination.** The Board and Comparison screens, the New Comparison form, the live author-only Job page (SSE, Retry/Skip, Publish), the backend API and the generation worker exist, and the whole stack starts with one command. The Board now pages 48 at a time with an infinite-scroll sentinel and a Load more fallback, global sidebar counts, URL-backed filters and a single stable SSE subscription. See `docs/IMPLEMENTATION-STATUS.md` for an exact snapshot.

## Stack

- Next.js 16 App Router, React 19, TypeScript
- Tailwind v4 + Radix primitives + Phosphor icons
- Postgres 17 + Drizzle ORM
- Redis + BullMQ (one job per Run)
- SSE with Redis pub/sub and Postgres replay
- AWS ECS Fargate + RDS + ElastiCache + SES target (ADR 0006)

## Local setup

### Docker: one command

Requires Docker Desktop or Colima with Compose v2.

```bash
docker compose up --build
```

That starts web, worker, Postgres, Redis and Mailpit. On first start the
`migrate` service waits for Postgres, applies migrations and seeds the
development data only when the database is empty. Later starts skip the seed.

| Service | Address |
|---|---|
| App | <http://localhost:3000> |
| Mailpit (SMTP inbox) | <http://localhost:8025> — SMTP on `localhost:1025` |
| Worker health | <http://localhost:3001/healthz> |
| Postgres | `localhost:5432` (`postgres` / `postgres`) |
| Redis | `localhost:6379` |

The repo is bind-mounted, so edits hot-reload in both containers. The web and
worker containers run the same image and the same `@owm/core` workspace code as
a local run.

Day-to-day commands:

```bash
docker compose logs -f web worker     # or: pnpm stack:logs
docker compose down                   # stop; named volumes keep all data
docker compose down --volumes         # explicit reset: delete database + Redis data
docker compose up --build             # restart with data intact
pnpm stack:seed                       # explicit reseed (truncates content)
```

`pnpm stack:reset` is the same as `down --volumes` followed by
`up --build`; it is the only command that deletes data.

If Homebrew Postgres or Redis is already running, either stop it or move the
host ports: `POSTGRES_PORT=5433 REDIS_PORT=6380 docker compose up`. Container
networking is unaffected. After changing dependencies, rebuild the dependency
layers with `docker compose up --build --renew-anon-volumes`.

Mailpit is wired as `SMTP_URL=smtp://mailpit:1025` but nothing sends mail until
magic-link auth lands (ticket 07).

The development identity defaults to `@mira`; `POST /api/dev/user` with
`{ "handle": "kev" }` switches it. The endpoint is disabled in production.

### Homebrew fallback (no Docker)

```bash
brew services start postgresql@17
brew services start redis
createdb openweightmodels           # once; skip if it already exists
cp .env.example .env                # then point DATABASE_URL at your OS user
pnpm install
pnpm db:init                        # migrate, then seed only if the database is empty
pnpm dev                            # web + worker
# or run them separately:
pnpm dev:web
pnpm dev:worker
```

Homebrew Postgres has no `postgres` role by default, so set
`DATABASE_URL=postgres://$(whoami)@localhost:5432/openweightmodels` in `.env`.
Mailpit is optional until magic-link auth lands: `brew install mailpit` then run
`mailpit` for SMTP on `1025` and the inbox on <http://localhost:8025>.

Open <http://localhost:3000>.

`pnpm db:init` is idempotent. Use `pnpm db:seed` to replace content with the
deterministic dev fixtures, and `pnpm db:reset` to drop and recreate the public
schema (it refuses to run in production).

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
| `pnpm db:init` | Apply migrations, seed only when the database is empty |
| `pnpm db:seed` | Reset and seed dev data |
| `pnpm db:reset` | Drop and recreate the public schema (refuses production) |
| `pnpm stack:up` | `docker compose up --build` |
| `pnpm stack:down` | Stop the stack, keep data |
| `pnpm stack:reset` | Delete volumes, then rebuild and start |
| `pnpm stack:logs` | Follow web and worker logs |
| `pnpm stack:seed` | Reseed content inside the running stack |
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
apps/worker              BullMQ consumer for queued Runs, health endpoint
packages/core            Drizzle schema, domain logic, queries, services, seed
packages/core/drizzle    Generated SQL migrations
docker-compose.yml       Local web + worker + Postgres + Redis + Mailpit
Dockerfile               Shared development image for web and worker
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
