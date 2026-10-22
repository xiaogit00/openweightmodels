# Implementation status — 22 October 2026

Snapshot for resuming work after a context clear. `BACKEND.md` is the contract; `docs/DECISIONS.md` is the decision record; `GLOSSARY.md` is the vocabulary; `design_handoff_openweightmodels/` remains the visual source of truth (v2 overrides `styles.css`).

---

## 1. Environment

- macOS (`darwin`), Node **23.7.0**, pnpm **12.14.0**.
- `docker-compose.yml`, `Dockerfile` and `pnpm stack:*` scripts exist (ticket 05), but **no Docker CLI is installed on this machine**, so the Docker path is syntax-checked and covered by a config test, not executed.
- Local services were installed with Homebrew:
  - PostgreSQL **17.11** (`brew services start postgresql@17`)
  - Redis **8.10** (`brew services start redis`)
- Database `openweightmodels` exists; migrations `0000_marvelous_paladin.sql` and `0001_fuzzy_tag.sql` are applied.
- `.env` is present locally and ignored by git:
  - `DATABASE_URL=postgres://localhost:5432/openweightmodels`
  - `REDIS_URL=redis://localhost:6379`
  - mock provider defaults
- `pnpm install` completed. `pnpm approve-builds --all` was run for esbuild/msgpackr.
- Git is initialised. The snapshot commit is `647aef9` — "Milestone 1 foundation: schema, domain, API, board and comparison UI". `.env` is ignored.

### Run locally (current state)

```bash
brew services start postgresql@17
brew services start redis
pnpm db:init          # migrate; seed only when the database is empty
pnpm dev              # web on :3000 and the generation worker
# or separately: pnpm dev:web / pnpm dev:worker
```

The Docker path is `docker compose up --build`; `migrate` runs `pnpm db:init`
before web and worker start. `docker compose down` keeps named volumes, and
`docker compose down --volumes` is the explicit data reset.

The seeded identity no longer signs in implicitly. Locally you can either use a magic link (Mailpit inbox at <http://localhost:8025>, or the link printed in the web log) or switch directly with `POST /api/dev/user { "handle": "kev" }`. Both the switcher and the development magic-link outbox are disabled in production.

---

## 2. What is built

### Workspace

```
package.json, pnpm-workspace.yaml, tsconfig.base.json, .env.example
apps/web       Next.js 16.4.2, React 19.3.1, Tailwind 4.3.3
apps/worker    BullMQ consumer: run + auto-skip handlers, graceful shutdown
packages/core  Drizzle schema, domain, queries, providers, services, seed
docs/          ADRs + decision log + this file
GLOSSARY.md, BACKEND.md
```

### Database

Migration creates 16 tables: `users`, `models`, `comparisons`, `jobs`, `responses`, `annotations`, `annotation_messages`, `comments`, `votes`, `activity_events`, `job_events`, `notifications`, `admin_actions`, and Better Auth's `auth_sessions`, `auth_accounts`, `auth_verifications`. Migration `0002_modern_lucky_pierre.sql` adds the auth tables and makes `users.handle` nullable until onboarding; `0003_shallow_odin.sql` adds the takedown columns and the admin audit table; `0005_stiff_mandroid.sql` adds `users.deleted_at` for account deletion.

Seed (`pnpm db:seed`) inserts:

- 3 users: `mira` (admin), `kev`, `ana`
- 8 models: Llama 3.3 70B, Qwen2.5 72B, DeepSeek V3, Mistral Large, Gemma 2 27B, Phi-4, Codestral, Qwen2.5 Coder
- 16 published Comparisons matching the prototype
- 42 Responses, 6 Annotations, 7 annotation messages, 4 Comments, 15 Votes
- 4 activity events for the ticker

Database verification after seeding:

```
comparisons 16 · responses 42 · annotations 6 · annotation_messages 7
comments 4 · votes 15
```

### Core domain

- `domain/types.ts` — categories, effort, statuses, annotation kinds, card/view types.
- `domain/upload.ts` — 1 MB/UTF-8/NUL checks, restricted YAML front matter (`maxAliasCount: 0`), prompt/title limits, filename title fallback, snippet/token helpers.
- `domain/handle.ts` — handle normalisation, format limits and the reserved-name list.
- `services/identity.ts` — `setHandle`, including case-insensitive uniqueness, first-claim-only updates and the unique-index race.
- `domain/markdown.ts` — remark/mdast parsing, annotatable run extraction, UTF-16 offset validation, quote derivation, in-render splitting support.
- `domain/filters.ts` — client-side filter/sort/counts/relative time.
- `domain/cursor.ts` — opaque base64url keyset cursor.
- `providers.ts` — deterministic `MockProvider` with streaming/failure and an OpenAI-compatible streaming adapter (OpenRouter-first). `PROVIDER=mock` is the default; any real provider slug (OpenRouter first) selects real calls and never falls back to mock. Real calls request provider usage, store completion tokens and provider-reported cost, redact the key from errors, and use a 120s timeout.
- `queries.ts` — board listing with filters/cursor/total, Comparison bundle, annotation/comment views, job bundle, notifications, card payloads.
- `events.ts` — activity/job event persistence + Redis publish + replay queries.
- `queue.ts` — BullMQ run queue, one job per Run, delayed 24h auto-skip.
- `services/` — create/publish/unpublish/delete/update Comparison, add model, retry/skip, annotations, annotation messages, comments, votes, run processing, job finalisation, auto-skip.
- `seed.ts`, `db/migrate.ts`, `db/reset.ts`.

### Web API routes

Implemented under `apps/web/src/app/api/`:

- `/me`, `/dev/user` (POST identity switch, DELETE sign-out), `/dev/magic-link` (development outbox), `/models`
- `/auth/[...all]` — Better Auth magic-link request, verification, session and sign-out endpoints
- `/account/handle` — first-sign-in handle onboarding
- `/account/export` — signed-in JSON download of the account's own data
- `/account/delete` — typed-confirmation account deletion; expires session cookies
- `/comparisons` (GET list, POST multipart create)
- `/comparisons/:id` (GET/PATCH/DELETE)
- `/comparisons/:id/publish`, `/unpublish`; `/comparisons/:id/responses` (POST add, GET author resync)
- `/responses/:id/retry`, `/skip`
- `/annotations`, `/annotations/:id`, `/annotations/:id/messages`, `.../messages/:messageId`
- `/comments`, `/comments/:id`
- `/votes`
- `/jobs/:id`
- `/notifications`
- `/stream/board`, `/stream/jobs/:id`

SSE uses Redis pub/sub + Postgres replay via `Last-Event-ID`, a 2s polling fallback, and a 20s heartbeat.

### Web UI

- `app/page.tsx` + `BoardClient`: sticky header, search with `/` shortcut, ticker, category/model/effort sidebar with global counts, sort tabs, active chips, queued-arrivals pill, responsive card grid, keyset pagination (48 per page) with an infinite-scroll sentinel plus an accessible Load more button, explicit loading/error/empty states, URL-backed filters with back/forward, a shared minute tick for relative times, and one SSE subscription across sort/filter changes. Deleting a comment or Annotation retracts its ticker line and lowers the card count live.
- `app/comparisons/[id]/page.tsx` + `ComparisonView`: meta row, prompt disclosure, sticky toolbar, annotation toggle and kind filters, base pane, Challenger tabs, markdown rendering, selection → Annotate → new Annotation popover, thread popover with votes/replies, Discussion composer/filters/replies/votes, Copy link. Content owners get kebab menus: Discussion comments and replies edit inline and delete with confirmation (a parent with replies tombstones, a childless comment disappears), Annotation owners can retag or delete the highlight and whole thread, and thread messages edit or tombstone. The Author of a published Comparison gets an Add model menu (enabled models only, Base and existing models excluded, ETAs shown, disabled at four slots). A pending add is an author-only tab with spinner and shimmer, subscribes to that Job's SSE stream, and resyncs from `GET /comparisons/:id/responses` when it settles; a failed add is an author-only error tab with Retry and Dismiss.
- `app/new/page.tsx` + `NewComparisonClient`: drag/drop upload with inline validation, front-matter prompt/title/model auto-fill, Base select, up to four Challenger tiles, Category/Effort controls, live "ON THE BOARD" draft preview, multipart submit and redirect to the Job summary.
- `app/comparisons/[id]/job/page.tsx` + `JobSummary`: author-only Job page. Subscribes to `/api/stream/jobs/:id`, applies `response.status` events in place, resyncs after a reconnect, shows Live/Connecting/Reconnecting, Retry/Skip on failed rows, the four-stage strip, per-Run progress and the ready banner with Publish/Review. Publishes atomically and navigates to the Comparison.
- Shared components: logo, avatar, site header with an account menu and a notification bell (unread count, newest-first dropdown, per-item links, mark-all read, empty/error states), Comparison card, markdown renderer.
- Tailwind theme and component classes in `globals.css` (2px radii, lime tokens, danger token, reduced-motion rules).
- Auth pages: `app/sign-in` (email form, sent state and error copy), `app/onboarding` (handle claim with inline rules/errors), `app/auth/complete` (new-account vs returning routing). `lib/auth.ts` exposes the Better Auth instance plus `getCurrentUser()`/`requireUser()`; `lib/auth-client.ts` is the browser client. `lib/mail.ts` sends through SMTP and keeps the development outbox.
- Account and legal pages: `app/account` (identity, JSON export download, typed-confirmation deletion), `app/terms` and `app/privacy` describe the data actually collected and retained, carry a visible draft-for-owner/legal-review banner and bracketed placeholders, and are linked from a shared footer in the root layout. Content whose author deleted their account renders `[deleted]` rather than a handle; the account menu links to `/account`.
- Anonymous readers see **Sign in** in the header. The New Comparison page redirects to `/sign-in?next=/new`; annotation, Discussion reply and vote affordances link to sign-in on a Comparison; the account menu signs out.

### Verification

- Ticket 12: `packages/core/test/providers.test.ts` covers the exact request shape (same Prompt and generation parameters for every Challenger), SSE content, provider usage tokens/cost, HTTP and in-stream errors, key redaction, the 120s timeout (injected short for the test), and provider selection with no silent mock fallback. A shared `test/fake-openai.ts` endpoint feeds `packages/core/test/provider-pipeline.test.ts`, which drives `processRun` end to end: content, completion tokens, latency and cost persisted; a 500 becomes Failed with a redacted useful message and an auto-skip timer; Retry then reaches Ready. A live-key OpenRouter call has **not** been made (no key in this checkout).
- Ticket 15: `packages/core/test/account.test.ts` proves deletion keeps published Comparisons under `[deleted]`, erases unpublished work and personal fields, tombstones comments while preserving other people's replies, removes Annotations with their threads, keeps `comment_count`/`annotation_count` exact (including a reply under an Admin-hidden parent), removes sessions, pending magic links, notifications, votes and ticker rows, frees the handle and email, refuses an untyped confirmation and a second deletion, and that export contains only the account's own data. `e2e/account.spec.ts` drives sign-in → comment → export download → typed confirmation → signed-out Board → tombstone, and checks the footer links to both legal pages.
- `pnpm typecheck` — **passes** (core, web, worker and the E2E suite).
- `pnpm test` — **passes with local Postgres and Redis**: 184 core tests, 13 web mail/redirect/notification-link/discussion tests and 9 worker dispatch/consumption/concurrency tests. When either service is unavailable the integration files warn and skip, so the unit tests still run. Coverage includes UTF-16 annotation offsets (emoji, CJK, escapes, cross-formatting, fenced vs indented code), upload parsing and limits, keyset cursors (including a sort mismatch and a Top cursor without a score), Board filter/URL helpers, 48-item default pagination, global Category/Model facets, the create → generate → publish pipeline with the mock provider, add-Challenger visibility (author-only pending/failed, atomic publication, cap/duplicate/Base/disabled rules, dismissed-slot release), admin authorization and audit (Model enable/disable, queued Runs failing on a disabled Model, takedown hiding from Board/public routes and restore), comment and Annotation edit/delete rules (inline body limit, hard delete and votes, tombstone with live replies, retagging, message tombstone, counters, ticker retraction), author-only write permissions, handle format/reserved-name rules, case-insensitive handle uniqueness and the concurrent-onboarding race, SMTP delivery of the magic-link email through a local sink, and post-auth redirect safety.
- `pnpm test:e2e` — **passes (15 tests)** (the run logged a Turbopack cache write warning after the suite; all tests still passed): an auth suite proves request → single-use link → handle onboarding → session reload → sign-out, reserved and taken handles, anonymous read with sign-in affordances, 401 on an anonymous write, replay rejection, expiry rejection after the verification row is expired, the development outbox, no bell for anonymous visitors, and a seeded author signing in with a link while their published Comparisons stay intact. An admin suite proves anonymous and member requests to `/admin` get 404, an admin can disable a Model (removing it from the API picker and `/new`) and re-enable it, a published Comparison can be taken down with a reason (disappearing from the public route and Board), the audit and hidden record show the actor and reason, and restore makes it public again. A real browser journey covers upload → schedule → live Job → publish → Board arrival → the author's unread notification and its persisted read state → annotate → thread → comment → vote across two identities (explicitly signing in through the development switcher), and asserts that a second reader sees an empty bell. A separate add-Challenger journey publishes a Comparison, adds a model from the menu (Base and existing models absent, ETA shown), proves the tab is author-only until it completes, and checks readers still have no Add control. An edit/delete journey proves inline comment editing, childless hard delete, parent tombstone with a surviving reply, live Board count and ticker retraction, inline message edit and tombstone, Annotation retagging and deletion, and that non-owners get no controls and a direct `PATCH` returns 403. A Board suite covers 48-item pages, the Load more fallback, the infinite-scroll sentinel, global sidebar counts, URL state across reload/back/forward, a single SSE subscription, loading/error/Retry and reduced motion. It seeds an isolated `openweightmodels_e2e` database (with enough published fixtures to paginate) and Redis DB `1`, then starts its own web and worker servers.
- Defects found and fixed: indented code blocks were incorrectly annotatable (they still render as code, but are no longer annotatable, matching `BACKEND.md` §7); Annotation, comment and reply vote controls gained accessible names.
- `pnpm db:migrate` — `0001_fuzzy_tag.sql`, `0002_modern_lucky_pierre.sql` and `0003_shallow_odin.sql` applied; re-running is a no-op.
- `pnpm db:seed` — **passes**; counts above.
- `pnpm db:init` — applied against a scratch database twice: the first run migrated and seeded, the second applied nothing and skipped the seed. No rows were duplicated. `db:seed` truncates, then inserts in one transaction, so a failed seed leaves an empty database that the next `db:init` retries instead of wedging.
- The documented Homebrew path was exercised end to end: `pnpm db:init` + `pnpm dev` with a real magic-link sign-in and handle onboarding, a two-Challenger Comparison reaching Ready, Publish, an anonymous Board and Comparison read, an Annotation with a thread reply, a Comment and a vote.
- `pnpm dev:worker` — boots and logs `consuming owm-runs with concurrency 4`. With `WORKER_HEALTH_PORT` set it also serves a liveness `/healthz`, which compose uses as the container health check.
- `packages/core/test/local-stack.test.ts` — parses `docker-compose.yml` and asserts the five services, shared image, startup ordering, health checks, named data volumes and documented `.env.example` variables. It does not need Docker.
- A real queue round-trip is covered by the worker integration test: enqueue → done → Job ready → one notification.
- `pnpm build` — **passes**; `/new` and `/comparisons/[id]/job` are in the route manifest. The Job page is now a client component that renders `SiteHeader`, so the earlier `@phosphor-icons/react/dist/ssr` risk is verified by the build; `next.config.ts`'s `experimental.serverActions` also compiles on Next 16.4.2.

---

## 3. What is missing

### Other missing pieces

- Production images and the AWS deployment (ticket 13). The current `Dockerfile` is a development target only.
- AWS CDK stack, Dockerfiles, CI/CD, deployment.
- One live-key OpenRouter smoke call. The adapter and pipeline are covered against a local OpenAI-compatible server; no `OPENROUTER_API_KEY` is configured in this checkout, so ticket 12's live-key sign-off remains manual.
- Owner/legal review of the Terms and Privacy copy, and the bracketed placeholders in them. The behaviour they describe is implemented and tested; the wording is not legal advice (`docs/PRIVACY.md`).
- A scheduled retention/pruning job for expired sessions and verification rows. They are inert today and are removed when the account is deleted, but nothing prunes them on a timer yet.

---

## 4. Known issues / deviations to fix

1. **Client/server imports**: client components must import from `@owm/core/client` (pure domain only). Server components/routes import `@owm/core`. Do not import `@owm/core` from a client component or `postgres`/`ioredis` enters the browser bundle.
2. `packages/core/src/services/votes.ts` has a stray `voteTargetTables` export and an unused `annotationMessages` import. Harmless; remove.
3. `packages/core/src/services/comparisons.ts` has an unused `sql` import and a stray `comparisonSql` export. Harmless; remove.
4. `postComment` now supports one-level replies; verify the server re-parenting when replying to a reply (the UI only exposes Reply on top-level comments).
5. Front-matter `model:` now preselects the Base model in the form; unknown values are ignored with a prompt to choose.
6. A worker crash between `calling` and a terminal Run status leaves that Run stranded; re-enqueueing non-terminal Runs from Postgres (BACKEND.md §5) is not implemented yet.
7. The `db:*` scripts, the worker and `next dev`/`next build` now load the repo-root `.env`.
8. No `.DS_Store` cleanup; it is ignored but present under `apps/` and `docs/`.
9. `BETTER_AUTH_SECRET` is required at runtime in production (Better Auth fails fast without it). `next build` uses a build-only placeholder when the secret is absent.
10. Magic-link mail uses `SMTP_URL`/`EMAIL_FROM`. Without Mailpit, a local link is logged and kept in the development outbox; production surfaces the SMTP error instead of silently dropping mail.
11. Better Auth's default magic-link rate limit is 5 requests per 60 seconds per IP; broader per-email/per-IP abuse controls remain ticket 16.
12. Handle changes after onboarding are not implemented (open question 4).
13. `PROVIDER_CONCURRENCY` is enforced per worker process. Running more than one worker replica multiplies the global provider cap; a cross-process concurrency limiter is not built.
14. Account deletion publishes a summary-less `account.deleted` SSE event per affected Comparison. Older clients ignore it and repair counts on the next reload; current clients apply it.
15. The footer is global, so it sits below the Board's full-height content and needs a scroll. Ticket 17 owns the visual pass.
16. A deleted account's handle is released for reuse. Old content never shows the handle (it renders `[deleted]`), so a new owner of the same handle cannot inherit attribution; ticker lines that named the old handle are removed.

---

## 5. Suggested next order

1. Accessibility and fidelity audit (ticket 17), including the admin surface and the new account/legal pages.
2. The live-key sign-off for ticket 12, then AWS staging (ticket 13) and the abuse/spend controls that depend on it (ticket 16).

---

## 6. Quick file map for the next session

| Area | Path |
|---|---|
| Schema | `packages/core/src/db/schema.ts` |
| Migration | `packages/core/drizzle/0000_marvelous_paladin.sql` … `0003_shallow_odin.sql` |
| Seed | `packages/core/src/seed.ts` |
| Queries/cards | `packages/core/src/queries.ts` |
| Admin services | `packages/core/src/services/admin.ts` |
| Admin UI | `apps/web/src/app/admin/page.tsx`, `apps/web/src/components/admin-client.tsx` |
| Job processing | `packages/core/src/services/jobs.ts` |
| Comparison lifecycle | `packages/core/src/services/comparisons.ts` |
| Annotation offsets | `packages/core/src/domain/markdown.ts` |
| Upload parsing | `packages/core/src/domain/upload.ts` |
| Mock/real provider | `packages/core/src/providers.ts` |
| SSE helper | `apps/web/src/lib/sse.ts` |
| Board UI | `apps/web/src/components/board-client.tsx` |
| Comparison UI | `apps/web/src/components/comparison-view.tsx` |
| Markdown/annotation render | `apps/web/src/components/markdown-view.tsx` |
| Auth server + identity seam | `apps/web/src/lib/auth.ts` |
| Auth browser client | `apps/web/src/lib/auth-client.ts` |
| Magic-link mail | `apps/web/src/lib/mail.ts` |
| Handle validation | `packages/core/src/domain/handle.ts` |
| Handle onboarding service | `packages/core/src/services/identity.ts` |
| Account deletion and export | `packages/core/src/services/account.ts`, `apps/web/src/app/api/account/` |
| Account settings page | `apps/web/src/app/account/page.tsx`, `apps/web/src/components/account-settings.tsx` |
| Legal pages and footer | `apps/web/src/app/terms`, `apps/web/src/app/privacy`, `apps/web/src/components/legal.tsx`, `site-footer.tsx`, `docs/PRIVACY.md` |
| Contract | `BACKEND.md` |
| Decisions | `docs/DECISIONS.md` |
| ADRs | `docs/adr/0001`–`0006` |
