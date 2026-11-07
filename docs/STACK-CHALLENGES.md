# Hands-on challenges for the OpenWeightModels stack

70 challenges for learning the stack this repository actually runs: Docker,
queues and workers, BullMQ, Redis, AWS, CDK, CI/CD, and the Postgres/SSE glue
that holds them together. It is written for someone who has used none of them.

The method is **learn by showing**:

1. Each part starts with a short explanation and a pointer to the real code.
2. Each challenge asks you to change something, observe it, then prove it with a
   query, a log line, a diff, or a test.
3. If you can explain *why* the observed behaviour happens, you have learned the
   concept. If you can predict it before running the command, you own it.

Budget roughly 25–35 hours. Parts 1–3 are local and free. Parts 4–6 touch AWS
and can cost money; read [Safety and cost](#safety-and-cost) first.

---

## Safety and cost

**Local data.** `docker compose down -v`, `pnpm stack:reset`, `FLUSHALL`, and
`pnpm db:reset` destroy local data. They are lab tools, not habits. Finish the
volume challenge before you destroy the volumes.

**AWS.** Every command in Parts 4–6 is meant for a **dedicated staging account**.
Never point a lab at production.

- The staging floor is roughly **$130–160/month** before model spend
  (`docs/DEPLOYMENT.md` §7). A forgotten NAT gateway bills hourly.
- `cdk destroy` deletes RDS and ElastiCache. That is intentional for staging,
  and catastrophic anywhere else.
- `aws cloudwatch set-alarm-state` sends real email through SNS. Use an address
  you own.
- Never print a secret value. Use `read -rsp` for keys and
  `describe-secret` (metadata only) when exploring.
- Do not run `pnpm deploy:staging` until challenge 67. It builds and pushes
  images and rolls the services.
- Prefer read-only verbs (`describe-*`, `list-*`, `get-*`, `cdk synth`,
  `cdk diff`) while learning.

**Code changes.** Work on a branch: `git switch -c lab/stack-challenges`. Revert
a single challenge with `git checkout -- <file>`. Do not commit lab scaffolding.

---

## Prerequisites

```bash
node --version            # >= 22 (this repo uses 23 locally)
pnpm --version            # 12.x, via corepack
docker --version
docker compose version
redis-cli --version
psql --version
aws --version             # v2, for Parts 4–6
gh --version              # optional, for CI labs
jq --version              # optional, makes JSON output readable

pnpm install
pnpm exec playwright install chromium   # only for the e2e lab
```

Start the local stack and confirm the five moving parts:

```bash
docker compose up --build          # one terminal; Ctrl-C stops it
docker compose ps                  # another terminal
curl -s localhost:3000/api/health | jq
curl -s localhost:3001/healthz
open http://localhost:8025         # Mailpit
```

| Service | Host address | Container address |
|---|---|---|
| web (Next.js) | `localhost:3000` | `web:3000` |
| worker (BullMQ) | `localhost:3001/healthz` | `worker:3001` |
| Postgres | `localhost:5432` | `postgres:5432` |
| Redis | `localhost:6379` | `redis:6379` |
| Mailpit | `localhost:8025`, SMTP `1025` | `mailpit:1025` |

The Homebrew fallback is in `README.md` §Local setup if you prefer no Docker.

---

## The system in one page

Local:

```
browser ──► Next.js web ──► Postgres (canonical state)
                │  │
                │  └──► Redis pub/sub ──► SSE streams
                │
                └──► Redis / BullMQ queue ──► worker ──► provider
                                                   │
                                                   └──► Postgres + Redis events
```

Staging (`docs/DEPLOYMENT.md` §1):

```
Internet ──HTTPS──► ALB ──HTTP 3000──► ECS Fargate web ──► RDS Postgres
                                             │            └► ElastiCache Redis
                                             └──► SES
ECS Fargate worker ──► RDS, ElastiCache, OpenRouter
```

Three sentences that explain most of the design:

- **Postgres is canonical; Redis is transport.** Every visible state transition
  is a Postgres row; Redis carries work and fans events out (`docs/adr/0004`).
- **The web process only schedules.** A provider call can take minutes, so the
  web request enqueues and returns; the worker does the slow work.
- **The same repository and Dockerfile build both environments.** Local uses the
  `dev` target; staging uses the production `web` and `worker` targets. Only
  configuration and credentials differ (`docs/ITERATING.md` §1).

Key files to keep open:

| Concern | File |
|---|---|
| Local topology | `docker-compose.yml` |
| Image stages | `Dockerfile` |
| Queue producer | `packages/core/src/queue.ts` |
| Worker consumer | `apps/worker/src/worker.ts`, `apps/worker/src/index.ts` |
| Run state machine | `packages/core/src/services/jobs.ts` |
| Redis client + channels | `packages/core/src/redis.ts` |
| SSE | `apps/web/src/lib/sse.ts`, `apps/web/src/app/api/stream/**` |
| Rate limiting | `packages/core/src/rate-limit.ts`, `apps/web/src/lib/rate-limit.ts` |
| AWS resources | `infra/lib/foundation-stack.ts`, `app-stack.ts`, `ops-stack.ts` |
| CDK entry point | `infra/bin/infra.ts`, `infra/lib/config.ts` |
| CI/CD | `.github/workflows/ci.yml`, `infra/scripts/deploy.sh` |

A pace that works if you have 4–6 hours a week:

| Week | Challenges | Theme |
|---|---|---|
| 1 | 1–11 | orientation, images, volumes, compose networking |
| 2 | 12–21 | secrets boundary, healthchecks, shutdown, queue basics |
| 3 | 22–32 | delayed jobs, dedupe, retries, multi-Turn, metrics, Redis producer |
| 4 | 33–42 | Redis data structures, pub/sub, rate limits, persistence, recovery |
| 5 | 43–54 | IAM, VPC, ECS, ALB, logs, alarms, SES |
| 6 | 55–68 | CDK, OIDC, migration-first releases, rollback |
| 7 | 69–70 | chaos drill and a new job type |

---

# Part 0 — Orientation

**Concept.** A stack is a set of processes and a set of state owners. Before
touching a queue or a cloud resource, know which process owns which state and
which request crosses which boundary.

Read `docker-compose.yml` top to bottom once. Notice the anchors (`x-app-env`,
`x-app-build`, `x-app-volumes`), the health conditions, and the fact that `web`
and `worker` build the *same* image with different commands.

### 1 · Draw the process map · ●○○ · 15 min · local

**Do** Draw every process, port, and data store for the local stack. Mark the
two edges that cross a trust boundary: web → provider (absent), and worker →
provider (present).

**Learn** Which process has the provider key and why
(`docker-compose.yml`, worker environment only). Which process serves SSE.

**Prove it** `docker compose ps` matches your diagram, and
`docker compose exec web env | grep -i openrouter` prints nothing while the
worker prints a variable.

### 2 · Trace one Run end to end · ●○○ · 30 min · local

**Do** Create a Comparison in the UI, then write the numbered path from the
button to the Job page updating. Cite the symbol at each hop.

**Learn** The chain: `POST /api/comparisons` → `createComparison` transaction →
`enqueueRun` per Challenger → `handleQueueJob` → `processRun` → provider
`onToken` → `recordRunStatus` → `job_events` row + Redis publish →
`/api/stream/jobs/:id` replay. Compare with `docs/adr/0004` and `BACKEND.md`.

**Prove it** Your trace names at least ten functions and two tables. Predict
which one is missing if the Job page never updates.

### 3 · Predict local vs staging · ●○○ · 20 min · local

**Do** Fill a table for six changes: a new migration, a new dependency, a
provider key rotation, a model registry entry, a CSS-only change, a docs-only
commit. For each, state what is needed locally, whether CI runs, and whether a
staging release is needed.

**Learn** `docs/ITERATING.md` §1 and §4.5. The code is identical; configuration
and credentials are not.

**Prove it** Check your answers against §4.5. Correct the ones you got wrong.

### 4 · Establish a baseline · ●○○ · 20 min · local

**Do** Run and time `pnpm typecheck`, `pnpm test`, `pnpm build`. Then stop Redis
and run `pnpm test` again. Finally run it with `CI=true`.

**Learn** `packages/core/test/services.ts`: integration tests skip when services
are unreachable, but **CI must fail instead of silently skipping**. That is why
`CI=true` changes the behaviour.

**Prove it** Record the four timings and the exact error from the `CI=true` run
with no database. Restore the services.

---

# Part 1 — Docker

**Concept.** An **image** is a read-only filesystem plus metadata. A
**container** is a process (or a few) running against that filesystem with its
own network namespace. A **Dockerfile** is a program that builds an image layer
by layer; layers are cached by input hash.

The repo uses a **multi-stage build**:

```
base ──► deps ──► dev                    (local: source bind-mounted over /app)
  │
  ├──► build ──► .next/standalone ──► web        (runtime image is FROM base)
  └──► prod-deps ──► node_modules ──► worker     (runtime image is FROM base)
```

The arrows into `web` and `worker` are **artifact** flow: both runtime stages
start `FROM base` and copy the output of `build`/`prod-deps`, so the compilers
and dev dependencies never ship.

`docker-compose.yml` is the local orchestrator. It does five jobs:

- **Build** `web`, `worker`, and `migrate` from the same `dev` target.
- **Network** them by service name (`postgres`, `redis`, `mailpit`).
- **Persist** Postgres and Redis data in named volumes.
- **Order** startup with `depends_on` + health/completion conditions.
- **Mask** host `node_modules` with anonymous volumes so macOS binaries never
  leak into Debian containers.

The mount block is the subtle part:

```yaml
volumes:
  - .:/app                      # host source over the image
  - /app/node_modules           # anonymous volume: image's deps win
  - /app/apps/web/.next         # anonymous volume: container's build cache
```

**What you should be able to explain afterwards:** why a source edit hot-reloads
but a dependency edit needs `--renew-anon-volumes`; why `localhost` inside a
container is not your Mac; why the production web image runs `server.js` from
the standalone output; and why ARM64 matters on Fargate.

### 5 · Build one stage only · ●○○ · 10 min · local

**Do** `docker build --target dev -t owm-dev .` then
`docker image history owm-dev`.

**Learn** Targets are independent build goals. `dev` stops before the production
`build` stage, so it never runs `next build`.

**Prove it** List the stages in `Dockerfile` and the image size. Explain why
`deps` is shared by `dev`, `build`, and `prod-deps`.

### 6 · Break the layer cache · ●○○ · 15 min · local

**Do** Rebuild twice with no changes. Then touch `apps/web/package.json` (add a
newline) and rebuild. Then revert and touch a `.tsx` file and rebuild.

**Learn** `COPY package.json pnpm-lock.yaml ...` + `pnpm install` is its own
layer. A manifest change invalidates the install; a source change only
invalidates the later `COPY . .`.

**Prove it** `docker build` output shows `CACHED` for the install on the source
change and re-runs it on the manifest change.

### 7 · Run the production web image · ●●○ · 25 min · local

**Do** Build the `web` target and run it against your local Postgres and Redis:

```bash
docker build --target web -t owm-web:prod .
docker run --rm -p 3999:3000 \
  -e DATABASE_URL=postgres://postgres:postgres@host.docker.internal:5432/openweightmodels \
  -e REDIS_URL=redis://host.docker.internal:6379 \
  -e APP_URL=http://localhost:3999 \
  -e BETTER_AUTH_SECRET=lab-only-secret \
  owm-web:prod
curl -s localhost:3999/api/health | jq
```

On Colima or Linux, add `--add-host=host.docker.internal:host-gateway` to the
`docker run` command.

**Learn** `Dockerfile` lines 62–71: the standalone server carries traced
`node_modules`, static assets and `public` are copied separately, and the
process runs as `node`. Runtime config comes from the environment, not the
build — except `NEXT_PUBLIC_*`, which Next inlines at build time
(`packages/core/src/app-url.ts` explains why production uses `APP_URL`).

**Prove it** The health endpoint responds and the container starts with no `.env`
file mounted. `docker image inspect owm-web:prod --format '{{json .Config.Env}}'`
shows no `APP_URL`, so the same image can serve two hostnames. Explain why a
`NEXT_PUBLIC_*` variable would not have that property (Next inlines it at build
time, which is why `packages/core/src/app-url.ts` prefers `APP_URL`).

### 8 · Find the anonymous volumes · ●●○ · 15 min · local

**Do** Run `docker compose exec web ls node_modules | head`. On the host, delete
a file under `apps/web/.next`, then list it inside the container. Finally run
`docker compose up -d --renew-anon-volumes web`.

**Learn** Bind mounts and volumes are layered: the host directory covers `/app`,
then anonymous volumes cover specific subdirectories. `--renew-anon-volumes`
creates fresh ones, which is why dependency changes need it.

**Prove it** Show the host-deleted file still exists in the container before the
renew, and is gone after.

### 9 · Prove what `down -v` destroys · ●●○ · 20 min · local

**Do** Write a row into Postgres and a key into Redis. `docker compose down`,
`docker compose up -d`, and read both back. Then `docker compose down -v`,
`docker compose up -d`, and read again.

**Learn** Named volumes (`postgres-data`, `redis-data`) survive container
recreation; `-v` removes them. Redis also has `--appendonly yes`, so a mere
restart preserves data.

**Prove it** Keep a transcript of the four reads. Reseed with
`pnpm stack:seed` or `pnpm db:init` afterwards.

### 10 · Watch a dependency condition block startup · ●●○ · 15 min · local

**Do** Stop Postgres (`docker compose stop postgres`), then
`docker compose up web`. Read the error. Restore. Then run
`docker compose config` and inspect the rendered `depends_on`.

**Learn** `condition: service_healthy` waits for the healthcheck;
`service_completed_successfully` waits for the one-shot `migrate` container.
Compose does not guess readiness from “container started”.

**Prove it** The `web` service does not start while `migrate` cannot reach
Postgres. The error names the failed dependency.

### 11 · Container DNS vs host ports · ●●○ · 20 min · local

**Do**

```bash
docker compose exec web getent hosts postgres
docker compose exec web node -e "fetch('http://worker:3001/healthz').then(r=>r.text()).then(console.log)"
POSTGRES_PORT=5433 docker compose up -d postgres
psql postgres://postgres:postgres@localhost:5433/openweightmodels -c 'select 1'
```

**Learn** Containers resolve each other by service name on the compose network.
Host port mappings exist only for your Mac. Changing `POSTGRES_PORT` changes
your access, not the app's `postgres:5432` URL.

**Prove it** The in-container fetch succeeds and the host `psql` works on 5433.
Restore `POSTGRES_PORT` and `docker compose up -d postgres`.

### 12 · Verify the secret boundary · ●●○ · 10 min · local

**Do** Compare `docker compose exec web env` and
`docker compose exec worker env` for `OPENROUTER_API_KEY`, then read the
`x-app-env` anchor and the worker override.

**Learn** Only the worker receives the provider key; only the worker should ever
call a provider. `packages/core/test/local-stack.test.ts` asserts this.

**Prove it** `docker compose config` shows the key absent from `web.environment`
and present (possibly empty) on `worker.environment`.

### 13 · Make a healthcheck fail · ●●○ · 20 min · local

**Do** Create an override file that points the worker healthcheck at a closed
port, then start with both files:

```bash
cat > /tmp/owm-health.override.yml <<'EOF'
services:
  worker:
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3999/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
EOF
docker compose -f docker-compose.yml -f /tmp/owm-health.override.yml up -d worker
docker compose ps
```

**Learn** Healthchecks are commands with interval, timeout, retries and
`start_period`. `docker compose ps` shows `healthy`/`unhealthy`. Override files
are how you change one service without editing the committed stack.

**Prove it** The worker becomes `unhealthy`; remove the override and it returns
to `healthy`.

### 14 · Send SIGTERM and read the shutdown · ●●○ · 20 min · local

**Do** Start a slow run (`MOCK_DELAY_MS=2000`), then
`docker compose kill -s SIGTERM worker` and read `docker compose logs worker`.

**Learn** `apps/worker/src/index.ts`: on SIGTERM it closes the health server,
stops the metrics timer, calls `worker.close()` (which waits for active jobs),
then closes the queue, Redis and Postgres. `init: true` makes `tini` PID 1 so
signals are forwarded. ECS sends SIGTERM, waits `stopTimeout` (30s), then
SIGKILLs.

**Prove it** The log line `[worker] SIGTERM received, shutting down` appears and
the active response reaches `done`, not `failed`, if it finished within the
grace period.

### 15 · Build for Graviton · ●●○ · 25 min · local

**Do**

```bash
docker buildx build --platform linux/arm64 --target worker --load -t owm-worker:arm64 .
docker image inspect owm-worker:arm64 --format '{{.Os}}/{{.Architecture}}'
```

**Learn** Fargate tasks are declared ARM64 in `foundation-stack.ts`
(`runtimePlatform`). An amd64 image fails at task start. In CI, an amd64 runner
needs QEMU + Buildx (`ci.yml` lines 125–128).

**Prove it** The inspected platform is `linux/arm64`. Explain why
`--platform` alone does not make a binary portable.

### 16 · Add a service to the stack · ●●○ · 20 min · local

**Do** Add a throwaway Redis UI service (or a `redis-cli` sidecar) to a
`compose.override.yml`, give it a host port, and confirm it reaches
`redis:6379`. Delete the override afterwards.

**Learn** Compose services join one network by default; `depends_on` orders
startup but does not guarantee readiness without a healthcheck. Overrides keep
experiments out of the committed file.

**Prove it** `docker compose config` includes the new service, and the UI or CLI
can read `DBSIZE` from the shared Redis.

---

# Part 2 — Queues, workers, and BullMQ

**Concept.** A **queue** decouples “accept the request” from “do the slow work”.
The web process is the **producer**; the worker is the **consumer**; Redis is the
**broker**. This buys three things: requests return in milliseconds, work
survives a web restart, and bursts are absorbed instead of timing out.

The price is **at-least-once delivery**. A job can be delivered twice after a
crash or a retry, so the consumer must be **idempotent**. This repo gets that
from Postgres, not from BullMQ: `processRun` claims a Run with a conditional
update (`status = 'queued'` → `'calling'`) and returns if another worker already
claimed it (`packages/core/src/services/jobs.ts`).

The state machine for one Response:

```
queued ──► calling ──► streaming ──► done
   │           │            │
   └───────────┴────────────┴──► failed ──► (retry) queued
                                      └──► (auto-skip / skip) skipped
```

**BullMQ** is a Node library on top of Redis. A `Queue` adds jobs; a `Worker`
takes them; a `Job` has a name, data, id, options and lifecycle timestamps.
Redis holds the bookkeeping: `wait`, `active`, `delayed`, `completed`, `failed`,
plus one hash per job under `bull:<queue>:<jobId>`.

Producer (`packages/core/src/queue.ts`):

```ts
new Queue(RUN_QUEUE, {
  connection: createRedisConnection(),
  defaultJobOptions: { removeOnComplete: 200, removeOnFail: 200, attempts: 1 },
});

await queue.add('run', { responseId });                 // immediate
await queue.add('auto-skip', { responseId }, {
  delay: AUTO_SKIP_DELAY_MS,
  jobId: `auto-skip-${responseId}-${attempt}`,           // dedupe key
});
```

Consumer (`apps/worker/src/worker.ts`):

```ts
const worker = new Worker(RUN_QUEUE, handleQueueJob, {
  connection: createRedisConnection(),
  concurrency,                       // jobs processed at once in this process
});
```

Two job names, two meanings: `run` calls the provider for one Turn; `auto-skip`
is a delayed timer that settles a failed Replay after 24 hours. A Challenger's
Turns are chained: `processRun` enqueues the next Turn only after the current
one is `done` (`enqueueNextTurn`). Challengers run independently.

**What you should be able to explain afterwards:** the difference between
concurrency and replicas; why `attempts: 1` is deliberate; why the DB claim is
the real idempotency guard; what `removeOnComplete` does; why an auto-skip job
has a deterministic id; and what happens to an active job on SIGTERM.

> **Lab note on environment variables.** `docker-compose.yml` passes only the
> keys listed under `x-app-env` plus the worker override. Exporting
> `AUTO_SKIP_DELAY_MS` in your shell does **not** reach a container. For knobs
> that are not listed there, either add them with a compose override
> (`services.worker.environment`) or stop the compose worker and run
> `pnpm dev:worker` on the host — it reads the root `.env`, and shell variables
> win over the file. The challenges below say which method to use.

### 17 · Pause the consumer and watch the backlog · ●○○ · 15 min · local

**Do** `docker compose stop worker`. Create two Comparisons. Inspect the queue
with the helper below, then `docker compose start worker` and watch it drain.

```ts
// packages/core/lab-queue.ts  (delete afterwards)
import { getRunQueue, closeRunQueue } from './src/index';
const q = getRunQueue();
console.log(await q.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed'));
await closeRunQueue();
```

```bash
pnpm --filter @owm/core exec tsx lab-queue.ts
```

**Learn** A queue is **backpressure**: producers keep succeeding while the
consumer is down. The UI still shows `queued`; nothing is lost while Redis is
up.

**Prove it** `waiting` grows while the worker is stopped and returns to zero
after it starts.

### 18 · Inspect BullMQ's keyspace · ●●○ · 20 min · local

**Do**

```bash
docker compose exec redis redis-cli
> SCAN 0 MATCH bull:owm-runs:* COUNT 100
> TYPE bull:owm-runs:wait
> LLEN bull:owm-runs:wait
> ZCARD bull:owm-runs:delayed
> ZRANGE bull:owm-runs:delayed 0 -1 WITHSCORES
> HGETALL bull:owm-runs:<jobId>
```

**Learn** `wait` is a list (FIFO); `delayed` and `failed` are sorted sets
(score = time); each job is a hash with `name`, `data`, `opts`, `timestamp`,
`attemptsMade`, `processedOn`, `finishedOn`, `stacktrace`. The default prefix is
`bull`.

**Prove it** Match one `jobId` to a `responseId` in Postgres. Explain why a
delayed job is not in `wait`.

### 19 · Decode one job · ●●○ · 15 min · local

**Do** `HGETALL` a job and pretty-print `data` and `opts`:

```bash
docker compose exec redis redis-cli HGET bull:owm-runs:<jobId> data
docker compose exec redis redis-cli HGET bull:owm-runs:<jobId> opts
```

**Learn** Job data is a small pointer (`{ responseId }`), never the whole
domain object. Postgres is the source of truth; the job only names the work.

**Prove it** Show the `responseId` row and its `status`. Explain what would
break if the job carried the prompt and the prompt were edited after scheduling
(it cannot be — the Turn freezes it).

### 20 · Dispatch an unknown job · ●●○ · 15 min · local

**Do** Add `not-a-job` to the queue with the helper, then read the worker log and
the `failed` set.

```ts
import { getRunQueue, closeRunQueue } from './src/index';
await getRunQueue().add('not-a-job', { responseId: 'x' });
await closeRunQueue();
```

**Learn** `handleQueueJob` has an explicit `switch` and throws on unknown names.
A thrown error marks the BullMQ job failed and triggers the `failed` listener,
which logs and calls `reportError`.

**Prove it** The log names the job and `Unknown job name`. The job appears in
`ZRANGE bull:owm-runs:failed 0 -1`.

### 21 · Concurrency vs replicas · ●●○ · 25 min · local

**Do** Run two worker processes with `PROVIDER_CONCURRENCY=2` (two terminals,
`pnpm dev:worker` each). Schedule four Challengers. Watch `active` in the helper
and the provider timing.

**Learn** Concurrency is per process; total parallelism is replicas ×
concurrency. In staging the worker service has `desiredCount: 1`, min 1, max 2,
and each task sets `PROVIDER_CONCURRENCY=4` — so the ceiling is 8 provider calls
unless you change it.

**Prove it** With two workers × 2, `active` reaches 4 but not 5. Stop one worker
and show it drops to 2.

### 22 · Shorten the 24-hour auto-skip · ●●○ · 30 min · local

**Do** Stop the compose worker and run the worker on the host with all three
knobs (none of them are template values in compose):

```bash
docker compose stop worker
AUTO_SKIP_DELAY_MS=15000 MOCK_DELAY_MS=0 MOCK_FAIL_ONCE=true pnpm dev:worker
```

Create a Comparison and watch the delayed job, then the skip. `docker compose
start worker` afterwards.

**Learn** `enqueueAutoSkip` runs after a failure; the delay is read at module
load in `queue.ts`, so a restart is required. When it fires,
`autoSkipRun` checks the Run is still `failed`, calls `stopReplayAt` (later
Turns become `skipped`), then `finalizeJob`.

**Prove it** `ZRANGE bull:owm-runs:delayed` contains the job, then empties; the
Response becomes `skipped`, the Job `ready`, and a `job.ready` notification
exists.

### 23 · Prove job-id deduplication · ●●○ · 20 min · local

**Do** Call `enqueueAutoSkip(responseId, 0)` twice, then
`enqueueAutoSkip(responseId, 1)`. Count the delayed jobs each time.

**Learn** BullMQ ignores an `add` whose `jobId` already exists (while that job
is retained). The id is **attempt-scoped** so a new failure after a retry gets a
fresh timer; `removeAutoSkip` removes the old one on retry.

**Prove it** Two calls with the same attempt produce one delayed job; attempt 1
produces a second. `removeAutoSkip(responseId, 1)` removes only the second.

### 24 · Change retention and watch trimming · ●●○ · 25 min · local

**Do** Temporarily change `removeOnComplete`/`removeOnFail` to `2`, restart,
run five fast Runs, then `ZCARD bull:owm-runs:completed`.

**Learn** Retention bounds Redis memory. A number keeps the newest N; `true`
removes immediately; an object can use `{ count, age }`. `attempts: 1` means
BullMQ itself does not retry — the product exposes Retry to the author instead.

**Prove it** The completed set does not exceed 2. Restore 200.

### 25 · Deliver the same job twice · ●●○ · 25 min · local

**Do** With a queued Run, call `enqueueRun(responseId)` twice. Let both jobs
run. Count the `calling` transitions:

```sql
select count(*)
from job_events
where response_id = '<id>'
  and kind = 'response.status'
  and payload->>'status' = 'calling';
```

**Learn** BullMQ does not dedupe `run` jobs (no `jobId` is set), so two jobs are
delivered. `processRun` claims with `where status = 'queued'`; the loser returns
before calling the provider. This is **idempotency at the consumer**, the
correct pattern for at-least-once delivery.

**Prove it** The count is 1, the Response is `done` once, and only one
`{"metric":"job","outcome":"finished"}` line appears for that Response.

### 26 · Watch a multi-Turn Replay chain · ●●○ · 35 min · local

**Do** Run the existing replay test first:

```bash
pnpm --filter @owm/core exec vitest run test/conversation-replay.test.ts
```

Then create a three-Turn Conversation with two Challengers (use
`createComparison({ turns: [...] })` as the test does), start the worker, and
stop it after Turn 1 is done. Query `turns` and `responses`, restart, and watch
Turn 2 enqueue.

**Learn** `replayMessages` returns `null` if any earlier Turn for that Model is
not `done`; the worker no-ops and the earlier Turn's completion enqueues the
next (`enqueueNextTurn`). This is **ordered execution without a scheduler**
(`docs/adr/0008`).

**Prove it** No Turn n+1 is `calling` before Turn n is `done` for the same
Model. The two Challengers' Turn 1s run in parallel.

### 27 · Force a failure, then retry · ●●○ · 30 min · local

**Do** Stop the compose worker, then start it on the host with the failure knob
(compose hard-codes `MOCK_FAIL_ONCE: "false"`):

```bash
docker compose stop worker
MOCK_FAIL_ONCE=true MOCK_DELAY_MS=0 pnpm dev:worker
```

Create a one-Challenger Comparison. Observe `failed`, the Job still `running`,
the delayed auto-skip and the absence of a `job.ready` notification. Click
**Retry**, then verify `attempt = 1`, `done`, Job `ready`, and one notification.
Restart the compose worker afterwards (`docker compose start worker`).

**Learn** Retry is an application operation (`retryRun`): it sets `queued`,
increments `attempt`, clears the error, enqueues a fresh `run`, and removes the
old auto-skip. BullMQ's `attempts` stays 1.

**Prove it** The `responses.attempt` values are 0 then 1; the old delayed job is
gone; the Job settles only after the retry succeeds.

### 28 · Kill a worker mid-job · ●●○ · 25 min · local

**Do** Stop the compose worker and run a slow one on the host
(`MOCK_DELAY_MS=3000 pnpm dev:worker`), then kill the `tsx` process with
`kill -9 <pid>` (not SIGTERM). Read the response and the job state. Start the
worker again and watch BullMQ's stalled-job handling. Alternatively, run the
compose worker with a `MOCK_DELAY_MS: "3000"` override and
`docker compose kill -s SIGKILL worker`.

**Learn** SIGKILL leaves an **active** job and an expired lock. BullMQ moves a
stalled job back to wait after `stalledInterval`; with `attempts: 1` and
`maxStalledCount` defaults, the outcome depends on whether it is treated as a
stall or a failure. More importantly, the Postgres row can be left `calling` —
this repo has **no automatic re-enqueue of stranded Runs**
(`docs/DEPLOYMENT.md` §8).

**Prove it** Record the exact state in Redis and Postgres after 30 seconds.
Explain why graceful SIGTERM (challenge 14) is the design, and SIGKILL is the
gap challenge 69 asks you to close.

### 29 · Liveness vs readiness · ●●○ · 20 min · local

**Do** Stop Redis. Check `curl -i localhost:3001/healthz` and
`curl -i localhost:3000/api/health`. Stop Postgres and check the web endpoint
again.

**Learn** The worker endpoint is **liveness** only: the process is up. The web
endpoint is **dependency-aware**: Postgres down → 503; Redis down → 200
`degraded`, because reads and SSE polling still work
(`apps/web/src/lib/health.ts`). The ALB health-checks the web endpoint; the
worker has no ALB, so ECS uses the container healthcheck.

**Prove it** Three responses: worker 200 with Redis down, web 200 `degraded`
with Redis down, web 503 with Postgres down. Restore both.

### 30 · Read the queue metric line · ●●○ · 20 min · local

**Do** `QUEUE_METRICS` is not in the compose environment, so choose one:

```bash
# Option A: host worker, read its terminal
docker compose stop worker
QUEUE_METRICS=true pnpm dev:worker

# Option B: compose override, then read the container log
cat > /tmp/owm-metrics.override.yml <<'EOF'
services:
  worker:
    environment:
      QUEUE_METRICS: "true"
EOF
docker compose -f docker-compose.yml -f /tmp/owm-metrics.override.yml up -d worker
docker compose logs worker | grep '"metric":"queue"' | tail -1 | jq
```

**Learn** `apps/worker/src/metrics.ts` emits
`{ waiting, active, delayed, failed, depth }` where `depth = waiting + delayed`.
The Ops stack turns this JSON into the `OWM/Queue Depth` metric with a CloudWatch
Logs metric filter, so the worker needs no CloudWatch SDK or IAM permission.

**Prove it** Compare `depth` with `getJobCounts` from challenge 17. Explain why
`active` is excluded from the alarm.

### 31 · Observe ordering and delay · ●●○ · 15 min · local

**Do** Enqueue three jobs with delays 0, 1s and 2s. Record `timestamp`,
`processedOn` and `finishedOn` from each job hash.

**Learn** BullMQ has no priority configured here, so `wait` is FIFO and
`delayed` is a time-ordered set that moves jobs into `wait` when due. Ordering
across workers is not guaranteed once jobs are active.

**Prove it** The 0s job processes first, the 2s last. Explain why two
Challengers may finish in either order even though each Replay is ordered.

### 32 · Stop Redis while the producer is scheduling · ●●● · 25 min · local

**Do** Stop Redis. Create a Comparison from the UI with a client timeout
(`curl --max-time 10` or the browser). Watch the request, the Postgres rows, and
the worker/queue. Restart Redis and observe.

**Learn** The web process also constructs a BullMQ `Queue` (`getRunQueue`), and
`createRedisConnection` sets `maxRetriesPerRequest: null` with the default
offline queue. Commands therefore **wait for reconnection** instead of failing
fast. The transaction has already committed before `enqueueRun` runs, so a
process crash between those two steps leaves a `scheduled` Job with no queued
work — the classic **dual-write** gap. Compare the rate limiter, which uses
`getRedis()` with `maxRetriesPerRequest: 2` and falls back quickly.

**Prove it** Show a `scheduled` job with no matching BullMQ job while Redis is
down, then show the request completing after Redis returns. Write two sentences
on why an outbox table (or enqueue-before-commit with a reconciler) would fix
it.

---

# Part 3 — Redis

**Concept.** Redis is a single-threaded, in-memory data-structure server. You
address **keys**; each key has a type (string, list, set, sorted set, hash,
stream). Commands are atomic; a **Lua script** runs several atomically. Some
features are deliberately ephemeral (pub/sub), others can be persisted (RDB
snapshots, AOF).

This repo uses Redis for four jobs, only one of which is a queue:

| Role | Key space | Durability needed? |
|---|---|---|
| BullMQ broker | `bull:owm-runs:*` | Yes, while work is pending |
| Pub/sub fan-out | `owm:board`, `owm:job:<id>` | No; Postgres replays |
| Fixed-window rate limits | `owm:rl:*` | No; losing them only resets limits |
| (Fallback poll) | — | Postgres, not Redis |

`packages/core/src/redis.ts` resolves either `REDIS_URL` or the discrete
`REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD`/`REDIS_TLS` variables an ECS task
receives. It deliberately uses **two client shapes**:

- `getRedis()` — `maxRetriesPerRequest: 2`, fail fast; used by rate limiting and
  `publish`.
- `createRedisConnection()` / `createSubscriber()` —
  `maxRetriesPerRequest: null`, which BullMQ requires; commands wait for
  reconnection.

Staging runs ElastiCache with **`maxmemory-policy: noeviction`**, cluster mode
off, in-transit TLS, one node. BullMQ must not have queue data evicted, and
ElastiCache Serverless is incompatible with BullMQ (`docs/DEPLOYMENT.md` §1).

The rate limiter is worth reading in full: it hashes the identifier so an email
or IP is never a key, and uses one Lua script to `INCR` and `PEXPIRE` atomically.

**What you should be able to explain afterwards:** why pub/sub cannot replay;
why the rate-limit script must be atomic; why `noeviction` is a correctness
requirement; why losing Redis loses queue contents but not domain state; and why
the test suite uses Redis DB `1`.

### 33 · Redis basics on the real keyspace · ●○○ · 15 min · local

**Do**

```bash
docker compose exec redis redis-cli
> INFO keyspace
> SCAN 0 COUNT 100
> TYPE bull:owm-runs:meta
> TTL bull:owm-runs:meta
> MEMORY USAGE bull:owm-runs:meta
> SELECT 1
> DBSIZE
```

**Learn** Logical databases (`0` default, `1` for e2e) share one process and one
memory limit. `SCAN` is the production-safe alternative to `KEYS`.

**Prove it** `INFO keyspace` shows `db0` (and maybe `db1`). Explain why `KEYS *`
is a bad habit.

### 34 · Reverse-engineer a rate-limit bucket · ●●○ · 25 min · local

**Do** The compose web service does not receive `.env.local`, so inject the
limit with a compose override (or run `pnpm dev:web` on the host):

```bash
cat > /tmp/owm-rate.override.yml <<'EOF'
services:
  web:
    environment:
      WRITE_RATE_LIMIT_PER_USER: "3"
EOF
docker compose -f docker-compose.yml -f /tmp/owm-rate.override.yml up -d web
```

Sign in with the dev switcher and post four comments:

```bash
curl -c /tmp/owm.cookies -X POST localhost:3000/api/dev/user \
  -H 'content-type: application/json' -d '{"handle":"mira"}'
# use a real published comparison id
curl -b /tmp/owm.cookies -X POST localhost:3000/api/comments \
  -H 'content-type: application/json' \
  -d '{"comparisonId":"<id>","body":"lab"}'
```

Then `SCAN 0 MATCH owm:rl:*`, `GET` the key, `TTL` it. Compute the SHA-256 of
your user id and compare the first 40 hex characters with the key suffix:

```bash
printf '%s' '<user-id>' | shasum -a 256 | cut -c1-40
```

**Learn** `rateLimitKey` hashes the identifier; the window is fixed; the fourth
request returns `429` with `Retry-After`. Every authenticated write goes through
`requireUser` → `enforceWriteLimit`, so a new route cannot forget it.

**Prove it** The key contains no email or IP, the TTL counts down, and the
fourth response is 429. Restore the limit.

### 35 · Run the Lua script by hand · ●●○ · 20 min · local

**Do**

```bash
docker compose exec redis redis-cli EVAL "local c=redis.call('INCR',KEYS[1]); if c==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]) end; local t=redis.call('PTTL',KEYS[1]); if t<0 then redis.call('PEXPIRE',KEYS[1],ARGV[1]); t=tonumber(ARGV[1]) end; return {c,t}" 1 lab:rl 5000
```

Run it twice and watch the count and PTTL.

**Learn** `INCR` then `PEXPIRE` as two commands can leave an immortal key if the
process dies between them. `EVAL` is atomic. The script also repairs a
negative TTL.

**Prove it** Count 1 with a full TTL, then count 2 with a smaller TTL. Delete
`lab:rl`.

### 36 · Watch pub/sub fan-out · ●●○ · 20 min · local

**Do** In one terminal:

```bash
docker compose exec redis redis-cli SUBSCRIBE owm:board
```

In another, create a comment or publish directly:

```bash
docker compose exec redis redis-cli PUBLISH owm:board '{"id":1,"type":"lab","data":{}}'
```

**Learn** Pub/sub is fire-and-forget: no history, no acknowledgement, no
persistence. That is acceptable because every event is also a Postgres row
(`activity_events`) and the SSE endpoint replays from the last id. `publish()`
swallows Redis failures on purpose (`packages/core/src/redis.ts`).

**Prove it** The subscriber receives the JSON; a subscriber that connects after
the publish receives nothing. Then create a real comment and show both the
`owm:board` message and the matching `activity_events` row — that pairing is
what makes replay possible.

### 37 · Replay a job stream with Last-Event-ID · ●●○ · 30 min · local

**Do** Sign in, open a Job page, and copy the job id. Then:

```bash
curl -N -b /tmp/owm.cookies localhost:3000/api/stream/jobs/<jobId>
```

Retry a failed Run in another tab. Then reconnect with
`-H 'Last-Event-ID: <id>'` and confirm only newer events arrive.

**Learn** `apps/web/src/lib/sse.ts`: the first replay uses
`jobEventsAfter(jobId, lastId)`, then subscribes to `owm:job:<jobId>`. Events
carry `id`, and `send` drops anything `<= lastId`. Postgres is the replay log;
Redis is the live path. The heartbeat is a comment frame every 20s.

**Prove it** The stream shows `response.status` events in order, and the
`Last-Event-ID` reconnect skips the ones you already saw.

### 38 · Pull Redis out from under the app · ●●○ · 25 min · local

**Do** `docker compose stop redis`. Check `/api/health`, post a comment, and read
the web logs. Then start Redis again.

**Learn** Health reports `degraded` but stays 200: Postgres is canonical and SSE
falls back to the 2-second poll. Rate limiting falls back to an in-process map
and logs one warning. The fallback is **per process**, so with two web tasks the
effective limit doubles — a deliberate availability-over-strictness trade-off.

**Prove it** The comment succeeds, the log shows
`[rate-limit] Redis unavailable; using the in-process store`, and the health
payload says `"redis":"error"`.

### 39 · See why `noeviction` matters · ●●● · 25 min · local

**Do** Run a scratch Redis with a tiny memory limit and a policy that evicts:

```bash
docker run --rm -d --name lab-redis -p 6390:6379 redis:8-alpine \
  redis-server --maxmemory 1mb --maxmemory-policy allkeys-lru
docker exec lab-redis redis-cli INFO stats | grep evicted_keys
```

Fill it with keys, read `evicted_keys`, then repeat with
`--maxmemory-policy noeviction` and watch `SET` fail with an OOM error.

**Learn** Eviction silently deletes keys, which for BullMQ means lost jobs and
broken locks. Staging sets `noeviction` in the ElastiCache parameter group
(`foundation-stack.ts`). `docker rm -f lab-redis` when done.

**Prove it** `evicted_keys` rises under LRU; under `noeviction`, writes fail
instead of disappearing. Explain which failure mode you want for a queue.

### 40 · AOF persistence across a restart · ●●○ · 20 min · local

**Do**

```bash
docker compose exec redis redis-cli SET lab:persist hello
docker compose restart redis
docker compose exec redis redis-cli GET lab:persist
```

Then run a scratch container **without** `--appendonly yes`, write a key,
restart it, and read again.

**Learn** Compose runs `redis-server --appendonly yes`, so writes replay from
the AOF. Staging sets `snapshotRetentionLimit: 0`, so there are no Redis
backups; losing the node still loses queue contents. Postgres is what makes
recovery possible.

**Prove it** The compose key survives; the scratch key does not. Delete
`lab:persist`.

### 41 · Prove the e2e database isolation · ●●○ · 25 min · local

**Do** `redis-cli -n 0 DBSIZE`, then `pnpm test:e2e`, then both `DBSIZE`s again.
Read the guard in `e2e/prepare.ts` and the URLs in `e2e/config.ts`.

**Learn** The suite uses `openweightmodels_e2e` and Redis DB `1`, refuses to
seed the development database, and flushes only its own DB. Playwright starts
its own web and worker on ports 3100/3199.

**Prove it** DB 0 keeps its keys; DB 1 is flushed and repopulated. Explain why
`FLUSHALL` in `prepare.ts` would be a bug.

### 42 · Recover stranded Runs after a Redis wipe · ●●● · 35 min · local

**Do** Stop the worker, create two Comparisons, then
`docker compose exec redis redis-cli FLUSHALL`. The Jobs exist in Postgres but
no BullMQ jobs do. Find them:

```sql
select id, status, attempt
from responses
where is_base = false and status in ('queued', 'calling', 'streaming')
order by created_at;
```

Write a recovery script that re-enqueues `queued` rows and decides what to do
with `calling`/`streaming` rows (reset to `queued` with `attempt + 1`? mark
failed?). Then restart the worker.

**Learn** This is the documented gap in `docs/DEPLOYMENT.md` §8: Postgres-first
makes recovery possible, but no automatic reconciler exists. A real fix is a
periodic job that compares non-terminal Responses with queue state, with an
age threshold to avoid racing a live worker.

**Prove it** Your script settles both Runs. Write the reconciler's contract in
five lines: inputs, age threshold, idempotency, metric, and what it does with a
`calling` row younger than the threshold.

---

# Part 4 — AWS

**Concept.** AWS is a set of regional APIs behind IAM. Four ideas cover most of
this stack:

1. **Account + region + ARN.** Every resource lives in a region and has an ARN.
   `eu-west-1` and `ap-southeast-1` are separate worlds; SES identities, RDS,
   ECR and ElastiCache must all be in the deployment region.
2. **IAM roles, not keys.** A role is a set of permissions with a trust policy
   saying who may assume it. ECS tasks get temporary credentials from the
   **task role**; the **execution role** is used by the ECS agent to pull images
   and inject secrets. Those are different roles and this repo uses them
   differently.
3. **A VPC is a network with subnets and route tables.** Public subnets route to
   an internet gateway; private subnets route to a NAT gateway. Security groups
   are stateful firewalls attached to resources.
4. **Managed services replace servers.** Fargate runs containers without EC2;
   RDS runs Postgres; ElastiCache runs Redis; ECR stores images; SES sends mail;
   Secrets Manager stores secrets; CloudWatch stores logs/metrics/alarms; SNS
   delivers notifications; Budgets tracks spend.

The staging topology is in `docs/DEPLOYMENT.md` §1. The code mapping:

| Resource | Where |
|---|---|
| VPC, subnets, NAT, security groups | `infra/lib/foundation-stack.ts` |
| RDS Postgres | `foundation-stack.ts` (`rds.DatabaseInstance`) |
| ElastiCache Redis | `foundation-stack.ts` (`CfnReplicationGroup`) |
| ECR repositories | `foundation-stack.ts` (`ecr.Repository`) |
| Secrets Manager | `foundation-stack.ts` (`authSecret`, `providerKey`, RDS secret) |
| SES identity + DKIM | `foundation-stack.ts` (`ses.EmailIdentity`) |
| ECS cluster, task definitions, logs | `foundation-stack.ts` |
| ALB, target group, DNS, ECS services, autoscaling | `infra/lib/app-stack.ts` |
| Alarms, metric filters, SNS, budget | `infra/lib/ops-stack.ts` |
| GitHub OIDC role | `infra/lib/ci-stack.ts` |

**What you should be able to explain afterwards:** why the web task has no
provider key; why the worker has no auth secret; why RDS is not publicly
accessible; why the ALB idle timeout is 4000s; why `LiveTaskCount` replaced
`RunningTaskCount`; and why the model spend cap is not an AWS Budget.

### 43 · Identity, region, and ARNs · ●○○ · 10 min · staging

**Do**

```bash
aws sts get-caller-identity
aws configure list
aws ec2 describe-regions --query 'Regions[].RegionName' --output text
```

**Learn** The account id, the principal, the region, and the ARN shape
(`arn:aws:service:region:account:resource`). Fargate has no instance metadata
service, which is why the task definition sets `AWS_REGION` explicitly
(`foundation-stack.ts`).

**Prove it** Write the ARN of the ECR repo from the Foundation stack outputs and
label each of its six colon-separated parts.

### 44 · Execution role vs task role · ●●○ · 25 min · staging

**Do** Read `foundation-stack.ts` around `executionRole`, `webTaskRole`,
`workerTaskRole`, and the `secrets` blocks. Then:

```bash
aws iam list-roles --query "Roles[?contains(RoleName, 'OwmStaging')].[RoleName,Arn]" --output table
aws ecs describe-task-definition --task-definition owm-staging-web \
  --query 'taskDefinition.containerDefinitions[0].secrets'
aws ecs describe-task-definition --task-definition owm-staging-worker \
  --query 'taskDefinition.containerDefinitions[0].secrets'
```

**Learn** The execution role pulls images and injects Secrets Manager values.
The web task role may call SES; the worker task role has no AWS permissions
because it calls OpenRouter over the internet. The web definition has
`BETTER_AUTH_SECRET` but no `OPENROUTER_API_KEY`; the worker has the reverse.

**Prove it** A table of role → trusted principal → policies → which secrets it
can read. Explain why `AdministratorAccess` on the CI role is fenced to staging
only.

### 45 · Explore Secrets Manager safely · ●●○ · 20 min · staging

**Do**

```bash
aws secretsmanager list-secrets \
  --query "SecretList[?startsWith(Name, 'owm-staging/')].[Name,ARN]" --output table
aws secretsmanager describe-secret --secret-id owm-staging/openrouter-api-key
```

Create, read, and delete a **scratch** secret:

```bash
aws secretsmanager create-secret --name lab/owm --secret-string '{"hello":"world"}'
aws secretsmanager get-secret-value --secret-id lab/owm --query SecretString --output text
aws secretsmanager delete-secret --secret-id lab/owm --force-delete-without-recovery
```

Never call `get-secret-value` on the provider key.

**Learn** ECS `secrets` are resolved at task start and injected as environment
variables, so a running task keeps the old value until replaced
(`docs/ITERATING.md` §4.6). Rotation is `put-secret-value` plus a forced
deployment. Deleting a secret normally reserves its name for a recovery window;
`--force-delete-without-recovery` skips it.

**Prove it** The scratch secret round-trips. Explain why putting the provider key
in a task `environment` value would leak it into `describe-task-definition`.

### 46 · Map the VPC · ●●○ · 25 min · staging

**Do** Pull the Foundation outputs, then describe the network:

```bash
VPC=$(aws cloudformation describe-stacks --stack-name OwmStagingFoundation \
  --query "Stacks[0].Outputs[?OutputKey=='VpcId'].OutputValue" --output text)
aws ec2 describe-vpcs --vpc-ids "$VPC"
aws ec2 describe-subnets --filters Name=vpc-id,Values="$VPC"
aws ec2 describe-route-tables --filters Name=vpc-id,Values="$VPC"
aws ec2 describe-nat-gateways --filter Name=vpc-id,Values="$VPC"
```

**Learn** Two AZs, public subnets for the ALB, private subnets with egress for
tasks and data. One NAT gateway is the cheap staging choice. Tasks have
`assignPublicIp: DISABLED`, so they reach ECR/SES/OpenRouter through the NAT.

**Prove it** Draw the route for a worker's outbound HTTPS request: task → private
subnet route table → NAT → IGW. Label the single point of failure.

### 47 · Security groups and a refused connection · ●●○ · 20 min · staging

**Do**

```bash
VPC=$(aws cloudformation describe-stacks --stack-name OwmStagingFoundation \
  --query "Stacks[0].Outputs[?OutputKey=='VpcId'].OutputValue" --output text)
DB=$(aws cloudformation describe-stacks --stack-name OwmStagingFoundation \
  --query "Stacks[0].Outputs[?OutputKey=='DatabaseEndpoint'].OutputValue" --output text)
aws ec2 describe-security-groups --filters Name=vpc-id,Values="$VPC" \
  --query 'SecurityGroups[].[GroupName,Description,IpPermissions]' --output json | jq
timeout 5 nc -vz "${DB%:*}" "${DB##*:}" || echo "refused as expected"
```

**Learn** RDS accepts 5432 only from the web and worker security groups; Redis
accepts 6379 only from those two. The ALB accepts 80/443 from the world and
forwards 3000 to web. `allowAllOutbound: true` on app groups is needed for
provider, ECR, SES and CloudWatch calls.

**Prove it** The public `nc` fails. The ingress rules reference **security group
ids**, not CIDRs, so a new task in the same group is allowed automatically.

### 48 · Inspect images and scans · ●●○ · 20 min · staging

**Do**

```bash
aws ecr describe-repositories --query 'repositories[].[repositoryName,repositoryUri]' --output table
aws ecr describe-images --repository-name owm-staging-web \
  --query 'sort_by(imageDetails,&imagePushedAt)[-3:].[imageTags,imagePushedAt,imageSizeInBytes]' --output table
aws ecr describe-image-scan-findings --repository-name owm-staging-web \
  --image-id imageTag=<tag> --query 'imageScanFindings.findingSeverityCounts'
aws ecr get-lifecycle-policy --repository-name owm-staging-web
```

**Learn** `imageScanOnPush: true`, untagged images expire after 14 days, and
`emptyOnDelete: true` lets CloudFormation delete a repository that still holds
images. The worker image is larger because it ships TypeScript and `tsx` at
runtime (`docs/DEPLOYMENT.md` §8).

**Prove it** Explain why a deploy can safely delete the stack even though ECR
contains images, and what would happen without `emptyOnDelete`.

### 49 · Run the migration task by hand · ●●● · 30 min · staging

**Do** Read `infra/scripts/deploy.sh` lines 197–218, then run the same one-off
task (migrations plus registry upsert; idempotent, but it can apply any pending
migration — do not run it during a release):

```bash
CLUSTER=$(aws cloudformation describe-stacks --stack-name OwmStagingFoundation \
  --query "Stacks[0].Outputs[?OutputKey=='ClusterName'].OutputValue" --output text)
MIGRATE_TASK=$(aws cloudformation describe-stacks --stack-name OwmStagingFoundation \
  --query "Stacks[0].Outputs[?OutputKey=='MigrateTaskDefinitionArn'].OutputValue" --output text)
SUBNETS=$(aws cloudformation describe-stacks --stack-name OwmStagingFoundation \
  --query "Stacks[0].Outputs[?OutputKey=='PrivateSubnetIds'].OutputValue" --output text)
SG=$(aws cloudformation describe-stacks --stack-name OwmStagingFoundation \
  --query "Stacks[0].Outputs[?OutputKey=='MigrateSecurityGroupId'].OutputValue" --output text)

TASK=$(aws ecs run-task --cluster "$CLUSTER" --task-definition "$MIGRATE_TASK" \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SG],assignPublicIp=DISABLED}" \
  --query 'tasks[0].taskArn' --output text)
aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$TASK"
aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK" \
  --query 'tasks[0].containers[0].[exitCode,reason]'
aws logs tail /aws/ecs/owm-staging/migrate --since 10m
```

**Learn** A **task definition** is a template; a **task** is one run; a
**service** keeps N tasks alive. Migrations are a one-off task because they must
finish (or fail) before services roll (`docs/adr/0007`). The task uses the
worker image and the same database secret.

**Prove it** Exit code 0 and a log line from `bootstrap.ts`. Explain why putting
migrations in the web entrypoint would race across tasks.

### 50 · ALB, target health, and SSE · ●●○ · 25 min · staging

**Do**

```bash
aws elbv2 describe-load-balancers --query 'LoadBalancers[].[LoadBalancerName,DNSName,Scheme]' --output table
aws elbv2 describe-load-balancer-attributes --load-balancer-arn <arn> \
  --query 'Attributes[?Key==`idle_timeout.timeout_seconds`]'
aws elbv2 describe-target-groups \
  --query 'TargetGroups[].[TargetGroupName,HealthCheckPath,HealthCheckIntervalSeconds]' --output table
aws elbv2 describe-target-group-attributes --target-group-arn <arn> \
  --query 'Attributes[?Key==`deregistration_delay.timeout_seconds`]'
aws elbv2 describe-target-health --target-group-arn <arn> \
  --query 'TargetHealthDescriptions[].[Target.Id,TargetHealth.State]'
curl --max-time 330 -Ns https://<your-domain>/api/stream/board > /tmp/sse.txt || true
grep -c ': ping' /tmp/sse.txt   # roughly 16 in 5 minutes
```

**Learn** The ALB idle timeout is 4000s, the app heartbeat is 20s, and the
target group health check is `/api/health` every 15s. Deregistration delay is
30s; web deploys keep `minimumHealthyPercent: 100`, so old tasks serve until new
ones pass health checks. SSE would die behind a default 60s idle timeout.

**Prove it** A healthy target, the 4000s attribute, and roughly 16 pings in five
minutes. Explain the difference between ALB 5xx and target 5xx.

### 51 · Query structured logs · ●●○ · 25 min · staging

**Do**

```bash
aws logs tail /aws/ecs/owm-staging/worker --follow
aws logs filter-log-events --log-group-name /aws/ecs/owm-staging/worker \
  --filter-pattern '{ $.metric = "job" && $.outcome = "failed" }' --max-items 5
```

Then Logs Insights:

```bash
QID=$(aws logs start-query --log-group-name /aws/ecs/owm-staging/worker \
  --start-time $(date -u -v-1H '+%s') --end-time $(date -u '+%s') \
  --query-string 'fields @timestamp, metric, depth, waiting, active | filter metric = "queue" | sort @timestamp desc | limit 20' \
  --query queryId --output text)
aws logs get-query-results --query-id "$QID"
```

**Learn** One JSON object per line is a contract: CloudWatch metric filters and
Logs Insights can query fields without parsing free text. The worker writes
`{"metric":"queue",...}` and `{"metric":"job",...}`; the Ops stack turns them
into metrics.

**Prove it** Find one queue line and one failed-job line. Explain why the metric
filter needs `$.depth = *` and why `defaultValue` cannot be combined with
`dimensions`.

### 52 · Trigger an alarm and read the notification · ●●○ · 20 min · staging

**Do**

```bash
aws cloudwatch describe-alarms \
  --query "MetricAlarms[?Namespace=='OWM/Queue' || Namespace=='OWM/Jobs'].[AlarmName,MetricName,StateValue]" \
  --output table
aws cloudwatch set-alarm-state --alarm-name <alarm-name> \
  --state-value ALARM --state-reason "lab exercise"
# wait for the email, then restore
aws cloudwatch set-alarm-state --alarm-name <alarm-name> \
  --state-value OK --state-reason "lab complete"
```

**Learn** Alarms evaluate a metric over periods and publish to SNS on both
`ALARM` and `OK`. The SNS topic policy must explicitly allow
`cloudwatch.amazonaws.com` and `budgets.amazonaws.com`; adding any policy
replaces SNS's default. The worker-stopped alarm uses `LiveTaskCount`, not the
older `RunningTaskCount` (which had no datapoints and pinned the alarm).

**Prove it** The email arrives and the console shows the state change. Explain
`treatMissingData` and why `BREACHING` on a nonexistent metric is dangerous.

### 53 · Compare the AWS budget with the app spend cap · ●●○ · 20 min · staging

**Do**

```bash
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
aws budgets describe-budgets --account-id "$ACCOUNT" \
  --query 'Budgets[].[BudgetName,BudgetLimit,TimeUnit]' --output table

# RDS is in a private subnet, so this works only from a host with a network
# path (a bastion/SSM session) or against your local database:
psql "$DATABASE_URL" -c \
  "select coalesce(sum(cost_usd),0) as month_spend
   from responses
   where finished_at >= date_trunc('month', now() at time zone 'utc');"
```

**Learn** AWS Budgets sees AWS charges only; OpenRouter spend never appears
there. `MONTHLY_SPEND_CAP_USD` is enforced twice: the API refuses to schedule,
and `processRun` checks again before each provider call. `429
spend_cap_reached` carries `Retry-After` until the next UTC month. Run the same
SQL on your local database to see the shape; the value is provider-reported
`responses.cost_usd`, and the mock provider reports `null`.

**Prove it** Explain what happens when the cap is reached mid-Job: queued Runs
fail without a provider call, and the author can retry next month. Name one
provider behaviour that would defeat the cap.

### 54 · SES, DKIM, ACM, and DNS · ●●○ · 25 min · staging

**Do**

```bash
aws sesv2 get-email-identity --email-identity "$OWM_SES_IDENTITY" \
  --region "$AWS_REGION" \
  --query '{Verified:VerifiedForSendingStatus,Dkim:DkimAttributes.Status}'
aws sesv2 list-email-identities --region "$AWS_REGION"
aws route53 list-resource-record-sets --hosted-zone-id "$OWM_HOSTED_ZONE_ID" \
  --query "ResourceRecordSets[?Type=='CNAME' || Type=='A'].[Name,Type,ResourceRecords]" --output json | jq
aws acm list-certificates --query 'CertificateSummaryList[].[DomainName,Status]' --output table
```

**Learn** SES identities are regional. In the sandbox only verified addresses
receive mail, and `ses:SendEmail` is authorized against the From identity
**and** every recipient that is a verified identity — which is why the web task
role grants `identity/*` (`foundation-stack.ts`). DKIM CNAMEs are created with
`CfnRecordSet` because `DkimDNSTokenName*` is already fully qualified.

**Prove it** `Verified: true`, `Dkim: SUCCESS`, three DKIM CNAMEs, and an issued
certificate. Explain the failure mode if you verify the domain in
`us-east-1` but deploy to `eu-west-1`.

---

# Part 5 — CDK

**Concept.** AWS CDK is a TypeScript program that **synthesizes** CloudFormation
templates. You write constructs; `cdk synth` produces JSON; `cdk deploy` asks
CloudFormation to create/update the stack. CDK itself is not in the runtime
path.

The mental model:

```
App
├── OwmStagingFoundation   (VPC, RDS, Redis, ECR, secrets, SES, logs, tasks)
├── OwmStagingApp          (ALB, DNS, ECS services, autoscaling)
├── OwmStagingOps          (SNS, alarms, metric filters, budget)
└── OwmStagingCi           (GitHub OIDC role; only when githubRepo is set)
```

`infra/bin/infra.ts` builds them; `loadDeploymentConfig(app)` reads context
(`-c key=value`) or environment variables and validates it. This is why no
account, domain, or secret is committed (`infra/lib/config.ts`).

Important CDK ideas used here:

- **L1 vs L2 constructs.** `CfnService` is a raw CloudFormation resource;
  `ecs.FargateService` is a higher-level construct. The repo uses `CfnService`
  deliberately so the service references a task-definition **family**, not an
  ARN, avoiding a cross-stack export that would block Foundation updates
  (`app-stack.ts` comment; ADR 0007).
- **Tokens.** `database.dbInstanceEndpointAddress` is a placeholder until
  deploy; you cannot branch on its value at synth time.
- **Explicit dependencies.** A string reference (`taskDefinition: 'owm-staging-web'`,
  `resourceId: 'service/...'`) creates no CloudFormation edge, so
  `node.addDependency` is required. Both bugs happened on first deploy
  (`docs/ITERATING.md` §5).
- **Removal policies.** `DESTROY` for disposable staging, `RETAIN` for anything
  you cannot recreate. ECR uses `emptyOnDelete`.
- **Assertions.** `infra/test/staging.test.ts` synthesizes the stacks and asserts
  security and wiring invariants without AWS credentials.

**What you should be able to explain afterwards:** why `deploy.sh` is the
release command instead of `cdk deploy`; why the stacks are split; what
`cdk bootstrap` creates; why the tests can run offline; and why changing a
logical id can replace a resource.

### 55 · Synthesize and read the output · ●○○ · 20 min · local

**Do**

```bash
pnpm cdk:synth \
  -c domainName=staging.example.com \
  -c hostedZoneId=Z0123456789 \
  -c alarmEmail=you@example.com
jq '.artifacts | keys' infra/cdk.out/manifest.json
jq '.Resources | keys' infra/cdk.out/OwmStagingApp.template.json
```

Find the `WebService` resource and trace it back to `app-stack.ts`.

**Learn** `cdk.out/` is generated, not committed. Each stack has a template and
metadata. Logical ids are derived from the construct path plus a hash; renaming
a construct can replace the resource.

**Prove it** Point at the exact `AWS::ECS::Service` JSON and the line of
TypeScript that produced it.

### 56 · Compare an L1 and an L2 construct · ●●● · 30 min · local

**Do** Read the `CfnService` block in `app-stack.ts`. Then, in a scratch stack,
replace it with `ecs.FargateService` using the same cluster and task definition,
synth, and diff the two `AWS::ECS::Service` resources.

**Learn** The L2 adds defaults (deployment controller, health check grace
period, circuit breaker wiring) and creates dependency edges. The L1 gives
control and avoids cross-stack references; the cost is that you must add
dependencies and some properties yourself.

**Prove it** List three properties the L2 sets that the L1 block sets
explicitly, and one edge the L2 would have created automatically.

### 57 · Remove a dependency edge and watch a test fail · ●●○ · 20 min · local

**Do** Comment out `webService.node.addDependency(httpsListener)` in
`app-stack.ts`, then run:

```bash
pnpm --filter @owm/infra test
```

Restore it. Repeat with the `target.node.addDependency(service)` line in the
scaling helper.

**Learn** `infra/test/staging.test.ts` asserts both edges. Without them,
CloudFormation can create the service before the target group is attached
(“does not have an associated load balancer”) or the scaling target before the
service exists (“ECS service doesn't exist”).

**Prove it** The named tests fail, then pass after restore. Explain why a string
reference is invisible to CloudFormation's graph.

### 58 · Add your own CDK assertion · ●●○ · 25 min · local

**Do** Add a test to `infra/test/staging.test.ts` for an invariant you care
about, for example: the worker container sets `QUEUE_METRICS=true`, every log
group retains 30 days, or no task definition contains a literal `sk-or-`.
Run `pnpm --filter @owm/infra test`. Break the code on purpose, watch it fail,
restore.

**Learn** CDK assertions are fast, offline unit tests over the synthesized
template. They catch security regressions (plaintext secrets) and wiring
regressions (missing env vars) before a deploy.

**Prove it** Red then green. The test name states the invariant, not the
implementation.

### 59 · Add a validated config knob · ●●○ · 30 min · local

**Do** Add `workerConcurrency` to `DeploymentConfig`, parse it with
`intContext(context, 'workerConcurrency', 4)` and validate it is positive, then
pass it to the worker's `PROVIDER_CONCURRENCY` in `foundation-stack.ts`. Add an
assertion and run:

```bash
pnpm --filter @owm/infra typecheck
pnpm --filter @owm/infra test
pnpm cdk:synth -c domainName=... -c hostedZoneId=... -c alarmEmail=... -c workerConcurrency=2
```

**Learn** Configuration is validated at synth time, not at 3am in a task. Context
is for non-secrets; secrets belong in Secrets Manager. The same value can be
passed by `deploy.sh` and by CI.

**Prove it** Invalid input (`0`, `abc`) fails synth with a clear message; valid
input appears in the template.

### 60 · Diff without deploying · ●●○ · 20 min · staging

**Do** With staging context exported:

```bash
pnpm --filter @owm/infra exec cdk diff OwmStagingFoundation \
  -c domainName="$OWM_DOMAIN_NAME" \
  -c hostedZoneId="$OWM_HOSTED_ZONE_ID" \
  -c alarmEmail="$OWM_ALARM_EMAIL"
```

Then change `imageTag` and diff again.

**Learn** `diff` is read-only. A new image tag changes the task definition
revision, not the service (the service references the family). `cdk bootstrap`
created the `CDKToolkit` stack: an S3 bucket for assets, an ECR repo for image
assets, and roles. `deploy.sh` bootstraps only if the stack is missing.

**Prove it** The diff shows a task-definition change and no service replacement.
Explain why a service that referenced a task ARN would behave differently.

### 61 · Removal policies by experiment · ●●○ · 20 min · local

**Do** In a scratch stack, create two S3 buckets, one with
`RemovalPolicy.RETAIN` and one with `DESTROY`; synth and compare
`DeletionPolicy` in the template. Then inspect the real policies: RDS
`DESTROY`, ECR `DESTROY` + `emptyOnDelete`, log groups `DESTROY`, secrets
default (retain).

**Learn** `RemovalPolicy` controls CloudFormation deletion behaviour, not runtime
deletion. Staging is disposable by design; production must not be. A deleted
secret enters a recovery window and reserves its name.

**Prove it** `jq` the two `DeletionPolicy` values. Explain why deleting the
Foundation stack can lose the database but not the Route 53 zone.

---

# Part 6 — CI/CD

**Concept.** CI answers “is this change safe?”; CD answers “put it in front of
users”. This repo uses GitHub Actions. A **workflow** has **jobs**; a job runs on
a **runner** and has **steps**. Jobs can declare **service containers**
(Postgres, Redis). `needs` creates a dependency; `environment` adds protection
rules and scoped variables/secrets.

The pipeline has two jobs (`.github/workflows/ci.yml`):

1. **verify** — on every PR and push to `main`: Postgres 17 + Redis 7 services,
   `pnpm db:bootstrap`, typecheck, test, build.
2. **deploy** — only on push to `main`, after verify: assume an AWS role through
   **GitHub OIDC**, then run `pnpm deploy:staging`.

OIDC means no long-lived AWS key in GitHub. GitHub signs a short-lived token;
STS exchanges it for temporary credentials if the role's trust policy matches
the repository, branch and environment (`infra/lib/ci-stack.ts`). The workflow
needs `id-token: write`; the role is deliberately broad because `cdk deploy`
manages everything.

The release sequence (`infra/scripts/deploy.sh`) is the part people get wrong:

```
build/push images ─► deploy Foundation (new task revisions)
                  ─► run migration task, wait for exit 0
                  ─► deploy App (ALB/services; usually no-op)
                  ─► deploy Ops (alarms/budget)
                  ─► pin services to new revisions
                  ─► wait services-stable ─► smoke /api/health
```

Migrations run **before** new code takes traffic. A failed migration aborts the
release before any service update. The database is never rolled back by
CloudFormation (`docs/adr/0007`).

**What you should be able to explain afterwards:** why `paths-ignore` exists;
why CI fails instead of skipping when services are missing; how OIDC replaces
access keys; why the image tag is the commit SHA; why `deploy` needs `verify`;
and what a rollback actually changes.

### 62 · Read the workflow like a program · ●○○ · 15 min · local

**Do** Answer from `.github/workflows/ci.yml`:

- Which events trigger it? Which paths are ignored?
- What does `concurrency: ci-${{ github.ref }}` + `cancel-in-progress` do?
- Why is `permissions: contents: read` at the top and `id-token: write` only on
  `deploy`?
- Why does `deploy` have `needs: verify` and `environment: staging`?
- What runs on a docs-only commit? (Hint: `paths-ignore`.)
- What does `cache: pnpm` cache, and what invalidates it?
- If `verify` is a required status check, what happens to a docs-only PR that
  skips it?

**Learn** Workflow syntax, least-privilege permissions, environment protection,
and job dependencies.

**Prove it** `gh workflow view CI` and `gh run list --limit 5`. Then find three
stale statements in the docs: `docs/ITERATING.md` §3 says there is no CI,
`README.md` links `docs/LABS.md` and `docs/CODEBASE-TOUR.md` which do not
exist, and `docs/DEPLOYMENT.md` §7 still names `RunningTaskCount` while the code
uses `LiveTaskCount`.

### 63 · Reproduce the verify job locally · ●●○ · 30 min · local

**Do**

```bash
docker compose up -d postgres redis mailpit
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/openweightmodels
export REDIS_URL=redis://localhost:6379
export APP_URL=http://localhost:3000
export BETTER_AUTH_SECRET=ci-only-secret
export EMAIL_FROM='OpenWeightModels <hello@example.test>'
export SMTP_URL=smtp://localhost:1025
export PROVIDER=mock
pnpm install --frozen-lockfile
pnpm db:bootstrap
pnpm typecheck
pnpm test
pnpm build
```

Then run against an unreachable database (the local `.env` would otherwise
supply a working URL):

```bash
CI=true DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5999/nope pnpm test
```

**Learn** `db:bootstrap` is the production schema path (migrations + registry, no
demo content). CI uses the same path a deploy uses. `servicesAvailable()` skips
integration tests locally, but throws under `CI` so a green run cannot hide a
missing service.

**Prove it** All five commands pass. The `CI=true` run fails with the
“Postgres and Redis are required in CI” message.

### 64 · Service containers vs compose · ●●○ · 20 min · local

**Do** Start a second Postgres on port 5433:

```bash
docker run --rm -d --name owm-lab-db -p 5433:5432 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=openweightmodels postgres:17
DATABASE_URL=postgres://postgres:postgres@localhost:5433/openweightmodels \
  REDIS_URL=redis://localhost:6379 pnpm db:bootstrap
DATABASE_URL=postgres://postgres:postgres@localhost:5433/openweightmodels \
  REDIS_URL=redis://localhost:6379 pnpm test
docker rm -f owm-lab-db
```

**Learn** CI's `services:` block is a lightweight way to get dependencies
without Docker Compose. It does not run the worker or Mailpit; tests that need
those are not in this workflow. The app is env-driven, so the same code works
against any endpoint.

**Prove it** The suite passes against 5433. Explain which tests would fail if CI
also needed the worker (and why they are in the e2e suite instead).

### 65 · Follow the OIDC token exchange · ●●○ · 25 min · staging

**Do** Read `infra/lib/ci-stack.ts` and `.github/workflows/ci.yml` lines 81–119.
Then inspect the deployed trust policy:

```bash
aws iam get-role --role-name owm-staging-github-deploy \
  --query 'Role.AssumeRolePolicyDocument' --output json | jq
aws iam list-open-id-connect-providers
aws iam list-users   # look for a deploy user; this pipeline should have none
```

**Learn** The token's `sub` is matched against
`repo:<owner>/<repo>:ref:refs/heads/main` and
`:environment:staging`; `aud` must be `sts.amazonaws.com`. Repositories created
after 15 July 2026 use immutable subjects (`repo:owner@id/repo@id`), which the
deploy script detects with `gh`. No `AWS::IAM::AccessKey` exists in the stack.

**Prove it** A diagram: GitHub runner → OIDC token → STS
`AssumeRoleWithWebIdentity` → temporary credentials → `cdk deploy`. Explain what
happens if the branch is `main` but the environment is not `staging`.

### 66 · Classify variables and secrets · ●●○ · 20 min · staging

**Do** List the `env:` block in the deploy job. Classify every entry as
`vars` or `secrets` and justify it. Then:

```bash
gh variable list --env staging
gh secret list --env staging
```

**Learn** `OWM_SENTRY_DSN` is a secret because it contains a project key;
`AWS_DEPLOY_ROLE_ARN`, domain, zone, alarm email and budgets are configuration.
Environment protection rules can require reviewers. The workflow's guard step
fails fast when `AWS_DEPLOY_ROLE_ARN` or `OWM_DOMAIN_NAME` is missing.

**Prove it** A table with three columns: name, kind, why. Remove a variable in a
scratch environment (or read the guard) and show the failure message.

### 67 · Prove migration-first stops a bad release · ●●○ · 35 min · local/staging

**Do** First simulate locally. Drizzle only applies migrations listed in
`packages/core/drizzle/meta/_journal.json`, so generate a real one rather than
dropping a loose `.sql` file:

1. Add a temporary column to a table in `packages/core/src/db/schema.ts`.
2. `pnpm db:generate` — this writes `0008_*.sql` and updates the journal.
3. Edit that generated SQL to `select * from does_not_exist;`.
4. Point `DATABASE_URL` at a scratch database and run `pnpm db:bootstrap`.
5. Observe the failure, then delete the generated SQL and snapshot, revert the
   journal entry with
   `git checkout -- packages/core/drizzle/meta/_journal.json`, and revert the
   schema.

Then read `deploy.sh` lines 197–224 and answer: which step would have failed
before `update_service`, and what would the script have done on a non-zero exit?

**Learn** `set -euo pipefail`; `aws ecs wait tasks-stopped`; the exit-code check;
`aws logs tail` on failure. The App stack is separate precisely so a migration
can sit between registering new task definitions and rolling services.

**Prove it** A timeline of the release with the failure point marked. Optional
staging drill: run `pnpm deploy:staging` on a dedicated branch, confirm it
aborts, then revert. Do not do this if anyone else is using the environment.

### 68 · Roll back a service, then forward · ●●○ · 30 min · staging

**Do**

```bash
aws ecs list-task-definitions --family-prefix owm-staging-web --sort DESC
aws ecs update-service --cluster owm-staging-cluster \
  --service owm-staging-web \
  --task-definition arn:aws:ecs:<region>:<account>:task-definition/owm-staging-web:<n>
aws ecs wait services-stable --cluster owm-staging-cluster --services owm-staging-web
```

Then roll forward to the newest revision. Repeat for the worker.

**Learn** Application rollback is a task-definition pin; the database is not
rolled back. Images stay in ECR by tag, so `IMAGE_TAG=<sha> pnpm deploy:staging`
is the other path. `services-stable` can return before `rolloutState` catches
up; check running/desired counts. A destructive migration needs an RDS snapshot
restored to a new instance, not a schema edit.

**Prove it** Health is green after both directions; one Run settles. Write the
rollback order as five numbered steps, ending with “confirm with `/api/health`,
one sign-in, one Run”.

---

# Part 7 — Capstones

These are deliberately open-ended. Do them only after the relevant parts.

### 69 · Run a chaos drill · ●●● · 60 min · local

**Do** In one session, without restarting everything at once:

1. Stop Redis during a streaming Run. Watch the SSE client fall back to the
   2-second poll, the rate limiter fall back to memory, and the worker's event
   publishing fail (but the DB keep updating).
2. SIGKILL the worker mid-Run. Record the Redis job state and the Postgres
   Response state after 30 seconds.
3. Stop Postgres. Watch web return 503 and the worker log errors.
4. Restore in the reverse order and settle the Run.

**Learn** Failure modes are the design. Postgres-first ordering is what lets you
recover; `maxRetriesPerRequest: null` explains the producer hang; the missing
reconciler explains the stranded `calling` row.

**Prove it** A one-page incident timeline with timestamps, observed states, and
the smallest code change that would have shortened recovery. If you propose a
reconciler, give its SQL predicate and its age threshold.

### 70 · Add a new job type end to end · ●●● · 90 min · local

**Do** Add a `cleanup` job that deletes read notifications older than 30 days
(or expired `auth_verifications`):

1. Add `enqueueCleanup()` to `packages/core/src/queue.ts` with a deterministic
   `jobId` and a delay.
2. Add the handler case in `apps/worker/src/worker.ts` and a service function in
   `packages/core` that does the delete in one SQL statement.
3. Emit a `{ "metric": "job", "outcome": ... }` line (or reuse the existing
   shape) and add it to the worker dispatch test.
4. Add a test in `apps/worker/test/run-worker.test.ts` that enqueues the job and
   waits for the rows to disappear.
5. Run `pnpm typecheck`, `pnpm test`, and `pnpm cdk:synth`.

**Learn** Producer/consumer contracts, deterministic ids, retention, idempotent
SQL, integration tests with real Postgres and Redis, and the fact that a new
job type needs no infrastructure change because the queue already exists.

**Prove it** The test is red before the handler, green after; a second delivery
of the same cleanup is harmless; the queue metrics still parse.

---

## Appendix A — What “done” looks like

You understand a layer when you can predict behaviour without running the
command. Use this as a self-check:

| Layer | You can… |
|---|---|
| Docker | explain why a source edit hot-reloads, a dependency edit does not, and which volume dies on `down -v` |
| Queues | draw the producer → broker → consumer path and name the idempotency guard |
| BullMQ | say what `wait`, `active`, `delayed`, `completed`, `failed` mean and what `removeOnComplete` bounds |
| Redis | choose between pub/sub, a list, a sorted set and a Lua counter for a given requirement |
| AWS | trace a request from Route 53 → ALB → web → RDS, naming the security group at each hop |
| CDK | predict whether a change replaces a resource, and why a string reference needs `addDependency` |
| CI/CD | explain how a commit becomes a task-definition revision without an AWS access key |
| Operations | diagnose a stuck Run from queue depth, worker logs, `job_events`, and `/api/health` |

## Appendix B — Known gaps and deliberate limitations

These are real, documented, and good advanced exercises:

- No automatic reconciler for stranded Runs after a Redis loss
  (`docs/DEPLOYMENT.md` §8). Challenge 42/69.
- Redis is a single node; losing it loses queue contents.
- The worker image ships TypeScript and `tsx`, so it is larger than a compiled
  worker.
- Staging has no WAF or ALB edge rate limiting; abuse controls are in-process +
  Redis.
- The spend cap depends on provider-reported cost; a provider that omits usage
  contributes zero.
- `staging.env` currently sets `OWM_SENTRY_DSN` to an email address. That is not
  a valid DSN, so `parseSentryDsn` returns `null` and errors go to structured
  logs only. Challenge 54 is a good place to notice this; fix it with a real
  Sentry DSN.
- Documentation drift: `docs/ITERATING.md` §3 says “There is no CI yet”,
  `README.md` links `docs/LABS.md` and `docs/CODEBASE-TOUR.md` which do not
  exist, and `docs/DEPLOYMENT.md` §7 names `RunningTaskCount` while the alarm
  uses `LiveTaskCount`. Challenge 62.

## Appendix C — Command cheat sheet

```bash
# local stack
docker compose up --build
docker compose ps
docker compose logs -f web worker
docker compose exec redis redis-cli
docker compose exec postgres psql -U postgres -d openweightmodels

# queue inspection (from packages/core)
pnpm --filter @owm/core exec tsx lab-queue.ts

# database
pnpm db:generate && pnpm db:migrate
pnpm db:bootstrap          # migrations + model registry (production path)
pnpm db:init               # local: migrate + registry + seed if empty
pnpm db:seed               # replace content
pnpm db:reset              # drop schema (never production)

# checks
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm test:live             # costs money

# CDK (offline)
pnpm cdk:synth -c domainName=staging.example.com -c hostedZoneId=Z... -c alarmEmail=you@example.com
pnpm --filter @owm/infra test

# AWS (staging only)
aws sts get-caller-identity
aws logs tail /aws/ecs/owm-staging/web --follow
aws logs tail /aws/ecs/owm-staging/worker --follow
aws ecs describe-services --cluster owm-staging-cluster \
  --services owm-staging-web owm-staging-worker
aws elbv2 describe-target-health --target-group-arn <arn>
aws cloudwatch describe-alarms

# CI
gh run list
gh run view <run-id> --log
gh workflow view CI
```
