# Deploying staging on AWS

Staging runs the same two-container topology as local development on AWS:
Next.js and the BullMQ worker as separate ECS Fargate services behind an
Application Load Balancer, with RDS PostgreSQL, a node-based ElastiCache Redis,
SES for magic links, ECR for images, Secrets Manager for credentials and
CloudWatch Logs. The infrastructure is AWS CDK in TypeScript under `infra/`
(ADR 0006).

> **What this document does not cover:** CI/CD with GitHub OIDC, budgets,
> alarms, rate limits at the edge and an error tracker. Those are ticket 16.
> This stack deliberately has no long-lived AWS access keys in the repository.

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
| CDK stacks | `OwmStagingFoundation` and `OwmStagingApp` | Task definitions can be registered without rolling services; migrations run between the two (see §5) |
| Network | 2 AZs, public subnets for the ALB, private subnets with one NAT gateway | One NAT is the cheap staging choice; production should use one per AZ |
| Web / worker | 0.5 vCPU / 1 GiB, ARM64 (Graviton) | Cheaper Fargate sizing for this load; images are built `linux/arm64` |
| Postgres | 20 GB gp3, encrypted, 7-day backups, single-AZ, `db.t4g.micro` | Disposable staging data; deletion protection is off so the stack can be torn down |
| Redis | One node, cluster mode off, `maxmemory-policy=noeviction`, in-transit TLS | BullMQ does not support ElastiCache Serverless and must not evict queue data |
| Images | Two ECR repositories, scan on push, untagged images expire after 14 days | Separate web and worker images |
| Secrets | RDS-generated master secret, generated Better Auth secret, empty OpenRouter secret | Injected with ECS `secrets`, never as plain task environment |
| Mail | SES identity for the domain (or a verified address) | The web task role has `ses:SendEmail`; no SMTP credentials exist |
| Logs | `/aws/ecs/owm-staging/{web,worker,migrate}`, 30 days | `aws logs tail` is the first diagnostic |

The web task has no provider key, and the worker has no auth secret. The
postgres password is assembled into a connection URL inside the process so it
never appears in a task definition environment value.

---

## 2. Prerequisites

- An AWS account and a region (the examples use `eu-west-1`).
- A hostname you control, e.g. `staging.openweightmodels.com`, plus either:
  - the Route 53 hosted zone ID for the parent domain — CDK creates the ACM
    certificate with DNS validation, the ALB alias record and SES DKIM records;
  - or an already-issued ACM certificate ARN in the same region. You then point
    DNS at the ALB yourself.
- SES: the account may still be in the sandbox. In staging, magic links only
  reach **verified** addresses until production access is granted. When
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
| `OWM_HOSTED_ZONE_ID` | one of | — | Route 53 zone for certificate, DNS and DKIM |
| `OWM_HOSTED_ZONE_NAME` | no | `OWM_DOMAIN_NAME` | Zone name when the zone is a parent, e.g. `example.com` for `staging.example.com` |
| `OWM_CERTIFICATE_ARN` | one of | — | Existing ACM certificate in the same region |
| `OWM_SES_IDENTITY` | no | domain | Verified SES domain or email address |
| `OWM_EMAIL_FROM` | no | `OpenWeightModels <no-reply@domain>` | Magic-link sender |
| `OWM_PROVIDER` | no | `openrouter` | `mock` for an infrastructure-only smoke test |
| `OWM_STACK_PREFIX` | no | `OwmStaging` | CloudFormation stack prefix |
| `OWM_NAME_PREFIX` | no | `owm-staging` | ECR, ECS and resource prefix |
| `IMAGE_TAG` | no | current git commit | Image tag and task-definition revision |
| `PLATFORM` | no | `linux/arm64` | Docker build platform |
| `SKIP_SMOKE` | no | unset | Set to `1` to skip the post-deploy health request |

To see the templates without AWS credentials:

```bash
pnpm cdk:synth -c domainName=staging.example.com -c hostedZoneId=Z0123456789
```

The two stacks are emitted into `infra/cdk.out` (gitignored).

---

## 4. First deployment

```bash
export AWS_REGION=eu-west-1
export OWM_DOMAIN_NAME=staging.openweightmodels.com
export OWM_HOSTED_ZONE_ID=Z0123456789
export OWM_HOSTED_ZONE_NAME=openweightmodels.com
export OWM_SES_IDENTITY=openweightmodels.com
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
   empty. Set it once:
   ```bash
   SECRET_ARN=$(aws cloudformation describe-stacks \
     --stack-name OwmStagingFoundation \
     --query "Stacks[0].Outputs[?OutputKey=='ProviderKeySecretArn'].OutputValue" \
     --output text)
   aws secretsmanager put-secret-value \
     --secret-id "$SECRET_ARN" \
     --secret-string 'sk-or-...'
   ```
   Re-run `pnpm deploy:staging` afterwards.
6. Runs the migration/bootstrap task in the private subnets and waits for it to
   exit 0.
7. Creates `OwmStagingApp`: HTTPS listener, HTTP redirect, DNS record, target
   group and the two ECS services.
8. Pins each service to the newest task-definition revision and forces a new
   deployment, then waits for `services-stable`.
9. Requests `https://<domain>/api/health` until it returns 200.

### What the migration task does

`packages/core/src/db/bootstrap.ts` applies the Drizzle migrations and upserts
the curated Model registry in `packages/core/src/model-registry.ts`. It does
**not** create users, Comparisons or any other development content. It is
idempotent and preserves an Admin's `enabled = false` on a Model.

---

## 5. Release sequence

`pnpm deploy:staging` is the release command. It deliberately splits the
deployment so schema changes land before new application code serves traffic:

1. Push new images.
2. Deploy `OwmStagingFoundation` → registers new task-definition revisions.
3. Run the migration task from the new worker image, wait for the exit code.
4. Deploy `OwmStagingApp` (usually a no-op after the first release).
5. Update `owm-staging-web` and `owm-staging-worker` to the new revision with
   `--force-new-deployment`, then wait for both services to be stable.

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
the worker):

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
      curl --max-time 330 -Ns https://<domain>/api/stream/board > /tmp/sse.txt
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
metrics are free. Alarms and a named owner are ticket 16.

### Secrets

| Secret | Created by | Rotation |
|---|---|---|
| `owm-staging/database` | RDS, generated password | RDS rotation (`aws rds modify-db-instance --manage-master-user-password`); update is picked up by new tasks |
| `owm-staging/auth-secret` | CDK, generated | Rotating signs everyone out; update the secret, then force a new web deployment |
| `owm-staging/openrouter-api-key` | CDK, empty | Put the key after the first deploy; restart the worker service |

Never put a key in CDK context, `.env`, a task environment value or a commit.

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

### Cost

Approximate monthly floor for one staging environment in `eu-west-1`, 730
hours, before model spend and data transfer:

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

Delete the environment with `cdk destroy OwmStagingApp OwmStagingFoundation`
(RDS takes a final snapshot only if you enable one; staging is configured to be
disposable). Avoid leaving the NAT gateway running when the environment is not
in use.

---

## 8. Staging limitations

These are intentional or owned by ticket 16:

- Single-AZ RDS, one NAT gateway, no deletion protection, no PITR beyond the
  seven-day automated backup window.
- SES sandbox: only verified recipients receive magic links until production
  access is granted.
- No CI/CD, GitHub OIDC, budget alarms, CloudWatch alarms, WAF or error
  tracker yet.
- Redis is a single node. Losing it loses BullMQ queue contents; Postgres still
  holds the Runs, but automatic re-enqueueing of stranded Runs is not
  implemented (BACKEND.md §5).
- The worker image ships TypeScript and `tsx` at runtime, which keeps releases
  simple but makes the image larger than a compiled worker would be.
- The ALB has no access logs; use ALB metrics and application logs.
