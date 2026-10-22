# Implementation status — 22 October 2026

Snapshot for resuming work after a context clear. `BACKEND.md` is the contract; `docs/DECISIONS.md` is the decision record; `GLOSSARY.md` is the vocabulary; `design_handoff_openweightmodels/` remains the visual source of truth (v2 overrides `styles.css`).

---

## 1. Environment

- macOS (`darwin`), Node **23.7.0**, pnpm **12.14.0**.
- **No Docker CLI on this machine.** Local services were installed with Homebrew:
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
pnpm db:migrate
pnpm db:seed
pnpm dev              # web on :3000 and the generation worker
# or separately: pnpm dev:web / pnpm dev:worker
```

The seeded dev identity defaults to `@mira` via `DEV_DEFAULT_USER`; `POST /api/dev/user { "handle": "kev" }` switches it in development.

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

Migration creates 12 tables: `users`, `models`, `comparisons`, `jobs`, `responses`, `annotations`, `annotation_messages`, `comments`, `votes`, `activity_events`, `job_events`, `notifications`.

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
- `domain/markdown.ts` — remark/mdast parsing, annotatable run extraction, UTF-16 offset validation, quote derivation, in-render splitting support.
- `domain/filters.ts` — client-side filter/sort/counts/relative time.
- `domain/cursor.ts` — opaque base64url keyset cursor.
- `providers.ts` — deterministic `MockProvider` with streaming/failure and an OpenAI-compatible streaming adapter (OpenRouter-first).
- `queries.ts` — board listing with filters/cursor/total, Comparison bundle, annotation/comment views, job bundle, notifications, card payloads.
- `events.ts` — activity/job event persistence + Redis publish + replay queries.
- `queue.ts` — BullMQ run queue, one job per Run, delayed 24h auto-skip.
- `services/` — create/publish/unpublish/delete/update Comparison, add model, retry/skip, annotations, annotation messages, comments, votes, run processing, job finalisation, auto-skip.
- `seed.ts`, `db/migrate.ts`, `db/reset.ts`.

### Web API routes

Implemented under `apps/web/src/app/api/`:

- `/me`, `/dev/user`, `/models`
- `/comparisons` (GET list, POST multipart create)
- `/comparisons/:id` (GET/PATCH/DELETE)
- `/comparisons/:id/publish`, `/unpublish`, `/responses`
- `/responses/:id/retry`, `/skip`
- `/annotations`, `/annotations/:id`, `/annotations/:id/messages`, `.../messages/:messageId`
- `/comments`, `/comments/:id`
- `/votes`
- `/jobs/:id`
- `/notifications`
- `/stream/board`, `/stream/jobs/:id`

SSE uses Redis pub/sub + Postgres replay via `Last-Event-ID`, a 2s polling fallback, and a 20s heartbeat.

### Web UI

- `app/page.tsx` + `BoardClient`: sticky header, search with `/` shortcut, ticker, category/model/effort sidebar, sort tabs, active chips, queued-arrivals pill, responsive card grid, empty state, live SSE arrival animation.
- `app/comparisons/[id]/page.tsx` + `ComparisonView`: meta row, prompt disclosure, sticky toolbar, annotation toggle and kind filters, base pane, Challenger tabs, markdown rendering, selection → Annotate → new Annotation popover, thread popover with votes/replies, Discussion composer/filters/replies/votes, Copy link.
- `app/new/page.tsx` + `NewComparisonClient`: drag/drop upload with inline validation, front-matter prompt/title/model auto-fill, Base select, up to four Challenger tiles, Category/Effort controls, live "ON THE BOARD" draft preview, multipart submit and redirect to the Job summary.
- `app/comparisons/[id]/job/page.tsx` + `JobSummary`: author-only Job page. Subscribes to `/api/stream/jobs/:id`, applies `response.status` events in place, resyncs after a reconnect, shows Live/Connecting/Reconnecting, Retry/Skip on failed rows, the four-stage strip, per-Run progress and the ready banner with Publish/Review. Publishes atomically and navigates to the Comparison.
- Shared components: logo, avatar, site header, Comparison card, markdown renderer.
- Tailwind theme and component classes in `globals.css` (2px radii, lime tokens, danger token, reduced-motion rules).
- Dev identity seam: `getCurrentUser()`; no real auth yet.

### Verification

- `pnpm typecheck` — **passes** (core, web, worker).
- `pnpm test` — **passes**: 28 core tests (run lifecycle, job events, publish/visibility, New Comparison rules) and 3 worker dispatch/consumption tests.
- `pnpm db:migrate` — `0001_fuzzy_tag.sql` applied; re-running is a no-op.
- `pnpm db:seed` — **passes**; counts above.
- `pnpm dev:worker` — boots and logs `consuming owm-runs with concurrency 4`.
- A real queue round-trip is covered by the worker integration test: enqueue → done → Job ready → one notification.
- `pnpm build` — **passes**; `/new` and `/comparisons/[id]/job` are in the route manifest. The Job page is now a client component that renders `SiteHeader`, so the earlier `@phosphor-icons/react/dist/ssr` risk is verified by the build; `next.config.ts`'s `experimental.serverActions` also compiles on Next 16.4.2.

---

## 3. What is missing

### Blocking the vertical slice

1. **Annotation and discussion smoke** — the create → live Job → publish → Board → anonymous Comparison read path is smoke-tested. Annotate → thread → comment → vote still needs an end-to-end pass.

### Other missing pieces

- Docker Compose + Dockerfiles (`web`, `worker`, Postgres, Redis, Mailpit) — package scripts assume it.
- Vitest unit tests for offsets, cursor, filters, upload parsing, votes/self-vote.
- Playwright create → publish → read and annotate → thread.
- Admin UI (model enable/disable, takedown).
- Better Auth magic-link integration + auth tables + handle onboarding.
- Notification bell UI (API exists).
- Add-model UI (API exists).
- Annotation/message/comment edit/delete UI (APIs exist).
- Infinite scroll / Load more on the Board (API cursor exists; UI loads up to 100 and filters client-side).
- Global sidebar counts when pagination lands.
- AWS CDK stack, Dockerfiles, CI/CD, deployment.
- Real OpenRouter execution test.

---

## 4. Known issues / deviations to fix

1. **Client/server imports**: client components must import from `@owm/core/client` (pure domain only). Server components/routes import `@owm/core`. Do not import `@owm/core` from a client component or `postgres`/`ioredis` enters the browser bundle.
2. `packages/core/src/services/votes.ts` has a stray `voteTargetTables` export and an unused `annotationMessages` import. Harmless; remove.
3. `packages/core/src/services/comparisons.ts` has an unused `sql` import and a stray `comparisonSql` export. Harmless; remove.
4. `BoardClient` holds up to 100 Comparisons and filters client-side. This is acceptable for M1 but contradicts the accepted pagination policy; fix in M2.
5. The Board ticker reconnects whenever `sort` changes because the SSE effect depends on `sort`; it dedupes cards but can duplicate ticker lines. Refactor to a stable effect with a ref in M2.
6. `postComment` now supports one-level replies; verify the server re-parenting when replying to a reply (the UI only exposes Reply on top-level comments).
7. Front-matter `model:` now preselects the Base model in the form; unknown values are ignored with a prompt to choose.
8. A worker crash between `calling` and a terminal Run status leaves that Run stranded; re-enqueueing non-terminal Runs from Postgres (BACKEND.md §5) is not implemented yet.
9. The `db:*` scripts, the worker and `next dev`/`next build` now load the repo-root `.env`.
10. No `.DS_Store` cleanup; it is ignored but present under `apps/` and `docs/`.

---

## 5. Suggested next order

1. Full smoke test of the annotate → thread → comment → vote half of the journey (ticket 04).
2. Docker Compose.
3. Vitest offset/upload/cursor tests.
4. Playwright happy path.
5. M2: auth, admin, add-model UI, edit/delete UI, notifications, pagination.

---

## 6. Quick file map for the next session

| Area | Path |
|---|---|
| Schema | `packages/core/src/db/schema.ts` |
| Migration | `packages/core/drizzle/0000_marvelous_paladin.sql` |
| Seed | `packages/core/src/seed.ts` |
| Queries/cards | `packages/core/src/queries.ts` |
| Job processing | `packages/core/src/services/jobs.ts` |
| Comparison lifecycle | `packages/core/src/services/comparisons.ts` |
| Annotation offsets | `packages/core/src/domain/markdown.ts` |
| Upload parsing | `packages/core/src/domain/upload.ts` |
| Mock/real provider | `packages/core/src/providers.ts` |
| SSE helper | `apps/web/src/lib/sse.ts` |
| Board UI | `apps/web/src/components/board-client.tsx` |
| Comparison UI | `apps/web/src/components/comparison-view.tsx` |
| Markdown/annotation render | `apps/web/src/components/markdown-view.tsx` |
| Dev auth seam | `apps/web/src/lib/auth.ts` |
| Contract | `BACKEND.md` |
| Decisions | `docs/DECISIONS.md` |
| ADRs | `docs/adr/0001`–`0006` |
