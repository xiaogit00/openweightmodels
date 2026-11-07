# Decision log — OpenWeightModels

This is the complete, consolidated record of the design grilling. `BACKEND.md` is the implementation contract; `GLOSSARY.md` is the vocabulary; `docs/adr/` holds the architectural decisions. This file explains **why**, records the rejected alternatives, and lists the edge cases and open questions that must not be silently rediscovered.

Status: decisions accepted unless marked **OPEN** or **DEFERRED**.

---

## 1. Product frame

| # | Decision | Rationale |
|---|---|---|
| 1 | **Production-intended**, not a mock-only portfolio piece | Real Postgres, queue, auth path, AWS target and moderation gates are in scope. Mock generation is only a development default. |
| 2 | **Vertical slice first**: create → job → comparison → publish → board | Forces the API, job pipeline and visibility rules to be correct before breadth. |
| 3 | **Comparison is a user-authored post**, not a canonical prompt page | Upload flow, author-only drafts and Publish all assume one owner and one `base_model_id`. Duplicate Prompts are allowed. |
| 4 | **Public read, authenticated write** | Sharing links and the public Board are the product; creating, annotating, commenting and voting require an account. |
| 5 | **Email magic link**, not GitHub OAuth | Do not require a developer account. Better Auth + SES + Mailpit (ADR 0005). |
| 6 | **Annotations are in Milestone 1** | They are the product's differentiator; a first demo without them is a generic LLM playground. If the first demo is internal-only, this can move to M2. |

**Rejected**: a portfolio demo with mocked data; screen-by-screen breadth-first build; canonical Prompt pages with many contributors; a private/invite-only forum; GitHub-only sign-in.

---

## 2. Visual and interaction contract

| # | Decision | Rationale |
|---|---|---|
| 7 | Pixel-exact at **1440px**; graceful stacking below 768px | The handoff only specifies desktop measurements. |
| 8 | Minimum type size **10px**; keep the dense mono/2px language | 9px labels are unreadable for many users without changing the design's character. |
| 9 | Honour `prefers-reduced-motion` for marquee, arrivals, shimmer and popovers | Accessibility; documented deviations from the prototypes. |
| 10 | One new **danger** token `#f87171`, used only for error text/icons/borders | The design has no error language; a full destructive palette would break the visual system. Accent-900 remains reserved for success/ready. |
| 11 | Inline error banners + pulse skeletons; **no toast system** | The design has no toast surface. "Copy link" confirms inline. |
| 12 | Tailwind v4 + CSS variables + **Radix** primitives + Phosphor React | Pixel control with accessible popover/dropdown behaviour. |
| 12a | The **v2 per-file tokens override `designs/styles.css`**; Nocturne indigo/purple tokens are not used | The base sheet is stale prototype styling. |
| 12b | 2px radius everywhere (including avatars/dots); no pills or circles; JetBrains Mono + Space Grotesk; Phosphor icons | Handoff's final visual language. |
| 12c | Card hover: accent border, neutral-800 background, −2px; new arrival: fade/slide from −8px at 98% scale with accent-900, settling over 1.4s | Handoff's interactive card specification. |

**Rejected**: full mobile-first redesign; 9px minimum type; neutral-only errors; a full red palette; toasts; CSS Modules; shadcn's visual layer; using `styles.css` as the token source; pills/circles; 4–14px radii.

---

## 3. Domain rules

| # | Decision | Rationale |
|---|---|---|
| 13 | **Prompt and Base output freeze** after scheduling | Every Challenger answered the frozen Prompt. Editing it would create Responses to different questions. |
| 14 | Title, Categories and Effort remain editable by the Author | Metadata can be corrected without invalidating generations. |
| 15 | Publish requires **at least one Done Challenger** | A base-only Comparison defeats the product. |
| 16 | Authors can **unpublish** (back to `ready`) and **soft-delete** | Production content needs an author-controlled exit. |
| 17 | Adding a Challenger to a published Comparison **auto-publishes on completion** | The author already reviewed the Comparison; a second review per model is friction. |
| 18 | Max **4 Challengers per Comparison**; at 4 selected every tile is disabled and the counter reads “4 of 4” | Matches creation UX and bounds spend. Add-model cannot exceed it. |
| 19 | Pending and failed added-model tabs are **author-only** until the Replay's first Turn is done; a multi-Turn Replay then streams into the published Comparison with a “Replay in progress” marker | The public must never see a model before it has any answer, or a failed provider call presented as a finished tab. Once a Replay has a done Turn, hiding the rest would misrepresent the transcript. |
| 20 | A failed Run blocks `ready` until retried, skipped, or auto-skipped after **24h** | Prevents permanent orphan drafts without discarding successful Runs. |
| 21 | **One-level Discussion replies**; reply-to-reply re-parents to the top-level comment; `about_model_id` is inherited | Matches the design; avoids unbounded trees. |
| 22 | Comments with replies are **tombstoned**; childless comments hard-delete | Preserves conversation context without keeping orphan bodies. |
| 23 | Discussion order is **oldest-first**; replies oldest-first | Reads as a conversation. Board "Top" is the discovery sort, not Discussion. |
| 24 | `comment_count` includes replies; deleted comments decrement it | Matches "Discussion · N". |
| 25 | **No self-voting** on own comments or Annotations | A vote count that includes the author by default is weaker evidence. |
| 26 | Model filter labels use **full display names** | `name.split(' ')[0]` collapses "Qwen2.5 72B" and "Qwen2.5 Coder" into identical chips. |

**Rejected**: editable Prompt; add-model requiring a second review; unlimited Challengers; public pending tabs before a model has any finished Turn; leaving failed Jobs stuck forever; unlimited reply nesting; newest-first Discussion; Reddit-style self-upvotes; first-word model labels.

---

## 4. Data and execution

| # | Decision | Rationale |
|---|---|---|
| 27 | **Postgres is canonical**; Redis is transport/pub-sub only | Job state, retries, visibility and 24h auto-skip all need transactional queries. |
| 28 | **BullMQ**, one queue job per **Run** | Retry/skip act on one unit; no long-lived worker fan-out. |
| 29 | A delayed BullMQ job auto-skips a still-failed Run after 24h (`AUTO_SKIP_DELAY_MS`) | Bounds orphaned Jobs. |
| 30 | **UUIDv7** primary keys; Model **slugs** in filters/pickers; Comparison URLs use UUIDs | Time-ordered, non-enumerable, stable model identifiers. |
| 31 | Opaque **keyset cursors**; `total` in the list response | Correct pagination under live inserts; tolerate scale before a separate count endpoint. |
| 32 | **Votes table is the only truth**; remove `votes int` from comments/annotations | Two writers would drift; per-user toggle needs rows. Only Board counters are denormalised. |
| 33 | Keep `comparisons.comment_count` / `annotation_count`, updated transactionally | Board Top sort and cards read them constantly. |
| 34 | Provider-agnostic **OpenAI-compatible adapter**; `MockProvider` default; OpenRouter first | One interface, no lock-in, testable without spend. |
| 35 | Provider secrets live in env/Secrets Manager, never in `models` | `api_base` and `api_model_id` are configuration, not credentials. |
| 36 | Identical generation params across Challengers: temperature 0.7, max_tokens 16384, 300s timeout | Fair comparisons. The cap covers reasoning tokens, which can otherwise consume the whole budget before visible text. |
| 37 | **Cost tracking**: `responses.cost_usd`, nullable | Production spend must be observable even without billing. |
| 38 | Quotas: 10 Jobs/hour, 50 Runs/day, 4 concurrent provider calls, 4 Challengers | Bounds abuse and spend; env-configurable. |
| 39 | Auto-skip jobs are **attempt-scoped**, and `queued → calling` is an atomic claim | A retry gets a fresh 24h window; a duplicate delivery cannot call the provider twice. |
| 40 | `job.ready` is unique per Author per Job via a partial unique index | Concurrent finalisation must not create duplicate notifications. |
| 39 | Duplicate model runs in one Comparison are rejected by a unique index | Prevents accidental double spend and ambiguous tabs. |
| 55 | `PROVIDER=mock` (default) or a real provider slug (OpenRouter first); a real mode never falls back to mock, and a missing key fails worker startup naming the environment variable | Dev and tests stay deterministic and spend-free; a misconfigured production worker must not publish mock text as a real model's answer. |
| 56 | Real streaming requests ask for usage; provider-reported completion tokens and cost are stored on the Response | Provider usage is the only non-estimated source of tokens and spend; the character estimate is a fallback only. |

**Rejected**: Redis as source of truth; one BullMQ job per Comparison; Postgres-only `pg-boss` queue; serial IDs; slug-based Comparison URLs; offset pagination; integer vote columns as truth; one hard-coded provider; per-model generation params; billing/credits in v1; unlimited generations.

---

## 5. Realtime

| # | Decision | Rationale |
|---|---|---|
| 40 | **SSE**, not WebSocket | One-way feeds; simpler auth and proxying. |
| 41 | Redis pub/sub for fan-out, Postgres event logs for replay via `Last-Event-ID` | Two processes (web + worker) cannot share an in-memory emitter. |
| 42 | 2s Postgres polling fallback + 20s heartbeat | Survives Redis loss and intermediate proxy idle timeouts. |
| 43 | Board stream public; Job stream author-only | Drafts must never leak. |
| 44 | ALB idle timeout 4000s in production | Default 60s would cut SSE. App heartbeat is the primary fix. |

**Rejected**: WebSocket adapter; SSE polling as the only mechanism; in-memory EventEmitter; long-lived Job SSE without replay.

---

## 6. Auth, access and admin

| # | Decision | Rationale |
|---|---|---|
| 45 | Real Better Auth sessions replace the implicit seeded identity; seeded users and a dev-only switcher remain behind `getCurrentUser()` | The seam kept identity swappable through M1, and the switcher keeps local content testing possible without email; production only accepts a verified session. |
| 46 | Magic link via **Better Auth**; SES production, Mailpit local; unique handle on first sign-in; monogram avatars; private email | No passwords, no developer-account requirement, in-process auth. |
| 47 | Drafts and Jobs return **404** to non-authors | Do not leak existence. |
| 48 | Minimal admin: model enable/disable + Comparison takedown; `role` and soft-delete columns now | A disabled provider must not require a deploy. No report queue in v1. |
| 49 | Registry seeded by migration/SQL until an admin UI exists | Avoids building CRUD for a small curated list. |
| 50 | **No moderation powers** beyond author delete and admin takedown in M1 | Report/flag and suspension are launch gates. |
| 51 | The admin surface is one `/admin` page plus gated `/api/admin/*` endpoints; missing and non-admin actors get **404** | Answers open question 8 without revealing the surface or the role of an account. |
| 52 | Takedown uses its own `takedown_at` / `takedown_by_id` / `takedown_reason` columns, separate from author `deleted_at` | A takedown is reversible and attributable; an Admin can review and restore the hidden record while the Author and public get 404. |
| 53 | Every admin action appends to `admin_actions`; the public activity stream gets only a summary-less, actor-less takedown/restore event | The audit trail is attributable without telling anonymous readers which Admin acted. Historical ticker rows for the hidden Comparison are removed. |
| 54 | Disabling a Model blocks new Runs and fails a Run that was queued but not yet claimed; completed Responses stay readable | Avoids silently generating on a disabled Model while keeping published Comparisons intact. |
| 57 | **Account deletion keeps published work under `[deleted]`**; unpublished Comparisons, sessions, votes and personal fields are erased, and comments/Annotations are tombstoned so other people's replies survive | Other people's discussion must not disappear because one participant leaves, while private drafts and sign-in data must not be retained. The handle and email are released. |

**Rejected**: GitHub OAuth; hosted auth; real auth before the slice; anonymous write; admin CRUD for models in M1; full moderation console in M1.

---

## 7. Annotations

| # | Decision | Rationale |
|---|---|---|
| 51 | Raw markdown is canonical; offsets are **UTF-16 code units** | JS/browser selection and Node validation agree; avoids emoji/CJK drift (ADR 0003). |
| 52 | Annotation must fit inside **one annotatable text node or fenced code block** | Splitting inline formatting safely is a much larger feature. |
| 53 | Server derives the **quote**; client quotes ignored | Prevents quote/offset divergence. |
| 54 | **Overlaps rejected** with `409`; adjacent allowed | Matches the prototype and the handoff's first option. |
| 55 | First message is **required** and created atomically | An Annotation with no thread is unreadable. |
| 56 | “N people” = distinct thread authors | Matches the prototype. |
| 57 | Thread messages oldest-first, no pagination | Small threads; conversation order. |
| 58 | Popover closes on outside click, Escape, kind-filter change, annotations off | Predictable, accessible. |
| 59 | Selecting across formatting, an existing highlight, escaped text, or block boundaries does nothing | Explicit non-goal rather than silent corruption. |
| 60 | Deleted Annotation removes highlight and thread; votes remain orphaned but unread | Soft delete preserves audit; cleanup is deferred. |

**Rejected**: plain-text projection offsets; full GFM cross-node ranges; client-supplied quotes; nested/overlapping highlights; annotations without a message; newest-first threads; self-voting.

---

## 8. Uploads and markdown

| # | Decision | Rationale |
|---|---|---|
| 61 | `.md`/`.markdown`/`.txt`, ≤1 MB, valid UTF-8, no NUL bytes | Production upload hardening. |
| 62 | Restricted YAML core schema, `maxAliasCount: 0`; only `prompt:` and `model:` read as strings | YAML aliases are an attack surface. |
| 63 | Prompt 1–10,000 chars; title 1–200; body non-empty | Bounded inputs. |
| 64 | Title falls back to the filename stem; Prompt falls back to front-matter | Matches the form's auto-fill. |
| 65 | Supported markdown: paragraphs, headings, lists, fenced code, inline code, bold, italic, links; blockquotes/hr render | Enough for model output without a full GFM surface. |
| 66 | Raw HTML is escaped and rendered as text; images show alt text; tables are not enabled | No XSS surface, no silent content loss. |
| 67 | Indented code renders but is not annotatable; fenced code is | Robust offset mapping only where raw and decoded align. |

**Rejected**: extension/size-only validation; full YAML types/aliases; rendering raw HTML; image embedding; GFM tables; annotating every markdown construct.

---

## 9. Board and comparison UI

| # | Decision | Rationale |
|---|---|---|
| 68 | Board filters/sort/search live in the **URL**; back-button friendly | Shareable views. |
| 69 | Arrivals queue unless within **200px of the top**; Live/New insert there, Top always queues into the pill | Prevents content jumping under a scrolled reader without breaking Top order. |
| 70 | Top scores update counts **in place**, never reorder live | Avoids a dancing grid. |
| 71 | Infinite scroll with a **Load more** fallback; 48 per page | Accessible pagination. |
| 72 | Ticker pauses on hover/focus; static under reduced motion; 30 events retained | Readability and accessibility. |
| 73 | `/` focuses search; Escape clears and blurs | Matches the hint. |
| 74 | `?model=<slug>` selects a tab; Copy link preserves it; canonical URL ignores it; Job pages are `noindex` | Shareable model view without duplicate SEO. |
| 75 | Job page at `/comparisons/:id/job`, author-only; publish redirects to the Comparison | Resumable, private job URL. |
| 76 | Filters combine **AND across groups, OR within the model list**; category is single-select; Effort active-toggle clears | Matches the prototype logic. |
| 77 | Search is case-insensitive over **Comparison title and Model display names** only | Explicit scope; Prompt/Response body search is a future feature. |
| 78 | Board Top score is `comment_count + 2 * annotation_count`; tie-break `published_at DESC, id DESC` | Handoff formula. |
| 79 | "Ago" times refresh every minute | Handoff behaviour; the Board shares one minute tick across cards. |
| 80 | Sidebar counts come from `GET /comparisons/facets`, loaded once and patched from publish events | Global counts must not shrink to the loaded page; a separate aggregate keeps page fetches cheap. |
| 81 | A filter change refetches page one; `Load more` stays keyset-paginated | Filter/sort changes need the server's ordering, while scrolling must not re-read earlier pages. |

**Rejected**: local-only filter state; always inserting at the top; live Top reordering; no pagination; autoplaying ticker with no pause; non-shareable tab state; OR-across-groups filtering; body/Prompt search in v1; ranking by raw votes.

---

## 10. Infrastructure

| # | Decision | Rationale |
|---|---|---|
| 76 | Local-first **Docker Compose**: web, worker, Postgres, Redis, Mailpit | Parity with production; simple SSE/queue. |
| 77 | AWS production: **ECS Fargate** web + worker, ALB, RDS, node-based ElastiCache, SES, ECR, Secrets Manager, CloudWatch, CDK TypeScript | AWS is the intended environment and containers preserve the architecture. |
| 78 | **No App Runner** | Closed to new customers (30 April 2026) and caps requests at 120s, killing SSE. |
| 79 | **No Lambda/API Gateway** for the app | 15-minute streams and a queue rewrite would reopen the BullMQ/SSE decisions. |
| 80 | No CloudFront in front of SSE initially | Avoids buffering/idle-timeout variables. |
| 81 | ElastiCache **node-based**, cluster mode off, `maxmemory-policy: noeviction` | BullMQ explicitly does not support ElastiCache Serverless. |
| 82 | SES starts in sandbox; production access is a launch gate | Sandbox only sends to verified addresses (200/day, 1/sec). |
| 83 | pnpm workspace: `apps/web`, `apps/worker`, `packages/core`; Drizzle | Shared schema/domain without importing Next into the worker; SQL control. |
| 84 | Tailwind v4 + Radix + Phosphor React + `next/font` | Matches the visual system and provides accessible primitives. |
| 85 | Staging splits CDK into a foundation stack (data, images, secrets, task definitions) and an app stack (ALB, services); services reference task-definition families and the release script pins revisions after a migration task exits 0 | Migrations must land before new code serves traffic, and cross-stack task-ARN exports would block Foundation updates (ADR 0007). |
| 86 | ECS injects database credentials as Secrets Manager `username`/`password` and the app assembles `DATABASE_URL`; Redis receives host/port/TLS and the provider key is a worker-only secret | No password or key appears in a plain task environment, and URL-special characters cannot corrupt the connection string. |
| 87 | Production mail uses the SES v2 API through the web task role (`EMAIL_TRANSPORT=ses`); local Mailpit keeps SMTP | No SES SMTP credentials to create, store or rotate. |
| 88 | `/api/health` returns 503 only when Postgres is unreachable; Redis failure reports `degraded` with 200 | Postgres is canonical, Redis loss is survivable and should not empty the ALB target group. |
| 89 | Rate limits are fixed-window counters in Redis, with an in-process fallback, and are enforced per user and per IP on every authenticated write plus a stricter generation bucket | Two web tasks must share one bucket; a Redis outage degrades the control rather than failing all writes open or closed. `requireUser()` is the single write seam. |
| 90 | Magic links are limited per IP by Better Auth and per email by the app; `/magic-link/verify` has a stricter per-IP rule | The plugin's bucket is per IP only; email is the abusive dimension for unsolicited mail, and verification is guessable. |
| 91 | Provider spend has a monthly UTC cap over provider-reported `responses.cost_usd`; AWS Budgets covers only AWS charges | OpenRouter spend never appears on the AWS bill, so one budget cannot bound both. The worker re-checks before every provider call. |
| 92 | Worker queue depth and failed/finished Runs are JSON log lines turned into CloudWatch metrics by log metric filters | Avoids a CloudWatch SDK and `cloudwatch:PutMetricData` in the worker while keeping alarms in CloudWatch. |
| 93 | Error reporting is a minimal Sentry envelope over `fetch`, with structured JSON as the fallback | No SDK dependency, no startup coupling, and the same redaction path applies whether or not a DSN is set. |
| 94 | CI uses GitHub OIDC to assume a staging deploy role; no AWS access key is stored | Short-lived credentials per run, fenced to one repository, branch and the `staging` environment. |

**Rejected**: Vercel + hosted queue (serverless SSE/worker rework); SQLite/in-process jobs; App Runner; Lambda/API Gateway; ElastiCache Serverless; Fly/Render once AWS was required; single-app repo; Prisma; shadcn's visual layer.

---

## 11. Edge cases that must stay true

1. **All Challengers skipped**: Comparison becomes `ready`, ready banner appears, Publish is disabled with an explanation. It never reaches the Board.
2. **A failed Run** blocks `ready`; the author must Retry or Skip, or wait for the 24h auto-skip.
3. **Retry** increments `attempt` on the same Response row; it does not create a new tab or a duplicate model row.
4. **Skip while streaming** is not allowed in v1; only `failed` or `queued` Runs can be skipped.
5. **Add-model on a `ready` draft** sets the Comparison back to `generating`; on a `published` Comparison it stays `published`.
6. **Add-model on a published Comparison** shows the pending tab to the author only until its first Turn is done; from then on the Replay streams into the published Comparison, and finishes publishing per Turn atomically.
7. **A fifth Challenger** is rejected (`409 too_many_challengers`).
8. **A model already present** is rejected (`409 model_exists`); the Base model cannot be a Challenger. A skipped (dismissed) failed add frees its Challenger slot, but its model remains used and cannot be added again.
9. **Unpublish** clears `published_at`, returns to `ready`, keeps comments/Annotations, and removes it from the Board stream.
10. **Soft-deleted Comparison** is hidden from everyone, including the Author, until an admin surface exists.
11. **Draft access** by a non-author is `404`, not `403`.
12. **Overlapping Annotations** return `409`; adjacent ranges are accepted.
13. **Selection across bold/italic/link boundaries** produces no Annotate button.
14. **Escaped/entity text** where raw markdown ≠ decoded text is not annotatable.
15. **Indented code** renders but cannot be annotated; fenced code can.
16. **Raw HTML** is shown as literal text, never executed.
17. **Annotation creation without a message** is rejected.
18. **Deleting an Annotation** hides its highlight and thread; votes remain but are not read.
19. **Deleting a thread message** always tombstones it in v1; hard deletion of childless messages is not implemented.
20. **Reply-to-reply** attaches to the top-level parent and inherits `about_model_id`.
21. **Deleting a comment with replies** tombstones it; a childless comment is hard-deleted and its votes removed.
22. **Self-vote** is rejected; the UI disables the control on your own content.
23. **Anonymous visitors** can read everything public, including highlights and vote counts, but every write prompts sign-in.
24. **SSE reconnect** replays from `Last-Event-ID`; malformed/unknown cursors are ignored and the stream starts from the beginning of the retained window.
25. **Redis failure**: SSE keeps polling Postgres; enqueueing new Runs currently fails at the API boundary (OPEN).
26. **Provider timeout** is 300s; the error is stored and surfaced as "API timeout".
27. **Mock failures** are opt-in via `MOCK_FAIL_ONCE=true` and optional `MOCK_FAIL_MODEL`.
28. **Upload failures** are `400` with a specific code: unsupported type, too large, empty, binary, invalid UTF-8, invalid front matter, empty body, prompt/title limits.
29. **Front-matter `model:`** is matched to a registry slug or display name to preselect the Base model. Unknown values are ignored with a prompt to choose.
30. **Base output metadata** is uploaded, so token/latency values are synthetic or blank; the UI must not imply they were measured.
31. **Cost** is stored when the provider reports it; there is no cost display in v1.
32. **Job notifications** are in-app only; the bell UI is not designed yet.
33. **Email sandbox**: until SES production access, only verified addresses receive magic links.
34. **Board counts** are global: the sidebar reads `GET /comparisons/facets`, not the loaded page.
35. **Canonical URL** for a Comparison ignores `?model`, and Job pages are `noindex`.
36. **Reduced motion** makes the ticker static and removes arrival/shimmer animations.

---

## 12. Open questions and known gaps

These are intentionally unresolved. Do not assume them.

### Product
1. Is the first external demo soon enough that Annotations must stay in M1? Current assumption: yes.
2. Do we need a **sample file** in production, or is it a demo-only affordance?
3. Should search cover the Prompt body and Response content, or only title/model names? Current spec: title and model names.
4. Should a user be able to change their handle later? Not designed.

### Auth and access
5. Resolved by ticket 16: magic-link requests are limited per email and per IP, verification attempts have a stricter per-IP rule, and writes/generations have per-user and per-IP limits (decisions 89–90).
6. Resolved: account deletion, data export and the retention windows are implemented in ticket 15; see `docs/PRIVACY.md`.
7. Report/flag, user suspension and admin audit logging are launch gates.
8. Where does the admin UI live, and who can see deleted Comparisons?

### Data and jobs
9. Redis-down behaviour for **new enqueues**: currently the API fails; an outbox/reconciliation job is not built.
10. `skip` while `streaming` is not supported; the worker is not cancellable yet.
11. Soft-deleted votes are retained as orphans; a cleanup policy is not decided.
12. `job.status = 'failed'` is defined but no path sets it; all-skipped still becomes `ready`.
13. The "Resolving models" Job stage is not persisted; it is derived in the UI.
14. `comparisons.status = 'draft'` is unused in M1.
15. Can two add-model Jobs run concurrently on the same published Comparison? Unique model rows prevent duplicates, but concurrent Job finalisation/UI is untested.
16. Provider cost is only available if the provider returns usage; no fallback pricing table.

### Annotations and rendering
17. Tables, images and raw HTML are not annotatable. Is richer rendering needed before launch?
18. Cross-node annotations (across bold/italic/link boundaries) are a future feature; offsets are designed to survive it.
19. Resolved: owners edit and delete Discussion comments and replies, retag or delete their Annotations, and edit or tombstone thread messages from kebab menus on the Comparison page.
20. Clickable links in Responses are rendered as underlined text, not anchors, to avoid losing annotation click targets. Decide the link behaviour.
21. Annotation threads have no pagination; very long threads will scroll.

### Board and UI
22. Resolved: infinite scroll with a Load more fallback pages the Board 48 at a time through an opaque cursor.
23. Resolved: sidebar counts come from `GET /comparisons/facets`, so they stay global while pages load.
24. Resolved: the notification bell is a header popover with an unread count, newest-first links to the Job or Comparison, and mark-all read.
25. The kebab menu for editing/deleting Discussion content is not designed.
26. The New Comparison form and Job summary exist; the Job page's live SSE updates, Retry/Skip and Publish are not yet built (see implementation status).
27. Anonymous "Sign in to annotate/comment/vote" affordances are specified but not designed.
28. Resolved: Board relative times share one timer and refresh every minute.
29. The Board has explicit loading, error, empty and reduced-motion states; a screen-by-screen skeleton and accessibility audit remains ticket 17.
30. Resolved: the Board keeps one SSE subscription across sort/filter changes, anchored with `after` and resuming from `Last-Event-ID`.

### Infrastructure and operations
31. Resolved by ticket 16: CI/CD, GitHub OIDC, budgets, alarms and the spend cap are implemented in `infra/` and `.github/workflows/ci.yml`; secret rotation and backup/restore drills remain operational exercises.
32. RDS Multi-AZ timing and ElastiCache sizing/cost are staging defaults in `docs/DEPLOYMENT.md`. Ticket 28 adds a provisional production profile (`db.t4g.small`, 2-node `cache.t4g.small`, 1 vCPU/2 GiB tasks) in `docs/PRODUCTION.md`; production sizing is still open until a load test.
33. Resolved by ticket 16: CloudWatch alarms have a named `OWM_ALARM_EMAIL` owner, and application errors go to a Sentry-compatible tracker when `OWM_SENTRY_DSN` is set.
34. SES production access must be requested; exact sender/domain is undecided.
35. WAF and rate limiting at the edge are not specified.

---

## 13. Deferred launch gates

Not M1 work, but required before public exposure:

- Terms of Service and Privacy Policy. **Written but explicitly marked for owner/legal review** (ticket 15).
- Report/flag queue, user suspension, admin audit log.
- Account deletion and data export. **Implemented in ticket 15.**
- SES production access and sender-domain verification.
- CloudWatch alarms with a named owner; restore drill for RDS. **Alarms and owner implemented in ticket 16; the restore drill is still owner work.**
- Magic-link abuse controls and per-IP rate limits. **Implemented in ticket 16.**
- Cost budget alarms and an absolute spend cap. **Implemented in ticket 16.**
- Final accessibility audit, including keyboard-only annotation and popover focus return.

---

## 13a. Explicit non-goals for v1

- No canonical Prompt pages or shared per-Prompt Discussion.
- No nested Discussion replies beyond one level.
- No cross-node Annotations; no Annotations on tables, images or raw HTML.
- No raw HTML execution, image embedding or GFM tables.
- No profile pages, avatar uploads or image uploads; monogram avatars only.
- No email notifications; in-app job-ready notification only.
- No billing, credits or payments.
- No report/flag UI, user suspension or account export.
- No WebSockets.
- No real provider execution in M1 (mock default; OpenRouter adapter is M3).
- No model-registry CRUD UI in M1; SQL/migration only.
- No CloudFront in front of SSE initially.
- No WAF or edge rate limiting yet.

## 14. Milestones

**M1 — vertical slice (in progress). Acceptance criteria**

1. Local services start; migrations and dev seed run.
2. The seeded user uploads a `.md` with front matter, picks a Base model and 1–4 Challengers, sets title/categories/effort, and schedules.
3. The mock provider streams; the Job page shows stages and per-Run status over SSE.
4. A forced failure supports Retry and Skip; the 24h auto-skip is unit-testable.
5. When all Runs are Done/Skipped the ready banner appears; Publish is disabled if zero Challengers are Done.
6. Publish places the card on the Board via SSE; opening it shows the Base pane and Challenger tabs.
7. A non-author gets `404` for the draft and `200` after publish.
8. Annotations can be created from a selection, show a thread, accept replies and votes; overlaps return `409`.
9. Discussion posts, one-level replies, votes and filters work.

**Dev seed**: 8 Models, 3 users (`mira`, `kev`, `ana`) and the prototype's 16 Comparisons, plus Annotations, Comments and Votes for the first Comparison. **Production seed** must contain only Models and the fixed Category list, never fake posts.

**Tests**: Vitest for offsets, cursor, filters and upload parsing; integration for job transitions with the mock provider; Playwright for create → publish → read and annotate → thread.

**M2**
Board pagination (infinite scroll/Load more, global counts, stable SSE effect), magic-link auth with handle onboarding, the job-ready notification bell, add-model on a published Comparison and edit/delete affordances for Discussion and Annotations are done; remaining M2 work is minimal admin.

**M3**
Real OpenRouter execution, accessibility audit, AWS deployment, operational hardening.

---

## 15. Decision index (grilling rounds)

| Round | Decisions |
|---|---|
| 1 | Q1 production-intended · Q2 vertical slice · Q3 local Docker · Q4 seeded identity seam · Q5 1440/10px/reduced motion · Q6 Comparison-as-post |
| 2 | Q7 provider adapter + mock · Q8 raw-markdown single-node annotations · Q9 votes table truth · Q10 activity events · Q11 in-app notifications · Q12 magic link · Q13 mutability/freeze/auto-publish · Q14 24h auto-skip |
| 3 | Q15 Postgres canonical/BullMQ transport · Q16 SSE + Redis + replay · Q17 quotas/cost · Q18 UTF-16 offsets/server quote/edit endpoints · Q19 one-level Discussion · Q20 UUIDv7/cursors · Q21 minimal admin · Q22 upload hardening · Q23 Better Auth/SES/handles |
| 4 | Q24 pnpm/Drizzle workspace · Q25 Tailwind/Radix · Q26 M1 acceptance/seed/tests · Q27 danger token/inline errors · Q28 Board live/pagination/URL · Q29 comparison lifecycle/cap/share URLs · Q30 annotation interaction · Q31 Discussion affordances · Q32 AWS ECS Fargate |
| Final | Q33 public read/authenticated write |
