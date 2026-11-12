# 29: Create and verify the production environment

**What to build:** Stand up `OwmProdFoundation`, `OwmProdApp`, `OwmProdOps` and `OwmProdCi` in the production AWS account using the profile and pipeline from ticket 28, configure the GitHub `production` environment, verify the full product path with invited users, and optionally import the staging content once.

**Blocked by:** 28 — Add the production profile and release pipeline.

**Status:** ready-for-human

## How to use this ticket

Work top to bottom. Every step has a command, the expected result, and a **Checkpoint**. Do not continue past a checkpoint that does not match. In an agent session, say "run ticket 29" and paste each checkpoint output; the agent should execute the command and wait for your confirmation before the next step.

Steps marked **👤** are yours alone: AWS console decisions, DNS, approvals, GitHub settings, or a secret you must type.

## Before you start

- [ ] **Production AWS account** exists, with an IAM identity that can create VPC, RDS, ElastiCache, ECS, ECR, ALB, Route 53, ACM, SES, Secrets Manager, CloudWatch, IAM, S3 and Budgets resources.
- [ ] **Region chosen**; every resource, the SES identity and the ACM certificate must be in it. The examples use `ap-southeast-1`.
- [ ] **👤 SES production access requested** in that account and region. Do this first; approval takes days. Until it is granted, only verified recipient addresses receive magic links. Console: SES → Account dashboard → Request production access.
- [ ] **Route 53 hosted zone** for `openweightmodels.net` exists and the registrar delegates to it. Apex is the production hostname.
- [ ] **OpenRouter API key** ready. Do not put it in a file, shell history or the repository.
- [ ] **Sentry DSN** ready (optional but recommended). Without it, errors go to structured CloudWatch logs.
- [ ] **GitHub admin** on `xiaogit00/openweightmodels`, so you can create the `production` environment, required reviewers and environment variables.
- [ ] `pnpm install`, Docker with Buildx, AWS CLI v2 and `gh` are available locally.

## Inputs

`prod.env.example` from ticket 28 is the template. Copy it to `prod.env` (gitignored), fill it in, then run `source prod.env`. The wizard does the same thing interactively.

```bash
export AWS_REGION=ap-southeast-1
export OWM_ENVIRONMENT=production
export OWM_STACK_PREFIX=OwmProd
export OWM_NAME_PREFIX=owm-prod

export OWM_DOMAIN_NAME=openweightmodels.net
export OWM_HOSTED_ZONE_ID=Z...
export OWM_HOSTED_ZONE_NAME=openweightmodels.net
export OWM_SES_IDENTITY=openweightmodels.net
export OWM_EMAIL_FROM='OpenWeightModels <no-reply@openweightmodels.net>'

export OWM_SIGNIN_ALLOWED_EMAILS='you@example.com,@partner.example'
export OWM_ALARM_EMAIL=you@example.com
export OWM_MONTHLY_BUDGET_USD=400
export OWM_MONTHLY_SPEND_CAP_USD=100

export OWM_ALLOW_SEARCH_INDEXING=false
export OWM_SES_PRODUCTION_ACCESS=true    # false only while SES is still in the sandbox
export OWM_GITHUB_REPO=xiaogit00/openweightmodels
export OWM_GITHUB_BRANCH=main
export OWM_GITHUB_ENVIRONMENT=production
```

Keep `OWM_ALLOW_SEARCH_INDEXING=false` while the site is invite-only. It is a build argument; flipping it later needs a new image and a release.

## Step 0 — 👤 confirm SES production access

```bash
aws sesv2 get-account --region "$AWS_REGION" \
  --query '{ProductionAccessEnabled:ProductionAccessEnabled,SendingEnabled:SendingEnabled}'
```

**Checkpoint:** `ProductionAccessEnabled: true`. If false, request access and wait before inviting real users. You can still create the environment while waiting, but only verified recipient addresses will receive magic links; leave `OWM_SES_PRODUCTION_ACCESS=false` until approval, then flip it in Step 8.

## Step 1 — confirm the account

```bash
aws sts get-caller-identity
```

**Checkpoint:** the `Account` is the production account, **not** the staging account. If it is the staging account, stop; do not create production resources there.

## Step 2 — confirm DNS

```bash
aws route53 list-hosted-zones-by-name --dns-name openweightmodels.net \
  --query 'HostedZones[].{Id:Id,Name:Name}' --output table
```

**Checkpoint:** exactly one zone named `openweightmodels.net.` and its ID matches `OWM_HOSTED_ZONE_ID` (without the `/hostedzone/` prefix).

## Step 3 — fill in and source the inputs

Copy `prod.env.example` to `prod.env`, fill in the values above, then:

```bash
source prod.env
echo "$OWM_ENVIRONMENT $OWM_STACK_PREFIX $OWM_DOMAIN_NAME"
```

**Checkpoint:** `production OwmProd openweightmodels.net`.

## Step 4 — bootstrap CDK

```bash
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
pnpm --filter @owm/infra exec cdk bootstrap "aws://$ACCOUNT/$AWS_REGION"
```

**Checkpoint:** the `CDKToolkit` stack reaches `CREATE_COMPLETE` (or already exists). This is once per account/region.

## Step 5 — first release (expect it to stop at the provider key)

```bash
pnpm deploy:prod
```

Expected sequence: creates `OwmProdFoundation` (VPC, RDS, Redis, ECR, secrets, SES, log groups, cluster, task definitions), builds and pushes the ARM64 web and worker images to the production ECR, then **stops** with:

```
The provider key secret is empty. Set it before releasing:
```

This is the guardrail, not a failure. The foundation and images are created; no service is running yet.

**Checkpoint:** the message above. The first create takes 30–60 minutes; billing starts now. If it fails, use the recovery section below before re-running.

## Step 6 — 👤 set the OpenRouter key

Do not paste the key into a command line or a file. Use a hidden prompt:

```bash
SECRET_ARN="$(aws cloudformation describe-stacks \
  --stack-name OwmProdFoundation \
  --query "Stacks[0].Outputs[?OutputKey=='ProviderKeySecretArn'].OutputValue" \
  --output text)"

read -rs OR_KEY
aws secretsmanager put-secret-value --secret-id "$SECRET_ARN" --secret-string "$OR_KEY"
unset OR_KEY
```

**Checkpoint:** the secret has a version. Confirm without printing it:

```bash
aws secretsmanager describe-secret --secret-id "$SECRET_ARN" \
  --query '{Name:Name,LastChanged:LastChangedDate,Version:VersionIdsToStages}' --output json
```

## Step 7 — complete the release

```bash
pnpm deploy:prod
```

Expected: Foundation redeployed with the image tags, a pre-migration RDS snapshot if the database already has history, the migration/bootstrap task exits 0, `OwmProdApp` and `OwmProdOps` are created, both services pin to the new revision, and `https://openweightmodels.net/api/health` returns 200.

**Checkpoint:** health passes. If the migration task exits non-zero, the release stops before rolling services; read:

```bash
aws logs tail /aws/ecs/owm-prod/migrate --since 30m
```

## Step 8 — verify SES and sign-in

```bash
aws sesv2 get-email-identity --email-identity "$OWM_SES_IDENTITY" --region "$AWS_REGION" \
  --query '{Verified:VerifiedForSendingStatus,Dkim:DkimAttributes.Status}'
```

**Checkpoint:** `Verified: true`, `Dkim: SUCCESS`. DKIM can take minutes.

Open `https://openweightmodels.net`, sign in with an address in `OWM_SIGNIN_ALLOWED_EMAILS`, claim a handle, and confirm the session survives a reload.

**Checkpoint:** the magic link arrives, onboarding completes, and a non-allowlisted address is refused.

If you launched while the account was still in the sandbox and approval has since arrived, flip the config from ticket 28 and release:

```bash
export OWM_SES_PRODUCTION_ACCESS=true
pnpm deploy:prod
```

For CI, also set the variable so later releases keep the narrowed grant:

```bash
gh variable set OWM_SES_PRODUCTION_ACCESS --env production --body "true"
```

## Step 9 — create the production OIDC role

`prod.env` already carries the environment, prefixes and GitHub values. Re-source it, then run the CI bootstrap:

```bash
source prod.env
echo "$OWM_ENVIRONMENT $OWM_STACK_PREFIX $OWM_GITHUB_ENVIRONMENT"
pnpm deploy:ci
```

**Checkpoint before running:** the line prints `production OwmProd production`.

Expected output: `OwmProdCi` created and the role ARN printed. It is `arn:aws:iam::<prod-account>:role/owm-prod-github-deploy`.

**Checkpoint:** copy the ARN. Confirm its trust policy allows only the `production` environment subject:

```bash
ROLE_ARN="$(aws cloudformation describe-stacks --stack-name OwmProdCi \
  --query "Stacks[0].Outputs[?OutputKey=='DeployRoleArn'].OutputValue" --output text)"
aws iam get-role --role-name owm-prod-github-deploy \
  --query 'Role.AssumeRolePolicyDocument' --output json
```

It must contain `repo:...:environment:production` and must not contain a branch subject.

## Step 10 — 👤 configure the GitHub `production` environment

In GitHub: **Settings → Environments → New environment → `production`**.

- [ ] Add **required reviewers** (at least you, ideally one other person).
- [ ] Restrict deployment branches and tags to `main` and `v*` tags.
- [ ] Add the variables below. Use environment variables, not repository variables: the workflow resolves `vars.*` against the `production` environment when `environment: production` is set.

```bash
gh variable set AWS_DEPLOY_ROLE_ARN --env production --body "$ROLE_ARN"
gh variable set AWS_REGION --env production --body "$AWS_REGION"
gh variable set OWM_DOMAIN_NAME --env production --body "$OWM_DOMAIN_NAME"
gh variable set OWM_HOSTED_ZONE_ID --env production --body "$OWM_HOSTED_ZONE_ID"
gh variable set OWM_HOSTED_ZONE_NAME --env production --body "$OWM_HOSTED_ZONE_NAME"
gh variable set OWM_SES_IDENTITY --env production --body "$OWM_SES_IDENTITY"
gh variable set OWM_EMAIL_FROM --env production --body "$OWM_EMAIL_FROM"
gh variable set OWM_ALARM_EMAIL --env production --body "$OWM_ALARM_EMAIL"
gh variable set OWM_MONTHLY_BUDGET_USD --env production --body "$OWM_MONTHLY_BUDGET_USD"
gh variable set OWM_MONTHLY_SPEND_CAP_USD --env production --body "$OWM_MONTHLY_SPEND_CAP_USD"
gh variable set OWM_SIGNIN_ALLOWED_EMAILS --env production --body "$OWM_SIGNIN_ALLOWED_EMAILS"
gh variable set OWM_ALLOW_SEARCH_INDEXING --env production --body "false"
gh variable set OWM_SES_PRODUCTION_ACCESS --env production --body "$OWM_SES_PRODUCTION_ACCESS"
gh variable set OWM_STACK_PREFIX --env production --body "OwmProd"
gh variable set OWM_NAME_PREFIX --env production --body "owm-prod"
```

Sentry DSN as a secret, not a variable:

```bash
gh secret set OWM_SENTRY_DSN --env production
```

**Checkpoint:** `gh variable list --env production` shows them; `gh secret list --env production` shows `OWM_SENTRY_DSN` and no AWS access key. The role trust does not need an AWS key.

## Step 11 — first CI release

The workflow from ticket 28 triggers on a `v*` tag whose commit is on `main`.

```bash
git checkout main
git pull
git tag v0.1.0
git push origin v0.1.0
gh run watch
```

Expected: the reusable verify job runs, the `production` environment waits for review, then the deploy job assumes the OIDC role and runs `pnpm deploy:prod`. The image tag is `github.sha`, the same commit that staging should have verified.

**Checkpoint:** the run is green, the approval was required, and the ECS services are stable. Do not tag a commit that has not passed staging.

## Step 12 — verify the product

Run through `docs/DEPLOYMENT.md` §6 against `https://openweightmodels.net`, not staging.

- [ ] `/api/health` returns `{"status":"ok", ...}`.
- [ ] The Board loads and pages.
- [ ] Sign-in sends a magic link; onboarding claims a handle.
- [ ] Upload a markdown file, pick a Base model and one Challenger, schedule it, and watch the Job update live.
- [ ] Publish; the card appears on the Board; open it, annotate, reply and vote.
- [ ] SSE survives five minutes and the heartbeat is visible every ~20 seconds:
  ```bash
  curl --max-time 330 -Ns https://openweightmodels.net/api/stream/board > /tmp/sse-prod.txt || true
  grep -c ': ping' /tmp/sse-prod.txt   # expect roughly 16
  ```
- [ ] Worker logs show consumed jobs and no provider-configuration failure:
  ```bash
  aws logs tail /aws/ecs/owm-prod/worker --since 15m
  ```
- [ ] CloudWatch alarms exist under the `owm-prod` prefix and the budget is visible:
  ```bash
  aws cloudwatch describe-alarms --alarm-name-prefix owm-prod
  aws budgets describe-budgets --account-id "$ACCOUNT"
  ```
- [ ] Trip one alarm (or use `set-alarm-state`) and confirm the email reaches `OWM_ALARM_EMAIL`.
- [ ] Confirm an RDS snapshot exists from the release, and try the rollback drill:
  ```bash
  aws ecs list-task-definitions --family-prefix owm-prod-web --sort DESC
  aws ecs update-service --cluster owm-prod-cluster --service owm-prod-web \
    --task-definition <previous-revision-arn>
  aws ecs wait services-stable --cluster owm-prod-cluster --services owm-prod-web
  # then pin back to the newest revision
  ```

**Checkpoint:** every box above is true, or the failure is written down as a follow-up.

## Step 13 (optional) — import the staging content

Do this only if the staging content is meant to survive. After it, staging is test-only.

1. Freeze writes: stop the staging worker and let in-flight Jobs settle. Do not run `pnpm db:seed` against staging — it truncates every content table (`packages/core/src/seed.ts:339-343`).
2. Dump from staging. Both databases are private, so use an in-VPC one-off ECS task or a temporary bastion with SSM; CloudShell cannot reach RDS. Use:
   ```bash
   pg_dump --no-owner --no-privileges --format=custom "$STAGING_DATABASE_URL" > owm-staging.dump
   ```
   Move the dump through S3 if the two accounts are separate.
3. Stop the production web and worker services (scale both to 0) so nothing writes during the restore. Production already has the schema and model rows from Step 7, so replace the public schema with the dump rather than layering it:
   ```bash
   psql "$PROD_DATABASE_URL" -c 'drop schema public cascade; create schema public;'
   pg_restore --no-owner --no-privileges --dbname "$PROD_DATABASE_URL" owm-staging.dump
   ```
   If production already holds real content, do not drop it; copy table groups in dependency order and reconcile the `models` table explicitly. The full-dump path above is for a cutover before the first real users.
4. Run the migrations and registry sync in production:
   ```bash
   pnpm db:bootstrap
   ```
   This is safe after the restore: the dump already contains staging's `models` rows, and the registry upserts by slug, preserving their IDs. It applies any migrations newer than staging without creating a second set of model IDs.
5. Scale the production services back up, or roll them through the normal release:
   ```bash
   pnpm deploy:prod
   ```
6. Truncate the auth tables so nobody carries a stale session or magic-link token:
   ```sql
   truncate auth_sessions, auth_verifications;
   ```
7. Verify:
   ```sql
   select 'users' as table, count(*) from users
   union all select 'comparisons', count(*) from comparisons
   union all select 'responses', count(*) from responses
   union all select 'annotations', count(*) from annotations
   union all select 'comments', count(*) from comments;
   ```
   - Every published Comparison has exactly one base Response.
   - Every `responses.model_id`, `comparisons.base_model_id` and `comments.about_model_id` resolves to a row in `models`. The full-dump path above replaces production's separately bootstrapped `models` rows with staging's, so the IDs line up. If you ever do a content-only copy instead, reconcile the `models` table by slug first; model IDs are generated per bootstrap (`packages/core/src/model-registry.ts:480-482`).
   - Spot-check an annotation with CJK or emoji; offsets are UTF-16 code units (ADR 0003), so do not validate them with Postgres `length()`.
   - One imported user can sign in with a magic link and see their Comparison.
8. Keep the dump in a secure, access-controlled bucket until you are satisfied, then delete it.

**Checkpoint:** counts match staging, model references resolve, sign-in works, and an imported annotation renders in place.

## Step 14 — 👤 invite the first users

- [ ] Set `OWM_SIGNIN_ALLOWED_EMAILS` to the invite list and release if it changed.
- [ ] Tell invitees their staging handles and content moved (if Step 13 ran) and that they need a fresh magic link.
- [ ] Keep `OWM_ALLOW_SEARCH_INDEXING=false` until the public launch.
- [ ] Before going public: set it to `true`, rebuild and release; remove the allowlist; confirm SES production access; consider WAF and the narrowing of the deploy role.

## Failure recovery

The first create leaves a failed stack in `ROLLBACK_COMPLETE`. `deploy.sh` cannot update it, so delete it before re-running:

```bash
STACK=OwmProdApp   # or OwmProdFoundation
aws cloudformation describe-stacks --stack-name "$STACK" \
  --query 'Stacks[0].StackStatus' --output text
aws cloudformation delete-stack --stack-name "$STACK"
aws cloudformation wait stack-delete-complete --stack-name "$STACK"
```

Deleting `OwmProdApp` is safe: it holds only the ALB, listeners, DNS record, ECS services and scaling targets. Images, task definitions, data and secrets live in `OwmProdFoundation`.

If `OwmProdFoundation` itself must be recreated, secrets scheduled for deletion reserve their names. List and force-delete the `owm-prod/*` secrets, and delete the production ECR repositories with `--force` before re-running. The `CDKToolkit` bootstrap stack is separate and stays.

Once production holds real content, `deletionProtection` is on and `RemovalPolicy.RETAIN` applies. A failed update should be fixed forward, not by deleting the stack; take a snapshot first.

## Acceptance criteria

- [ ] `OwmProdFoundation`, `OwmProdApp` and `OwmProdOps` exist in the production account and region.
- [ ] `https://openweightmodels.net` serves over HTTPS with a valid certificate.
- [ ] SES is verified and production access is granted; an invited address receives a magic link.
- [ ] A real OpenRouter Run completes with non-mock tokens and latency; a Comparison publishes; an annotation renders.
- [ ] SSE survives five minutes with heartbeats.
- [ ] Alarms, the SNS owner subscription and the budget exist; one alarm reaches the owner.
- [ ] `OwmProdCi` exists and its trust allows only `environment:production`.
- [ ] The GitHub `production` environment requires reviewers and holds the variables/secrets listed above.
- [ ] A `v*` tag deploy through CI succeeds with no stored AWS access key.
- [ ] The rollback drill is documented and tried once.
- [ ] If Step 13 ran: imported counts match, model references resolve, auth tables are truncated, and one imported user signs in.

## Notes

- Provisional monthly floor for production in `ap-southeast-1`: roughly **$300–380** before model spend (ALB, 2 web + 1 worker at 1 vCPU/2 GiB, 2 NAT gateways, Multi-AZ `db.t4g.small` with 100 GB, 2-node `cache.t4g.small`, logs/ECR/SES). Keeping staging adds its ~$130–160.
- Production sizing is provisional; `docs/DECISIONS.md` decision 32 is still open. Raise counts/sizing after a load test rather than guessing.
- Migrations are forward-only. The release takes a snapshot before the migration task; that snapshot is the rollback point.
- The deploy role still has `AdministratorAccess`. Narrow it once the resource surface stops changing.
- WAF and ALB edge rate limiting are deferred; application and Better Auth rate limits are active.
- If Step 13 grows beyond a one-page runbook, split it into its own content-migration ticket rather than hiding it here.
- Do not commit `prod.env`, the provider key or the dump.

## Comments

- Steps 8 and 11–14 continue in ticket 30: `.scratch/openweightmodels/issues/30-finish-production-release-and-verification.md`. Steps 1–7, 9 and 10 are complete as of 2026-11-07; ticket 30 records the live state, the CI run, the SES/SNS gates, and the remaining verification.
