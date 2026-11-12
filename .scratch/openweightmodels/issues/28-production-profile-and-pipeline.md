# 28: Add the production profile and release pipeline

**What to build:** A production profile for the existing CDK stacks and a tag-gated GitHub Actions pipeline that deploys it to a separate AWS account. Production runs the same three stacks as `OwmProdFoundation`, `OwmProdApp` and `OwmProdOps`, plus `OwmProdCi`, with HA data, retained state, an invite-only launch and the same migration-first release sequence as staging.

**Blocked by:** 13 — Deploy staging on AWS; 16 — Abuse controls, spend caps and delivery pipeline.

**Status:** done

## Decisions

- **Separate AWS account.** Production is not a second set of stacks in the staging account.
- **Apex domain.** `openweightmodels.net` in the existing Route 53 zone; CDK creates a new ACM certificate for the apex.
- **Invite-only first.** `OWM_SIGNIN_ALLOWED_EMAILS` is set and `OWM_ALLOW_SEARCH_INDEXING=false` until the public launch.
- **Same commit, not the same image bytes.** Separate accounts have separate ECRs, and `ALLOW_SEARCH_INDEXING` is baked at build time (`Dockerfile:42-47`, `apps/web/next.config.ts:16`). The production workflow rebuilds from the tagged commit with production build arguments. Byte-identical promotion would require a cross-account image copy; that is not required for this ticket.
- **Environment is explicit.** `OWM_ENVIRONMENT=production` selects the profile and defaults the prefixes to `OwmProd`/`owm-prod`. The config rejects a mismatch between `environment` and the prefixes.

## Configuration

- [ ] Add `environment: 'staging' | 'production'` to `infra/lib/config.ts`, read from `OWM_ENVIRONMENT` / `-c environment`, default `staging`.
- [ ] Reject a mismatch between `environment` and `stackPrefix`/`namePrefix`, so `environment=production` cannot deploy `OwmStaging*` by accident.
- [ ] Derive the defaults in the table below from `environment`. Expose the sizing and count values through CDK context / `OWM_*` variables so a release can tune them without code changes.
- [ ] Add `sentryEnvironment` (defaults to `environment`) and `githubEnvironment` (defaults to `environment`).
- [ ] Add `prod.env.example` and add `prod.env` to `.gitignore`. The example holds no secrets.

| Setting | Staging | Production |
|---|---|---|
| `stackPrefix` / `namePrefix` | `OwmStaging` / `owm-staging` | `OwmProd` / `owm-prod` |
| RDS instance | `db.t4g.micro` | `db.t4g.small` (provisional, overridable) |
| RDS storage / max | 20 / 50 GB | 100 / 500 GB |
| RDS Multi-AZ | `false` | `true` |
| RDS deletion protection | `false` | `true` |
| RDS removal policy | `DESTROY` | `RETAIN` |
| RDS automated backups | 7 days, deleted on delete | 14 days, retained |
| Redis | 1 node, no failover | 2 nodes, automatic failover, Multi-AZ |
| NAT gateways | 1 | 2 (one per AZ) |
| ECR | `emptyOnDelete`, `DESTROY` | `RETAIN`, no empty-on-delete |
| Log retention / removal | 30 days, `DESTROY` | 90 days, `RETAIN` |
| Container Insights | `DISABLED` | `ENABLED` |
| ALB deletion protection | `false` | `true` |
| ALB access logs | none | S3 bucket, 90-day lifecycle |
| Web / worker sizing | 0.5 vCPU / 1 GiB | 1 vCPU / 2 GiB (provisional) |
| Web count | 2 / 2 / 4 | 2 / 2 / 6 |
| Worker count | 1 / 1 / 2 | 1 / 1 / 4 |
| Worker rollout | stop-then-start | `minimumHealthyPercent: 100` |

WAF is deliberately deferred for the invite-only launch; note it in the production doc rather than silently adding it.

## Foundation stack

- [ ] VPC: `natGateways` follows the table.
- [ ] RDS: Multi-AZ, deletion protection, `RemovalPolicy.RETAIN`, `deleteAutomatedBackups: false`, backup retention, storage autoscaling, instance class/size from config.
- [ ] ElastiCache: `numCacheClusters: 2`, `automaticFailoverEnabled: true`, `multiAzEnabled: true` in production; keep the single node and TLS/noeviction setup in staging.
- [ ] ECR: `RemovalPolicy.RETAIN` and `emptyOnDelete: false` in production.
- [ ] Log groups: retention and removal policy from config.
- [ ] ECS cluster: Container Insights `ENABLED` in production.
- [ ] `SENTRY_ENVIRONMENT` comes from config, not the literal `'staging'` (`infra/lib/foundation-stack.ts:356,403`).
- [ ] Add `sesProductionAccess` (read from `OWM_SES_PRODUCTION_ACCESS` / `-c sesProductionAccess`, default `false`). While false, keep the account-wide `identity/*` grant that the sandbox needs. When true, narrow the grant to the sending identity. The owner flips this after SES approves the account.
- [ ] Add a `DatabaseInstanceIdentifier` stack output so the release script can take a pre-migration snapshot.

## App stack

- [ ] ALB `deletionProtection` follows the table.
- [ ] Add an S3 bucket for ALB access logs in production, with a 90-day lifecycle and `RemovalPolicy.RETAIN`, and call `alb.logAccessLogs(bucket, 'alb')`.
- [ ] Worker service deployment configuration: `minimumHealthyPercent: 100`, `maximumPercent: 200` in production so a release does not stop the only consumer; staging keeps the current 0/100.
- [ ] Keep the 4000-second idle timeout, HTTP→HTTPS redirect, health check and circuit breaker unchanged.

## CI stack

- [ ] Replace the hardcoded `environment:staging` in the OIDC trust (`infra/lib/ci-stack.ts:53`) with `config.githubEnvironment`.
- [ ] In production, trust **only** `environment:production` (the workflow job declares `environment: production`). Do not add a branch subject for the production role; a push to `main` must not be able to assume it.
- [ ] Keep the existing branch + environment trust for staging.
- [ ] Keep the role name `${namePrefix}-github-deploy`; `OwmProdCi` therefore creates `owm-prod-github-deploy`.
- [ ] Make `infra/scripts/setup-ci.sh` environment-aware: derive `OwmProd`/`owm-prod` from `OWM_ENVIRONMENT=production`, read `OWM_GITHUB_ENVIRONMENT`, and pass it to the CI stack.
- [ ] Leave the role with `AdministratorAccess` for now, with a code comment that production should move to a narrower permission set once the deploy surface settles.

## Release script

- [ ] `infra/scripts/deploy.sh` reads `OWM_ENVIRONMENT`; when it is `production`, default `STACK_PREFIX=OwmProd`, `NAME_PREFIX=owm-prod` and `PLATFORM=linux/arm64`.
- [ ] Add `deploy:prod` to the root `package.json` (for example `OWM_ENVIRONMENT=production bash infra/scripts/deploy.sh`).
- [ ] Production takes an RDS snapshot before the migration task, and aborts if the snapshot fails. Skip it on the first create (no database yet) and when `SKIP_SNAPSHOT=1` is explicitly set. Snapshot name: `<name>-pre-<image-tag>-<UTC timestamp>`.
- [ ] Add `SKIP_BUILD=1`: verify `IMAGE_TAG` exists in both target ECR repositories and skip the Docker build/push. This is the hotfix/redeploy path, not the normal tag release.
- [ ] Pass the new count/sizing context values through `CONTEXT`, including `OWM_SES_PRODUCTION_ACCESS`.
- [ ] Replace staging-specific user-facing messages with `${STACK_PREFIX}` / `${NAME_PREFIX}` so the same script reports correctly for both environments.
- [ ] Keep the existing ordering: push images → deploy Foundation → check provider key → snapshot → run migration task → deploy App → deploy Ops → pin services → wait → smoke.

## Release workflow

- [ ] Extract the `verify` job from `.github/workflows/ci.yml` into a reusable `.github/workflows/verify.yml` with `on: workflow_call` (typecheck, tests, build, Postgres/Redis services, `pnpm db:bootstrap`). Both `ci.yml` and the production workflow call it, so a tag is verified with exactly the same steps as `main`.
- [ ] Keep the staging deploy job in `ci.yml` unchanged: push to `main` → verify → deploy staging.
- [ ] Add `.github/workflows/deploy-production.yml`:
  - `on: push: tags: ['v*']` and `workflow_dispatch` with an optional `image_tag` input.
  - `permissions: contents: read, id-token: write`.
  - `environment: production`.
  - `concurrency: { group: deploy-production, cancel-in-progress: false }`.
  - A tag guard: check out with full history, fetch `origin/main`, and fail unless `GITHUB_SHA` is an ancestor of `origin/main`.
  - `needs:` the reusable verify workflow.
  - Assume `vars.AWS_DEPLOY_ROLE_ARN` through `aws-actions/configure-aws-credentials@v4`; `role-session-name: owm-prod-${{ github.run_id }}`.
  - Set `OWM_ENVIRONMENT=production`, `OWM_STACK_PREFIX=OwmProd`, `OWM_NAME_PREFIX=owm-prod`, `IMAGE_TAG=${{ github.sha }}` (or the dispatch input), `OWM_DOMAIN_NAME`, zone/SES/email/alarm/budget/spend/invite values from the `production` environment, and `OWM_SES_PRODUCTION_ACCESS` from a variable (default `false`).
  - Set `OWM_ALLOW_SEARCH_INDEXING=false` for the invite-only launch.
  - Run `pnpm deploy:prod`; when `image_tag` is supplied, run with `SKIP_BUILD=1`.
  - Do not cancel an in-flight production deploy.
- [ ] Add a workflow-level `timeout-minutes` of at least 90 for the first production create.

## Interactive owner wizard

- [ ] Add `infra/scripts/prod-wizard.sh`, a checkpointed bash wizard for the owner steps in ticket 29:
  - `--check` verifies prerequisites and current state without changing anything.
  - `--from N` resumes at a step; state is kept in a gitignored `prod.env` and `.prod-wizard-state`.
  - Refuses to run when `aws sts get-caller-identity` does not match the expected production account (prompt once, no default). A same-account run requires an explicit `--allow-same-account`.
  - Prompts for region, domain, hosted zone, alarm email, budget, spend cap, invite list and optional Sentry DSN; writes `prod.env` with mode `600`.
  - Pauses at the SES production-access check and at the GitHub environment setup, printing the console path and the exact `gh` commands.
  - Reads the OpenRouter key with `read -rs`, pipes it straight into Secrets Manager, and never echoes, logs or writes it.
  - Prints the tag command for the first CI release at the end.
  - Never runs `cdk destroy` or any destructive command.
- [ ] Add a `bash -n` check to the release tests, and make `--check` safe to run without mutating AWS.

## Tests

- [ ] Add `infra/test/production.test.ts` with a production config and assert:
  - RDS `MultiAZ: true`, `DeletionProtection: true`, `DeletionPolicy: Retain`, backup retention, `DeleteAutomatedBackups: false`.
  - ElastiCache 2 nodes with automatic failover and Multi-AZ.
  - Two NAT gateways.
  - ECR `DeletionPolicy: Retain` and `EmptyOnDelete: false`.
  - Log retention 90 days and `DeletionPolicy: Retain`.
  - ALB `DeletionProtection: true` and access-log configuration.
  - `SENTRY_ENVIRONMENT=production` in both task definitions.
  - CI role trust contains `:environment:production` and no `:ref:refs/heads/main` subject.
  - Worker deployment `MinimumHealthyPercent: 100`.
- [ ] Update `infra/test/release.test.ts` for `deploy:prod`, environment-derived prefixes, the pre-migration snapshot ordering, and `SKIP_BUILD`.
- [ ] Add a config test for the environment/prefix mismatch guard.
- [ ] Keep all staging assertions passing unchanged.
- [ ] Run `pnpm typecheck`, `pnpm test`, `bash -n infra/scripts/*.sh`, and `pnpm cdk:synth` with production context.

## Documentation

- [ ] Add `docs/PRODUCTION.md`: topology, production settings and why, first-deploy sequence, release process, rollback, cost estimate, backup/restore, SES approval, and the content-import pointer from ticket 29.
- [ ] Link it from `README.md` and `docs/DEPLOYMENT.md`.
- [ ] Note the provisional production sizing (decision 32 in `docs/DECISIONS.md` is still open) and the deferred WAF.

## Acceptance criteria

- [ ] `OWM_ENVIRONMENT=production pnpm cdk:synth` emits the production templates with no staging-only settings.
- [ ] Every production safety property above is asserted by a focused test; staging tests still pass.
- [ ] `OWM_ENVIRONMENT=production pnpm deploy:prod` resolves the prod prefixes and refuses a mismatched environment.
- [ ] `deploy-production.yml` is tag-triggered, environment-gated, non-cancelling, verifies before deploying, and has no stored AWS keys.
- [ ] `OwmProdCi` trusts only `environment:production`.
- [ ] A production release takes an RDS snapshot before the migration task and aborts if it fails.
- [ ] `prod-wizard.sh --check` runs without mutating state and `--help` explains each checkpoint.
- [ ] `pnpm typecheck`, `pnpm test` and `bash -n` pass.
- [ ] Production docs are written and linked.

## Notes

- The actual first deployment, SES approval, GitHub environment and verification are ticket 29.
- Production uses the same migration-first sequence as staging (ADR 0007); migrations are forward-only and the pre-migration snapshot is the rollback point.
- The first production create takes 30–60 minutes and starts billing immediately.
- Do not commit `prod.env` or any provider key; the wizard must keep secrets out of files.

## Comments

- Implemented in commit `0381110`. `pnpm typecheck`, `pnpm test`, `bash -n infra/scripts/*.sh`, and a production/staging `cdk synth` pass.
