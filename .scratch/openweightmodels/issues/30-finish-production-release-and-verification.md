# 30: Finish the production release and verify the product

**What to build:** Pick up after ticket 29. `OwmProdFoundation`, `OwmProdApp`, `OwmProdOps` and `OwmProdCi` already exist in the production account; the site is live and healthy. Finish the first CI release, clear the SES/SNS gates, verify the full product path, run the rollback drill, and optionally import staging content before inviting users.

**Blocked by:** 29 — Create and verify the production environment (partially complete; this ticket carries steps 8 and 11–14).

**Status:** ready-for-human

> An agent can execute every shell step and stop at each 👤 checkpoint. The remaining gates are SES approval, SNS confirmation, sign-in, deployment approval, and invites, so do not treat this as an AFK ticket.

## How to use this ticket

Work top to bottom. Every step has commands, the expected result, and a **Checkpoint**. Stop at a 👤 step until the human confirms. Do not print, commit, or paste the provider key, database password, or the content dump.

At the time this ticket was written (2026-11-07):

- CI run `42343801839` for commit `0381110` is **green**: verify `2m26s`, staging deploy `14m56s` (https://github.com/xiaogit00/openweightmodels/actions/runs/42343801839). The preflight is satisfied and Step 1 can start immediately.
- The first production release was run locally from `0381110`. It created all four stacks, took a pre-migration snapshot, bootstrapped the database, and brought up 2 web + 1 worker task. `https://openweightmodels.net/api/health` returns `200` with `database: ok` and `redis: ok` when queried against the ALB.
- The provider key is valid (`sk-or-…`, OpenRouter `/api/v1/key` returns 200). An earlier 32-character invalid value was replaced.
- SES domain verification, SES production access, and the SNS owner subscription are still pending.

## Preflight

```bash
cd /Users/lei/p/openweightmodels
git fetch origin
git rev-parse HEAD origin/main          # both must be 0381110... before tagging
source prod.env
export AWS_PROFILE=owm-prod

aws sts get-caller-identity             # Confirm the production account, not staging; user owm-admin
aws cloudformation list-stacks \
  --query 'StackSummaries[].{Name:StackName,Status:StackStatus}' --output table
bash infra/scripts/prod-wizard.sh --check
```

Expected: the four `OwmProd*` stacks exist; the wizard reports only SES and GitHub-environment items as not ready; the staging account is never touched.

Note for local verification: the router at `192.168.18.1` still caches the old nameservers. Public DNS (`1.1.1.1`, `8.8.8.8`) already resolves the production ALB. Either change the Mac's DNS to `1.1.1.1`/`8.8.8.8`, flush the cache, or use:

```bash
curl --resolve openweightmodels.net:443:$(dig +short A openweightmodels.net @8.8.8.8 | head -1) \
  https://openweightmodels.net/api/health
```

## Step 1 — first CI release (👤 approval)

Only tag a commit that has passed staging. `0381110` is on `origin/main`; the CI run above is the staging check.

```bash
git checkout main
git pull
git tag -a v0.1.0 -m "Production v0.1.0"
git push origin v0.1.0
gh run list --limit 3
gh run watch <run-id>
```

The `production` environment requires review by `xiaogit00`. Open **Actions → the Deploy production run → Review deployments → production → Approve** (or use the pending-deployments API). The tag guard fails unless the commit is an ancestor of `origin/main`.

Expected: the reusable verify job runs, the environment pauses for review, the deploy job assumes
the deploy role in the `production` environment's `AWS_DEPLOY_ROLE_ARN` variable through OIDC, and `pnpm deploy:prod` runs. The image tag is the tag commit's SHA. The deploy takes a new pre-migration snapshot, runs the migration task, updates the services, and checks `/api/health`.

**Checkpoint:** the run is green; the approval is recorded; no AWS access key is stored in GitHub; `aws ecs describe-services --cluster owm-prod-cluster --services owm-prod-web owm-prod-worker` shows the new revision stable.

If the health check fails, read `aws logs tail /aws/ecs/owm-prod/web --since 15m`. A failure on the local machine due to the router cache does not apply to the GitHub runner.

## Step 2 — SES and SNS (👤 + agent)

```bash
aws sesv2 get-email-identity --email-identity openweightmodels.net \
  --region ap-southeast-1 \
  --query '{Verified:VerifiedForSendingStatus,Status:VerificationStatus,Dkim:DkimAttributes.Status,Checked:VerificationInfo.LastCheckedTimestamp,Error:VerificationInfo.ErrorType}'

aws sesv2 get-account --region ap-southeast-1 \
  --query '{ProductionAccessEnabled:ProductionAccessEnabled}'

TOPIC=$(aws cloudformation describe-stacks --stack-name OwmProdOps \
  --query "Stacks[0].Outputs[?OutputKey=='AlarmTopicArn'].OutputValue" --output text)
aws sns list-subscriptions-by-topic --topic-arn "$TOPIC" \
  --query 'Subscriptions[].{Endpoint:Endpoint,Arn:SubscriptionArn}' --output table
```

- 👤 Confirm the AWS **Subscription Confirmation** email for the alarm owner. The subscription must stop showing `PendingConfirmation`.
- The SES domain DNS records are correct and resolve through all four new nameservers. SES last checked at `13:26` and reported `HOST_NOT_FOUND`; this is its own recheck lag. Do not change DNS. Wait for `Verified: true` / `Dkim: SUCCESS` (official limit 72h).
- SES production access was requested on 2026-11-07. Until approved, only verified recipients receive magic links.
- To test sign-in while still in the sandbox, verify one **allowlisted** address as an SES email identity and click the verification email. The From domain (`openweightmodels.net`) must also be verified for the app to send. The already-verified root mailbox is listed by `aws sesv2 list-email-identities` (it is not currently on the allowlist).
- If the domain stalls for more than a day, compare the DKIM CNAMEs from
  `OwmProdFoundation.SesDkimName*` / `SesDkimValue*` against the new zone and against
  `dig +short CNAME <token>._domainkey.openweightmodels.net @1.1.1.1`.

**Checkpoint:** domain verified, SNS subscription confirmed, at least one allowlisted recipient verified (or production access granted), and the SES production-access status recorded.

## Step 3 — sign-in and onboarding (👤)

Open `https://openweightmodels.net`, sign in with an allowlisted, verified address, claim a handle, reload and confirm the session survives, then confirm a non-allowlisted address is refused.

If the magic link does not arrive, check the web logs for SES errors and confirm the From identity is verified. Do not bypass the allowlist in production.

**Checkpoint:** magic link arrives, onboarding completes, session survives reload, non-allowlisted address refused.

## Step 4 — product path (👤 + agent)

Against `https://openweightmodels.net` (not staging):

- [x] `/api/health` returns `{"status":"ok", ...}`.
- [x] The Board loads and pages. It loads with 3 published cards; cursor paging is not exercisable until there are more cards.
- [x] Upload a markdown file, pick a Base model and one Challenger, schedule, and watch the Job update live.
- [x] Publish; the card appears on the Board; open it, annotate, reply, and vote. Published, annotated and replied; **vote was not exercised** because self-voting is blocked and the only author is `lei`.
- [x] Worker logs show consumed jobs and no provider-configuration failure (one `qwen-3-8-27b` model-content failure is noted below):
  ```bash
  aws logs tail /aws/ecs/owm-prod/worker --since 15m
  ```
- [x] The run uses real OpenRouter tokens/latency, not mock values.
- [x] SSE survives five minutes with heartbeats:
  ```bash
  curl --max-time 330 -Ns https://openweightmodels.net/api/stream/board > /tmp/sse-prod.txt || true
  grep -c ': ping' /tmp/sse-prod.txt   # expect roughly 16
  ```

**Checkpoint:** every box is true, or the failure is written down as a follow-up.

## Step 5 — alarms, budget, snapshot, rollback drill

```bash
# Actual names are OwmProdOps-* / OwmProdApp-*, not owm-prod-*.
aws cloudwatch describe-alarms --alarm-name-prefix OwmProd \
  --query 'MetricAlarms[].{Name:AlarmName,State:StateValue}' --output table

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
aws budgets describe-budgets --account-id "$ACCOUNT" \
  --query 'Budgets[].{Name:BudgetName,Limit:BudgetLimit.Amount}' --output table

aws rds describe-db-snapshots --snapshot-type manual \
  --query 'DBSnapshots[].{Id:DBSnapshotIdentifier,Status:Status,Created:SnapshotCreateTime}' --output table
```

Trip one Ops alarm and confirm the email reaches the owner after the SNS subscription is confirmed:

```bash
aws cloudwatch set-alarm-state --alarm-name <one OwmProdOps alarm> \
  --state-value ALARM --state-reason "ticket 30 owner-email drill"
# 👤 confirm the email, then restore it
aws cloudwatch set-alarm-state --alarm-name <the same alarm> \
  --state-value OK --state-reason "ticket 30 drill complete"
```

Rollback drill:

```bash
aws ecs list-task-definitions --family-prefix owm-prod-web --sort DESC
aws ecs update-service --cluster owm-prod-cluster --service owm-prod-web \
  --task-definition <previous-revision-arn>
aws ecs wait services-stable --cluster owm-prod-cluster --services owm-prod-web
# verify health, then pin back to the newest revision
aws ecs update-service --cluster owm-prod-cluster --service owm-prod-web \
  --task-definition <newest-revision-arn>
aws ecs wait services-stable --cluster owm-prod-cluster --services owm-prod-web
```

Known snapshot from the local first release:
`owm-prod-pre-0381110249ad-20261107t035741z` (available). The CI release takes another one.

**Checkpoint:** one alarm email received, budget/alarms visible, rollback tried and pinned back, snapshot listed.

## Step 6 (optional) — import the staging content

Do this only if the staging content is meant to survive. Follow ticket 29 Step 13 exactly: freeze writes, dump through an in-VPC task or SSM bastion, stop production services, replace the public schema, restore, run `pnpm db:bootstrap`, truncate `auth_sessions`/`auth_verifications`, verify counts and model references, and keep the dump in a secure bucket until satisfied. Never run `pnpm db:seed` against staging.

If the decision is to skip, record it in the Comments section.

**Checkpoint:** counts match staging, model references resolve, sign-in works, an imported annotation renders, auth tables are truncated.

## Step 7 — SES approval flip and invites (👤)

When SES production access is granted:

```bash
# edit prod.env, then release
export OWM_SES_PRODUCTION_ACCESS=true
pnpm deploy:prod
gh variable set OWM_SES_PRODUCTION_ACCESS --env production --body "true"
```

Update `OWM_SIGNIN_ALLOWED_EMAILS` in `prod.env` and the GitHub `production` environment for the invite list, then release. Tell invitees their staging handles/content moved (if Step 6 ran) and that they need a fresh magic link.

Keep `OWM_ALLOW_SEARCH_INDEXING=false` until the public launch. Before going public: set it to `true`, rebuild and release, remove the allowlist, confirm SES production access, and consider WAF plus narrowing the deploy role.

**Checkpoint:** invitees receive magic links; the allowlist matches the intended list; search indexing is still off until launch.

## Known deviations and follow-ups

- **Alarm names:** CDK generates `OwmProdOps-*` / `OwmProdApp-*`; the ticket 29 check `--alarm-name-prefix owm-prod` returns nothing. Use `--alarm-name-prefix OwmProd`, or add explicit `alarmName`s in `infra/lib/ops-stack.ts` as a follow-up.
- **Staging DNS is frozen:** the staging stack (the `default` AWS profile) still points at `Z02852693V1NZ352P3PEJ`; the apex zone `Z068582410JN7QXO826L4` in the production account serves copies of the staging A/ACM/DKIM records. If the staging ALB or certificate is ever replaced, update the new zone manually. Consider a follow-up that gives staging its own delegated zone or repoints it.
- **Repository is public** to enable environment protection rules on the free plan. Required reviewer `xiaogit00` and policies `main` + `v*` are configured. Revisit if the repo returns to private (requires GitHub Pro).
- **Provider-key guard** only checks that the secret is non-empty; during the first local release it accepted an invalid 32-character value. Consider a format check (`sk-or-`) or a live OpenRouter check in `deploy.sh`.
- **Sentry:** `OWM_SENTRY_DSN` is unset; errors go to structured CloudWatch logs only.
- **Local DNS:** the Mac router caches the old NS; use a public resolver or `--resolve`. This does not affect the GitHub runner.
- **Local artifacts:** `prod.env` is gitignored and mode 600. `cookies.txt` is currently untracked and not ignored; add it to `.gitignore` before any broad `git add`.
- **First local release** created App/Ops before the provider key was valid; the CI release redeploys the same commit with the valid key.

## Acceptance criteria

- [x] A `v*` tag deploy through CI succeeds with the `production` environment approval and no stored AWS access key.
- [x] `https://openweightmodels.net` serves over HTTPS with a valid certificate; `/api/health` returns ok.
- [ ] SES domain is verified and production access is granted; an invited address receives a magic link. Domain verified and allowlisted addresses receive magic links; **AWS production access is still pending**.
- [x] A real OpenRouter Run completes with non-mock tokens and latency; a Comparison publishes; an annotation renders.
- [x] SSE survives five minutes with heartbeats.
- [x] Alarms, the SNS owner subscription and the budget exist; one alarm reaches the owner.
- [x] The rollback drill is documented and tried once.
- [ ] If Step 6 ran: imported counts match, model references resolve, auth tables are truncated, one imported user signs in. (Not applicable — Step 6 was skipped.)
- [x] If Step 6 was skipped: the decision is recorded.

## Comments

- Created 2026-11-07 after ticket 29's local bootstrap. The first local production release had already created all four stacks, the site was returning `200` via the ALB, the provider key was valid, and the worker was consuming `owm-runs`. SES domain verification, SES production access, and the SNS subscription were pending. The repository was made public and the production environment protections were applied in this session.
- 2026-11-07: CI run `42343801839` for `0381110` completed green — verify `2m26s`, staging deploy `14m56s`. `origin/main` now contains `0381110`, so the `v0.1.0` tag is unblocked.
- 2026-11-12 verification pass:
  - Step 1 was already complete. `v0.1.0` points at `0381110`; CI run `42941107826` (branch `v0.1.0`) ran verify then `Deploy production (OIDC)` and succeeded. The `production` environment requires `xiaogit00`, allows branches `main` and tags `v*`, and has no secrets — only the `AWS_DEPLOY_ROLE_ARN` and config variables. ECS is stable at web 2/2 and worker 1/1 on task definition revision 2.
  - Preflight: the four `OwmProd*` stacks are complete, and `prod-wizard.sh --check` reports only SES production access as not ready.
  - SES: the `openweightmodels.net` domain is verified with DKIM `SUCCESS`. Both allowlisted addresses (`thefuelstack@gmail.com`, `leibingguo@gmail.com`) were created and are verified in the sandbox. Production access is still `false`.
  - SNS: the `owm-prod-alarms` subscription is confirmed (no `PendingConfirmation`).
  - Alarm drill: `OwmProdOps-QueueDepthAlarmD4A3A893-yBok40So4Bgz` was set to `ALARM` and restored to `OK`. SNS recorded 1 publish + 1 delivery for each transition and 0 failures. The owner confirmed the email arrived.
  - Budgets: `owm-prod-monthly` and `owm-prod-guardrail` exist. Their ACTUAL/FORECASTED notifications publish to `owm-prod-alarms` (and the guardrail also emails the owner).
  - Snapshots: the CI release took `owm-prod-pre-0381110249ad4f6920c0e2c3305a86bb7d7e5544-20261111t015742z` (available).
  - Rollback drill: task definition revision 1 was already `INACTIVE`, so ECS refused to deploy it. Revision 1 was re-registered as revision 3 (same `0381110249ad` image), deployed, health-checked (`database: ok`, `redis: ok`), then the service was pinned back to revision 2 and health-checked again. This proves the rollback mechanics, though both available revisions carry the same commit image.
  - SSE: `GET /api/stream/board` held for 330s and emitted 16 `: ping` heartbeats.
  - `/api/health` returns `{"status":"ok","checks":{"database":"ok","redis":"ok"}}` and the certificate is valid to 2027-05-24.
  - Step 6 was skipped by owner decision: production launches without importing staging content.
  - Added `cookies.txt` to `.gitignore` (known follow-up).
  - Sign-in/onboarding: owner confirmed the magic link, handle claim and session-survives-reload checks. The web logs show `[auth] magic link suppressed: address is not allowlisted` for non-allowlisted attempts, and SES recorded 5 sends in the session (2 identity verifications + magic links).
  - Product path: three comparisons are published by `lei` and appear on the Board. Real OpenRouter usage is recorded, e.g. `qwen-3-8-27b` 15,694 tokens / 199s / $0.019633 and `deepseek-v4-1-flash` 3,731 tokens / 22s / $0.001860. One annotation renders with its thread reply, and comments/replies are present.
  - Vote is the one product-path gap: every published annotation/comment is authored by `lei`, and `toggleVote` rejects `self_vote`. Exercise the vote path from the second allowlisted account. Board pagination is also not exercisable with only 3 cards.
  - One `qwen-3-8-27b` run failed with `The model returned no text. It may have used its entire output budget on reasoning.` after 16,384 tokens / 216s. This is model output-budget behaviour, not a provider-configuration failure; the comparison remained publishable.
  - Remaining human gates: SES production access (still `false`) and the invite flip in Step 7, plus one vote from a second account to cover that product-path box.
