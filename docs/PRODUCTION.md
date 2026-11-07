# Production on AWS

Production runs the same code as staging in a **separate AWS account**. The CDK
stacks are `OwmProdFoundation`, `OwmProdApp`, `OwmProdOps` and `OwmProdCi`; the
resource prefix is `owm-prod`. The first release is invite-only.

The environment is selected explicitly:

```bash
OWM_ENVIRONMENT=production pnpm deploy:prod
```

`OWM_ENVIRONMENT=production` derives `OwmProd`/`owm-prod` and rejects a
mismatched `OWM_STACK_PREFIX`/`OWM_NAME_PREFIX`, so a production run cannot
update the staging stacks by accident. The release workflow sets the same
values for CI.

> **What this document covers:** the production topology, why the settings
> differ from staging, the first-deploy and release sequence, rollback,
> backup/restore, SES approval, cost and the known provisional choices.
> The step-by-step owner runbook is ticket 29; the interactive helper is
> `infra/scripts/prod-wizard.sh`.

---

## 1. Topology

```
Internet
   │  HTTPS 443 (HTTP 80 redirects)
   ▼
Application Load Balancer  ── deletion protection, access logs (90 days),
   │                          idle timeout 4000s, TLS 1.3-1.2 policy
   │  HTTP 3000
   ▼
ECS Fargate `owm-prod-web` (1 vCPU / 2 GiB, min 2, max 6, CPU target 60%)
   │                         │
   │                         └── SES v2 (task role, no SMTP secret)
   ├── RDS PostgreSQL 17 `db.t4g.small` Multi-AZ, 100→500 GB gp3
   └── ElastiCache Redis 7 `cache.t4g.small`, 2 nodes, automatic failover,
                                  Multi-AZ, TLS, noeviction
                                  ▲
ECS Fargate `owm-prod-worker` (1 vCPU / 2 GiB, min 1, max 4, CPU target 70%)
                                  │
                                  └── OpenRouter (key from Secrets Manager)
```

Stacks:

| Stack | Contents |
|---|---|
| `OwmProdFoundation` | VPC, NAT gateways, RDS, ElastiCache, ECR, secrets, SES, log groups, ECS cluster, task definitions |
| `OwmProdApp` | ALB, certificate, HTTPS listener, DNS, ECS services, autoscaling |
| `OwmProdOps` | SNS alarm topic, CloudWatch alarms, log metric filters, AWS budget |
| `OwmProdCi` | GitHub Actions OIDC deploy role (created once) |

Splitting foundation from app is what makes the migration-first release safe:
new task definitions are registered first, the migration task runs, then the
services roll (ADR 0007).

---

## 2. Settings and why

| Setting | Production | Why |
|---|---|---|
| AWS account | Separate from staging | Blast-radius isolation and independent budgets/quotas |
| Apex hostname | `openweightmodels.net` | The certificate and DNS live in the existing Route 53 zone |
| RDS instance | `db.t4g.small` (provisional) | Comfortable starting point; tune after a load test |
| RDS storage | 100 GB, autoscaling to 500 GB | Headroom without manual resize during a release |
| RDS Multi-AZ | On | Failover without a create-and-restore |
| RDS deletion protection | On | A stack delete cannot remove the database |
| RDS removal policy | `RETAIN` | Data outlives a failed CloudFormation stack |
| RDS backups | 14 days, not deleted with the instance | The rollback point for a destructive migration |
| Redis | 2 nodes, automatic failover, Multi-AZ | BullMQ must survive a node or AZ failure |
| NAT gateways | 2, one per AZ | No single-AZ egress dependency |
| ECR | `RETAIN`, no empty-on-delete | Image tags are the application rollback path |
| Logs | 90 days, `RETAIN` | Incident reconstruction and audit |
| Container Insights | Enabled | Task-level CPU/memory evidence during incidents |
| ALB deletion protection | On | A stack delete cannot remove the public entry point |
| ALB access logs | S3 bucket, 90-day lifecycle, `RETAIN` | Reconstruct requests after abuse or an incident report |
| Web/worker sizing | 1 vCPU / 2 GiB | Provisional; 0.5 vCPU is staging-only |
| Web count | 2 desired, 2–6 | Both AZs always serving |
| Worker count | 1 desired, 1–4 | At least one consumer is always running |
| Worker rollout | `minimumHealthyPercent: 100`, `maximumPercent: 200` | Staging's stop-then-start would stop the only consumer |
| SES grant | Narrowed to the sending identity after approval | Production recipients are not account identities |
| Search indexing | `ALLOW_SEARCH_INDEXING=false` | Invite-only launch; it is a build argument |
| Sentry environment | `production` | Filters production errors apart from staging |

Safety properties (Multi-AZ, retention policies, deletion protection, the
Redis topology, log retention, ALB protection) are **not** overridable through
context. Sizing and counts are: see `prod.env.example` for
`OWM_WEB_*`, `OWM_WORKER_*`, `OWM_DB_*`, `OWM_CACHE_NODE_TYPE` and
`OWM_NAT_GATEWAYS`.

**WAF is deliberately deferred.** The invite-only launch relies on the
application and Better Auth rate limits. Add WAF or ALB edge rate limiting
before opening the site to the public, when the traffic shape is known.

---

## 3. First deployment

The owner runbook with every command and checkpoint is ticket 29. The
interactive helper walks the same steps:

```bash
bash infra/scripts/prod-wizard.sh --check   # read-only prerequisite check
bash infra/scripts/prod-wizard.sh           # checkpointed owner wizard
```

`--check` verifies tools, the AWS identity, `prod.env`, the CDK bootstrap, the
stacks, the provider key, SES production access and the GitHub environment
without changing anything. The wizard keeps its place in
`.prod-wizard-state` and can resume with `--from N`.

Manually, the sequence is:

1. Confirm the production AWS account (never the staging account), the
   `openweightmodels.net` hosted zone and SES production access.
2. Copy `prod.env.example` to `prod.env`, fill it in and `source prod.env`.
3. Bootstrap CDK once in the account/region.
4. `pnpm deploy:prod`. This creates `OwmProdFoundation`, builds and pushes the
   ARM64 web and worker images, then stops at the empty provider-key guard.
5. Put the OpenRouter key into Secrets Manager. Never put it in a file, a
   shell history or the repository.
6. `pnpm deploy:prod` again. Once the foundation already exists, the release
   takes a pre-migration snapshot, runs the migration/bootstrap task, creates
   `OwmProdApp` and `OwmProdOps`, pins both services and checks
   `https://openweightmodels.net/api/health`.
7. Create `OwmProdCi` with `OWM_ENVIRONMENT=production pnpm deploy:ci` and add
   the variables/secrets to the GitHub `production` environment. See §6.
8. Tag a commit that has passed staging:

   ```bash
   git checkout main
   git pull
   git tag v0.1.0
   git push origin v0.1.0
   ```

The first create takes 30–60 minutes and starts billing immediately.

---

## 4. Release process

Production releases are **tag-gated** and environment-gated:

```
push v* tag ─▶ verify (same reusable workflow as main)
             ─▶ GitHub `production` environment review
             ─▶ OIDC role owm-prod-github-deploy
             ─▶ pnpm deploy:prod
```

`.github/workflows/deploy-production.yml` checks out full history, fetches
`origin/main` and fails unless the tagged commit is an ancestor of `main`. A
tag on a side branch cannot deploy. The concurrency group
`deploy-production` never cancels an in-flight release.

The workflow rebuilds the images from the tagged commit with production build
arguments. It does **not** copy staging's image bytes: the accounts have
separate ECR registries and `ALLOW_SEARCH_INDEXING` is baked at build time.
Same commit, production build.

The release order is fixed:

1. Push the images (or verify they exist with `SKIP_BUILD=1`).
2. Deploy `OwmProdFoundation` → new task-definition revisions.
3. Check the provider key.
4. Take an RDS snapshot and abort if it fails.
5. Run the migration task; abort before any service update if it exits
   non-zero.
6. Deploy `OwmProdApp`, then `OwmProdOps`.
7. Pin both services to the new revisions and wait for `services-stable`.
8. Request `/api/health`.

Hotfix/redeploy of an existing tag:

```bash
IMAGE_TAG=<sha> SKIP_BUILD=1 pnpm deploy:prod
```

That path verifies the tag exists in both production ECR repositories before
skipping the build. It is not the normal release path.

---

## 5. Rollback, backup and restore

**Application rollback** is a task-definition rollback:

```bash
aws ecs list-task-definitions --family-prefix owm-prod-web --sort DESC
aws ecs update-service --cluster owm-prod-cluster --service owm-prod-web \
  --task-definition <previous-revision-arn>
aws ecs wait services-stable --cluster owm-prod-cluster --services owm-prod-web
```

Do the same for `owm-prod-worker`. Images are retained in ECR by tag, so
`IMAGE_TAG=<sha> SKIP_BUILD=1 pnpm deploy:prod` is the other way back.

**Migrations are forward-only.** The release snapshot named
`owm-prod-pre-<tag>-<UTC timestamp>` is the rollback point for a destructive
migration. Restore it to a new RDS instance and repoint the app; do not
hand-edit the schema. `SKIP_SNAPSHOT=1` exists only for a deliberately
snapshot-free restart.

Because production uses `RemovalPolicy.RETAIN` and deletion protection, a
failed update should be fixed forward. Do not delete `OwmProdFoundation` once
it holds real data.

Restore drill (owner work, run at least once before launch):

1. Restore the chosen snapshot to a new instance:
   ```bash
   aws rds restore-db-instance-from-db-snapshot \
     --db-instance-identifier owm-prod-restore-drill \
     --db-snapshot-identifier <snapshot-id> \
     --db-instance-class db.t4g.small \
     --no-publicly-accessible
   ```
2. Point a temporary task or bastion at it and run
   `select count(*)` over the content tables and `pnpm db:bootstrap`.
3. Confirm the schema and Model registry are intact, then delete the drill
   instance.

Rotate the provider key by putting a new value in the Secrets Manager secret
and forcing a new worker deployment. Rotating `owm-prod/auth-secret` signs
everyone out.

---

## 6. GitHub `production` environment

Create **Settings → Environments → `production`** with:

- required reviewers (at least the owner);
- deployment branches and tags restricted to `main` and `v*`.

Variables (environment, not repository):

| Variable | Value |
|---|---|
| `AWS_DEPLOY_ROLE_ARN` | output of `pnpm deploy:ci` |
| `AWS_REGION` | e.g. `ap-southeast-1` |
| `OWM_DOMAIN_NAME` | `openweightmodels.net` |
| `OWM_HOSTED_ZONE_ID` / `OWM_HOSTED_ZONE_NAME` | Route 53 zone |
| `OWM_SES_IDENTITY` / `OWM_EMAIL_FROM` | verified sender |
| `OWM_ALARM_EMAIL` | alarm owner |
| `OWM_MONTHLY_BUDGET_USD` / `OWM_MONTHLY_SPEND_CAP_USD` | ceilings |
| `OWM_SIGNIN_ALLOWED_EMAILS` | invite list |
| `OWM_ALLOW_SEARCH_INDEXING` | `false` until public launch |
| `OWM_SES_PRODUCTION_ACCESS` | `false` until SES approval |
| `OWM_STACK_PREFIX` / `OWM_NAME_PREFIX` | `OwmProd` / `owm-prod` |

Secret: `OWM_SENTRY_DSN`. No AWS access key is stored.

`OwmProdCi` trusts **only**
`repo:<owner>/<repo>:environment:production`. There is no branch subject, so a
push to `main` cannot assume the production role. The role still has
`AdministratorAccess`; narrow it once the deploy surface settles.

---

## 7. SES approval

SES identities and production access are **regional**. Request production
access in the production account and deployment region early; approval takes
days. While the account is in the sandbox:

- only verified recipient addresses receive magic links;
- the web task keeps the `identity/*` send grant, because SES authorises the
  sender *and* every recipient that is a verified identity;
- `OWM_SES_PRODUCTION_ACCESS=false`.

After approval, set `OWM_SES_PRODUCTION_ACCESS=true`, release once so the grant
narrows to the sending identity, and keep the GitHub variable in sync:

```bash
gh variable set OWM_SES_PRODUCTION_ACCESS --env production --body true
```

---

## 8. Cost

Approximate monthly floor for production in `ap-southeast-1`, before model
spend and data transfer:

| Item | Approx. USD/month |
|---|---|
| ALB + LCU | 20–30 |
| 2 web + 1 worker at 1 vCPU / 2 GiB ARM64 | 140 |
| 2 NAT gateways | 64 + data |
| RDS `db.t4g.small` Multi-AZ, 100 GB gp3, 14-day backups | 60–80 |
| ElastiCache 2 × `cache.t4g.small` | 30–40 |
| ECR, CloudWatch Logs (90 days), S3 access logs, SES | 10–20 |
| **Total** | **≈ 300–380 + model spend** |

Keeping staging adds roughly **$130–160**. Production sizing is provisional:
`docs/DECISIONS.md` decision 32 is still open. Raise counts and instance sizes
after a load test rather than guessing.

---

## 9. Launch checklist

- [ ] SES production access is true and DKIM verifies.
- [ ] `https://openweightmodels.net/api/health` returns 200.
- [ ] An invited address receives a magic link; a non-invited address is
      refused.
- [ ] The Board, a published Comparison, an annotation, a reply and a vote
      work against production.
- [ ] SSE survives five minutes with heartbeats.
- [ ] A worker Run completes with real provider tokens and latency.
- [ ] Alarms, the SNS subscription and the budget exist; one alarm reaches the
      owner; the release snapshot exists.
- [ ] A `v*` tag deploy through CI succeeds with no stored AWS key.
- [ ] The rollback drill above has been tried once.
- [ ] Content import (optional) is done as ticket 29 Step 13; after it, staging
      is test-only.
- [ ] Keep `OWM_ALLOW_SEARCH_INDEXING=false` until the public launch. Before
      going public: rebuild with `true`, remove the allowlist, confirm SES
      access, and consider WAF plus narrowing the deploy role.
