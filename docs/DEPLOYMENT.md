# Deploying staging on AWS

Staging runs the same two-container topology as local development on AWS:
Next.js and the BullMQ worker as separate ECS Fargate services behind an
Application Load Balancer, with RDS PostgreSQL, a node-based ElastiCache Redis,
SES for magic links, ECR for images, Secrets Manager for credentials and
CloudWatch Logs. The infrastructure is AWS CDK in TypeScript under `infra/`
(ADR 0006).

> **What this document covers:** the staging stacks, release sequence, CI/CD
> with GitHub OIDC, rate limits, alarms, budgets, the provider spend cap, the
> error tracker and rollback. There are no long-lived AWS access keys in the
> repository or in GitHub.

---

## 1. Topology

```
Internet
   │  HTTPS 443 (HTTP 80 redirects)
   ▼
Application Load Balancer  ── idle timeout 4000s, TLS 1.3-1.2 policy
   │  HTTP 3000
   ▼
ECS Fargate service `owm-staging-web` (min 2, max 4, CPU target 60%)
   │                         │
   │                         └── SES v2 (task role, no SMTP secret)
   ├── RDS PostgreSQL 17 (db.t4g.micro, single-AZ staging)
   └── ElastiCache Redis 7 (cache.t4g.micro, one node, TLS, noeviction)
                                  ▲
ECS Fargate service `owm-staging-worker` (min 1, max 2, CPU target 70%)
                                  │
                                  └── OpenRouter (key from Secrets Manager)
```

| Resource | Staging choice | Why |
|---|---|---|
| CDK stacks | `OwmStagingFoundation`, `OwmStagingApp`, `OwmStagingOps` and optional `OwmStagingCi` | Task definitions can be registered without rolling services; migrations run between Foundation and App (see §5); alarms and budgets are independent of a release; CI owns the OIDC role |
| Network | 2 AZs, public subnets for the ALB, private subnets with one NAT gateway | One NAT is the cheap staging choice; production should use one per AZ |
| Web / worker | 0.5 vCPU / 1 GiB, ARM64 (Graviton) | Cheaper Fargate sizing for this load; images are built `linux/arm64` |
| Postgres | 20 GB gp3, encrypted, 7-day backups, single-AZ, `db.t4g.micro` | Disposable staging data; deletion protection is off so the stack can be torn down |
| Redis | One-node replication group, cluster mode off, `maxmemory-policy=noeviction`, in-transit TLS | BullMQ does not support ElastiCache Serverless and must not evict queue data; ElastiCache only supports TLS on a replication group, not a plain cache cluster |
| Images | Two ECR repositories, scan on push, untagged images expire after 14 days | Separate web and worker images |
| Secrets | RDS-generated master secret, generated Better Auth secret, empty OpenRouter secret | Injected with ECS `secrets`, never as plain task environment |
| Mail | SES identity for the domain (or a verified address) | The web task role has `ses:SendEmail`; no SMTP credentials exist |
| Logs | `/aws/ecs/owm-staging/{web,worker,migrate}`, 30 days | `aws logs tail` is the first diagnostic |

The web task has no provider key, and the worker has no auth secret. The
postgres password is assembled into a connection URL inside the process so it
never appears in a task definition environment value.

---

## 2. Prerequisites

- An AWS account and a region (the examples use `eu-west-1`). Choose the region
  nearest your users — for example `ap-southeast-1` in Singapore. Every
  resource, the SES identity and the recipient verification must be in that
  same region. The release script requires `AWS_REGION` (or
  `AWS_DEFAULT_REGION`) in the environment; a region configured only in the CLI
  profile is not enough.
- A hostname you control, e.g. `staging.openweightmodels.com`, plus either:
  - the Route 53 hosted zone ID for the parent domain — CDK creates the ACM
    certificate with DNS validation, the ALB alias record and SES DKIM records;
  - or an already-issued ACM certificate ARN in the same region. You then point
    DNS at the ALB yourself.

  `staging.openweightmodels.com` is only an example; use a domain you control.
  If the domain is not already in Route 53, register it there, or create a
  public hosted zone and delegate the registrar's name servers to it before
  deploying. Without that delegation ACM validation cannot complete. Get the
  actual zone ID with `aws route53 list-hosted-zones-by-name`; `deploy.sh`
  checks that the zone exists and exits before creating resources if the ID is
  the `Z...` placeholder.
- SES: the account may still be in the sandbox. In staging, magic links only
  reach **verified** addresses until production access is granted. SES
  identities and recipient verifications are **regional** — verify them in the
  deployment region. The SES console often defaults to `us-east-1`, which is
  the wrong region for the `eu-west-1` examples. When
  `OWM_HOSTED_ZONE_ID` is supplied, CDK creates the SES domain identity and its
  DKIM records in that zone (set `OWM_HOSTED_ZONE_NAME` when the zone is a
  parent of the app hostname). An email identity instead requires clicking the
  AWS verification link before mail can be sent. With the
  `OWM_CERTIFICATE_ARN` path no zone is known to CDK, so publish the
  `SesDkimName1`/`SesDkimValue1`–`3` stack outputs as CNAME records yourself.
- An OpenRouter API key. It is written to Secrets Manager after the first
  deploy, never to this repository or a task definition.
- Locally: AWS CLI v2 configured with a role that can create the resources
  above, Docker with Buildx, Node 22+ and pnpm 12.

```bash
aws sts get-caller-identity
docker buildx version
pnpm install
```

`pnpm deploy:staging` runs `cdk bootstrap` for the account/region if the
`CDKToolkit` stack is missing. Bootstrapping by hand is also fine:

```bash
pnpm --filter @owm/infra exec cdk bootstrap aws://<account>/<region>
```

---

## 3. Configuration

Everything is passed as CDK context by the release script, so no domain,
account ID or secret is committed. The script reads these environment
variables:

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `AWS_REGION` (or `AWS_DEFAULT_REGION`) | yes | — | Deployment region |
| `OWM_DOMAIN_NAME` | yes | — | Public hostname, no scheme |
| `OWM_HOSTED_ZONE_ID` | one of | — | Actual Route 53 hosted zone ID for the domain (for example `Z0123456789ABCDEFGHIJ`; omit the `/hostedzone/` prefix) |
| `OWM_HOSTED_ZONE_NAME` | no | `OWM_DOMAIN_NAME` | Zone name when the zone is a parent, e.g. `example.com` for `staging.example.com` |
| `OWM_CERTIFICATE_ARN` | one of | — | Existing ACM certificate in the same region |
| `OWM_SES_IDENTITY` | no | domain | Verified SES domain or email address |
| `OWM_EMAIL_FROM` | no | `OpenWeightModels <no-reply@domain>` | Magic-link sender |
| `OWM_ALARM_EMAIL` | yes | — | Named owner for CloudWatch and budget alarms; the SNS email subscription |
| `OWM_MONTHLY_BUDGET_USD` | no | `200` | AWS infrastructure budget (not model spend) |
| `OWM_MONTHLY_SPEND_CAP_USD` | no | `100` | Absolute provider-spend ceiling per UTC month; `0` is rejected in staging |
| `OWM_SENTRY_DSN` | no | unset | Sentry-compatible error tracker; unset writes structured errors to logs only |
| `OWM_GITHUB_REPO` | for `deploy:ci` | — | `owner/repository` allowed to assume the deploy role |
| `OWM_GITHUB_BRANCH` | no | `main` | Branch allowed to deploy through OIDC |
| `OWM_GITHUB_OIDC_PROVIDER_ARN` | no | create | Reuse an existing GitHub OIDC provider |
| `OWM_SIGNIN_ALLOWED_EMAILS` | no | unset (any address) | Comma-separated sign-in allowlist: `owner@example.com` for one address, `@example.com` for a domain |
| `OWM_ALLOW_SEARCH_INDEXING` | no | `false` | Set `true` only for a public launch; it is a build argument, so it needs a rebuild |
| `OWM_PROVIDER` | no | `openrouter` | `mock` for an infrastructure-only smoke test |
| `OWM_STACK_PREFIX` | no | `OwmStaging` | CloudFormation stack prefix |
| `OWM_NAME_PREFIX` | no | `owm-staging` | ECR, ECS and resource prefix |
| `IMAGE_TAG` | no | current git commit | Image tag and task-definition revision |
| `PLATFORM` | no | `linux/arm64` | Docker build platform |
| `SKIP_SMOKE` | no | unset | Set to `1` to skip the post-deploy health request |

To see the templates without AWS credentials:

```bash
pnpm cdk:synth \
  -c domainName=staging.example.com \
  -c hostedZoneId=Z0123456789 \
  -c alarmEmail=owner@example.com
```

The three stacks are emitted into `infra/cdk.out` (gitignored). `OwmStagingCi`
is added only when `OWM_GITHUB_REPO` (or `-c githubRepo=owner/repo`) is set.

---

## 4. First deployment

```bash
export AWS_REGION=eu-west-1
export OWM_DOMAIN_NAME=staging.openweightmodels.com
# Replace with the actual zone ID from Route 53; `Z...` is only a placeholder.
export OWM_HOSTED_ZONE_ID=Z0123456789ABCDEFGHIJ
export OWM_HOSTED_ZONE_NAME=openweightmodels.com
# Required: the person who owns alarms and the budget.
export OWM_ALARM_EMAIL=ops@openweightmodels.net
# Strongly recommended before exposing the app: a Sentry project DSN.
export OWM_SENTRY_DSN=https://key@o123.ingest.sentry.io/456789
# Optional; defaults to OWM_DOMAIN_NAME. Matching the staging hostname keeps
# the SES identity and the From address identical.
export OWM_SES_IDENTITY=staging.openweightmodels.com
pnpm deploy:staging
```

The first run:

1. Bootstraps CDK if needed.
2. Creates `OwmStagingFoundation`: VPC, RDS, ElastiCache, ECR, secrets, SES
   identity, log groups, cluster and the web/worker/migrate task definitions.
   Task definitions may reference an image that does not exist yet; nothing
   runs them until the App stack exists.
3. Builds the `web` and `worker` production images for `linux/arm64` and pushes
   them to ECR with the commit tag.
4. Re-deploys the Foundation stack so the task definitions reference those
   image tags.
5. Refuses to continue if `PROVIDER` is not `mock` and the OpenRouter secret is
   empty. This is a guardrail, not a failed deployment: with the default
   `openrouter` provider the first run always stops here after creating the
   foundation and pushing images. Set the secret once and re-run:
   ```bash
   SECRET_ARN=$(aws cloudformation describe-stacks \
     --stack-name OwmStagingFoundation \
     --query "Stacks[0].Outputs[?OutputKey=='ProviderKeySecretArn'].OutputValue" \
     --output text)
   aws secretsmanager put-secret-value \
     --secret-id "$SECRET_ARN" \
     --secret-string 'sk-or-...'
   ```
   Re-run `pnpm deploy:staging` afterwards. For an infrastructure-only first
   pass, run with `OWM_PROVIDER=mock`; the provider-key check is skipped and
   you can set the key and re-run without `mock` later.
6. Runs the migration/bootstrap task in the private subnets and waits for it to
   exit 0.
7. Creates `OwmStagingApp`: HTTPS listener, HTTP redirect, DNS record, target
   group and the two ECS services.
8. Creates `OwmStagingOps`: the alarm SNS topic with `OWM_ALARM_EMAIL`, the
   CloudWatch alarms, log metric filters and the monthly AWS budget.
9. Pins each service to the newest task-definition revision and forces a new
   deployment, then waits for `services-stable`.
10. Requests `https://<domain>/api/health` until it returns 200.

The first deploy typically takes 30–60 minutes; RDS, ElastiCache, the NAT
gateway and ACM validation dominate. Do not interrupt it.

### What the migration task does

`packages/core/src/db/bootstrap.ts` applies the Drizzle migrations and upserts
the curated Model registry in `packages/core/src/model-registry.ts`. It does
**not** create users, Comparisons or any other development content. It is
idempotent and preserves an Admin's `enabled = false` on a Model.

---

## 5. Release sequence

For the day-to-day loop — local development, the pre-release checks, then this
command — see [`docs/ITERATING.md`](ITERATING.md).

`pnpm deploy:staging` is the release command. It deliberately splits the
deployment so schema changes land before new application code serves traffic:

1. Push new images.
2. Deploy `OwmStagingFoundation` → registers new task-definition revisions.
3. Run the migration task from the new worker image, wait for the exit code.
4. Deploy `OwmStagingApp` (usually a no-op after the first release).
5. Deploy `OwmStagingOps` (alarms, budget and owner; idempotent).
6. Update `owm-staging-web` and `owm-staging-worker` to the new revision with
   `--force-new-deployment`, then wait for both services to be stable.

**Migrations are automatic.** Step 3 is the only path that changes the schema:
it runs `packages/core/src/db/bootstrap.ts` (Drizzle migrations plus the Model
registry) and the release aborts before any service update if the task exits
non-zero. The migration task uses the new worker image, so a rollback to an
older application revision must not depend on a schema change. Write migrations
so the previous application version keeps working: add nullable columns and new
tables in one release, backfill, then drop or tighten in a later release.

The ECS services reference their task definition **family**, not an ARN, so
registering a new revision does not change a cross-stack export. The script
pins the revision after the migration. If you run the two CDK stacks by hand,
run the migration task between them (see the script for the exact
`aws ecs run-task` command).

The ALB deregistration delay is 30 seconds and `minHealthyPercent` is 100 for
web, so publishing keeps old tasks serving until new tasks are healthy.

---

## 6. Verify staging

Run through this list once per environment (and after changes to auth, SSE or
the worker).

Before testing magic links, verify the sign-in address in SES **in the
deployment region**, and wait for the domain identity to verify:

```bash
aws sesv2 get-email-identity --email-identity "${OWM_SES_IDENTITY:-$OWM_DOMAIN_NAME}" \
  --region "$AWS_REGION" \
  --query '{Verified:VerifiedForSendingStatus,Dkim:DkimAttributes.Status}'
```

Expect `Verified: true` and `Dkim: SUCCESS`. DKIM usually verifies in minutes
but can take longer; until then SES rejects sends. Use the verified address for
the sign-in step and check spam.

SES authorises `SendEmail` against every identity in the request: the `From`
identity and each recipient that is a verified identity in the account. In the
sandbox every recipient is one, so the web task role is granted
`ses:SendEmail`/`ses:SendRawEmail` on `identity/*` in the account rather than on
the sending domain alone. A domain-only grant fails the send with
`AccessDeniedException ... not authorized to perform 'ses:SendEmail' on resource
...identity/<recipient>`, which is easy to misread as a verification problem.
Narrow that grant back to the sending domain once the account has production
access.

- [ ] `https://<domain>/api/health` returns `{"status":"ok", ...}`.
- [ ] The Board loads and pages.
- [ ] Sign-in sends a magic link through SES. In the sandbox, use a verified
      address; the link is single-use and returns to the staging hostname.
- [ ] First sign-in claims a handle and the session survives a reload.
- [ ] Upload a file, pick a Base model and one Challenger, schedule, and watch
      the Job update live with real provider tokens and latency.
- [ ] Publish, confirm the card appears on the Board, open it, annotate, reply
      and vote.
- [ ] SSE survives more than five minutes without client traffic, and the
      heartbeat is visible every 20 seconds:
      ```bash
      curl --max-time 330 -Ns https://<domain>/api/stream/board > /tmp/sse.txt || true
      grep -c ': ping' /tmp/sse.txt   # expect roughly 16
      ```
      The 4000-second ALB idle timeout is the backstop; the application
      heartbeat is the primary fix.
- [ ] Worker logs show jobs being consumed and no `assertProviderConfigured`
      failure.

If the health check fails, start with:

```bash
aws logs tail /aws/ecs/owm-staging/web --since 15m
aws logs tail /aws/ecs/owm-staging/worker --since 15m
aws ecs describe-services --cluster owm-staging-cluster \
  --services owm-staging-web owm-staging-worker
```

`/api/health` returns 503 only when Postgres is unreachable. Redis failure
reports `degraded` but stays 200, because Postgres is canonical and SSE falls
back to polling.

---

## 7. Operations

### Logs and metrics

```bash
aws logs tail /aws/ecs/owm-staging/web --follow
aws logs tail /aws/ecs/owm-staging/worker --follow
aws logs tail /aws/ecs/owm-staging/migrate --since 30m
```

CloudWatch metrics are the standard ECS/ALB/RDS/ElastiCache metrics. Container
Insights is **off** in staging to keep the cost down; ALB, ECS service and RDS
metrics are free.

### Alarms, budgets and the spend cap

`OwmStagingOps` creates one SNS topic (`<name>-alarms`) with an email
subscription to `OWM_ALARM_EMAIL`. Every alarm notifies that address on both
`ALARM` and `OK`:

| Alarm | Signal | Threshold |
|---|---|---|
| ALB 5xx | `HTTPCode_ELB_5XX_Count` sum over 5 min | ≥ 5 for 10 min |
| Target 5xx | `HTTPCode_Target_5XX_Count` sum over 5 min | ≥ 5 for 10 min |
| Unhealthy web tasks | `UnHealthyHostCount` maximum | ≥ 1 for 2 min |
| Worker stopped | ECS `RunningTaskCount` minimum | < 1 for 2 min |
| Queue depth | `OWM/Queue Depth` maximum | > 25 for 2 min |
| Job failure rate | `100 * Failed / Finished` over 15 min | > 20% |

The last two come from JSON lines the worker writes: one `{"metric":"queue",…}`
line per minute, and one `{"metric":"job","outcome":…}` line per settled Run.
CloudWatch Logs metric filters turn them into metrics, so the worker needs no
CloudWatch SDK or IAM permission. Confirm the filters after a release:

```bash
aws logs describe-metric-filters --log-group-name /aws/ecs/owm-staging/worker
aws cloudwatch get-metric-statistics --namespace OWM/Queue --metric-name Depth \
  --start-time "$(date -u -v-15M '+%Y-%m-%dT%H:%M:%SZ')" \
  --end-time "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
  --period 60 --statistics Maximum
```

**Infrastructure budget.** `OwmStagingOps` creates a monthly `COST` budget of
`OWM_MONTHLY_BUDGET_USD` (default 200) and notifies the alarm topic at 80% actual
and 100% forecasted. AWS Budgets only sees AWS charges.

**Provider spend cap.** Model spend is not an AWS charge, so the application
enforces its own ceiling. `MONTHLY_SPEND_CAP_USD` is passed to the worker;
`createComparison`, Add model and Retry refuse with `429 spend_cap_reached`
once the UTC-month sum of provider-reported `responses.cost_usd` reaches the
cap. `processRun` checks again before every provider call, so a Run queued
before the cap was hit fails without calling the provider. The cap resets on the
first day of the next UTC month; the 429 carries `Retry-After`.

```bash
# Current spend, from the database
psql "$DATABASE_URL" -c \
  "select coalesce(sum(cost_usd),0) from responses where finished_at >= date_trunc('month', now() at time zone 'utc');"
```

**Error tracker.** Set `OWM_SENTRY_DSN` to a Sentry-compatible project. The
worker reports every failed provider call with `responseId`, `jobId`,
`comparisonId`, `modelSlug`, `turnId`, `attempt`, tokens and latency; web 500s
are reported with the route's status and code. Secrets, provider keys and
database passwords are redacted before an event leaves the process. Without a
DSN the same structured `error.report` JSON is written to the log group.

### Continuous delivery (GitHub OIDC)

`.github/workflows/ci.yml` runs on every pull request and on `main`:

1. `pnpm typecheck`, `pnpm test` and `pnpm build` against Postgres 17 and Redis 7
   service containers (with `pnpm db:bootstrap`, so CI uses the real schema).
2. On `main` only, a second job assumes the staging deploy role with a GitHub
   OIDC token and runs `pnpm deploy:staging`.

No AWS access key is stored in GitHub. Create the role once:

```bash
export OWM_GITHUB_REPO=owner/openweightmodels
export OWM_GITHUB_BRANCH=main
pnpm deploy:ci
```

`pnpm deploy:ci` creates `OwmStagingCi` with the GitHub OIDC provider (or imports
one via `OWM_GITHUB_OIDC_PROVIDER_ARN`) and the `<name>-github-deploy` role. Its
trust policy is fenced to `repo:<owner>/<repo>:ref:refs/heads/<branch>` and
`repo:<owner>/<repo>:environment:staging`. The role has `AdministratorAccess`
because `cdk deploy` manages every staging resource; it exists only in the
staging account.

In GitHub, create an Environment named `staging` and set:

| Kind | Name | Value |
|---|---|---|
| variable | `AWS_DEPLOY_ROLE_ARN` | output of `pnpm deploy:ci` |
| variable | `AWS_REGION` | e.g. `eu-west-1` |
| variable | `OWM_DOMAIN_NAME` | staging hostname |
| variable | `OWM_HOSTED_ZONE_ID` / `OWM_HOSTED_ZONE_NAME` | Route 53 zone |
| variable | `OWM_ALARM_EMAIL` | alarm owner |
| variable | `OWM_MONTHLY_BUDGET_USD` / `OWM_MONTHLY_SPEND_CAP_USD` | ceilings |
| variable | `OWM_SES_IDENTITY`, `OWM_EMAIL_FROM`, `OWM_SIGNIN_ALLOWED_EMAILS` | mail and access |
| secret | `OWM_SENTRY_DSN` | error tracker |

Require reviewers on the `staging` environment if a deploy should need approval.

### Secrets

| Secret | Created by | Rotation |
|---|---|---|
| `owm-staging/database` | RDS, generated password | RDS rotation (`aws rds modify-db-instance --manage-master-user-password`); update is picked up by new tasks |
| `owm-staging/auth-secret` | CDK, generated | Rotating signs everyone out; update the secret, then force a new web deployment |
| `owm-staging/openrouter-api-key` | CDK, empty | Put the key after the first deploy; restart the worker service |

Never put a key in CDK context, `.env`, a task environment value or a commit.

### Recovering a failed first create

If a first create (`OwmStagingFoundation` or `OwmStagingApp`) fails,
CloudFormation usually leaves the stack in `ROLLBACK_COMPLETE`. `deploy.sh`
cannot update that stack, so delete it and wait before re-running:

```bash
STACK=OwmStagingApp   # or OwmStagingFoundation
aws cloudformation describe-stacks --stack-name "$STACK" \
  --query 'Stacks[0].StackStatus' --output text
aws cloudformation delete-stack --stack-name "$STACK"
aws cloudformation wait stack-delete-complete --stack-name "$STACK"
```

Deleting `OwmStagingApp` is safe: it holds only the ALB, listeners, DNS record,
ECS services and scaling targets. Images, task definitions, data and secrets
live in `OwmStagingFoundation` and are untouched.

The notes below only apply when `OwmStagingFoundation` itself has to be
recreated.

Secrets Manager schedules deleted secrets for a recovery window, which reserves
their names. If a subsequent create complains that a secret is already scheduled
for deletion, list and force-delete the staging secrets:

```bash
aws secretsmanager list-secrets \
  --query "SecretList[?starts_with(Name, 'owm-staging/')].Name" --output text
aws secretsmanager delete-secret --secret-id owm-staging/<name> \
  --force-delete-without-recovery
```

If ECR repositories survived the failure, delete them with `--force` before
re-running; otherwise `deploy.sh` sees them and skips the Foundation create:

```bash
aws ecr delete-repository --repository-name owm-staging-web --force
aws ecr delete-repository --repository-name owm-staging-worker --force
```

The `CDKToolkit` bootstrap stack is separate and should stay.

### Rollback

Application rollback is a task-definition rollback; the database is not rolled
back by CloudFormation.

```bash
# List previous revisions (newest first)
aws ecs list-task-definitions --family-prefix owm-staging-web --sort DESC

# Pin the service to a previous revision and wait
aws ecs update-service --cluster owm-staging-cluster \
  --service owm-staging-web \
  --task-definition arn:aws:ecs:<region>:<account>:task-definition/owm-staging-web:<n>
aws ecs wait services-stable --cluster owm-staging-cluster --services owm-staging-web
```

Do the same for `owm-staging-worker`. Images are kept in ECR by tag, so a
previous commit tag can be re-deployed with `IMAGE_TAG=<sha> pnpm deploy:staging`.
Migrations are forward-only: before a destructive migration, take an RDS
snapshot (`aws rds create-db-snapshot`) and restore to a new instance if the
rollback requires it. `infra/scripts/deploy.sh` never modifies data beyond the
idempotent registry upsert.

Rollback drill, in order:

1. Stop the bleeding: revert the offending commit on `main` and let CI deploy
   the previous code, or pin the ECS services to the prior task-definition
   revisions as above.
2. If the migration must be undone, restore the pre-release snapshot to a new
   RDS instance and repoint the app; do not hand-edit the schema. The migration
   is not reversible by `cdk deploy`.
3. If the release is unusable and the data is disposable (staging), delete
   `OwmStagingApp` and `OwmStagingOps`, fix forward, and redeploy.
4. Confirm the rollback with `/api/health`, a sign-in, one published Comparison
   and one settled Run; check `JobFailureRateAlarm` returned to `OK`.

### Cost

Approximate monthly floor for one staging environment in `eu-west-1`, 730
hours, before model spend and data transfer (Singapore and other regions vary
slightly):

| Item | Approx. USD/month |
|---|---|
| ALB | 18 + LCU |
| 2 web tasks (0.5 vCPU / 1 GiB ARM64) | 36 |
| 1 worker task (0.5 vCPU / 1 GiB ARM64) | 18 |
| NAT gateway (one) | 32 + data |
| RDS `db.t4g.micro`, 20 GB gp3, 7-day backups | 15 |
| ElastiCache `cache.t4g.micro` | 9 |
| ECR, CloudWatch Logs, SES | 3–8 |
| **Total** | **≈ 130–160 + model spend** |

Delete the environment with the same configuration exports still set:

```bash
pnpm --filter @owm/infra exec cdk destroy \
  OwmStagingOps OwmStagingApp OwmStagingFoundation
```

CDK needs to synthesize the app to destroy it, so keep `OWM_DOMAIN_NAME` and
the hosted-zone/certificate variables exported. The ECR repositories are
configured with `emptyOnDelete`, so the images pushed by a release do not block
deletion. RDS takes a final snapshot only if you enable one; staging is
configured to be disposable. The CDK bootstrap stack (`CDKToolkit`), the
Route 53 hosted zone and the domain registration are not part of either stack
and remain; delete the zone if you are not keeping the domain. Avoid leaving
the NAT gateway running when the environment is not in use.

---

## 8. Staging limitations

These are intentional:

- Single-AZ RDS, one NAT gateway, no deletion protection, no PITR beyond the
  seven-day automated backup window.
- SES sandbox: only verified recipients receive magic links until production
  access is granted.
- The deploy role is broad (`AdministratorAccess`) and staging-only; a shared
  production account should use a narrower permission set.
- No WAF or ALB edge rate limiting. Abuse controls are enforced in the app and
  Better Auth; a distributed source can still consume TLS and request capacity.
- The spend cap depends on provider-reported cost. A provider that omits usage
  in a streamed response contributes zero to the monthly sum; OpenRouter reports
  it today.
- Redis is a single node. Losing it loses BullMQ queue contents; Postgres still
  holds the Runs, but automatic re-enqueueing of stranded Runs is not
  implemented (BACKEND.md §5).
- The worker image ships TypeScript and `tsx` at runtime, which keeps releases
  simple but makes the image larger than a compiled worker would be.
- The ALB has no access logs; use ALB metrics and application logs.
