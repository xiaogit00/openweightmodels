# Iterating on OpenWeightModels

Two loops. The local loop is minutes and free; the staging loop is one command
and about six minutes. Everything below assumes you work from the repo root.

Related: `docs/DEPLOYMENT.md` (topology, first deploy, rollback, cost) and
`docs/IMPLEMENTATION-STATUS.md` (what is built).

---

## 1. What differs between the two loops

| | Local | Staging |
|---|---|---|
| Provider | `PROVIDER=mock` by default | `PROVIDER=openrouter` |
| Provider key | `.env.local` or exported | Secrets Manager, injected by ECS |
| Mail | Mailpit at `localhost:8025` | SES (sandbox: verified recipients only) |
| Identity | magic link, or `POST /api/dev/user` | magic link only |
| Database | your Postgres | RDS, private subnets |
| Schema changes | `pnpm db:migrate` on your machine | migration task during `deploy:staging` |
| Model registry | `pnpm db:init` (or `pnpm db:bootstrap`) | bootstrap task during `deploy:staging` |

The code is identical. The differences are configuration and credentials, which
is why a local pass does not prove a staging pass — the release step at the end
is not optional ceremony.

---

## 2. The local loop

### 2.1 Start the stack

Docker (recommended — Postgres, Redis, Mailpit and both processes in one go):

```bash
pnpm stack:up          # docker compose up --build
```

| Service | Address |
|---|---|
| App | <http://localhost:3000> |
| Mailpit inbox | <http://localhost:8025> |
| Worker health | <http://localhost:3001/healthz> |
| Postgres | `localhost:5432` (`postgres` / `postgres`) |
| Redis | `localhost:6379` |

No Docker:

```bash
brew services start postgresql@17 redis
createdb openweightmodels     # once
cp .env.example .env          # set DATABASE_URL to your OS user
pnpm install
pnpm db:init                  # migrate, sync the registry, then seed only if empty
pnpm dev                      # web + worker, or dev:web / dev:worker separately
```

`pnpm stack:reset` deletes the volumes (database and Redis data) and rebuilds;
`pnpm db:reset` drops just the public schema. `pnpm stack:down` keeps the named
volumes.

### 2.2 What hot-reloads, and what does not

`@owm/core` exports TypeScript source (`packages/core/package.json` → `exports`
points at `./src/*.ts`), so there is no build step between packages.

| You changed | What to do |
|---|---|
| `apps/web/**`, `packages/core/**` | nothing; Next dev recompiles (restart if a core change is not picked up) |
| `apps/worker/**`, `packages/core/**` | nothing; `tsx watch` restarts |
| `.env` or `.env.local` | restart the process. `tsx watch` reloads code, not env |
| `package.json` dependencies | `docker compose up --build --renew-anon-volumes`, or `pnpm install` |
| `docker-compose.yml` | `docker compose up -d` (recreates the changed containers) |

`.env.local` wins over `.env`, both are read from the repo root, and a value
already exported in your shell wins over both (`packages/core/src/load-env.ts`).
Keep `OPENROUTER_API_KEY` in `.env.local`; it is gitignored.

Watch the logs with `pnpm stack:logs` (web + worker) or
`docker compose logs -f migrate`.

### 2.3 Database changes

```bash
# 1. edit packages/core/src/db/schema.ts
pnpm db:generate            # writes packages/core/drizzle/NNNN_*.sql
# 2. read the generated SQL before applying it
pnpm db:migrate
```

Under Docker, `pnpm db:migrate` works from the host if `DATABASE_URL` points at
`localhost:5432`; otherwise re-run the migrate service:

```bash
docker compose run --rm migrate
```

Rules:

- Never edit a migration that has already been applied anywhere. Add another one.
- Migrations are forward-only. A destructive change on staging needs an RDS
  snapshot first (`aws rds create-db-snapshot`).
- `pnpm db:reset` drops and recreates the public schema and refuses to run in
  production. It is the fast way out of a half-applied local migration.

### 2.4 Model registry changes

The registry is data, not schema: edit `packages/core/src/model-registry.ts`,
then

```bash
pnpm db:bootstrap      # upsert by slug; never touches Comparisons or users
```

`db:bootstrap` preserves an Admin-disabled model, so re-running it will not
silently re-enable something you turned off. `pnpm db:init` now performs the
same registry sync on every run, so a populated local database picks up a new
release without a manual reseed; retired entries are disabled, not deleted.

The pickers show current releases by default, grouped into **Open weights** and
**Frontier API**. Previous releases stay behind a `Show previous releases`
disclosure, while search scans every release and badges the previous matches.
The Base picker lists current entries first in its four current/previous
optgroups and marks previous options with `(previous)`.

### 2.5 Real generations locally

```bash
# in .env.local
PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-v1-...
```

Restart the worker; it refuses to boot if `PROVIDER=openrouter` has no key, and
a real mode never falls back to mock. To prove one real call end to end,
including stored tokens, latency and cost:

```bash
pnpm test:live     # costs money; only this script calls a provider
```

`LIVE_PROVIDER_MODEL` overrides the default model.

### 2.6 Fast checks inside the loop

```bash
pnpm --filter @owm/core test          # one package
pnpm --filter @owm/web test
pnpm typecheck                        # all packages + e2e typings
```

`pnpm test` across everything needs Postgres and Redis running; the DB-backed
suites skip themselves (with a warning) when they are not reachable, so a green
run with services down is weaker than it looks.

---

## 3. Before you release

There is no CI yet (ticket 16), so this is the pipeline. Run in this order:

| Command | Catches | Needs |
|---|---|---|
| `pnpm typecheck` | type drift across packages and e2e | nothing |
| `pnpm test` | unit + DB-backed integration | Postgres, Redis |
| `pnpm build` | Next build and standalone output | nothing beyond env |
| `pnpm test:e2e` | the browser journey, a11y, keyboard, responsive | Postgres, Redis, `psql`, `redis-cli`, Playwright chromium |
| `pnpm test:live` | real provider wiring | a key; costs money |

`pnpm test:e2e` seeds `openweightmodels_e2e` and Redis database `1`, starts its
own servers on port 3100, and refuses to touch your development database. It
re-seeds before the run, so it will overwrite that isolated database only.

Run `pnpm test:live` when you touched the provider client, the worker queue, or
the cost/token persistence — not on every release.

Stack-only changes (`infra/**`) do not need the full suite, but they do need:

```bash
pnpm cdk:synth
pnpm --filter @owm/infra test
```

Both are offline and fast.

---

## 4. The staging loop

### 4.1 Keep the deployment context in one file

`deploy.sh` reads exported variables. Put them in a gitignored file and source
it, rather than retyping them (a typo in the zone ID fails after images are
built):

```bash
# staging.env  (gitignored — no secrets in here)
export AWS_REGION=ap-southeast-1
export OWM_DOMAIN_NAME=staging.openweightmodels.net
export OWM_HOSTED_ZONE_ID=<your Route 53 zone id>
export OWM_HOSTED_ZONE_NAME=openweightmodels.net
export OWM_PROVIDER=openrouter
# Keep a public staging URL to the people meant to test it. Comma-separated;
# `@example.com` allows a whole domain. Unset allows anyone.
export OWM_SIGNIN_ALLOWED_EMAILS=owner@example.com
```

```bash
source staging.env
pnpm deploy:staging
```

The provider key is **not** here. It lives in Secrets Manager and survives every
release.

### 4.2 Commit first

The image tag defaults to `git rev-parse --short=12 HEAD`, but the build runs
from your working tree. Two releases with uncommitted changes therefore publish
different images under the same tag:

```bash
git status --short        # expect no modified source
```

If you deliberately want a distinct tag, pass one:

```bash
IMAGE_TAG=$(git rev-parse --short=12 HEAD)-dirty pnpm deploy:staging
```

### 4.3 What a release actually does

`pnpm deploy:staging` is `infra/scripts/deploy.sh`. In order:

1. Preflight: region, domain, zone lookup (`route53 get-hosted-zone`), required
   tools (`aws`, `docker`, `pnpm`, `curl`, buildx).
2. Build and push ARM64 `web` and `worker` images to ECR. On a clean account the
   foundation stack is created first, because the ECR repositories it owns must
   exist before anything can be pushed.
3. Deploy `OwmStagingFoundation` — new task-definition revisions.
4. Run the migration task from the new worker image; fail if it exits non-zero.
5. Deploy `OwmStagingApp` (usually a no-op after the first release).
6. Pin both services to the new revision and force a new deployment.
7. Wait for `services-stable`, then poll `https://<domain>/api/health`.

Observed on this project: ~5.5 minutes end to end, dominated by the worker image
push (~78s) and the service roll (~2 min). Migrations apply *before* new code
takes traffic, which is why the two stacks are split.

Things it does **not** do: set or rotate the provider key, seed demo content, or
change DNS if records already exist.

### 4.4 After it returns

```bash
aws cloudformation describe-stacks --stack-name OwmStagingApp \
  --query 'Stacks[0].StackStatus' --output text      # CREATE_COMPLETE / UPDATE_COMPLETE

aws ecs describe-services --cluster owm-staging-cluster \
  --services owm-staging-web owm-staging-worker \
  --query 'services[].[serviceName,deployments[0].rolloutState,runningCount,desiredCount,taskDefinition]' \
  --output text

curl -sS https://staging.openweightmodels.net/api/health
```

`rolloutState` can lag behind reality by a minute or two; trust
`runningCount == desiredCount` plus a healthy task, and check
`deployments[].status` if in doubt. Then do the short smoke:

- sign in (magic link to a verified address in the SES sandbox);
- one real generation, confirming tokens and latency, not mock values;
- board, publish, one annotation.

`docs/DEPLOYMENT.md` §6 has the full checklist, including the five-minute SSE
check, which is only needed after changes to streaming, the ALB or auth.

### 4.5 What needs a release, and what does not

| Change | Action |
|---|---|
| `apps/**` or `packages/core/**` code | `pnpm deploy:staging` |
| New migration | `pnpm deploy:staging` (bootstrap task applies it) |
| Model registry entry | `pnpm deploy:staging` (the registry ships in the worker image) |
| `infra/**` | `pnpm deploy:staging` |
| Provider key value | `put-secret-value` + worker restart; no release |
| Staging data fix | one-off `aws ecs run-task` with the migrate task definition |

### 4.6 Secrets and config

Rotate the provider key without a release:

```bash
read -rsp "OpenRouter key: " OR_KEY; echo
aws secretsmanager put-secret-value \
  --secret-id owm-staging/openrouter-api-key \
  --region ap-southeast-1 --secret-string "$OR_KEY"
unset OR_KEY

aws ecs update-service --cluster owm-staging-cluster \
  --service owm-staging-worker --force-new-deployment --region ap-southeast-1
aws ecs wait services-stable --cluster owm-staging-cluster \
  --services owm-staging-worker --region ap-southeast-1
```

Secrets are injected at task start, so the running task keeps the old value
until it is replaced. Only the worker has the provider key.

### 4.7 Rollback

```bash
aws ecs list-task-definitions --family-prefix owm-staging-web --sort DESC
aws ecs update-service --cluster owm-staging-cluster \
  --service owm-staging-web --task-definition <previous revision ARN>
aws ecs wait services-stable --cluster owm-staging-cluster --services owm-staging-web
```

Or redeploy an older commit with `IMAGE_TAG=<sha> pnpm deploy:staging`. Database
changes are not rolled back by CloudFormation; restore from a snapshot if a
migration has to be undone.

---

## 5. Traps this project has already hit

- **CloudFormation string references.** A resource that names an ECS service,
  target group or scaling target by *string* (L1 `CfnService`,
  `ScalableTarget.resourceId`) gets no dependency edge, so it can be created
  before the thing it points at. Both of these failed on first deploy. When you
  add such a resource, add `node.addDependency` explicitly and assert it in
  `infra/test/staging.test.ts`.
- **`deploy.sh` accepts any non-empty provider secret.** A malformed key reaches
  production and surfaces as a run failure. Error messages are distinguishable:
  `Missing Authentication header` = not an OpenRouter key at all;
  `User not found.` = well-formed but invalid; `402` = account out of credit.
- **SES authorises every identity in a send.** In the sandbox each recipient is
  a verified identity in the account, so the web task role needs
  `ses:SendEmail` on `identity/*`, not just on the sending domain. The failure
  reads as `AccessDenied ... identity/<recipient>` and looks like a verification
  problem.
- **SES identities are regional.** Verify the sending domain and any sandbox
  recipient in the deployment region, not in `us-east-1`.
- **Stale browser tabs after a release.** A tab opened before a deploy holds old
  Server Action ids and logs `The Server Reference ID did not match the expected
  format`. Hard-reload; it is not a server fault.
- **`ecs wait services-stable` returns early.** It can succeed while
  `rolloutState` still says `IN_PROGRESS`. Confirm running/desired counts.
- **A failed first create is terminal.** CloudFormation leaves the stack in
  `ROLLBACK_COMPLETE`, which cannot be updated. Delete the stack before
  re-running (`docs/DEPLOYMENT.md` §7). Deleting `OwmStagingApp` is safe; it
  holds no data.
- **Docker dependency changes** need `--build --renew-anon-volumes`; otherwise
  the old `node_modules` layer is reused.
- **Port clashes** with Homebrew Postgres/Redis: `POSTGRES_PORT=5433
  REDIS_PORT=6380 pnpm stack:up`.

---

## 6. Where work gets recorded

- One ticket per feature: `.scratch/<feature-slug>/issues/NN-<slug>.md`, with a
  `Status:` line and appends under `## Comments`. `Status: done` closes it.
- Decisions that will outlive the ticket go to `docs/adr/` and, if they settle a
  product question, to `docs/DECISIONS.md`.
- New domain vocabulary goes in `GLOSSARY.md`.

---

## 7. Cheat sheet

```bash
# local
pnpm stack:up                       # or: pnpm db:init && pnpm dev
pnpm db:generate && pnpm db:migrate # schema change
pnpm db:init                        # local registry refresh (syncs by slug)
pnpm db:bootstrap                   # production registry change
pnpm typecheck && pnpm test         # before anything else
pnpm test:e2e                       # UI changes
pnpm test:live                      # provider changes

# staging
source staging.env
git status --short                  # clean tree
pnpm deploy:staging
curl -sS https://staging.openweightmodels.net/api/health
```
