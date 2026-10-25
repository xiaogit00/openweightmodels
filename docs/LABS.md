# Labs — learn OpenWeightModels by poking it

These are small, runnable experiments. Each one isolates a layer so you can see what it does, then break it deliberately.

Read [`docs/CODEBASE-TOUR.md`](CODEBASE-TOUR.md) first if you have not. The tour explains *why*; the labs give you *muscle memory*.

> **Safety first.** Use a dedicated **lab database** and Redis DB index. Do not run destructive labs (account deletion, model disable, seed reset) against the development database if it contains work you care about. The setup below keeps everything isolated on port 3200 and Redis DB `2`.

**Labs:** [0. Boot](#lab-0--boot-and-find-the-seams) · [1. Database](#lab-1--read-the-database-like-the-app-does) · [2. Upload parser](#lab-2--upload-parsing-without-a-server) · [3. Markdown offsets](#lab-3--markdown-runs-and-annotation-offsets) · [4. Board API](#lab-4--the-board-api-and-keyset-pagination) · [5. Create/publish](#lab-5--create-and-publish-a-comparison-through-the-api) · [6. Queue](#lab-6--stop-the-worker-and-watch-the-queue) · [7. Fail/retry/skip](#lab-7--fail-a-run-then-retry-skip-and-auto-skip) · [8. SSE](#lab-8--sse-from-the-terminal) · [9. Annotations](#lab-9--annotations-over-http) · [10. Discussion/votes](#lab-10--discussion-reply-re-parenting-and-votes) · [11. Auth](#lab-11--magic-link-auth-and-handle-onboarding) · [12. Moderation](#lab-12--admin-moderation) · [13. Account deletion](#lab-13--account-export-and-deletion) · [14. UI](#lab-14--ui-experiments) · [15. Tests](#lab-15--tests-as-a-microscope) · [16. Capstone](#lab-16--capstone-add-a-feature-end-to-end)

---

## Lab setup (once)

### 1. Start the services

```bash
cd /path/to/openweightmodels
brew services start postgresql@17
brew services start redis
```

If you use Docker instead, the commands below still work as long as Postgres, Redis and Node are reachable from your shell.

### 2. Create and seed a lab database

```bash
createdb openweightmodels_lab 2>/dev/null || true

export LAB_DB="postgres://localhost:5432/openweightmodels_lab"
export LAB_REDIS="redis://localhost:6379/2"
export LAB_URL="http://localhost:3200"
export COOKIE_JAR="${TMPDIR:-/tmp}/owm-lab-cookies.txt"
export KEV_JAR="${TMPDIR:-/tmp}/owm-lab-kev-cookies.txt"
export ADMIN_JAR="${TMPDIR:-/tmp}/owm-lab-admin-cookies.txt"

DATABASE_URL="$LAB_DB" pnpm --filter @owm/core exec tsx src/db/migrate.ts
DATABASE_URL="$LAB_DB" pnpm --filter @owm/core exec tsx src/seed.ts
```

`src/seed.ts` truncates and reseeds, so re-running it is your reset button. It does **not** touch the development database because `DATABASE_URL` is overridden.

### 3. Start the web app

Terminal A:

```bash
DATABASE_URL="$LAB_DB" \
REDIS_URL="$LAB_REDIS" \
APP_URL="$LAB_URL" \
BETTER_AUTH_SECRET="openweightmodels-lab-secret-change-me" \
ALLOW_DEV_USER_SWITCH=true \
MOCK_DELAY_MS=40 \
pnpm --filter @owm/web exec next dev -p 3200
```

### 4. Start the worker

Terminal B:

```bash
DATABASE_URL="$LAB_DB" \
REDIS_URL="$LAB_REDIS" \
PROVIDER=mock \
MOCK_DELAY_MS=40 \
pnpm --filter @owm/worker dev
```

You should see:

```
[worker] consuming owm-runs with concurrency 4
```

### 5. Reset the lab

```bash
DATABASE_URL="$LAB_DB" pnpm --filter @owm/core exec tsx src/seed.ts
redis-cli -u "$LAB_REDIS" FLUSHDB
```

`FLUSHDB` only clears the Redis database in `$LAB_REDIS` (`/2`), not your development Redis DB.

### Useful variables

| Variable | Value |
|---|---|
| `$LAB_DB` | `postgres://localhost:5432/openweightmodels_lab` |
| `$LAB_REDIS` | `redis://localhost:6379/2` |
| `$LAB_URL` | `http://localhost:3200` |
| `$COOKIE_JAR` | signed-in-as-mira cookie jar |
| `$KEV_JAR` | signed-in-as-kev cookie jar |
| `$ADMIN_JAR` | signed-in-as-mira (admin) cookie jar |

> Run the labs in **one shell** so `$ID`, `$JOB` and the cookie jars persist. If you open a new terminal, re-export the setup variables and sign in again.

---

## Lab 0 — Boot and find the seams

**Goal:** see the three processes and their health.

```bash
curl -s "$LAB_URL/api/health" | jq
```

Expected:

```json
{ "status": "ok", "checks": { "database": "ok", "redis": "ok" } }
```

Open <http://localhost:3200>. You should see the seeded Board.

Now look at the worker terminal. It should have printed the queue name and concurrency. Nothing else yet.

**Database check:**

```bash
psql "$LAB_DB" -tAc "
select
  (select count(*) from users)       as users,
  (select count(*) from comparisons) as comparisons,
  (select count(*) from responses)   as responses,
  (select count(*) from annotations) as annotations,
  (select count(*) from comments)    as comments,
  (select count(*) from votes)       as votes;"
```

Expected roughly: 3 users, 16 comparisons, 42 responses, 6 annotations, 4 comments, 15 votes. (The seed is deterministic; exact counts are in `docs/IMPLEMENTATION-STATUS.md`.)

**Poke:** stop Redis (`brew services stop redis`) and hit `/api/health` again. It should return `degraded` with HTTP 200, because Postgres is still reachable and the app can serve reads with SSE polling. Start Redis again.

**Why it matters:** this is the operational shape: Postgres down = fatal; Redis down = degraded.

---

## Lab 1 — Read the database like the app does

**Goal:** learn the tables by querying them, not by reading 471 lines of schema.

```bash
psql "$LAB_DB" -c "\dt"
```

Then:

```bash
psql "$LAB_DB" -c "
select id, title, status, published_at, deleted_at, takedown_at
from comparisons
order by created_at desc
limit 8;"
```

Notice that seeded Comparisons are `published`, while anything you create will be `generating` and then `ready`.

**Job and Run state:**

```bash
psql "$LAB_DB" -c "
select c.title,
       j.status as job_status,
       r.status as run_status,
       m.slug,
       r.attempt
from comparisons c
join jobs j on j.comparison_id = c.id
join responses r on r.job_id = j.id
join models m on m.id = r.model_id
order by c.created_at desc, r.created_at
limit 15;"
```

You should see one Job per generation batch and one Run per Challenger. The Base Response has `job_id = NULL` because it was uploaded, not generated.

**The public log:**

```bash
psql "$LAB_DB" -c "
select id, kind, summary
from activity_events
order by id desc
limit 10;"
```

`id` is a `bigserial` and is the SSE cursor. Some events have an empty `summary`; those are deletion/takedown/hide events that exist to update an open Board, not to appear in the ticker.

**Notifications:**

```bash
psql "$LAB_DB" -c "
select kind, payload, read_at
from notifications
order by created_at desc
limit 5;"
```

**Poke:** find a Comparison with multiple Challengers and count its Responses:

```bash
psql "$LAB_DB" -c "
select c.title, count(r.id) filter (where r.is_base) as bases,
       count(r.id) filter (where not r.is_base) as challengers
from comparisons c
join responses r on r.comparison_id = c.id
group by c.id, c.title
order by challengers desc
limit 5;"
```

There is always exactly one base.

**Why it matters:** every UI state is a row here. If you can describe a feature as rows and state transitions, you can implement it.

---

## Lab 2 — Upload parsing without a server

**Goal:** see exactly what the server does with a markdown upload, and how it rejects bad input.

Create a scratch script:

```bash
cat > "${TMPDIR:-/tmp}/owm-upload-lab.mts" <<'EOF'
const root = process.cwd();
const {
  parseMarkdownUpload,
  validateFileSize,
  decodeUtf8,
} = await import(`${root}/packages/core/src/domain/upload.ts`);

const cases: Array<[string, string, string]> = [
  ['valid', '---\nprompt: Explain SSE\nmodel: llama-3-3-70b\n---\n\nBody text.', 'My-Sample.md'],
  ['no front matter', '# Heading\n\nBody.', 'notes.txt'],
  ['unknown model', '---\nmodel: not-a-model\n---\n\nBody.', 'x.md'],
  ['bad yaml', '---\nprompt: [unclosed\n---\n\nBody.', 'x.md'],
  ['empty body', '---\nprompt: Hi\n---\n\n   ', 'x.md'],
];

for (const [label, text, name] of cases) {
  try {
    console.log(label, parseMarkdownUpload(text, name));
  } catch (error) {
    console.log(label, 'ERROR', (error as Error).message);
  }
}

const checks: Array<[string, () => unknown]> = [
  ['empty file', () => validateFileSize(0)],
  ['oversize', () => validateFileSize(1024 * 1024 + 1)],
  ['nul byte', () => decodeUtf8(new Uint8Array([104, 105, 0]))],
  ['bad utf8', () => decodeUtf8(new Uint8Array([0xff, 0xfe]))],
];

for (const [label, fn] of checks) {
  try { fn(); console.log(label, 'accepted'); }
  catch (error) { console.log(label, 'ERROR', (error as Error).message); }
}
EOF

pnpm exec tsx "${TMPDIR:-/tmp}/owm-upload-lab.mts"
```

Expected highlights:

- `valid` returns `{ body: 'Body text.', prompt: 'Explain SSE', model: 'llama-3-3-70b', titleFromFile: 'My Sample', ... }`.
- No front matter returns `prompt: null`, `model: null`, and a title derived from the filename.
- An unknown `model:` is **kept as a string**; the New Comparison form decides it cannot match it and asks the author to choose. The parser itself does not know the registry.
- Bad YAML, empty body, empty file, oversize, NUL bytes and invalid UTF-8 all throw with machine-readable codes.

**Poke:** change `'Body text.'` to `'   '` and confirm `empty_body`. Change the filename to `x.pdf` and confirm `unsupported_file_type`.

**Why it matters:** front matter is optional and deliberately restricted. The parser is pure; it has no database or auth. That makes it easy to test and safe to reuse in the browser for a preview.

---

## Lab 3 — Markdown, runs and annotation offsets

**Goal:** understand why some text is annotatable and some is not.

```bash
cat > "${TMPDIR:-/tmp}/owm-markdown-lab.mts" <<'EOF'
const root = process.cwd();
const {
  annotatableRanges,
  buildBlocks,
  validateAnnotationRange,
} = await import(`${root}/packages/core/src/domain/markdown.ts`);

const samples: Record<string, string> = {
  plain: 'Hello world.',
  bold: 'Hello **bold** world.',
  inlineCode: 'Run `pnpm dev` now.',
  fenced: 'Before.\n\n```js\nconst x = 1;\n```\n',
  indented: 'Before.\n\n    const x = 1;\n',
  emoji: 'Hi 👋 there.',
  escape: 'A \\*literal\\* star.',
  link: 'See [the docs](https://example.com) now.',
  table: '| a | b |\n| - | - |\n| 1 | 2 |',
};

for (const [name, md] of Object.entries(samples)) {
  console.log(name, JSON.stringify(annotatableRanges(md)));
}

const md = 'Hello **bold** world.';
for (const [start, end] of [[0, 5], [8, 12], [0, 12]]) {
  try { console.log('range', start, end, validateAnnotationRange(md, start, end)); }
  catch (error) { console.log('range', start, end, 'ERROR', (error as Error).message); }
}

console.log(JSON.stringify(buildBlocks(md), null, 2));
EOF

pnpm exec tsx "${TMPDIR:-/tmp}/owm-markdown-lab.mts"
```

Expected:

- `bold` produces three runs: `Hello `, `bold`, ` world.` — the marks split the text.
- `fenced` includes the code text as one annotatable range; `indented` does not (`annotatable: false`).
- `emoji` offsets count `👋` as **two** UTF-16 code units. JavaScript `indexOf` and browser Selection use the same units.
- `escape` is not annotatable because the raw source (`\*`) differs from the decoded text (`*`).
- `link` marks the link text as annotatable with `href` on the run.
- `table` is rendered as raw text, not a table, because GFM is not enabled.
- `validateAnnotationRange('Hello **bold** world.', 0, 12)` fails: the range crosses a formatting boundary.
- `buildBlocks` shows the block/run tree the renderer consumes.

**Poke:** add a CJK sample (`'こんにちは世界'`) and an emoji in the middle of a word. Confirm offsets still index the raw string. Then try a range that starts in plain text and ends inside bold.

**Why it matters:** annotations are not DOM ranges. They are stable offsets into immutable raw markdown. This is the single most subtle part of the codebase.

---

## Lab 4 — The Board API and keyset pagination

**Goal:** see filters, sorting, cursors and facets without the UI.

```bash
# First page
curl -s "$LAB_URL/api/comparisons?limit=2" | jq '{total, nextCursor, titles: [.items[].title]}'
```

Save the cursor:

```bash
CURSOR=$(curl -s "$LAB_URL/api/comparisons?limit=1" | jq -r '.nextCursor')
echo "$CURSOR"
```

Fetch the next page:

```bash
curl -s "$LAB_URL/api/comparisons?limit=2&cursor=$CURSOR" | jq '{total, titles: [.items[].title]}'
```

**Try each filter:**

```bash
curl -s "$LAB_URL/api/comparisons?cat=Coding&limit=3" | jq '{total, titles: [.items[].title]}'
curl -s "$LAB_URL/api/comparisons?models=llama-3-3-70b&limit=3" | jq '{total, titles: [.items[].title]}'
curl -s "$LAB_URL/api/comparisons?effort=2&limit=3" | jq '{total, titles: [.items[].title]}'
curl -s "$LAB_URL/api/comparisons?q=rate&limit=3" | jq '{total, titles: [.items[].title]}'
curl -s "$LAB_URL/api/comparisons?sort=top&limit=3" | jq '{total, titles: [.items[].title]}'
```

**Prove the cursor is sort-specific:**

```bash
curl -s "$LAB_URL/api/comparisons?sort=top&limit=1&cursor=$CURSOR" | jq
```

Expected: `400` with `invalid_cursor`. A cursor minted for `live` cannot be replayed against `top`.

**Facets are global:**

```bash
curl -s "$LAB_URL/api/comparisons/facets" | jq
curl -s "$LAB_URL/api/comparisons?cat=Coding&limit=1" | jq '.total'
```

The facets total is the whole Board; the list `total` is filter-scoped.

**Poke:** `sort=bogus` should fall back to `live`; `cat=bogus` should become `All`; `limit=1000` is clamped to 100. Find those behaviours in `parseBoardFilters` and `listComparisons`.

**Why it matters:** the Board is a keyset-paginated SQL query, not an in-memory filter. Every new filter must decide how it affects `total`, `nextCursor`, the cursor payload and the client's `matchesFilters`.

---

## Lab 5 — Create and publish a Comparison through the API

**Goal:** drive the main write path without clicking.

### Sign in as the seeded author

```bash
curl -s -c "$COOKIE_JAR" \
  -H 'content-type: application/json' \
  -d '{"handle":"mira"}' \
  "$LAB_URL/api/dev/user" | jq
```

### Find model IDs

```bash
BASE=$(curl -s "$LAB_URL/api/models" | jq -r '.models[] | select(.slug=="llama-3-3-70b") | .id')
CHAL=$(curl -s "$LAB_URL/api/models" | jq -r '.models[] | select(.slug=="qwen-2-5-72b") | .id')
echo "$BASE $CHAL"
```

### Write a base output

```bash
cat > "${TMPDIR:-/tmp}/owm-lab-base.md" <<'EOF'
---
prompt: Write a thread-safe sliding-window rate limiter in Go.
model: llama-3-3-70b
---

Here is a thread-safe sliding-window rate limiter that tracks request timestamps per key.

The **trade-off** is memory: a log is exact but stores one timestamp per accepted request.
EOF
```

### Create

```bash
RESP=$(curl -s -b "$COOKIE_JAR" -X POST "$LAB_URL/api/comparisons" \
  -F "file=@${TMPDIR:-/tmp}/owm-lab-base.md;type=text/markdown" \
  -F "base_model_id=$BASE" \
  -F "prompt=Write a thread-safe sliding-window rate limiter in Go." \
  -F "title=Lab comparison $(date +%s)" \
  -F "effort=2" \
  -F "categories=Coding" \
  -F "model_ids=$CHAL")

echo "$RESP" | jq
ID=$(echo "$RESP" | jq -r .id)
JOB=$(echo "$RESP" | jq -r .jobId)
echo "$ID $JOB"
```

Expected: `201` with `{ id, jobId, title }`.

### Watch the Job settle

```bash
for i in $(seq 1 30); do
  STATUS=$(curl -s -b "$COOKIE_JAR" "$LAB_URL/api/jobs/$JOB" | jq -r '.job.status')
  echo "$i $STATUS"
  [ "$STATUS" = "ready" ] && break
  sleep 1
done
```

Then inspect the runs:

```bash
curl -s -b "$COOKIE_JAR" "$LAB_URL/api/jobs/$JOB" \
  | jq '.runs[] | {modelName, status, tokens, latencyMs, attempt, error}'
```

### Publish

```bash
curl -s -b "$COOKIE_JAR" -X POST "$LAB_URL/api/comparisons/$ID/publish" \
  | jq '.card | {id, title, models: [.models[].name], commentCount, annotationCount}'
```

Now check the Board:

```bash
curl -s "$LAB_URL/api/comparisons?q=Lab" | jq '{total, titles: [.items[].title]}'
```

**Poke:**

- Before publishing, fetch the Comparison **without** the cookie: `curl -s -o /dev/null -w '%{http_code}\n' "$LAB_URL/api/comparisons/$ID"` → `404`.
- With the cookie → `200`.
- Try `POST /api/comparisons` without a cookie → `401 unauthorized`.
- Try creating with the Base also in `model_ids` → `409 base_in_challengers`.
- Duplicate `model_ids` are de-duplicated at creation. To see `409 model_exists`, add an already-used model later via `POST /api/comparisons/:id/responses`.

**Why it matters:** this is the whole core loop. The UI is a thin layer over these endpoints.

---

## Lab 6 — Stop the worker and watch the queue

**Goal:** see that the web app only *enqueues*; the worker does the work.

1. Stop the worker with `Ctrl-C` in Terminal B.
2. Create another Comparison using the Lab 5 commands (new title, same base/challenger).
3. Check Postgres:

```bash
psql "$LAB_DB" -c "
select status, count(*)
from responses
where comparison_id = '$ID'
group by status;"

psql "$LAB_DB" -c "select status from jobs where id = '$JOB';"
```

Expected: all Challenger Responses are `queued`, the Base is `done`, and the Job is `scheduled`.

4. Check Redis:

```bash
redis-cli -u "$LAB_REDIS" --scan --pattern 'bull:owm-runs:*' | sort | head -20
```

You should see keys for the queue. The exact key names are BullMQ internals; the point is that the work is in Redis, not in a running process.

5. Start the worker again:

```bash
DATABASE_URL="$LAB_DB" REDIS_URL="$LAB_REDIS" PROVIDER=mock MOCK_DELAY_MS=40 \
  pnpm --filter @owm/worker dev
```

Watch it drain the queue, then check `job_events`:

```bash
psql "$LAB_DB" -c "
select kind, count(*)
from job_events
where job_id = '$JOB'
group by kind
order by kind;"
```

Expected kinds: `job.scheduled`, `response.status` (several), `job.ready`.

**Poke:** while the worker is stopped, restart the web app. The queued work survives, because it is in Redis and Postgres, not in the web process.

**Why it matters:** this is why `/api/comparisons` returns quickly and why a slow provider cannot block the web server.

---

## Lab 7 — Fail a Run, then retry, skip and auto-skip

**Goal:** exercise the Run state machine.

### Restart the worker with failure injection

```bash
DATABASE_URL="$LAB_DB" REDIS_URL="$LAB_REDIS" PROVIDER=mock \
  MOCK_DELAY_MS=20 MOCK_FAIL_ONCE=true MOCK_FAIL_MODEL=deepseek-v3 \
  pnpm --filter @owm/worker dev
```

Create a Comparison whose Challenger is `deepseek-v3`:

```bash
DS=$(curl -s "$LAB_URL/api/models" | jq -r '.models[] | select(.slug=="deepseek-v3") | .id')
```

Reuse Lab 5's multipart block, but replace `-F "model_ids=$CHAL"` with `-F "model_ids=$DS"` and use a new title. Then set `ID` and `JOB` from the response as before.

Wait a few seconds, then:

```bash
psql "$LAB_DB" -c "
select status, error, attempt
from responses
where job_id = '$JOB' and is_base = false;"

psql "$LAB_DB" -c "select status from jobs where id = '$JOB';"
```

Expected: the Run is `failed` with `API timeout`, `attempt = 0`. The Job is still `running`, not `failed`, because a failed Run blocks readiness.

### Retry

```bash
RUN=$(psql "$LAB_DB" -tAc "
select id from responses
where job_id = '$JOB' and is_base = false
limit 1;")

curl -s -b "$COOKIE_JAR" -X POST "$LAB_URL/api/responses/$RUN/retry" | jq
```

The mock fails only on `attempt === 0`, so attempt 1 succeeds. Check the Run and Job again.

### Skip instead

Create and fail a **new** Comparison (otherwise the retried Run is already `done`), then re-derive the failed Run:

```bash
RUN=$(psql "$LAB_DB" -tAc "
select id from responses
where job_id = '$JOB' and is_base = false and status = 'failed'
limit 1;")

curl -s -b "$COOKIE_JAR" -X POST "$LAB_URL/api/responses/$RUN/skip" | jq
```

Expected: the Run is `skipped`; `finalizeJob` sets the Job `ready` and the Comparison `ready` (if it was generating). If this was the only Challenger and it was skipped, publishing returns `409 no_done_responses`.

### Auto-skip

Restart the worker with a 5-second timer:

```bash
DATABASE_URL="$LAB_DB" REDIS_URL="$LAB_REDIS" PROVIDER=mock \
  MOCK_DELAY_MS=20 MOCK_FAIL_ONCE=true MOCK_FAIL_MODEL=deepseek-v3 \
  AUTO_SKIP_DELAY_MS=5000 \
  pnpm --filter @owm/worker dev
```

Create and fail another Run (re-derive `ID`/`JOB` from the new creation), wait ~7 seconds, then check it became `skipped` without a click. The delayed job is attempt-scoped, so a retry before it fires gets a fresh window.

**Poke:** set `AUTO_SKIP_DELAY_MS=1000` and watch the race between the delayed job and a fast retry. `removeAutoSkip` is the cleanup path.

**Why it matters:** retry/skip are user decisions stored in Postgres, not BullMQ retries. The queue only carries attempts.

---

## Lab 8 — SSE from the terminal

**Goal:** see the exact wire format and prove replay.

### Board stream

Get the current high-water mark so you do not replay history:

```bash
LAST=$(psql "$LAB_DB" -tAc "select coalesce(max(id), 0) from activity_events")
echo "$LAST"

curl -N "$LAB_URL/api/stream/board?after=$LAST"
```

You should see:

```
: connected
```

In another terminal, create and publish a Comparison (Lab 5). The stream prints:

```
id: 43
data: {"id":43,"type":"comparison.published","data":{...}}
```

Wait 20 seconds and you will see `: ping`.

### Replay

1. Note the last `id` you received.
2. Stop the stream (`Ctrl-C`).
3. Publish two more Comparisons.
4. Reconnect with that ID (replace `43` with the one you noted):

```bash
LAST_SEEN=43
curl -N -H "Last-Event-ID: $LAST_SEEN" "$LAB_URL/api/stream/board"
```

You should receive both missed events, in order, before any new ones.

### Job stream

This replays the last Job's events. To watch a live one, start the `curl` and then create a Comparison in another terminal.

```bash
curl -N -b "$COOKIE_JAR" "$LAB_URL/api/stream/jobs/$JOB"
```

Expected event types: `response.status` with `calling`, `streaming`, `done`; then `job.ready`.

### Raw Redis fan-out

```bash
redis-cli -u "$LAB_REDIS" SUBSCRIBE owm:board
```

Publish a Comparison in another terminal. You will see the raw JSON message. This is the same payload the SSE route forwards.

**Poke (advanced):** start a second web server on port 3201 with `REDIS_URL=redis://localhost:6399` (a dead Redis). Open `http://localhost:3201/api/stream/board?after=$LAST`; it still receives new events, because the 2-second Postgres poll is the fallback. This proves Redis is not the source of truth.

**Why it matters:** `id` is a Postgres sequence, not a Redis message ID. That is what makes reconnect and replay reliable.

---

## Lab 9 — Annotations over HTTP

**Goal:** see server-side range validation, overlap rejection and counter updates.

Use a published Comparison with a base body containing `sliding-window` (the Lab 5 sample does). If `$ID` is stale, re-derive it:

```bash
ID=$(curl -s "$LAB_URL/api/comparisons?q=Lab&limit=1" | jq -r '.items[0].id')
```

Then:

```bash
curl -s "$LAB_URL/api/comparisons/$ID" > "${TMPDIR:-/tmp}/owm-comp.json"

RESP=$(jq -r '.responses[] | select(.response.isBase) | .response.id' "${TMPDIR:-/tmp}/owm-comp.json")
START=$(node - "${TMPDIR:-/tmp}/owm-comp.json" <<'NODE'
const fs = require('fs');
const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const base = data.responses.find((r) => r.response.isBase).response;
console.log(base.contentMd.indexOf('sliding-window'));
NODE
)
END=$((START + 14))
echo "$RESP $START $END"
[ "$START" -ge 0 ] || echo "phrase not found — use a Comparison whose base contains 'sliding-window'"
```

Create:

```bash
curl -s -b "$COOKIE_JAR" \
  -H 'content-type: application/json' \
  -d "{\"responseId\":\"$RESP\",\"kind\":\"bug\",\"startOffset\":$START,\"endOffset\":$END,\"body\":\"Lab annotation\",\"quote\":\"CLIENT QUOTE IS IGNORED\"}" \
  "$LAB_URL/api/annotations" | jq
```

Expected: `201`, and `.annotation.quote` is `sliding-window` from the server, not the client string.

### Overlap

Repeat the exact request. Expected: `409 annotation_overlap`.

### Adjacent

Create another range starting at `END`:

```bash
curl -s -b "$COOKIE_JAR" \
  -H 'content-type: application/json' \
  -d "{\"responseId\":\"$RESP\",\"kind\":\"question\",\"startOffset\":$END,\"endOffset\":$((END + 5)),\"body\":\"Adjacent is fine\"}" \
  "$LAB_URL/api/annotations" | jq
```

### Cross-format rejection

Our sample has `**trade-off**`. Compute a range that starts at 0 and ends inside the bold word:

```bash
BOLD_END=$(node - "${TMPDIR:-/tmp}/owm-comp.json" <<'NODE'
const fs = require('fs');
const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const base = data.responses.find((r) => r.response.isBase).response;
console.log(base.contentMd.indexOf('trade-off') + 9);
NODE
)
curl -s -b "$COOKIE_JAR" \
  -H 'content-type: application/json' \
  -d "{\"responseId\":\"$RESP\",\"kind\":\"bug\",\"startOffset\":0,\"endOffset\":$BOLD_END,\"body\":\"Should fail\"}" \
  "$LAB_URL/api/annotations" | jq
```

Expected: `409` with code `unannotatable_range`.

### Counter and ticker

```bash
psql "$LAB_DB" -c "select annotation_count from comparisons where id = '$ID';"
psql "$LAB_DB" -c "
select kind, summary, payload->>'annotationId' as annotation_id
from activity_events
where comparison_id = '$ID'
order by id desc
limit 5;"
```

### Delete

```bash
ANN=$(curl -s "$LAB_URL/api/comparisons/$ID" | jq -r '.annotations[0].id')
curl -s -b "$COOKIE_JAR" -X DELETE "$LAB_URL/api/annotations/$ANN" | jq
```

Expected: `{ ok: true }`; the counter decreases; the ticker rows for that Annotation are retracted and a summary-less `annotation.deleted` event remains.

**Poke:** annotate a fenced code block (works) and an indented code block (fails). Annotate across an emoji and confirm offsets still line up in the UI.

**Why it matters:** the client computes offsets, but the server re-validates. Never trust a client range.

---

## Lab 10 — Discussion, reply re-parenting and votes

**Goal:** see the one-level reply rule and the two kinds of deletion.

Create a root comment as mira:

```bash
C1=$(curl -s -b "$COOKIE_JAR" -H 'content-type: application/json' \
  -d "{\"comparisonId\":\"$ID\",\"body\":\"Root comment\"}" \
  "$LAB_URL/api/comments" | jq -r .comment.id)

C2=$(curl -s -b "$COOKIE_JAR" -H 'content-type: application/json' \
  -d "{\"comparisonId\":\"$ID\",\"parentId\":\"$C1\",\"body\":\"First reply\"}" \
  "$LAB_URL/api/comments" | jq -r .comment.id)

C3=$(curl -s -b "$COOKIE_JAR" -H 'content-type: application/json' \
  -d "{\"comparisonId\":\"$ID\",\"parentId\":\"$C2\",\"body\":\"Reply to a reply\"}" \
  "$LAB_URL/api/comments" | jq -r .comment.id)

psql "$LAB_DB" -c "
select id, parent_id, body
from comments
where id in ('$C1','$C2','$C3')
order by created_at;"
```

Expected: `C3.parent_id = C1`, not `C2`. The service re-parents a reply-to-a-reply to the root.

### Vote as kev

```bash
curl -s -c "$KEV_JAR" -H 'content-type: application/json' \
  -d '{"handle":"kev"}' "$LAB_URL/api/dev/user" > /dev/null

curl -s -b "$KEV_JAR" -H 'content-type: application/json' \
  -d "{\"targetType\":\"comment\",\"targetId\":\"$C1\"}" \
  "$LAB_URL/api/votes" | jq
```

Expected: `{ "voted": true, "count": 1 }`. Repeat to toggle off.

### Self-vote

```bash
curl -s -b "$COOKIE_JAR" -H 'content-type: application/json' \
  -d "{\"targetType\":\"comment\",\"targetId\":\"$C1\"}" \
  "$LAB_URL/api/votes" | jq
```

Expected: `self_vote`. **Note:** the current service returns HTTP `409`, although `BACKEND.md` says `400`. See the tour §9.

### Tombstone vs hard delete

Delete the root (it has replies):

```bash
curl -s -b "$COOKIE_JAR" -X DELETE "$LAB_URL/api/comments/$C1" | jq
psql "$LAB_DB" -c "select id, body, deleted_at from comments where id = '$C1';"
```

The row remains with `deleted_at`; public reads return an empty body. Replies survive.

Delete the childless reply:

```bash
curl -s -b "$COOKIE_JAR" -X DELETE "$LAB_URL/api/comments/$C3" | jq
psql "$LAB_DB" -c "select count(*) from comments where id = '$C3';"
```

Expected: `0` rows — childless comments are hard-deleted, and their votes are deleted with them.

**Poke:** reply to `C2` after `C1` is tombstoned. The parent still exists, so the reply is allowed and re-parented to `C1`.

**Why it matters:** tombstones preserve other people's replies; hard deletes keep the table clean when nothing depends on the row.

---

## Lab 11 — Magic-link auth and handle onboarding

**Goal:** see the real auth flow, not the dev switcher.

### Request a link

Pick the address first, then enter that exact address on the page:

```bash
EMAIL="lab-$(date +%s)@example.test"
echo "$EMAIL"
```

Open <http://localhost:3200/sign-in> and enter `$EMAIL`.

If Mailpit is running, open <http://localhost:8025> and click the link. If not, the web log prints the URL and the development outbox has it:

```bash
# The browser request already created the link; read the latest one for this email.
LINK=$(curl -s "$LAB_URL/api/dev/magic-link?email=$EMAIL" | jq -r .url)
echo "$LINK"
open "$LINK"    # macOS; or paste it into the browser
```

Opening the link verifies it, creates the account and redirects to `/auth/complete`, then `/onboarding`.

### Claim a handle

Claim it in the browser on `/onboarding`. Then check the session and the row:

```bash
psql "$LAB_DB" -c "select email, handle, email_verified from users where email = '$EMAIL';"
```

If you prefer a curl-only flow, **do not open the link in the browser first** (it is single-use). Use a new cookie jar (not `$COOKIE_JAR`, which is mira) and follow the verification redirect:

```bash
NEW_JAR="${TMPDIR:-/tmp}/owm-lab-new-cookies.txt"
curl -s -L -c "$NEW_JAR" -b "$NEW_JAR" "$LINK" -o /dev/null
curl -s -b "$NEW_JAR" "$LAB_URL/api/me" | jq
curl -s -b "$NEW_JAR" \
  -H 'content-type: application/json' \
  -d '{"handle":"lab-reader"}' \
  "$LAB_URL/api/account/handle" | jq
```

### Single use and expiry

- Open the same link again: it should fail; the token is consumed.
- Tokens expire after 15 minutes (`MAGIC_LINK_TTL_MINUTES`).
- Better Auth rate-limits magic-link requests (5 per 60s per IP by default). Requesting six quickly should return `429`.

### Production guard

Read `apps/web/src/lib/identity-policy.ts` and `apps/web/src/app/api/dev/user/route.ts`. The dev switcher and the dev outbox return `404` whenever `NODE_ENV=production`, regardless of `ALLOW_DEV_USER_SWITCH`.

**Why it matters:** the session cookie is the only production identity. The dev switcher is a convenience that must never leak into production.

---

## Lab 12 — Admin moderation

**Goal:** see takedown, model disable, suspension and the audit trail.

Sign in as the admin:

```bash
curl -s -c "$ADMIN_JAR" -H 'content-type: application/json' \
  -d '{"handle":"mira"}' "$LAB_URL/api/dev/user" > /dev/null
```

Find a published Comparison authored by `kev`:

```bash
ID=$(psql "$LAB_DB" -tAc "
select c.id
from comparisons c
join users u on u.id = c.author_id
where u.handle = 'kev' and c.status = 'published'
limit 1;")
echo "$ID"
```

### Takedown

```bash
curl -s -b "$ADMIN_JAR" -H 'content-type: application/json' \
  -d '{"reason":"Lab takedown"}' \
  -X POST "$LAB_URL/api/admin/comparisons/$ID/takedown" | jq

curl -s -o /dev/null -w 'public: %{http_code}\n' "$LAB_URL/api/comparisons/$ID"
```

Expected: `404` to the public. Sign in as kev and fetch it: also `404` (the author loses access). Fetch as mira with the admin cookie: `200`, because an Admin can review a taken-down record.

```bash
curl -s -c "$KEV_JAR" -H 'content-type: application/json' \
  -d '{"handle":"kev"}' "$LAB_URL/api/dev/user" > /dev/null

curl -s -o /dev/null -w 'author: %{http_code}\n' -b "$KEV_JAR" "$LAB_URL/api/comparisons/$ID"
curl -s -o /dev/null -w 'admin:  %{http_code}\n' -b "$ADMIN_JAR" "$LAB_URL/api/comparisons/$ID"
```

Check the Board and the ticker: the card and its ticker lines disappear. Check `admin_actions`:

```bash
psql "$LAB_DB" -c "
select action, target_type, reason
from admin_actions
order by created_at desc
limit 5;"
```

### Restore

```bash
curl -s -b "$ADMIN_JAR" -H 'content-type: application/json' \
  -d '{"reason":"Lab restore"}' \
  -X POST "$LAB_URL/api/admin/comparisons/$ID/restore" | jq
```

The Comparison and its card return.

### Disable a Model

```bash
MODEL=$(curl -s "$LAB_URL/api/models" | jq -r '.models[] | select(.slug=="phi-4") | .id')

curl -s -b "$ADMIN_JAR" -X PATCH \
  -H 'content-type: application/json' \
  -d '{"enabled":false}' \
  "$LAB_URL/api/admin/models/$MODEL" | jq

curl -s "$LAB_URL/api/models" | jq '[.models[].slug] | index("phi-4")'
```

Expected: `null` — the model is gone from the picker. A Run already queued on it will fail with `Model disabled` rather than call the provider.

### Suspend a member

```bash
KEV=$(psql "$LAB_DB" -tAc "select id from users where handle = 'kev'")

curl -s -b "$ADMIN_JAR" -H 'content-type: application/json' \
  -d '{"reason":"Lab suspension"}' \
  -X POST "$LAB_URL/api/admin/users/$KEV/suspend" | jq
```

As kev, try to comment:

```bash
curl -s -b "$KEV_JAR" -H 'content-type: application/json' \
  -d "{\"comparisonId\":\"$ID\",\"body\":\"Should fail\"}" \
  "$LAB_URL/api/comments" | jq
```

Expected: `403 account_suspended`. Reads still work. Reinstate with `/reinstate`.

**Poke:** open `/admin` as mira. As kev, `/admin` returns `404`, not `403`.

**Why it matters:** every removal is attributable and reversible. Counters, ticker lines and the audit row all move together.

---

## Lab 13 — Account export and deletion

**Goal:** see the full erasure policy. **Use the lab DB only.**

Sign in as kev and export:

```bash
curl -s -c "$KEV_JAR" -H 'content-type: application/json' \
  -d '{"handle":"kev"}' "$LAB_URL/api/dev/user" > /dev/null

curl -s -b "$KEV_JAR" "$LAB_URL/api/account/export" \
  | jq '{account, comparisons: (.comparisons | length), comments: (.comments | length), annotations: (.annotations | length)}'

# Capture the id BEFORE deletion; the email and handle are cleared afterwards.
KEV=$(psql "$LAB_DB" -tAc "select id from users where handle = 'kev'")
echo "$KEV"
```

Delete:

```bash
curl -s -b "$KEV_JAR" -H 'content-type: application/json' \
  -d '{"confirmation":"DELETE"}' \
  -X POST "$LAB_URL/api/account/delete" | jq
```

Check the `users` row:

```bash
psql "$LAB_DB" -c "
select handle, email, name, avatar_url, suspended_at, deleted_at
from users where id = '$KEV';"
```

Expected: personal fields are null, `deleted_at` is set.

Check the effects:

```bash
# Published Comparisons remain, attributed to [deleted]
psql "$LAB_DB" -c "
select count(*) from comparisons where author_id = '$KEV';"

# Comments are tombstones; Annotations are gone
psql "$LAB_DB" -c "
select count(*) filter (where deleted_at is not null) as tombstones,
       count(*) as total
from comments where author_id = '$KEV';"

psql "$LAB_DB" -c "
select count(*) from annotations where author_id = '$KEV';"

# Sessions and pending magic links are gone
psql "$LAB_DB" -c "select count(*) from auth_sessions where user_id = '$KEV';"
```

Fetch a surviving Comparison as the public:

```bash
COMP=$(psql "$LAB_DB" -tAc "select id from comparisons where author_id = '$KEV' limit 1")
curl -s "$LAB_URL/api/comparisons/$COMP" | jq '.author.handle'
```

Expected: `"deleted"`; the API renders it as `[deleted]`.

**Poke:** try deleting with `{"confirmation":"nope"}` → `400`. The service is actually case-insensitive, so `delete` also works; the UI asks for uppercase. Try deleting an admin (mira) when it is the last admin → `409`. Reseed afterwards:

```bash
DATABASE_URL="$LAB_DB" pnpm --filter @owm/core exec tsx src/seed.ts
```

**Why it matters:** account deletion is not a cascade of everything. Published work and other people's replies must survive; private and personal data must not.

---

## Lab 14 — UI experiments

**Goal:** feel how the client state machines are wired.

### Shrink the Board page size

Edit `packages/core/src/domain/filters.ts`:

```ts
export const BOARD_PAGE_SIZE = 3; // was 48
```

Reload the Board. You should get three cards, a sentinel and a **Load more** button. Scroll to trigger the infinite loader. If Next does not pick up a change under `packages/core`, restart the web dev server; some setups only watch `apps/web`. Revert when done.

### Change live-arrival placement

Edit `packages/core/src/domain/filters.ts`:

```ts
export const ARRIVAL_NEAR_TOP_PX = 0; // was 200
```

Publish a Comparison while the Board is at the top. It should always go into the "N new comparisons" pill instead of inserting. Revert.

### Change a design token

Edit `apps/web/src/app/globals.css`:

```css
--color-accent: #38bdf8; /* was #a3e635 */
```

Every accent updates via hot reload. Revert. This is the whole Tailwind v4 theme: CSS variables, not a config file.

### Inspect the client state

Open React DevTools, select `BoardClient`, and watch `items`, `pending`, `facets`, `phase`, `live` while you filter, scroll and publish. The component is a small state machine; the server only supplies the first page.

**Poke:** add `console.log` inside the `source.onmessage` handler in `board-client.tsx`, publish, and watch the event arrive. Remove it before committing.

**Why it matters:** most UI features are changes to a client state machine plus one API call, not a new page.

---

## Lab 15 — Tests as a microscope

**Goal:** learn the fastest feedback loops.

### One domain file

```bash
pnpm --filter @owm/core exec vitest run test/markdown.test.ts
pnpm --filter @owm/core exec vitest run test/cursor.test.ts
```

These need no Postgres or Redis.

### One integration suite

```bash
pnpm --filter @owm/core exec vitest run test/pipeline.test.ts
```

This needs Postgres and Redis; `test/setup.ts` loads `.env`. If a service is down, integration files skip with a warning.

### Web unit tests

```bash
pnpm --filter @owm/web test
```

### One browser spec

```bash
pnpm test:e2e e2e/journey.spec.ts
```

The `test:e2e` script runs `e2e/prepare.ts` first: it creates/seeds `openweightmodels_e2e`, flushes Redis DB `1`, and starts its own web + worker on port 3100. It refuses to touch the development database or Redis DB.

### Add a failing test first

In `packages/core/test/markdown.test.ts`, add a case for a new emoji range:

```ts
it('keeps UTF-16 offsets around an emoji', () => {
  const md = 'Hi 👋 there';
  const runs = annotatableRanges(md);
  expect(runs[0]?.text).toBe(md);
});
```

Run it. It passes, because the whole string is one run. Now assert the wrong offset and watch it fail. This is the red-green loop you will use for real changes.

### Visual and accessibility

```bash
pnpm test:e2e e2e/a11y.spec.ts
pnpm test:e2e e2e/visual.spec.ts
```

After a deliberate visual change:

```bash
pnpm test:e2e e2e/visual.spec.ts --update-snapshots
```

Review the images before committing them. Playwright suffixes snapshots with the OS (`*-darwin.png`).

**Why it matters:** every layer has a fast test. Use the lowest layer that can prove the behaviour.

---

## Lab 16 — Capstone: add a feature end-to-end

Pick one. The first is fully guided; the other two are checklists.

### Option A (guided, no migration): add a new Annotation kind, `style`

This touches the shared domain constant, the server validator, the UI icons/filters, and tests. It teaches the most common feature shape.

1. **Domain** — `packages/core/src/domain/types.ts`:

   ```ts
   export const ANNOTATION_KINDS = ['bug', 'hallucination', 'good', 'question', 'style'] as const;
   ```

   Add to `ANNOTATION_KIND_META`:

   ```ts
   style: { label: 'Style', icon: 'ph-paint-brush' },
   ```

2. **Server** — nothing to change. `annotationCreateSchema` uses `z.enum(ANNOTATION_KINDS)` and `assertKind` uses the same constant. Confirm by creating one with `"kind":"style"`.

3. **UI** — `apps/web/src/components/comparison-view.tsx`:

   - import an icon (e.g. `PaintBrush` from `@phosphor-icons/react`),
   - add `style: PaintBrush` to `KIND_ICONS`,
   - the filter list and the new-annotation kind buttons derive from `ANNOTATION_KINDS`, so they update automatically.

4. **Database** — no migration. `annotations.kind` is `text` and typed in TypeScript. This is a deliberate trade-off: flexible kinds, no DB enum to migrate.

5. **Tests** — add a core test:

   ```ts
   it('accepts the style kind', async () => {
     await withFixture({ comparisonStatus: 'published' }, async (fixture) => {
       const annotation = await createAnnotation({
         userId: fixture.userId,
         responseId: fixture.baseResponseId,
         kind: 'style',
         startOffset: 0,
         endOffset: 5,
         body: 'Looks good',
       });
       expect(annotation.kind).toBe('style');
     });
   });
   ```

   Add an e2e assertion if the kind filter is part of the journey. Run:

   ```bash
   pnpm typecheck
   pnpm --filter @owm/core exec vitest run test/markdown.test.ts test/permissions.test.ts
   pnpm test:e2e e2e/a11y.spec.ts
   ```

6. **Docs** — if `style` is a product concept, add it to `GLOSSARY.md` and `BACKEND.md` §7. If it is only a label, a comment in `types.ts` is enough.

7. **Review checklist** — can a user create it? Can they filter by it? Does it render with the right label? Does it survive delete/hide/account deletion? Is the icon accessible (label, not just colour)?

### Option B (checklist, migration): add `comparisons.source_url`

Follow §8.3 of the tour:

1. Add the column to `schema.ts`.
2. `pnpm db:generate`; review the SQL and snapshot.
3. `pnpm db:migrate`.
4. Add it to `ComparisonCard` if the Board shows it.
5. Add it to `createComparison` / `updateComparison` and the Zod patch schema.
6. Add the form field and display.
7. Update seed/fixtures and tests.
8. `pnpm typecheck && pnpm test && pnpm build`.

### Option C (checklist, larger): author controls for a Comparison

The API already exists; the UI does not. Implement:

1. An author-only kebab menu on the Comparison page.
2. **Edit** opens a form for title, categories and effort (`PATCH /api/comparisons/:id`).
3. **Unpublish** confirms and calls `POST /api/comparisons/:id/unpublish`.
4. **Delete** confirms and calls `DELETE /api/comparisons/:id`.
5. After unpublish, the page shows the author-only ready state and the Job page's Publish button.
6. After delete, navigate to the Board.
7. Add tests: non-author gets no menu and a direct `PATCH` returns `403`; author can edit; unpublish makes the public route `404`; delete hides it everywhere.
8. Run the a11y and keyboard suites; add a keyboard path for the new menu.

This is the best first product feature because it completes a half-built surface rather than inventing a new one.

### Feature worksheet (copy this into your scratch notes)

```
User story:
  As a ..., I want ..., so that ...

Invariants:
  - Who can see it?
  - What happens on delete/hide/takedown?
  - What happens to counters and ticker lines?

Data:
  - New columns/tables/indexes?
  - Migration needed?

API:
  - Endpoint(s), auth level, request/response shape, error codes.

UI:
  - Server component or client component?
  - Loading, empty, error, optimistic states?

Realtime:
  - Does an open Board/Job need to update?
  - New event kind? Persist before publish.

Tests:
  - Domain, service, API, e2e, a11y, visual.

Docs:
  - GLOSSARY / BACKEND / DECISIONS / ADR?
```

---

## Where to go next

- Re-read [`docs/CODEBASE-TOUR.md`](CODEBASE-TOUR.md) §8–§9 before your first feature.
- Pick a gap from §8.5 of the tour. The author comparison controls (Option C above) are the most self-contained.
- When you change a contract, update `BACKEND.md` and `GLOSSARY.md` in the same commit. The docs are part of the product.
