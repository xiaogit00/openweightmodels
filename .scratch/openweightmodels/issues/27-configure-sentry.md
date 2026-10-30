# 27: Configure Sentry and verify a failed Run reaches it

**What to build:** Point staging at a real Sentry-compatible error tracker, inject the DSN into both the web and worker task definitions, and prove that one deliberately failed Run produces a diagnosable event. The reporting code already exists in `packages/core/src/error-reporting.ts`; this ticket is configuration, release and verification by the owner.

**Blocked by:** 16 — Abuse controls, spend caps and delivery pipeline.

**Status:** ready-for-human

## Current state

- Staging is deployed and healthy at `https://staging.openweightmodels.net`; web and worker run the CI-built image on ECS.
- The GitHub `staging` environment has no `OWM_SENTRY_DSN` secret, so the current task definitions have no `SENTRY_DSN` and the worker writes structured `error.report` JSON to CloudWatch instead of sending events.
- `staging.env` currently has `thefuelstack@gmail.com` in the `OWM_SENTRY_DSN` slot. That is an email address, not a DSN; `parseSentryDsn` rejects it. Replace it before the next local release.
- The DSN is injected by `OwmStagingFoundation` as a plain task environment variable, so changing it requires a new task-definition revision and a service roll.

## Steps

1. Create a Sentry project (platform: Node.js) and copy its DSN from **Settings → Projects → \<project\> → Client Keys (DSN)**. It must look like `https://<public-key>@o<org-id>.ingest.sentry.io/<project-id>`; a self-hosted Sentry works if the same path shape is used.

2. Store it as a secret, not a variable:
   ```bash
   gh secret set OWM_SENTRY_DSN --env staging
   ```

3. Replace the wrong value in the gitignored `staging.env`:
   ```bash
   export OWM_SENTRY_DSN='https://<public-key>@o<org-id>.ingest.sentry.io/<project-id>'
   ```

4. Release. A push to `main` deploys through CI; a manual `workflow_dispatch` runs verify only, because the deploy job is gated on a push. The quicker path is:
   ```bash
   source staging.env
   pnpm deploy:staging
   ```

5. Confirm the value reached both tasks:
   ```bash
   aws ecs describe-task-definition --task-definition owm-staging-worker \
     --query "taskDefinition.containerDefinitions[0].environment[?name=='SENTRY_DSN'].value" --output text
   aws ecs describe-task-definition --task-definition owm-staging-web \
     --query "taskDefinition.containerDefinitions[0].environment[?name=='SENTRY_DSN'].value" --output text
   ```

6. Produce one deliberate failure. Keep the real key in the shell; do not write it to disk:
   ```bash
   SECRET=owm-staging/openrouter-api-key
   OR_KEY="$(aws secretsmanager get-secret-value --secret-id "$SECRET" \
     --query SecretString --output text)"

   aws secretsmanager put-secret-value --secret-id "$SECRET" \
     --secret-string 'sk-or-v1-invalid-sentry-test'
   aws ecs update-service --cluster owm-staging-cluster \
     --service owm-staging-worker --force-new-deployment >/dev/null
   aws ecs wait services-stable --cluster owm-staging-cluster --services owm-staging-worker
   ```

7. In the staging UI, create a Comparison (or Retry an existing Run). The Run fails with a provider error and the worker posts one event. Open Sentry → Issues and check the event carries `responseId`, `jobId`, `comparisonId`, `modelSlug`, `turnId`, `attempt`, tokens and latency, and that secrets are redacted.

8. Restore the key and prove a real Run still works:
   ```bash
   aws secretsmanager put-secret-value --secret-id "$SECRET" --secret-string "$OR_KEY"
   unset OR_KEY
   aws ecs update-service --cluster owm-staging-cluster \
     --service owm-staging-worker --force-new-deployment >/dev/null
   aws ecs wait services-stable --cluster owm-staging-cluster --services owm-staging-worker
   ```

`put-secret-value` keeps the real key as the `AWSPREVIOUS` version, so the restore is recoverable even if the shell dies. Restarting the worker is required because task environment and secrets are read only at task start.

## Acceptance criteria

- [ ] A Sentry-compatible project exists and its DSN is stored in the GitHub `staging` environment as the `OWM_SENTRY_DSN` secret.
- [ ] `staging.env` holds the same DSN; it no longer contains the alarm email in that slot, and the file remains gitignored.
- [ ] A release injects `SENTRY_DSN` into both `owm-staging-web` and `owm-staging-worker` task definitions.
- [ ] One deliberate failed Run produces exactly one Sentry event with `responseId`, `jobId`, `comparisonId`, `modelSlug`, `turnId`, `attempt`, tokens and latency.
- [ ] A spot-check of the event shows provider keys and the database password are redacted.
- [ ] The OpenRouter key is restored, the worker is redeployed, and a real Run settles `done` with non-mock tokens and latency.
- [ ] No DSN, provider key or password is committed; `gh secret list` still shows no AWS access key.
- [ ] The Sentry owner step in ticket 16 can be checked off and this ticket closed.

## Notes

- `docs/DEPLOYMENT.md` §7 ("Error tracker") documents the event contents and the log fallback; §6 is the post-release checklist.
- Sentry DSNs are client keys rather than credentials that grant account access, but they still belong in the environment secret, not in the repository.
- The earlier alarms, SNS subscription and first OIDC deploy from ticket 16 are already verified; this ticket covers only the error tracker and its failed-Run proof.

## Comments

- 2026-10-30 — Split from ticket 16 after staging deployed. Ticket 16's other owner steps are done: `OwmStagingOps` and `OwmStagingCi` exist, the SNS subscription is confirmed, an alarm was tripped and delivered, and the first GitHub Actions deploy completed through OIDC with no stored AWS key.
