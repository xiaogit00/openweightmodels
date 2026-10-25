# Codebase tour — how OpenWeightModels works

This is a guided tour of the implementation in this repository. It assumes you can read TypeScript but **not** that you already know Next.js, Drizzle, BullMQ, Redis pub/sub or SSE. It explains each layer in plain language, then traces every important user action from the browser to Postgres and back.

Companion document: [`docs/LABS.md`](LABS.md) — small, runnable experiments for each layer.

Canonical contracts:

| Document | What it is |
|---|---|
| [`BACKEND.md`](../BACKEND.md) | The accepted data model, API, job and SSE contract |
| [`GLOSSARY.md`](../GLOSSARY.md) | The domain vocabulary; use these words in code and commits |
| [`docs/DECISIONS.md`](DECISIONS.md) | Settled decisions, rejected alternatives and open questions |
| [`docs/adr/`](adr/) | Architectural decisions 0001–0007 |
| [`docs/IMPLEMENTATION-STATUS.md`](IMPLEMENTATION-STATUS.md) | What is built, what is missing, known issues |
| `design_handoff_openweightmodels/designs/* v2.dc.html` | The visual source of truth |

> **Rule of thumb:** `BACKEND.md` is the contract; the code is the truth for details. Where they disagree, note the difference and fix one of them deliberately. Known mismatches are recorded in §9.

**Contents:** [0. One paragraph](#0-the-one-paragraph-version) · [1. Vocabulary](#1-vocabulary-you-must-internalise) · [2. Stack](#2-the-stack-element-by-element) · [3. Repository map](#3-repository-map) · [4. Data model](#4-data-model-in-plain-english) · [5. End-to-end flows](#5-end-to-end-flows) · [6. Behaviour reference](#6-behaviour-reference) · [7. Click-to-write map](#7-what-happens-when-you-click-something) · [8. Implementing a feature](#8-implementing-the-next-feature) · [9. Sharp edges](#9-sharp-edges-and-known-deviations) · [10. Reading plan](#10-reading-plan) · [Appendices](#appendix-a--scripts)

---

## 0. The one-paragraph version

OpenWeightModels is a forum for side-by-side model comparisons. A **Comparison** is a user-authored post: one uploaded **Base output** (markdown) plus one to four **Challenger** responses that the platform generates from the same **Prompt**. A Next.js web app renders the public Board, accepts writes, and streams live updates over Server-Sent Events (SSE). A separate BullMQ worker consumes one Redis job per Challenger **Run**, calls an OpenAI-compatible provider (or a deterministic mock), and writes every status change and final response to Postgres. Postgres is the source of truth; Redis is only the queue and the live fan-out. The author explicitly publishes when at least one Challenger is done, and the public Board updates live.

```
Browser
  │  HTTP (pages + JSON API)
  ▼
Next.js web (apps/web) ────────── SQL ──────────► Postgres
  │  ▲                                             ▲
  │  └──── SSE (replay + live) ───────┐            │
  │                                   │            │
  └──── enqueue Run ──► Redis ◄───────┘            │
                         │  BullMQ queue            │
                         ▼                         │
                    Worker (apps/worker) ──── SQL ─┘
                         │
                         └──► OpenAI-compatible provider
```

Both apps import `@owm/core`, which contains the schema, domain rules, queries, services and provider adapters. The worker and the web server run the **same code** for generation semantics; only the entry point differs.

**Six things to remember**

1. The **web app** renders pages, accepts writes and streams updates. It does not generate.
2. The **worker** consumes one queue job per Challenger Run and calls the provider.
3. **Postgres is canonical**; Redis is only transport and fan-out.
4. Every state transition is a **row update** plus an **event row**; the event row is what makes replay work.
5. **SSE** is replay-from-Postgres plus live-from-Redis, with a poll fallback.
6. The **Comparison lifecycle** is `generating → ready → published`, and Publish is explicit.

---

## 1. Vocabulary you must internalise

The full list is in [`GLOSSARY.md`](../GLOSSARY.md). These are the ones that appear everywhere:

| Term | Meaning | Not this |
|---|---|---|
| **Comparison** | One post: Base output + Challengers for one Prompt | thread, entry |
| **Prompt** | The instruction every Response answers | question, task |
| **Base output** | The author-uploaded markdown | base response, upload |
| **Base model** | The Model that produced the Base output | source model |
| **Challenger** | A Model the platform generates against the Prompt | competitor |
| **Response** | One Model's output, base or generated | completion, answer |
| **Author** | The user who created the Comparison | owner, poster |
| **Category** | Fixed topical tag (`Coding`, `Reasoning`, …) | tag |
| **Effort** | Low / Med / High (`1`–`3`) | difficulty |
| **Board** | Public feed of published Comparisons | feed, home |
| **Publish** | Make a Comparison visible on the Board | release, post |
| **Draft** | Not published; author-only | unpublished post |
| **Takedown** | Admin hides a published Comparison | delete |
| **Hidden content** | Admin removed a comment/Annotation from view | deleted |
| **Report** | Reader asks an Admin to review content | flag |
| **Suspension** | Admin blocks writes, keeps reads | ban |
| **Handle** | Public identity, `@handle` | username |
| **Model** | A registry entry for an open-weight LLM | provider |
| **Job** | One batch of generation work | task, run |
| **Run** | One attempt to generate one Challenger's Response | task, job |
| **Annotation** | Threaded note on a character range of a Response | highlight |
| **Discussion** | Comparison-level conversation | comments |
| **Vote** | Upvote on a comment or Annotation | like |

Two distinctions that cause most confusion:

- A **Job** is a batch; a **Run** is one model inside it. Creating a Comparison with three Challengers creates **one Job and three Runs**.
- A **Response** is the row that stores content. A **Run** is the lifecycle of a non-base Response. Retry reuses the same Response row and increments `attempt`.

---

## 2. The stack, element by element

### 2.1 Node.js, TypeScript and pnpm workspaces

**What it is.** Node runs JavaScript/TypeScript outside the browser. TypeScript adds static types that are erased at runtime. pnpm installs dependencies and links local packages.

**How this repo uses it.**

- `package.json` at the root declares the workspace scripts and dev tools.
- `pnpm-workspace.yaml` includes `apps/*`, `packages/*` and `infra`.
- There are three application packages:
  - `apps/web` — Next.js UI and HTTP API.
  - `apps/worker` — BullMQ consumer.
  - `packages/core` — shared domain, database, providers, services, seed.
- `packages/core` is imported as `workspace:*`. There is no build step for it during development; apps import its TypeScript directly.
- `infra` is a fourth package: AWS CDK infrastructure, tests and deploy scripts.

**Why a shared core?** The web app and worker must agree on state transitions, validation and SQL. Putting them in one package prevents drift between two implementations.

**Learn it by:** running `pnpm -r typecheck`, and reading `packages/core/package.json` `exports`.

### 2.2 Next.js 16 App Router and React 19

**What it is.** Next.js is a React framework. The **App Router** maps folders under `app/` to URLs. React 19 renders the UI.

The two component types are the key idea:

| Kind | Runs where | Can use | This repo's examples |
|---|---|---|---|
| **Server Component** (default) | On the server, per request | `async`, database, secrets, `headers()` | `app/page.tsx`, `app/comparisons/[id]/page.tsx`, `app/admin/page.tsx` |
| **Client Component** (`'use client'`) | In the browser (also prerendered) | state, effects, event handlers, `window`, `EventSource` | `BoardClient`, `ComparisonView`, `JobSummary`, `NewComparisonClient` |

A typical page is a thin server component that fetches data and passes serialisable props to a client component:

```tsx
// app/page.tsx (server)
const [user, page, facets, models, events] = await Promise.all([...]);
return <BoardClient initialPage={page} initialFacets={facets} ... />;
```

The client component owns interaction and live updates. This is why `board-client.tsx` is large: it is the browser-side state machine for filters, pagination, live arrivals and the ticker.

**File conventions used here:**

| File | Meaning |
|---|---|
| `app/layout.tsx` | Root HTML, fonts, footer |
| `app/page.tsx` | `/` |
| `app/comparisons/[id]/page.tsx` | `/comparisons/:id` |
| `app/comparisons/[id]/job/page.tsx` | `/comparisons/:id/job` |
| `app/api/**/route.ts` | HTTP API endpoints (route handlers) |
| `app/globals.css` | Global CSS and Tailwind theme |

**Route handlers** are the API. They export functions named after HTTP methods (`GET`, `POST`, `PATCH`, `DELETE`) and receive a standard `Request`. They are not cached by default. Most here also declare:

```ts
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
```

`force-dynamic` means "render this per request, do not statically cache it". This app is a live forum; every page depends on the session and database. There are **no React Server Actions** in this codebase; writes are ordinary `fetch` calls to route handlers.

**Why this matters for you:** if you add a page that reads the database or the session, default to a server component plus `dynamic = 'force-dynamic'`. If you add a button, put it in a client component. Do not import database code into a client component.

**Next 16 caution.** The repo has an `apps/web/AGENTS.md` note: this Next version has breaking changes relative to older training data. Read the installed docs under `apps/web/node_modules/next/dist/docs/` before changing framework-level behaviour.

### 2.3 Tailwind v4, Radix and Phosphor

- **Tailwind v4** is CSS-first. There is no `tailwind.config.js`. The theme lives in `apps/web/src/app/globals.css` inside `@theme { ... }`: colours, fonts, radii, shadows. Utility classes such as `bg-surface`, `text-neutral-400` and `rounded-[2px]` come from those tokens.
- **Radix UI** supplies accessible primitives. The Add model menu, annotation popovers and report menu use `@radix-ui/react-popover`.
- **Phosphor Icons** supplies icons. Server components import from `@phosphor-icons/react/dist/ssr`; client components import from `@phosphor-icons/react`.
- The visual language is deliberately dense: 2px radii, 12px body text, lime accent, monospace body font, Space Grotesk headings. Fidelity is tested by Playwright screenshots.
- Motion is centralised in `.anim-*` / `.arrive-*` classes so `prefers-reduced-motion` can turn the ticker static and remove arrival/shimmer/pulse/spin without layout jumps.

**Learn it by:** changing a token in `globals.css` and watching the whole app update. Lab 14 does this.

### 2.4 PostgreSQL 17

**What it is.** A relational database. Data lives in tables with typed columns, constraints and indexes. Transactions make a group of writes atomic.

**How this repo uses it.**

- Every application entity is a table. See `packages/core/src/db/schema.ts`.
- Primary keys are **UUIDv7**, generated in the application. UUIDv7 is time-ordered, so inserts have good index locality and the ID itself encodes creation order.
- Event log IDs (`activity_events.id`, `job_events.id`) are `bigserial`. They are monotonic, which makes them perfect SSE cursors.
- Timestamps are `timestamptz` and stored in UTC.
- Arrays and JSONB are used deliberately:
  - `comparisons.categories` is `text[]` (fixed list, containment queries).
  - `activity_events.payload` and `job_events.payload` are `jsonb` (flexible snapshots for live UI).
- Constraints encode business rules:
  - `UNIQUE (comparison_id, model_id)` on Responses prevents duplicate models.
  - A partial unique index allows exactly one `is_base = true` per Comparison.
  - `UNIQUE (user_id, target_type, target_id)` on Votes makes voting a toggle.
  - A partial unique index on notifications deduplicates `job.ready` per author per Job.
- `comparisons.comment_count` and `annotation_count` are denormalised so the Board does not aggregate on every page load. They are updated in the same transaction as the content change.

**Learn it by:** Lab 1 queries the live tables.

### 2.5 Drizzle ORM and migrations

**What it is.** Drizzle is a TypeScript ORM (object-relational mapper) and query builder. You describe tables in TypeScript; Drizzle generates SQL and gives you typed query results. Migrations are SQL files applied in order, so every environment reaches the same schema without manual edits.

**How this repo uses it.**

- `packages/core/src/db/schema.ts` is the schema. `$inferSelect` / `$inferInsert` derive row types.
- `packages/core/src/db/client.ts` creates one `postgres` connection pool and one Drizzle instance per process, cached on `globalThis` to survive Next hot reloads.
- `packages/core/src/queries.ts` contains read queries. Services in `packages/core/src/services/` contain writes and business rules.
- `packages/core/drizzle/` contains generated SQL migrations and snapshots. `drizzle.config.ts` points at the schema and output folder.
- `pnpm db:generate` runs `drizzle-kit generate` after a schema edit.
- `pnpm db:migrate` applies pending migrations.
- `pnpm db:init` applies migrations and seeds only when the database is empty.
- `pnpm db:bootstrap` applies migrations and upserts the Model registry only — the production path.
- `pnpm db:reset` drops and recreates the public schema; it refuses production.

**Why Drizzle instead of raw SQL?** Type safety at the call site and one schema definition that drives both queries and migrations. It still lets you drop to `sql\`...\`` for keyset comparisons, `FOR UPDATE` and aggregates.

**Learn it by:** reading `listComparisons` in `queries.ts` (keyset pagination) and `createComparison` in `services/comparisons.ts` (transaction).

### 2.6 Redis and BullMQ

**What Redis is.** An in-memory data store. Here it does exactly two jobs:

1. **Queue transport** for BullMQ.
2. **Pub/sub fan-out** for SSE. Pub/sub means a publisher sends one message to a channel; every process subscribed to that channel receives a copy. The SSE route subscribes; the web app and worker publish.

**What BullMQ is.** A Redis-backed job queue for Node. You add a named job with data; a worker process picks it up. It supports retries, delays, concurrency and deduplication by job ID.

**How this repo uses it.**

- Queue name: `owm-runs`.
- One BullMQ job per Run, with data `{ responseId }`.
- Also one delayed `auto-skip` job per failed attempt, with a deterministic ID `auto-skip-<responseId>-<attempt>` and a 24-hour delay by default.
- Worker concurrency defaults to `PROVIDER_CONCURRENCY=4`.
- `removeOnComplete` / `removeOnFail` keep the last 200 jobs.
- `attempts: 1`: BullMQ does **not** retry. Retry is an explicit user action that re-enqueues the same Response row after incrementing `attempt`. This keeps retry semantics and UI state in Postgres, not in the queue.
- Redis is configured with pub/sub channels `owm:board` and `owm:job:<jobId>`.
- Production Redis must use `maxmemory-policy: noeviction`; BullMQ is incompatible with eviction and with ElastiCache Serverless.

**Postgres is canonical.** If Redis is wiped, the queue can be rebuilt from non-terminal Responses. The SSE route also polls Postgres every two seconds, so live updates survive a Redis outage (with latency).

**Learn it by:** Lab 6 (stop the worker, watch queued work) and Lab 8 (subscribe to the raw channel).

### 2.7 Server-Sent Events (SSE)

**What it is.** A one-way stream from server to browser over ordinary HTTP. The browser API is `EventSource`; the server sends `text/event-stream` with lines like:

```
id: 42
data: {"type":"comparison.published", ...}

```

**Why not WebSockets?** The updates are one-way. SSE reconnects automatically, works through the ALB, and is simpler to operate. The ALB idle timeout is raised to 4000s and the server sends a heartbeat every 20s.

**How this repo uses it.**

- `apps/web/src/lib/sse.ts` is the shared implementation.
- On connect it:
  1. writes `: connected`,
  2. replays events after `Last-Event-ID` (or `?after=`) from Postgres,
  3. subscribes to a Redis channel for live events,
  4. starts a 2s Postgres poll fallback and a 20s heartbeat.
- Every event is persisted **before** it is published to Redis. That ordering is what makes replay possible.
- `id` is the Postgres `bigserial`. `send()` ignores any event whose ID is not greater than the last sent ID, so replay + pub/sub duplicates are harmless.
- The Board stream is public. The Job stream is author-only and checked before the stream starts.

**Event kinds:**

| Channel | Kinds | Consumer |
|---|---|---|
| `owm:board` | `comparison.published`, `comparison.restored`, `comparison.takedown`, `run.finished`, `annotation.created`, `annotation.replied`, `annotation.deleted`, `annotation.hidden`, `annotation.restored`, `comment.created`, `comment.replied`, `comment.deleted`, `comment.hidden`, `comment.restored`, `annotation.message.deleted`, `account.deleted` | Board ticker, live card inserts/removals, counters |
| `owm:job:<id>` | `job.scheduled`, `response.status`, `job.ready` | Job page, author-only pending tabs on a Comparison |

**Learn it by:** Lab 8.

### 2.8 Authentication: Better Auth magic links

**What it is.** Better Auth handles email magic-link sign-in, sessions and cookies. The app keeps its own `users` row as the identity that content references.

**Flow.**

1. `/sign-in` posts an email to Better Auth (`/api/auth/sign-in/magic-link`).
2. Better Auth stores a **hashed** single-use token in `auth_verifications` and emails a link containing the raw token.
3. The link hits `/api/auth/magic-link/verify`; Better Auth verifies, creates/updates the user and session, and redirects to `/auth/complete`.
4. `/auth/complete` sends a new account to `/onboarding` (claim a handle) or a returning account to `next`.
5. The session is a cookie. `getCurrentUser()` reads the Better Auth session first, then the development identity cookie.

**Important seams** (`apps/web/src/lib/auth.ts`):

| Function | Use |
|---|---|
| `getCurrentUser()` | Any read that depends on identity |
| `getViewerId()` | Read-only viewer ID or `null` |
| `requireSession()` | Signed-in reads, e.g. notifications; no handle required |
| `requireUser()` | Every content write; rejects suspended accounts and accounts without a handle |
| `requireAdmin()` | Admin routes; returns `404` to non-admins |

**Development identity.** `POST /api/dev/user { "handle": "mira" }` sets an `owm_user` cookie. It is impossible in production (`NODE_ENV=production`), regardless of `ALLOW_DEV_USER_SWITCH`. The dev magic-link outbox `GET /api/dev/magic-link?email=` is also development-only.

**Email.** Local default is SMTP to Mailpit (`smtp://localhost:1025`). Production uses SES v2 through the ECS task role. Without Mailpit the link is logged and kept in the dev outbox.

**Learn it by:** Lab 11.

### 2.9 Validation and parsing

Zod is a runtime validator: TypeScript types disappear at runtime, so Zod checks the actual JSON or form data that arrives at the HTTP boundary. YAML front matter is the optional `---` block at the top of an uploaded markdown file.

Two layers, deliberately:

| Layer | Responsibility | Location |
|---|---|---|
| HTTP boundary | Shape, types, enum membership, body size | Zod schemas in `apps/web/src/lib/validation.ts` |
| Domain | Business rules, ranges, quotas, ownership, state transitions | `packages/core/src/domain/` and `services/` |

Examples:

- `annotationCreateSchema` checks that offsets are integers and `body` is 1–5000 characters; `validateAnnotationRange` checks that the range lies inside one annotatable run and derives the quote.
- The New Comparison form parses the upload locally for a preview, but the server re-parses it in `createComparison`. Never trust client-side parsing.
- Upload parsing uses `yaml` with `schema: 'core'` and `maxAliasCount: 0` (no aliases, no custom tags), rejects NUL bytes and invalid UTF-8, and caps files at 1 MB.
- Markdown is parsed with `unified` + `remark-parse` into an mdast. Only a safe subset is rendered; raw HTML is shown as text.

**Learn it by:** Labs 2 and 3.

### 2.10 Tests, local stack and deployment

| Tool | Role |
|---|---|
| **Vitest** | Unit + integration tests. Core tests use real Postgres and Redis when available and skip integration files otherwise. |
| **Playwright** | Browser journeys. It creates an isolated database (`openweightmodels_e2e`) and Redis DB `1`, starts its own web + worker on port 3100, and refuses to touch dev data. |
| **axe-core** | Accessibility checks in `e2e/a11y.spec.ts`; fails on critical/serious findings. |
| **Docker Compose** | Runs several containers from one YAML file. Local stack: web, worker, Postgres, Redis, Mailpit, and a `migrate` service. |
| **AWS CDK** | Infrastructure as code in TypeScript. `infra/` synthesises CloudFormation for the staging stack. |

The AWS pieces, in plain language:

| Piece | What it does here |
|---|---|
| **ECS Fargate** | Runs the web and worker containers without managing EC2 servers |
| **RDS Postgres** | Managed Postgres |
| **ElastiCache Redis** | Managed Redis (a standard node, not Serverless) |
| **SES** | Sends magic-link email |
| **ECR** | Stores the web and worker images |
| **Secrets Manager** | Stores the database password and provider key |
| **ALB** | HTTPS load balancer; idle timeout raised for SSE |
| **CloudWatch** | Logs and metrics |

**Learn it by:** Lab 15.

---

## 3. Repository map

```
openweightmodels/
├── apps/
│   ├── web/                 Next.js app, pages, route handlers, client components
│   └── worker/              BullMQ consumer + health endpoint
├── packages/
│   └── core/
│       ├── src/db/          schema, client, migrations runner, seed bootstrap
│       ├── src/domain/      pure rules: types, upload, markdown, cursor, filters, handle
│       ├── src/services/    write use-cases: comparisons, jobs, annotations, comments, votes, admin, moderation, account
│       ├── src/queries.ts   read models: Board, Comparison bundle, Job bundle, notifications
│       ├── src/events.ts    activity + job event persistence and replay
│       ├── src/queue.ts     BullMQ queue + auto-skip
│       ├── src/providers.ts mock and OpenAI-compatible providers
│       ├── src/redis.ts     connections, channels, publish
│       ├── src/seed.ts      deterministic development fixtures
│       └── drizzle/         generated SQL migrations + snapshots
├── infra/                   CDK stacks, deploy script, template tests
├── e2e/                     Playwright suites, isolated DB setup
├── design_handoff_openweightmodels/   read-only visual source of truth
└── docs/                    ADRs, decisions, status, deployment, this tour, labs
```

### The ten files to read first

Read them in this order. Each one unlocks the next.

| # | File | Why |
|---|---|---|
| 1 | `packages/core/src/db/schema.ts` | The shape of all state |
| 2 | `packages/core/src/domain/types.ts` | Shared enums, card/view types, progress |
| 3 | `packages/core/src/services/comparisons.ts` | Create, publish, unpublish, update, add model, retry, skip |
| 4 | `packages/core/src/services/jobs.ts` | The generation state machine |
| 5 | `packages/core/src/providers.ts` | Mock vs real provider, streaming, errors, cost |
| 6 | `packages/core/src/events.ts` | Persist then publish; replay queries |
| 7 | `apps/web/src/lib/sse.ts` | Replay + pub/sub + poll + heartbeat |
| 8 | `apps/web/src/components/board-client.tsx` | The Board's client state machine |
| 9 | `apps/web/src/components/comparison-view.tsx` | Tabs, annotations, discussion, add model |
| 10 | `apps/web/src/components/job-summary.tsx` | Live Job page, retry/skip, publish |

Then skim `packages/core/src/queries.ts` (843 lines) as a reference rather than reading it top to bottom.

### Import boundary (important)

`packages/core` has two entry points:

| Import | Contains | Use from |
|---|---|---|
| `@owm/core` | Everything, including `postgres`, `ioredis`, `bullmq` | Server components, route handlers, worker, scripts |
| `@owm/core/client` | Pure domain only (no DB/Redis/queue) | Any `'use client'` component |

If a client component imports `@owm/core`, the database driver enters the browser bundle and the build fails or bloats. This is the #1 rule in `docs/IMPLEMENTATION-STATUS.md`.

---

## 4. Data model in plain English

### 4.1 Table groups

| Group | Tables | Purpose |
|---|---|---|
| Identity | `users`, `auth_sessions`, `auth_accounts`, `auth_verifications` | Accounts, handles, sessions, magic-link tokens |
| Catalogue | `models` | Curated Model registry; provider + `api_model_id` |
| Content | `comparisons`, `responses` | The post and its outputs |
| Generation | `jobs`, `job_events` | A batch of Runs and its replay log |
| Discussion | `annotations`, `annotation_messages`, `comments`, `votes` | Annotations, threads, Discussion, voting |
| Live feed | `activity_events`, `notifications` | Public ticker/replay; in-app alerts |
| Moderation | `reports`, `admin_actions` | Reports queue and append-only audit |

### 4.2 Relationship sketch

```
users ──1:N── comparisons ──1:N── jobs ──1:N── responses ──N:1── models
  │                │                             ▲
  │                ├──1:N── comments ──N:1── users
  │                │            └── self-reference parent_id (one level)
  │                └── (annotations attach to responses, not comparisons)
  ├──1:N── annotations ──1:N── annotation_messages
  ├──1:N── votes (polymorphic: comment | annotation)
  ├──1:N── notifications
  └──1:N── admin_actions / reports

comparisons ──1:N── activity_events (public log, optional comparison_id)
jobs ─────────1:N── job_events (per-job replay log)
```

### 4.3 State machines

**Comparison**

```
draft (reserved)

generating ──all Runs settled──► ready ──publish──► published
     ▲                              ▲                  │
     └──────── add model ───────────┘                  │
                                                       │
                        ready ◄────── unpublish ───────┘
```

- M1 creates `generating` directly; `draft` is reserved for future explicit drafts.
- `failed` is also reserved: a failed Run does not move the Comparison to `failed`.
- `published` can gain Challengers without leaving `published`.
- A failed Run blocks `ready` until retried, skipped, or auto-skipped after 24h.
- Publish requires at least one `done` Challenger.
- Soft delete (`deleted_at`) hides from everyone.
- Takedown (`takedown_at`) hides from public and author; an Admin can still review it.

**Run (a non-base Response)**

```
queued ──► calling ──► streaming ──► done
  │          │            │
  └──────────┴────────────┴──► failed ──retry──► queued
                                 └──skip──► skipped
```

- Retry reuses the same row and increments `attempt`.
- Skip is allowed from `failed` or `queued`; it finalises the Job.
- The 24h auto-skip is a delayed BullMQ job, scoped to the attempt.

**Job**

```
scheduled ──► running ──► ready
```

`resolving` and `failed` exist in the enum but the current pipeline never sets them (see §9).

### 4.4 Why these particular constraints

- **One Base per Comparison**: a partial unique index `WHERE is_base = true`. The Base is the anchor; a Comparison with two bases has no meaning.
- **No duplicate model in one Comparison**: `UNIQUE (comparison_id, model_id)`. It makes "add the same model twice" impossible even under a race.
- **One vote per user per target**: a unique index on Votes makes toggle logic trivial and race-safe at the DB level.
- **Denormalised counters**: `comment_count` includes replies; `annotation_count` counts live Annotations. Both are adjusted in the same transaction as the content write, and both are decremented by moderation/account deletion. The Board's `top` sort uses `comment_count + 2 * annotation_count`.
- **Event IDs as cursors**: `bigserial` gives a total order that both replay and live delivery can compare. `UUIDv7` would not be a safe cursor across concurrent inserts.

---

## 5. End-to-end flows

### 5.1 Reading the Board

Files: `apps/web/src/app/page.tsx`, `packages/core/src/queries.ts`, `apps/web/src/components/board-client.tsx`.

1. The server component calls `getCurrentUser()`, `listComparisons()`, `getBoardFacets()`, `getModels()` and `recentActivity(24)` in parallel.
2. `listComparisons` filters to `status = 'published'`, `deleted_at IS NULL`, `takedown_at IS NULL`, applies `cat` / `models` / `effort` / `q`, orders by the chosen sort, and fetches `limit + 1` rows to know whether there is a next page.
3. It returns `{ items, total, nextCursor }`. `total` is the count for the **active filters**; `nextCursor` is an opaque base64url JSON cursor.
4. `BoardClient` hydrates with that page. It owns filters, loaded items, facets, pending live arrivals, ticker events, loading/error state and live/reconnecting state.
5. Filters are pushed to the URL with a 180ms debounce. `popstate` restores the view. A request sequence counter plus `AbortController` ensures a slow response cannot overwrite a newer view.
6. `IntersectionObserver` on a sentinel 600px before the bottom calls `loadMore`; a visible **Load more** button is the accessible fallback. Both use the same 48-item page size.
7. One `EventSource('/api/stream/board')` lives for the page's lifetime. Sort/filter changes do not resubscribe; they only update refs. Reconnects resume from the browser's `Last-Event-ID`.
8. On `comparison.published`:
   - sidebar facets are incremented globally,
   - if the card matches the active filters, `total` increases,
   - near the top on `live`/`new`, the card is inserted with an arrival animation,
   - otherwise it goes into a "N new comparisons" pill and does not move content under the reader,
   - on `top`, it always goes to the pill because placing it would require re-ranking.
9. `annotation.created`, `comment.created`, deletes, hides and account deletion adjust card counts in place. `run.finished` replaces a live card with its settled version.

**Why facets are separate.** Sidebar counts are global and ignore the reader's active filters. Computing them from the loaded page would make the sidebar shrink as you scroll. `GET /api/comparisons/facets` aggregates the whole published Board once per page load; live publishes patch it, and a reconnect refetches it.

### 5.2 Creating a Comparison

Files: `apps/web/src/components/new-comparison-client.tsx`, `apps/web/src/app/api/comparisons/route.ts`, `packages/core/src/services/comparisons.ts`.

1. The author drops a `.md`/`.markdown`/`.txt` file (≤1 MB) or clicks **Use a sample file**.
2. The client validates size, decodes UTF-8, parses front matter, and fills the Prompt/Title/Base model where possible. This is a **preview**; the server re-does all of it.
3. The client shows live "ON THE BOARD" draft preview and a readiness hint (`describeSchedule`). It submits `multipart/form-data`.
4. `POST /api/comparisons` calls `requireUser()` (session + not suspended + has handle), reads the file and fields, and calls `createComparison`.
5. `createComparison`:
   - calls `assertCanWrite` and `assertQuota` (10 Jobs/hour, 50 Runs/day),
   - parses the upload and validates prompt/title/categories/effort,
   - checks 1–4 unique Challengers, excludes the Base, and loads enabled Models,
   - generates UUIDv7 IDs for the Comparison, Job, Base Response and each Challenger Response,
   - **one transaction**: insert Comparison (`generating`), Job (`scheduled`), Base Response (`done`, uploaded body, estimated tokens), Challenger Responses (`queued`),
   - writes `job.scheduled` and enqueues **one BullMQ job per Challenger**.
6. The API returns `{ id, jobId, title }` with `201`. The client navigates to `/comparisons/:id/job`.
7. Generation has not happened yet. That is the worker's job.

**Why the Base is `done` immediately.** It is author-supplied content, not generated. Its tokens are estimated as `ceil(length / 4)`.

### 5.3 Generating: the worker

Files: `apps/worker/src/worker.ts`, `packages/core/src/services/jobs.ts`, `packages/core/src/providers.ts`.

1. BullMQ delivers a `run` job with `{ responseId }`.
2. `handleQueueJob` switches on the job name: `run` → `processRun`, `auto-skip` → `autoSkipRun`.
3. `processRun` loads the Response, Comparison and Model.
4. **Unknown model** and **disabled model** fail the Run with a clear error instead of calling a provider.
5. It **claims** the Run atomically: `UPDATE responses SET status='calling' WHERE id=? AND status='queued' RETURNING id`. If no row returns, another worker already claimed it. This is what makes at-least-once delivery safe.
6. It sets the Job to `running` (preserving the first `started_at`) and, if the Comparison is not published, sets it to `generating`.
7. It calls `getProvider(model).generate(...)`:
   - `MockProvider` streams a deterministic answer based on the prompt (and has failure knobs).
   - `OpenAICompatibleProvider` POSTs to the model's `api_base` `/chat/completions` with one user message, `temperature: 0.7`, `max_tokens: 4096`, `stream: true`, `stream_options.include_usage: true`, a 120s timeout, and the provider key from the environment.
8. `onToken` accumulates text and, at most every 500ms, updates `tokens` / `status = 'streaming'` and writes a `response.status` Job event.
9. On success it stores `content_md`, provider tokens, latency, cost, `done`, `finished_at`, and emits a final `response.status`.
10. On failure it stores the error (redacted of the API key), `failed`, latency and tokens, emits `response.status`, and enqueues a delayed auto-skip.
11. `finally` calls `finalizeJob`.

**Why the worker is separate.** A provider call can take 120s. Holding an HTTP request open for that, and doing it in the web process, would exhaust the web server and make concurrency limits impossible to enforce. The worker is a separate ECS service with its own scaling and health check.

### 5.4 Finalising a Job

Files: `packages/core/src/services/jobs.ts`, `packages/core/src/events.ts`.

`finalizeJob(jobId)` runs in a transaction:

1. `SELECT ... FOR UPDATE` the Job row. If it is already `ready` or `failed`, stop.
2. Load all non-base Responses for the Job.
3. If any is not `done` or `skipped`, set the Job to `running` and stop. (The Job is not ready yet.)
4. Lock the Comparison row, set the Job `ready`, set the Comparison `ready` if it was `generating`, and insert a `job.ready` notification for the author (`ON CONFLICT DO NOTHING` backed by the partial unique index).
5. After commit, write a `job.ready` Job event.
6. If the Comparison is already `published` (this was an add-model Job), write a `run.finished` activity event carrying the **settled card**, so the Board can replace the card's model list, snippets and counts without a second publish.

The notification is in-app only. The bell reads it; no email is sent.

### 5.5 Publishing

Files: `packages/core/src/services/comparisons.ts`, `apps/web/src/components/job-summary.tsx`.

1. The Job page shows **Publish to board** once the Job is settled and at least one Challenger is `done`.
2. `POST /api/comparisons/:id/publish`:
   - requires the author and a writable account,
   - requires `status = 'ready'` (a publishing Comparison returns its card idempotently),
   - requires ≥1 `done` Challenger,
   - sets `status='published'`, `published_at=now()`,
   - builds the full `ComparisonCard`,
   - writes `comparison.published` with `payload.card` and a ticker summary.
3. The Board receives the event: it inserts the card if it matches, bumps global facets, and shows the arrival pill/animation.
4. **Unpublish** sets `status='ready'` and `published_at=NULL`. It is not exposed in the current UI (see §9).
5. **Soft delete** sets `deleted_at`; the Comparison is hidden from everyone. The API exists; the UI does not expose it yet.

### 5.6 Adding a Challenger to a published Comparison

Files: `packages/core/src/services/comparisons.ts`, `apps/web/src/components/comparison-view.tsx`.

1. Only the author sees **Add model**, and only on a `published` Comparison.
2. The menu lists enabled Models excluding the Base and any Model already used. It disables at four Challengers and shows ETAs.
3. `POST /api/comparisons/:id/responses`:
   - requires author ownership,
   - allows `ready` or `published`,
   - rejects the Base, duplicates, disabled models, and the cap,
   - creates a new Job + queued Response in one transaction,
   - leaves a `published` Comparison published; moves a `ready` one back to `generating`,
   - enqueues the Run.
4. The new tab is **author-only** while pending. The author's page subscribes to `/api/stream/jobs/:jobId`, updates status in place, and resyncs from `GET /api/comparisons/:id/responses` when the Run settles.
5. A failed add is an author-only error tab with Retry/Dismiss. The public never sees it.
6. When it completes, `finalizeJob` emits `run.finished` with the settled card; the public tab appears and the Board card updates.

**Skipped Runs release a slot**; the model still counts as used, so it cannot be added again.

### 5.7 Retry, Skip and auto-skip

- **Retry** (`POST /api/responses/:id/retry`):
  - author-only, `failed` only,
  - sets `queued`, clears error/finished, increments `attempt`,
  - moves a `ready` Comparison back to `generating`,
  - emits a `queued` Job event, enqueues the Run, removes the old auto-skip timer.
- **Skip** (`POST /api/responses/:id/skip`):
  - author-only, `failed` or `queued` only,
  - sets `skipped`, finalises the Job immediately,
  - a skipped Run produces no content and is hidden from public reads.
- **Auto-skip**: on failure the worker enqueues a delayed BullMQ job for `AUTO_SKIP_DELAY_MS` (24h default). `autoSkipRun` checks the Run is still `failed`, sets `skipped`, emits the event and finalises. A retry gets a fresh window because the job ID is attempt-scoped.

### 5.8 Annotating a Response

Files: `packages/core/src/domain/markdown.ts`, `packages/core/src/services/annotations.ts`, `apps/web/src/components/comparison-view.tsx`, `apps/web/src/components/markdown-view.tsx`.

1. The viewer toggles **Annotations** on. Annotations only become selectable when on; creating one still requires a writable signed-in account.
2. `buildBlocks(contentMd)` parses the raw markdown into blocks and inline runs. Each run records its **raw source start offset**, its text, its inline marks, and whether it is `annotatable`.
3. A run is annotatable only when the raw markdown slice exactly equals the decoded text. That excludes escapes/entities, cross-format ranges, and indented code. Fenced code is annotatable; indented code is not.
4. On mouse-up or Shift/arrow key-up, the client checks that the selection is inside one `[data-run][data-annotatable="1"]` element and that anchor and focus are the same text node. It computes `startOffset = runStart + selectionStart` and `endOffset = runStart + selectionEnd` (UTF-16 code units).
5. It rejects a selection that overlaps an existing Annotation in the same Response (adjacent is fine) and shows **Annotate selection**.
6. `POST /api/annotations` re-validates everything on the server:
   - range fits one annotatable run,
   - non-empty quote,
   - no overlap,
   - body 1–5000 chars.
7. In one transaction it inserts the Annotation, inserts the first thread message, and increments `comparison.annotation_count`. The **server derives `quote`**; any client-supplied quote is ignored.
8. It writes `annotation.created` with a ticker summary.
9. Rendering splits the run text at annotation offsets and wraps the selected slice in a focusable `<span role="button">`. The thread popover shows kind, author, votes, messages, edit/delete controls.
10. Deleting the Annotation soft-deletes it, decrements the counter, removes its ticker lines, and emits a summary-less `annotation.deleted`.

**Why offsets into raw markdown?** The renderer is not the source of truth. Storing offsets into a rendered/normalised projection would move every highlight when the renderer changes. Raw markdown is immutable once a Response is `done`, so UTF-16 offsets into it are stable. See ADR 0002 and 0003.

### 5.9 Discussion and votes

Files: `packages/core/src/services/comments.ts`, `packages/core/src/services/votes.ts`.

- A root comment has `parentId = null`. A reply has `parentId` set.
- Replying to a reply is **re-parented to the original root**. `aboutModelId` is inherited from the parent when omitted.
- `comment_count` includes replies. It is incremented in the same transaction as the insert.
- A delete with replies is a **tombstone**: `deleted_at` is set, the body renders empty, and the replies survive in flat order. A childless comment is hard-deleted (and its votes are deleted).
- A hidden comment (Admin) is invisible, cannot receive replies or votes, and is excluded from the count. Hiding a parent hides its replies.
- Votes are a toggle. The `votes` table is the only source of truth. Self-voting is rejected. Counts are computed from the table, except the two denormalised Comparison counters.

### 5.10 Sign-in, onboarding and account deletion

Covered in §2.8. Account deletion (`packages/core/src/services/account.ts`) is worth understanding because it touches many tables:

1. Requires a typed confirmation matching `DELETE` (case-insensitive; the UI asks for uppercase).
2. Keeps the `users` row with `deleted_at` set and clears email, handle, name, image, avatar, suspension fields.
3. Deletes sessions, auth accounts, pending magic links, notifications, reports and votes.
4. Deletes unpublished Comparisons and their Responses.
5. Published Comparisons stay; their author renders as `[deleted]`.
6. Comments become tombstones so other people's replies survive.
7. Annotations follow the author-delete rule: they disappear with their highlights and threads; counters are decremented exactly.
8. Releases the handle and email for reuse.
9. Emits summary-less `account.deleted` events per affected Comparison so open Boards repair counts and ticker lines.
10. The last remaining Admin cannot delete its own account.

### 5.11 Moderation

Files: `packages/core/src/services/moderation.ts`, `packages/core/src/services/admin.ts`, `apps/web/src/components/admin-client.tsx`.

- **Report**: one row per reporter per target; repeating returns the existing row with `duplicate: true`. Reporting your own content is rejected; hidden/deleted/taken-down targets return `404`.
- **Hide**: Admin hides a comparison, comment or Annotation with a required reason. A hide also closes every open report on that target, writes `report.resolved`, decrements counters, removes ticker lines, and emits a summary-less hidden event.
- **Dismiss**: closes a report without changing content.
- **Restore**: restores a hidden comment or Annotation; increments counters and emits a restored event.
- **Takedown**: hides a **published Comparison** from public and author, keeps its Responses/Discussion, writes `comparison.takedown`, and emits a summary-less event so open Boards drop it. An Admin can still open it to review/restore.
- **Suspend**: blocks every user-generated write but keeps reads and sessions. Existing content stays public unless hidden separately. `requireUser` and `assertCanWrite` both enforce this.
- Every action writes an `admin_actions` audit row (actor, action, target, reason, timestamp).

---

## 6. Behaviour reference

### 6.1 Who can see what

| Viewer | Published | Ready/generating (author) | Ready/generating (others) | Taken down | Deleted |
|---|---|---|---|---|---|
| Anonymous / member | Yes | No (404) | No (404) | No (404) | No (404) |
| Author | Yes | Yes | — | No (404) | No (404) |
| Admin | Yes | No (404) | No (404) | Yes, to review/restore | No (404) |

Public reads of a Comparison omit `queued`, `calling`, `streaming`, `failed` and `skipped` Challengers. The author sees them.

### 6.2 HTTP semantics

- Errors use `{ error: { code, message } }`.
- Status codes: `400`, `401`, `403`, `404`, `409`, `429`, `500`.
- Authorization failures for drafts/deleted/taken-down Comparisons return `404`, not `403`, so existence does not leak.
- A suspended account gets `403 account_suspended` on writes.
- An account without a handle gets `403 handle_required` on writes.
- Quotas return `429 rate_limited`.

### 6.3 Board behaviour

- Page size: 48 (API clamps `limit` to 100).
- Sorts:
  - `live`: `published_at DESC, id DESC`
  - `new`: `created_at DESC, id DESC`
  - `top`: `(comment_count + 2 * annotation_count) DESC, published_at DESC, id DESC`
- Cursors are opaque base64url JSON and are **sort-specific**; using a `live` cursor on `top` returns `400 invalid_cursor`.
- Filters: `cat`, `models` (comma-separated slugs), `effort`, `q`, `sort`.
- `q` currently searches Comparison titles and Model display names, not the Prompt body.
- Facets are global; `total` in the list response is filter-scoped.
- Live arrival: near the top on `live`/`new`, the card inserts; otherwise it queues in a pill. `top` always queues.
- Re-clicking the active sort refetches page one (this is how `top` applies count changes).

### 6.4 Generation rules

- 1–4 Challengers per Comparison, including creation-time Challengers.
- The Base cannot be a Challenger; a Model cannot appear twice.
- Exactly one Base per Comparison.
- Identical generation parameters for every Challenger: same Prompt, `temperature: 0.7`, `max_tokens: 4096`, stream, 120s timeout.
- `PROVIDER=mock` is the default. A real mode is selected with `PROVIDER=openrouter` and requires `OPENROUTER_API_KEY`. There is **no silent fallback** to mock.
- `responses.cost_usd` stores provider-reported cost; it is not displayed in v1.
- Quotas: 10 Jobs/hour, 50 Runs/day, 4 concurrent provider calls per worker process. The concurrency cap is not enforced across multiple worker replicas.

### 6.5 Annotation rules

- Offsets are UTF-16 code units into raw `responses.content_md`; end exclusive.
- Must fit inside one annotatable text node or one fenced code block.
- Not annotatable: across bold/italic/link boundaries, escaped/entity text where raw ≠ decoded, indented code, across paragraph/block boundaries.
- Overlaps return `409 annotation_overlap`; adjacent is allowed.
- The quote is server-derived.
- The first message is created atomically with the Annotation.
- An Annotation with `hidden_at` is invisible to public reads and cannot receive messages or votes.
- Deleting an Annotation soft-deletes it; its votes remain in the table but are not read.

### 6.6 Discussion and vote rules

- Replies are one level. A reply to a reply is re-parented to the root.
- `about_model_id` is inherited from the parent when omitted.
- Reply order is oldest-first.
- A comment with replies is tombstoned on delete; a childless comment is hard-deleted.
- Hidden comments and their replies are invisible and cannot receive writes.
- Votes are a toggle. Self-votes are rejected. Counts come from the `votes` table.
- `comment_count` includes replies and is decremented on delete/hide; restore increments it again.

### 6.7 Notification rules

- v1 has one kind: `job.ready`.
- One notification per author per Job, enforced by a partial unique index.
- The bell shows unread count and newest-first items. Opening a notification item marks that item read; opening the Job/comparison directly does not. The bell also offers mark-all read.
- No email notifications; magic-link mail is transactional only.

---

## 7. What happens when you click something

| Action | Network | Main server work | DB writes | Live event |
|---|---|---|---|---|
| Search / filter | `GET /api/comparisons?...` | `listComparisons` (facets stay cached) | Reads only | — |
| Infinite scroll | `GET /api/comparisons?...&cursor=` | Same, keyset window | Reads only | — |
| Upload file | none (local) | Client parses preview only | none | — |
| Submit New Comparison | `POST /api/comparisons` (multipart) | `requireUser` → `createComparison` | Comparison, Job, Base Response, Challenger Responses | `job.scheduled` |
| Worker starts | Redis → worker | `processRun` | Response `calling`, Job `running` | `response.status` |
| Worker streams | Redis → worker | `onToken` | Response `streaming`/tokens every ≤500ms | `response.status` |
| Worker finishes | Redis → worker | `finalizeJob` | Response `done`, Job `ready`, Comparison `ready` (if generating), Notification | `response.status`, `job.ready` |
| Publish | `POST /api/comparisons/:id/publish` | `publishComparison` | `status=published`, `published_at` | `comparison.published` |
| Add model | `POST /api/comparisons/:id/responses` | `addModelToComparison` | Job, Response, Comparison status | `job.scheduled` |
| Retry | `POST /api/responses/:id/retry` | `retryRun` | Response `queued`, `attempt+1`, Comparison `generating` (if ready) | `response.status` |
| Skip | `POST /api/responses/:id/skip` | `skipRun` | Response `skipped`, `finalizeJob` | `response.status`, `job.ready` |
| Annotate | `POST /api/annotations` | `createAnnotation` | Annotation, first message, counter | `annotation.created` |
| Reply to Annotation | `POST /api/annotations/:id/messages` | `addAnnotationMessage` | Message | `annotation.replied` |
| Comment | `POST /api/comments` | `createComment` | Comment, counter | `comment.created` |
| Reply | `POST /api/comments` with `parentId` | `createComment` (re-parent) | Comment, counter | `comment.replied` |
| Vote | `POST /api/votes` | `toggleVote` | Vote insert/delete | none |
| Report | `POST /api/reports` | `createReport` | Report | none |
| Admin hide | `POST /api/admin/reports/:id/hide` | `hideReportedContent` | Hidden fields, counter, report closure, audit | `comment.hidden` / `annotation.hidden` |
| Admin takedown | `POST /api/admin/comparisons/:id/takedown` | `takeDownComparison` | `takedown_at`, audit | `comparison.takedown` |
| Delete account | `POST /api/account/delete` | `deleteAccount` | Many tables | `account.deleted` |

---

## 8. Implementing the next feature

### 8.1 Find the seam

| If the change is… | Start here | Then |
|---|---|---|
| A visual/interaction change | `apps/web/src/components/` | Use `@owm/core/client` only; run visual/a11y tests |
| A new read | `packages/core/src/queries.ts` + `apps/web/src/app/api/.../route.ts` | Add a server component or client fetch |
| A new write | `packages/core/src/services/` + a route handler | `requireUser`/`requireAdmin`, Zod schema, `apiError` |
| A new generation behaviour | `packages/core/src/services/jobs.ts` / `providers.ts` | Worker handler, job events, tests |
| A new realtime update | `packages/core/src/events.ts` + the relevant consumer | Add the event kind to the Board/Job client; persist before publish |
| A schema change | `packages/core/src/db/schema.ts` | `pnpm db:generate`, review SQL, `pnpm db:migrate`, update seed/fixtures |
| A moderation action | `packages/core/src/services/moderation.ts` / `admin.ts` | Add an `admin_actions` row, ticker/counter effects, Admin UI |
| An auth change | `apps/web/src/lib/auth.ts` | `requireUser`/`requireAdmin` call sites, e2e auth suite |

### 8.2 Golden rules

1. **Do not import `@owm/core` from a client component.** Use `@owm/core/client`.
2. **Postgres first, then Redis.** Persist the event/card, then publish. The SSE poll fallback depends on this.
3. **Every write goes through a service**, not directly in a route handler. The route is for auth, parsing and HTTP mapping.
4. **Validation belongs in two places**: Zod at the boundary, domain rules in `packages/core/src/domain`.
5. **Use a transaction when two rows must agree** (content + counter, Comparison + Job + Responses).
6. **Use the existing error helpers** (`notFound`, `forbidden`, `conflict`, `tooMany`) so the client gets the standard `{ error }` shape.
7. **404, not 403, for content you do not want to reveal.**
8. **Respect the state machines.** Do not publish a Comparison with zero done Challengers; do not retry a non-failed Run.
9. **Denormalised counters change with the content**, including on delete, hide, restore and account deletion.
10. **Add a test at the same layer as the change.** Pure domain → Vitest unit; DB/service → core integration; UI → Playwright.

### 8.3 Schema change walkthrough

Example: add `comparisons.source_url` (a nullable text field).

1. Edit `packages/core/src/db/schema.ts`:
   ```ts
   sourceUrl: text('source_url'),
   ```
2. Generate the migration:
   ```bash
   pnpm db:generate
   ```
   Review the new `packages/core/drizzle/NNNN_*.sql` and the snapshot. Never hand-edit the snapshot.
3. Apply:
   ```bash
   pnpm db:migrate
   ```
4. Expose it through the domain/query/service layers:
   - `ComparisonCard` in `domain/types.ts` if the Board needs it,
   - `cardFromRows` in `queries.ts`,
   - `updateComparison` and `createComparison` in `services/comparisons.ts`,
   - the Zod patch schema in `apps/web/src/lib/validation.ts`,
   - the New/Comparison UI.
5. Update `seed.ts` if fixtures should show it, and `test/fixtures.ts` if tests need it.
6. Add a migration test? The migration itself is exercised by `pnpm db:init`/`db:migrate`; add a service test for the new field.
7. Run `pnpm typecheck && pnpm test && pnpm build`.

**Production note:** migrations are forward-only and run before the ECS services roll (ADR 0007). A migration must be compatible with the currently running revision.

### 8.4 Testing walkthrough

| Layer | Command | What it costs |
|---|---|---|
| Pure domain | `pnpm --filter @owm/core exec vitest run test/markdown.test.ts` | Fast, no services |
| Core integration | `pnpm test` | Needs Postgres + Redis; skips integration files if absent |
| Web unit | `pnpm --filter @owm/web test` | Fast |
| Worker integration | `pnpm --filter @owm/worker test` | Needs Postgres + Redis |
| One browser spec | `pnpm test:e2e e2e/journey.spec.ts` | Seeds isolated DB + Redis DB 1 |
| Live provider | `pnpm test:live` | Calls a real provider and bills you |
| Visual snapshots | `pnpm test:e2e e2e/visual.spec.ts --update-snapshots` | Deliberate visual review |

Test patterns to copy:

- `packages/core/test/markdown.test.ts` — table-driven domain cases, including emoji/CJK.
- `packages/core/test/pipeline.test.ts` — create → generate → publish with the mock provider.
- `packages/core/test/provider-pipeline.test.ts` — fake OpenAI endpoint, cost/tokens, retry.
- `packages/core/test/permissions.test.ts` — author-only writes, self-vote, hidden content.
- `e2e/journey.spec.ts` — full browser journey across two identities.

### 8.5 Concrete gaps you could implement next

These are real gaps in the current implementation, not hypothetical:

1. **Author comparison controls.** `PATCH /api/comparisons/:id`, `DELETE /api/comparisons/:id` and `POST /api/comparisons/:id/unpublish` exist, but the Comparison UI does not expose edit, unpublish or delete. This is a clean UI + confirmation-dialog feature.
2. **Explicit drafts.** `draft` is a reserved status and the schema supports it, but M1 creates `generating` directly. A "Save as draft" flow would need a create path that does not enqueue Runs, plus a draft list for the author.
3. **Handle changes after onboarding.** `setHandle` only allows a first claim (`handle IS NULL`). Open question 4 in `docs/DECISIONS.md`.
4. **Retention pruning.** Expired sessions and verification rows are inert; no scheduled prune exists.
5. **Worker crash recovery.** A crash between `calling` and a terminal status leaves a Run stranded. Re-enqueueing non-terminal Runs from Postgres is described in `BACKEND.md` §5 but not implemented.
6. **Cross-process provider cap.** `PROVIDER_CONCURRENCY` is per worker process; multiple replicas multiply the cap.
7. **CI/CD, alarms, budgets, edge rate limits.** Ticket 16; the staging release is a script, not a pipeline.
8. **Real AWS deployment and smoke run.** The CDK stacks are synth/test-verified only.
9. **Legal copy review.** Terms/Privacy are marked as drafts for owner/legal review.
10. **Prompt search.** `q` searches titles and model names; adding prompt text would require a query change and likely an index.

---

## 9. Sharp edges and known deviations

Read this before your first change.

1. **Client/server import boundary.** Client components must import `@owm/core/client`. Importing `@owm/core` pulls `postgres`/`ioredis`/`bullmq` into the browser bundle.
2. **`self_vote` status mismatch.** `BACKEND.md` says `400 self_vote`; `packages/core/src/services/votes.ts` uses `conflict()`, which returns **409**. The test only asserts the error code. Decide which is canonical before relying on the status.
3. **Unused Job statuses.** `resolving` and `failed` are in the `JobStatus` enum but the pipeline never sets them. The Job page's "Resolving models" stage is a UI label, not a real status.
4. **Worker crash can strand a Run.** There is no re-enqueue-from-Postgres recovery yet. A Run stuck in `calling`/`streaming` will not auto-skip (auto-skip is only scheduled on failure).
5. **Per-process concurrency.** `PROVIDER_CONCURRENCY` is enforced by the worker's BullMQ concurrency, not globally across replicas.
6. **Redis eviction policy.** Production must use `noeviction`; ElastiCache Serverless is not supported for BullMQ.
7. **`db:seed` is destructive.** It truncates content and reseeds. Use `db:init` for idempotent setup, and a separate database for destructive experiments.
8. **No Next cache components.** Pages are `force-dynamic`; route handlers are uncached by default. Do not add `use cache` without understanding the session and live-update requirements.
9. **Next 16 differences.** Read `apps/web/node_modules/next/dist/docs/` before changing routing, caching or server-component behaviour.
10. **Visual snapshots are OS-specific.** Playwright suffixes `*-darwin.png`; generate a set on each OS a CI job runs on.
11. **Annotation errors are 409.** Service-level range/overlap/body errors go through `conflict()` in the annotation service, so they return 409 with a machine code. Zod shape errors still return 400. The client reads the message.
12. **`q` does not search prompts.** It searches `comparisons.title` and `models.display_name`.
13. **No author unpublish/delete UI.** The API exists; the surface does not. Do not assume the feature is complete because the endpoint is.
14. **Stray exports.** `services/votes.ts` has `voteTargetTables`; `services/comparisons.ts` has `comparisonSql`. Harmless; remove if you touch those files.

---

## 10. Reading plan

### 90 minutes (get productive)

1. This document §0–§5.
2. `BACKEND.md` §1–§5 (runtime, data model, state machines, API, pipeline).
3. `GLOSSARY.md` once.
4. Labs 0, 1, 5, 9 in `docs/LABS.md`.
5. Skim `comparison-view.tsx` around the annotation selection and Add model code.

### Half a day (understand the whole system)

1. §6–§9 here.
2. Read the ten files in §3.
3. Run Labs 2, 3, 4, 6, 7, 8, 10.
4. Read `docs/DECISIONS.md` §11 (edge cases) and the ADRs.

### Deep (ready to design features)

1. All labs, including the capstone in Lab 16.
2. Read `services/admin.ts`, `services/moderation.ts`, `services/account.ts`.
3. Read the e2e suites: they are executable specifications.
4. Read `docs/IMPLEMENTATION-STATUS.md` §3–§4 (missing pieces and known issues).

### Documentation map

| Question | Read |
|---|---|
| What are the domain words? | `GLOSSARY.md` |
| What is the exact API/DB contract? | `BACKEND.md` |
| Why was this chosen? | `docs/DECISIONS.md`, `docs/adr/` |
| How do I deploy? | `docs/DEPLOYMENT.md` |
| What is already built? | `docs/IMPLEMENTATION-STATUS.md` |
| How do I run it? | `README.md` |
| How do I experiment? | `docs/LABS.md` |

---

## Appendix A — Scripts

| Script | Purpose |
|---|---|
| `pnpm dev` | Web + worker |
| `pnpm dev:web` | Next dev server |
| `pnpm dev:worker` | BullMQ worker |
| `pnpm build` | Build all packages |
| `pnpm typecheck` | Typecheck all packages + e2e |
| `pnpm test` | Core + web + worker tests |
| `pnpm test:live` | Opt-in real-provider smoke call |
| `pnpm test:e2e` | Playwright with isolated DB/Redis |
| `pnpm db:generate` | Generate SQL from schema |
| `pnpm db:migrate` | Apply migrations |
| `pnpm db:bootstrap` | Migrations + Model registry only (production) |
| `pnpm db:init` | Migrations + seed only if empty |
| `pnpm db:seed` | Truncate and seed dev fixtures |
| `pnpm db:reset` | Drop/recreate schema (refuses production) |
| `pnpm stack:*` | Docker Compose lifecycle |
| `pnpm cdk:synth` | Synthesize AWS stacks |
| `pnpm deploy:staging` | Build/push/release staging |

## Appendix B — Environment variables

| Variable | Default / purpose |
|---|---|
| `DATABASE_URL` | `postgres://localhost:5432/openweightmodels` |
| `REDIS_URL` | `redis://localhost:6379` |
| `APP_URL` | Runtime public URL (server-side) |
| `PROVIDER` | `mock` or `openrouter`; no silent fallback |
| `OPENROUTER_API_KEY` | Required when `PROVIDER=openrouter` |
| `MOCK_DELAY_MS` | Per-chunk mock delay |
| `MOCK_FAIL_ONCE` | Fail the first attempt of a mock Run |
| `MOCK_FAIL_MODEL` | Restrict `MOCK_FAIL_ONCE` to one slug |
| `MAX_CHALLENGERS` | 4 |
| `JOBS_PER_HOUR` | 10 |
| `RUNS_PER_DAY` | 50 |
| `PROVIDER_CONCURRENCY` | 4 (per worker process) |
| `AUTO_SKIP_DELAY_MS` | 86400000 (24h) |
| `EMAIL_TRANSPORT` | `smtp` (default) or `ses` |
| `SMTP_URL` | `smtp://localhost:1025` |
| `EMAIL_FROM` | From address for magic links |
| `BETTER_AUTH_SECRET` | Session signing secret |
| `ALLOW_DEV_USER_SWITCH` | Development identity switcher |
| `E2E_DATABASE_URL` | Isolated browser-suite DB |
| `E2E_REDIS_URL` | Isolated Redis DB index |

## Appendix C — API surface (compact)

| Method + path | Auth | Purpose |
|---|---|---|
| `GET /api/me` | optional | Current user (no email) |
| `POST/DELETE /api/dev/user` | dev only | Identity switcher |
| `GET /api/models` | public | Enabled registry |
| `GET /api/comparisons` | public | Board page |
| `GET /api/comparisons/facets` | public | Global sidebar counts |
| `GET /api/comparisons/:id` | optional | Comparison bundle |
| `POST /api/comparisons` | write | Create (multipart) |
| `PATCH /api/comparisons/:id` | author | Title/categories/effort |
| `DELETE /api/comparisons/:id` | author | Soft delete |
| `POST /api/comparisons/:id/publish` | author | Publish |
| `POST /api/comparisons/:id/unpublish` | author | Back to ready |
| `POST /api/comparisons/:id/responses` | author | Add Challenger |
| `GET /api/comparisons/:id/responses` | author | Resync |
| `POST /api/responses/:id/retry` | author | Retry failed |
| `POST /api/responses/:id/skip` | author | Skip failed/queued |
| `GET /api/jobs/:id` | author | Job bundle |
| `POST /api/annotations` | write | Create Annotation |
| `PATCH/DELETE /api/annotations/:id` | owner | Retag / delete |
| `POST /api/annotations/:id/messages` | write | Thread reply |
| `PATCH/DELETE /api/annotations/:id/messages/:messageId` | owner | Edit / tombstone |
| `POST /api/comments` | write | Root or reply |
| `PATCH/DELETE /api/comments/:id` | owner | Edit / delete |
| `POST /api/votes` | write | Toggle vote |
| `GET/PATCH /api/notifications` | session | List / mark read |
| `POST /api/reports` | write | Report content |
| `GET /api/admin/overview` | admin | Admin queue |
| `PATCH /api/admin/models/:id` | admin | Enable/disable |
| `POST /api/admin/comparisons/:id/takedown` | admin | Hide |
| `POST /api/admin/comparisons/:id/restore` | admin | Restore |
| `POST /api/admin/reports/:id/hide` | admin | Hide reported content |
| `POST /api/admin/reports/:id/dismiss` | admin | Dismiss |
| `POST /api/admin/moderation/restore` | admin | Restore hidden content |
| `POST /api/admin/users/:id/suspend` | admin | Suspend |
| `POST /api/admin/users/:id/reinstate` | admin | Reinstate |
| `GET /api/stream/board` | public | SSE |
| `GET /api/stream/jobs/:id` | author | SSE |
| `GET /api/health` | public | Dependency health |

## Appendix D — Key functions

| Function | File | What to know |
|---|---|---|
| `createComparison` | `services/comparisons.ts` | One transaction, then enqueue |
| `publishComparison` | `services/comparisons.ts` | Ready + ≥1 done; emits card |
| `addModelToComparison` | `services/comparisons.ts` | Cap/dupe/base checks; published stays published |
| `retryRun` / `skipRun` | `services/comparisons.ts` | Same Response row; attempt-scoped timer |
| `processRun` | `services/jobs.ts` | Claim, call, stream, persist, finalise |
| `finalizeJob` | `services/jobs.ts` | Row locks, notification, `run.finished` |
| `autoSkipRun` | `services/jobs.ts` | Only if still failed |
| `getProvider` | `providers.ts` | Mock vs real; no fallback |
| `logActivity` / `logJobEvent` | `events.ts` | Persist then publish |
| `sseResponse` | `apps/web/src/lib/sse.ts` | Replay + subscribe + poll + heartbeat |
| `listComparisons` | `queries.ts` | Keyset pagination and filters |
| `getComparisonForViewer` | `queries.ts` | Visibility rules |
| `getJobForAuthor` | `queries.ts` | Author-only Job bundle |
| `buildBlocks` | `domain/markdown.ts` | Markdown to safe blocks/runs |
| `validateAnnotationRange` | `domain/markdown.ts` | Offset range + server-derived quote |
| `parseMarkdownUpload` | `domain/upload.ts` | Front matter, limits, body |
| `toggleVote` | `services/votes.ts` | Toggle, self-vote rejection |
| `deleteAccount` | `services/account.ts` | The full erasure policy |
