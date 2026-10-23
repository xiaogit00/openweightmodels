# OpenWeightModels

A forum where people publish side-by-side comparisons of open-weight model outputs to the same prompt.

This repository is the production-intended implementation of the design handoff in `design_handoff_openweightmodels/`. The `v2` HTML files are the visual source of truth; `designs/styles.css` is only the prototype's base sheet and its tokens are overridden by every v2 screen.

**Status: Milestone 1 feature-complete locally; M2 has started with Board pagination and email magic-link accounts.** The Board and Comparison screens, the New Comparison form, the live author-only Job page (SSE, Retry/Skip, Publish), the backend API and the generation worker exist, and the whole stack starts with one command. The Board pages 48 at a time with an infinite-scroll sentinel and a Load more fallback, global sidebar counts, URL-backed filters and a single stable SSE subscription. Sign-in is a single-use email magic link with handle onboarding; public pages stay readable anonymously. `/account` exports a member's own data as JSON and deletes the account on a typed confirmation, keeping published work under a `[deleted]` attribution. Terms and Privacy pages are linked from the shell; their copy is marked for owner/legal review. AWS staging infrastructure (CDK, production images and the migration-first release flow) is in `infra/`; see `docs/DEPLOYMENT.md`. See `docs/IMPLEMENTATION-STATUS.md` for an exact snapshot.

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

Mailpit receives magic-link mail as `SMTP_URL=smtp://mailpit:1025`; open
<http://localhost:8025> to read it. The development identity switcher also
remains available: `POST /api/dev/user` with `{ "handle": "kev" }` signs in as a
seeded account without email. Both the switcher and the development magic-link
outbox are disabled in production.

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
Mailpit is optional: `brew install mailpit` then run `mailpit` for SMTP on
`1025` and the inbox on <http://localhost:8025>. Without it, the magic link is
printed in the web server log and stored in the development outbox.

Open <http://localhost:3000>, choose **Sign in**, and use a seeded address such
as `mira@openweightmodels.test`; or switch identity directly with
`POST /api/dev/user { "handle": "mira" }`.

### Real generation (OpenRouter)

`PROVIDER=mock` is the default, including for tests. To run real generations:

```bash
# Homebrew path
PROVIDER=openrouter OPENROUTER_API_KEY=sk-or-... pnpm dev

# Docker path (compose passes the key through)
PROVIDER=openrouter OPENROUTER_API_KEY=sk-or-... docker compose up --build
```

The worker validates this at startup: `PROVIDER=openrouter` without
`OPENROUTER_API_KEY` fails with the missing variable named, and a real mode
never falls back to mock. Keep the key out of shell history by putting it in
`.env.local` (gitignored); Next, the worker and the db scripts read it. Each
Challenger receives the same frozen Prompt,
`temperature: 0.7`, `max_tokens: 4096`, streaming and a 120-second timeout;
the final content, provider-reported completion tokens, latency and cost are
stored on the Response. The key stays in the environment and is redacted from
error messages stored on a failed Run.

To prove one real call end to end — including the stored tokens, latency and
cost — with Postgres, Redis and the key in `.env.local` (or exported):

```bash
pnpm test:live
```

Only the `test:live` script runs that file, so `pnpm test` never calls a
provider and never bills you. `LIVE_PROVIDER_MODEL` overrides the default
`deepseek/deepseek-chat`.

`pnpm db:init` is idempotent. Use `pnpm db:seed` to replace content with the
deterministic dev fixtures, and `pnpm db:reset` to drop and recreate the public
schema (it refuses to run in production).

### AWS staging

The full procedure is in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). In short:

```bash
export AWS_REGION=eu-west-1
export OWM_DOMAIN_NAME=staging.openweightmodels.com
export OWM_HOSTED_ZONE_ID=Z0123456789   # or OWM_CERTIFICATE_ARN
export OWM_HOSTED_ZONE_NAME=openweightmodels.com
pnpm deploy:staging
```

This builds ARM64 web and worker images, pushes them to ECR, creates the CDK
foundation stack, runs the database bootstrap task (migrations plus the Model
registry, never development content), then creates/rolls the ECS services. The
OpenRouter key is written once to Secrets Manager after the first deploy — it is
never a commit, a `.env` value or a task environment. Staging uses SES for magic
links through the web task role; in the SES sandbox only verified addresses
receive mail. CloudWatch alarms, budgets, CI/CD and edge rate limits are ticket
16.

### Checks

```bash
pnpm typecheck
pnpm test                    # unit + integration tests (needs Postgres and Redis)
pnpm test:live               # opt-in real-provider smoke call (needs a key)
pnpm build
pnpm test:e2e                # browser journey, with an isolated database and Redis DB
```

The browser suite seeds `openweightmodels_e2e` and Redis database `1`, then starts its own web and
worker servers on port 3100. Install the browser once with `pnpm exec playwright install chromium`.
It needs `psql` and `redis-cli` on `PATH` (Homebrew installs both). Override the targets with
`E2E_DATABASE_URL` and `E2E_REDIS_URL`; the suite refuses to seed the development database or
flush the development Redis DB index.

### Accessibility and fidelity checks

`e2e/a11y.spec.ts` runs axe-core against the Board, Comparison (including an open Annotation
thread), New Comparison and Job screens and fails on any critical or serious finding.
`e2e/keyboard.spec.ts` drives Annotation threads, Discussion compose/reply/edit/delete, Add model
and the admin takedown panel with the keyboard, checks Escape with an unsent draft, and asserts
`prefers-reduced-motion` turns off the ticker, arrival, shimmer and pulse animations.
`e2e/responsive.spec.ts` proves the four main screens stack at 768px and 360px without document
overflow, and `e2e/visual.spec.ts` keeps 1440×900 baselines for them (1% pixel tolerance) plus the
v2 measurements (52px header, 30px ticker, 216px sidebar, 20px gutters, 8px card gap, 1120/1480
page widths). Update the baselines deliberately after a visual review with
`pnpm test:e2e e2e/visual.spec.ts --update-snapshots`; the spec reseeds the E2E database so other
suites' mutations cannot leak into the images. Playwright suffixes snapshots with the platform
(`*-darwin.png` here), so generate and commit a set on each OS a CI job runs on before enabling the
visual suite there.

## Scripts

| Script | Purpose |
|---|---|
| `pnpm dev:web` | Next.js dev server |
| `pnpm dev:worker` | BullMQ worker consuming the generation queue |
| `pnpm db:generate` | Generate Drizzle SQL from schema |
| `pnpm db:migrate` | Apply migrations |
| `pnpm db:bootstrap` | Apply migrations and upsert the Model registry only (production) |
| `pnpm db:init` | Apply migrations, seed only when the database is empty |
| `pnpm db:seed` | Reset and seed dev data |
| `pnpm db:reset` | Drop and recreate the public schema (refuses production) |
| `pnpm stack:up` | `docker compose up --build` |
| `pnpm stack:down` | Stop the stack, keep data |
| `pnpm stack:reset` | Delete volumes, then rebuild and start |
| `pnpm stack:logs` | Follow web and worker logs |
| `pnpm stack:seed` | Reseed content inside the running stack |
| `pnpm cdk:synth` | Synthesize the AWS staging templates |
| `pnpm deploy:staging` | Build, push and release the staging stack |
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
| `docs/adr/` | Architectural decisions 0001–0007 |
| `docs/IMPLEMENTATION-STATUS.md` | What is built, what is missing, known issues, next steps |
| `docs/DEPLOYMENT.md` | AWS staging topology, first deploy, release, rollback, cost and smoke tests |

## Repository layout

```
apps/web                 Next.js app, API routes, UI
apps/worker              BullMQ consumer for queued Runs, health endpoint
packages/core            Drizzle schema, domain logic, queries, services, seed
packages/core/drizzle    Generated SQL migrations
infra                    AWS CDK staging stacks, deploy script and template tests
docker-compose.yml       Local web + worker + Postgres + Redis + Mailpit
Dockerfile               Development, web and worker images
docs/                    ADRs, decision log, implementation status
design_handoff_openweightmodels/   Read-only design handoff
```

## Core rules

- A Comparison is a user-authored post; duplicate Prompts are allowed.
- Reading is public; creating, annotating, commenting, voting and publishing require a session and a claimed handle.
- Prompt and Base output freeze after scheduling; title/categories/effort stay editable.
- Publish requires at least one Done Challenger; drafts are author-only and return `404` to everyone else.
- Annotations are stored as UTF-16 offsets into raw markdown and must fit within one annotatable text node or fenced code block.
- Votes live only in the `votes` table; self-voting is rejected.
- Discussion replies are one level deep.
- Postgres is canonical; Redis is transport and pub/sub only.
