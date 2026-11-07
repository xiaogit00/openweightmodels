#!/usr/bin/env bash
#
# Interactive, checkpointed owner wizard for the production environment
# (ticket 29). It writes only prod.env and .prod-wizard-state; the OpenRouter
# key is read with a hidden prompt and piped straight into Secrets Manager.
#
# It never deletes a stack and never runs a destructive AWS command.
#
# Usage:
#   bash infra/scripts/prod-wizard.sh [--check] [--from N] [--allow-same-account]
#
#   --check               Verify prerequisites and current state, changing nothing.
#   --from N              Resume at checkpoint N (state defaults to the next one).
#   --allow-same-account  Allow production resources in an account that already
#                         contains OwmStagingFoundation.
#   --help                Print this help.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

ENV_FILE="${OWM_PROD_ENV_FILE:-prod.env}"
STATE_FILE="${OWM_PROD_WIZARD_STATE:-.prod-wizard-state}"
CHECK_ONLY=0
ALLOW_SAME_ACCOUNT=0
FROM_STEP=""
PROBLEMS=0

usage() {
  cat <<'EOF'
Production owner wizard (ticket 29).

Checkpoints:
  1  Preflight      tools, AWS identity, separate-account guard.
  2  Inputs         region, apex domain, zone, SES, alarms, budget, invites,
                    GitHub repository/environment. Writes prod.env (mode 600).
  3  Bootstrap      CDK bootstrap in the production account/region (once).
  4  First release  Creates OwmProdFoundation and pushes the images; expected
                    to stop at the empty provider-key guard.
  5  Provider key   Hidden prompt; pipes the OpenRouter key into Secrets Manager
                    without echoing, logging or writing it.
  6  Complete       Creates OwmProdApp and OwmProdOps, runs the migration task
                    and waits for the services to become stable.
  7  SES            Checks production access and pauses for the owner decision.
  8  CI role        Creates OwmProdCi and prints the deploy role ARN.
  9  GitHub         Prints the production-environment console path and the exact
                    gh commands; pauses for the owner to configure reviewers.
  10 First tag      Prints the v* tag command for the first CI release.

Options:
  --check               Verify everything above without changing anything.
  --from N              Resume at checkpoint N.
  --allow-same-account  Allow a run in an account that already has the staging
                        stack. Use only when the two environments intentionally
                        share an account.
  --help                Show this help.

State lives in prod.env and .prod-wizard-state; both are gitignored.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) CHECK_ONLY=1 ;;
    --allow-same-account) ALLOW_SAME_ACCOUNT=1 ;;
    --from)
      [[ $# -ge 2 ]] || { echo "--from needs a checkpoint number." >&2; exit 1; }
      FROM_STEP="$2"
      shift
      ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
  shift
done

die() {
  echo "Error: $*" >&2
  exit 1
}

say() {
  printf '\n=== %s ===\n' "$*"
}

ok() {
  echo "  ok: $*"
}

problem() {
  echo "  missing: $*" >&2
  PROBLEMS=$((PROBLEMS + 1))
}

load_env() {
  if [[ -f "$ENV_FILE" ]]; then
    # shellcheck disable=SC1090
    source "$ENV_FILE"
  fi
}

save_var() {
  local key="$1"
  local value="$2"
  local tmp
  touch "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  tmp="$(mktemp "${TMPDIR:-/tmp}/owm-prod-env.XXXXXX")"
  grep -v "^export ${key}=" "$ENV_FILE" >"$tmp" || true
  printf 'export %s=%q\n' "$key" "$value" >>"$tmp"
  mv "$tmp" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  export "$key=$value"
}

prompt() {
  local label="$1"
  local default="${2:-}"
  local value
  if [[ -n "$default" ]]; then
    read -r -p "$label [$default]: " value
  else
    read -r -p "$label: " value
  fi
  printf '%s' "${value:-$default}"
}

prompt_required() {
  local label="$1"
  local default="${2:-}"
  local value
  while true; do
    value="$(prompt "$label" "$default")"
    if [[ -n "$value" ]]; then
      printf '%s' "$value"
      return
    fi
    echo "This value is required." >&2
  done
}

pause() {
  local message="${1:-Press Enter to continue}"
  read -r -p "$message " _ || true
}

read_state() {
  if [[ -f "$STATE_FILE" ]]; then
    cat "$STATE_FILE"
  else
    echo 0
  fi
}

mark_done() {
  echo "$1" >"$STATE_FILE"
}

current_account() {
  aws sts get-caller-identity --query Account --output text
}

load_env

if [[ -n "$FROM_STEP" ]]; then
  [[ "$FROM_STEP" =~ ^[0-9]+$ ]] || die "--from must be a checkpoint number."
  START="$FROM_STEP"
elif (( CHECK_ONLY )); then
  START=1
else
  START=$(( $(read_state) + 1 ))
fi

check_tools() {
  local missing=0
  for tool in aws docker pnpm git curl; do
    if command -v "$tool" >/dev/null 2>&1; then
      ok "$tool"
    else
      problem "$tool is not installed"
      missing=1
    fi
  done
  if command -v docker >/dev/null 2>&1 && ! docker buildx version >/dev/null 2>&1; then
    problem "Docker Buildx is not available"
    missing=1
  fi
  if (( ! CHECK_ONLY && missing )); then
    die "Install the missing tools before rerunning."
  fi
}

ensure_account() {
  local expected="${OWM_PROD_ACCOUNT:-}"
  local caller
  if ! caller="$(current_account 2>/dev/null)"; then
    problem "aws sts get-caller-identity failed; check your credentials"
    if (( ! CHECK_ONLY )); then
      die "Cannot determine the AWS account."
    fi
    return
  fi

  if [[ -z "$expected" ]]; then
    if (( CHECK_ONLY )); then
      problem "OWM_PROD_ACCOUNT is not recorded in $ENV_FILE"
      return
    fi
    echo "Production is intentionally a separate AWS account."
    echo "Current credentials: account $caller."
    while [[ -z "$expected" ]]; do
      read -r -p "Production AWS account ID (no default): " expected
    done
    save_var OWM_PROD_ACCOUNT "$expected"
  fi

  if [[ "$caller" != "$expected" ]]; then
    problem "aws sts get-caller-identity is account $caller, not the expected production account $expected"
    if (( ! CHECK_ONLY )); then
      die "Refusing to touch production with the wrong account."
    fi
  else
    ok "AWS identity is the expected production account ($caller)"
  fi

  if aws cloudformation describe-stacks --stack-name OwmStagingFoundation >/dev/null 2>&1; then
    if (( ALLOW_SAME_ACCOUNT )); then
      echo "Warning: OwmStagingFoundation exists in this account; continuing because --allow-same-account was passed."
    else
      problem "OwmStagingFoundation exists in account $caller; this looks like the staging account"
      if (( ! CHECK_ONLY )); then
        die "Use --allow-same-account only if production and staging intentionally share an account."
      fi
    fi
  else
    ok "No OwmStagingFoundation in this account"
  fi
}

step_1_preflight() {
  check_tools
  ensure_account
}

check_inputs() {
  local name
  for name in \
    OWM_ENVIRONMENT \
    OWM_STACK_PREFIX \
    OWM_NAME_PREFIX \
    AWS_REGION \
    OWM_DOMAIN_NAME \
    OWM_HOSTED_ZONE_ID \
    OWM_ALARM_EMAIL \
    OWM_MONTHLY_BUDGET_USD \
    OWM_MONTHLY_SPEND_CAP_USD \
    OWM_SIGNIN_ALLOWED_EMAILS \
    OWM_GITHUB_REPO \
    OWM_GITHUB_ENVIRONMENT; do
    if [[ -n "${!name:-}" ]]; then
      ok "$name is set"
    else
      problem "$name is missing from $ENV_FILE"
    fi
  done
  if [[ -n "${OWM_ENVIRONMENT:-}" && "$OWM_ENVIRONMENT" != "production" ]]; then
    problem "OWM_ENVIRONMENT must be production (got '$OWM_ENVIRONMENT')"
  fi
  if [[ -n "${OWM_STACK_PREFIX:-}" && "$OWM_STACK_PREFIX" != "OwmProd" ]]; then
    problem "OWM_STACK_PREFIX must be OwmProd (got '$OWM_STACK_PREFIX')"
  fi
  if [[ -n "${OWM_NAME_PREFIX:-}" && "$OWM_NAME_PREFIX" != "owm-prod" ]]; then
    problem "OWM_NAME_PREFIX must be owm-prod (got '$OWM_NAME_PREFIX')"
  fi
  if [[ -n "${OWM_SES_PRODUCTION_ACCESS:-}" ]] &&
     [[ ! "$OWM_SES_PRODUCTION_ACCESS" =~ ^(true|false)$ ]]; then
    problem "OWM_SES_PRODUCTION_ACCESS must be true or false"
  fi
}

step_2_inputs() {
  if (( CHECK_ONLY )); then
    if [[ ! -f "$ENV_FILE" ]]; then
      problem "$ENV_FILE does not exist; run the wizard without --check"
      return
    fi
    load_env
    check_inputs
    return
  fi

  if [[ ! -f "$ENV_FILE" ]]; then
    touch "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    echo "Created $ENV_FILE (mode 600)."
  fi
  chmod 600 "$ENV_FILE"

  # Keep the environment and prefixes in prod.env: setup-ci.sh derives
  # OwmProdCi/owm-prod from them, and ticket 29 assumes they are present.
  save_var OWM_ENVIRONMENT production
  save_var OWM_STACK_PREFIX OwmProd
  save_var OWM_NAME_PREFIX owm-prod

  local region domain zone_id zone_name ses email alarm budget cap invites sentry
  local github_repo github_branch github_environment

  region="$(prompt_required 'AWS region' "${AWS_REGION:-ap-southeast-1}")"
  save_var AWS_REGION "$region"

  domain="$(prompt_required 'Apex domain' "${OWM_DOMAIN_NAME:-openweightmodels.net}")"
  save_var OWM_DOMAIN_NAME "$domain"

  zone_id="$(prompt_required 'Route 53 hosted zone ID (Z..., no /hostedzone/ prefix)' "${OWM_HOSTED_ZONE_ID:-}")"
  save_var OWM_HOSTED_ZONE_ID "${zone_id#/hostedzone/}"

  zone_name="$(prompt_required 'Route 53 zone name' "${OWM_HOSTED_ZONE_NAME:-$domain}")"
  save_var OWM_HOSTED_ZONE_NAME "$zone_name"

  ses="$(prompt_required 'SES identity (domain or verified address)' "${OWM_SES_IDENTITY:-$domain}")"
  save_var OWM_SES_IDENTITY "$ses"

  email="$(prompt_required 'From address' "${OWM_EMAIL_FROM:-OpenWeightModels <no-reply@${domain}>}")"
  save_var OWM_EMAIL_FROM "$email"

  alarm="$(prompt_required 'Alarm owner email' "${OWM_ALARM_EMAIL:-}")"
  save_var OWM_ALARM_EMAIL "$alarm"

  budget="$(prompt_required 'Monthly AWS infrastructure budget (USD)' "${OWM_MONTHLY_BUDGET_USD:-400}")"
  save_var OWM_MONTHLY_BUDGET_USD "$budget"

  cap="$(prompt_required 'Monthly model spend cap (USD)' "${OWM_MONTHLY_SPEND_CAP_USD:-100}")"
  save_var OWM_MONTHLY_SPEND_CAP_USD "$cap"

  invites="$(prompt_required 'Invite-only email allowlist (comma-separated)' "${OWM_SIGNIN_ALLOWED_EMAILS:-}")"
  save_var OWM_SIGNIN_ALLOWED_EMAILS "$invites"

  sentry="$(prompt 'Sentry DSN (optional, Enter to skip)' "${OWM_SENTRY_DSN:-}")"
  if [[ -n "$sentry" ]]; then
    save_var OWM_SENTRY_DSN "$sentry"
  fi

  github_repo="$(prompt_required 'GitHub repository (owner/name)' "${OWM_GITHUB_REPO:-}")"
  save_var OWM_GITHUB_REPO "$github_repo"

  github_branch="$(prompt_required 'GitHub branch for staging deploys' "${OWM_GITHUB_BRANCH:-main}")"
  save_var OWM_GITHUB_BRANCH "$github_branch"

  github_environment="$(prompt_required 'GitHub environment for production' "${OWM_GITHUB_ENVIRONMENT:-production}")"
  save_var OWM_GITHUB_ENVIRONMENT "$github_environment"

  # The invite-only launch is a build argument, so it must stay false until the
  # public launch image is built.
  save_var OWM_ALLOW_SEARCH_INDEXING false
  save_var OWM_SES_PRODUCTION_ACCESS "${OWM_SES_PRODUCTION_ACCESS:-false}"

  echo
  echo "Wrote $ENV_FILE. It contains no provider key."
}

step_3_bootstrap() {
  local account
  account="$(current_account)"
  if (( CHECK_ONLY )); then
    if aws cloudformation describe-stacks --stack-name CDKToolkit >/dev/null 2>&1; then
      ok "CDKToolkit exists"
    else
      problem "CDKToolkit is not bootstrapped in account $account"
    fi
    return
  fi
  say "Bootstrapping CDK in aws://$account/$AWS_REGION"
  pnpm --filter @owm/infra exec cdk bootstrap "aws://$account/$AWS_REGION"
}

step_4_first_release() {
  if (( CHECK_ONLY )); then
    if aws cloudformation describe-stacks --stack-name OwmProdFoundation >/dev/null 2>&1; then
      ok "OwmProdFoundation exists"
    else
      problem "OwmProdFoundation does not exist yet"
    fi
    return
  fi

  say "First release (expected to stop at the provider-key guard)"
  local status=0
  set +e
  pnpm deploy:prod
  status=$?
  set -e

  if [[ "$status" == "0" ]]; then
    echo "The release completed without stopping at the provider key."
    return
  fi
  if aws cloudformation describe-stacks --stack-name OwmProdFoundation >/dev/null 2>&1; then
    echo "deploy:prod exited $status after creating OwmProdFoundation."
    echo "If the last line was the empty provider-key guard, continue to checkpoint 5."
    return
  fi
  die "The first release failed before creating OwmProdFoundation."
}

step_5_provider_key() {
  local arn existing replace
  arn="$(aws cloudformation describe-stacks \
    --stack-name OwmProdFoundation \
    --query "Stacks[0].Outputs[?OutputKey=='ProviderKeySecretArn'].OutputValue" \
    --output text 2>/dev/null || true)"
  if [[ -z "$arn" || "$arn" == "None" ]]; then
    if (( CHECK_ONLY )); then
      problem "ProviderKeySecretArn is not available; the foundation stack is not ready"
      return
    fi
    die "ProviderKeySecretArn is not available; finish checkpoint 4 first."
  fi

  if (( CHECK_ONLY )); then
    existing="$(aws secretsmanager get-secret-value --secret-id "$arn" \
      --query SecretString --output text 2>/dev/null || true)"
    if [[ -n "$existing" ]]; then
      ok "the provider key secret has a value"
    else
      problem "the provider key secret is empty"
    fi
    unset existing
    return
  fi

  existing="$(aws secretsmanager get-secret-value --secret-id "$arn" \
    --query SecretString --output text 2>/dev/null || true)"
  if [[ -n "$existing" ]]; then
    unset existing
    read -r -p "The provider key secret already has a value. Replace it? [y/N]: " replace
    if [[ ! "$replace" =~ ^[yY]$ ]]; then
      echo "Keeping the existing provider key."
      return
    fi
  fi
  unset existing

  local or_key
  read -rs -p "OpenRouter API key (input hidden): " or_key
  echo
  [[ -n "$or_key" ]] || die "The provider key cannot be empty."
  # Never echo, log or write the key. Pipe it through stdin so it is not in the
  # shell history or a temporary file.
  if ! printf '%s' "$or_key" | aws secretsmanager put-secret-value \
      --secret-id "$arn" --secret-string file:///dev/stdin >/dev/null; then
    unset or_key
    die "Writing the provider key to Secrets Manager failed."
  fi
  unset or_key
  echo "Provider key written to Secrets Manager."
}

step_6_complete_release() {
  if (( CHECK_ONLY )); then
    if aws cloudformation describe-stacks --stack-name OwmProdApp >/dev/null 2>&1; then
      ok "OwmProdApp exists"
    else
      problem "OwmProdApp does not exist yet"
    fi
    if aws cloudformation describe-stacks --stack-name OwmProdOps >/dev/null 2>&1; then
      ok "OwmProdOps exists"
    else
      problem "OwmProdOps does not exist yet"
    fi
    if curl -fsS "https://${OWM_DOMAIN_NAME:-}/api/health" >/dev/null 2>&1; then
      ok "https://$OWM_DOMAIN_NAME/api/health returns 200"
    else
      problem "https://${OWM_DOMAIN_NAME:-<domain>}/api/health is not reachable yet"
    fi
    return
  fi
  say "Completing the release"
  pnpm deploy:prod
}

step_7_ses() {
  local enabled
  enabled="$(aws sesv2 get-account --region "${AWS_REGION:-}" \
    --query ProductionAccessEnabled --output text 2>/dev/null || true)"

  echo "SES production access: ${enabled:-unknown}"
  echo "Console: https://console.aws.amazon.com/ses/home?region=${AWS_REGION:-}"

  if (( CHECK_ONLY )); then
    if [[ "$enabled" == "True" || "$enabled" == "true" ]]; then
      ok "SES production access is enabled"
    else
      problem "SES production access is not enabled; only verified recipients receive mail"
    fi
    return
  fi

  if [[ "$enabled" == "True" || "$enabled" == "true" ]]; then
    save_var OWM_SES_PRODUCTION_ACCESS true
    echo "prod.env now sets OWM_SES_PRODUCTION_ACCESS=true."
    echo "Release once more so the web task grant narrows to the sending identity:"
    echo "  pnpm deploy:prod"
    echo "For CI, also run:"
    echo "  gh variable set OWM_SES_PRODUCTION_ACCESS --env ${OWM_GITHUB_ENVIRONMENT:-production} --body true"
  else
    save_var OWM_SES_PRODUCTION_ACCESS false
    echo "Keep OWM_SES_PRODUCTION_ACCESS=false until SES approves the account."
    echo "Then rerun: bash infra/scripts/prod-wizard.sh --from 7"
  fi
  pause "Press Enter when the SES check is done."
}

step_8_ci_role() {
  if (( CHECK_ONLY )); then
    if aws cloudformation describe-stacks --stack-name OwmProdCi >/dev/null 2>&1; then
      ok "OwmProdCi exists"
    else
      problem "OwmProdCi does not exist yet"
    fi
    return
  fi
  say "Creating the production OIDC deploy role"
  OWM_ENVIRONMENT=production OWM_STACK_PREFIX=OwmProd OWM_NAME_PREFIX=owm-prod \
    pnpm deploy:ci
  local role_arn
  role_arn="$(aws cloudformation describe-stacks \
    --stack-name OwmProdCi \
    --query "Stacks[0].Outputs[?OutputKey=='DeployRoleArn'].OutputValue" \
    --output text)"
  echo "Deploy role: $role_arn"
  echo "Trust must contain environment:production and no branch subject."
}

step_9_github() {
  local environment="${OWM_GITHUB_ENVIRONMENT:-production}"
  local role_arn
  role_arn="$(aws cloudformation describe-stacks \
    --stack-name OwmProdCi \
    --query "Stacks[0].Outputs[?OutputKey=='DeployRoleArn'].OutputValue" \
    --output text 2>/dev/null || true)"

  if (( CHECK_ONLY )); then
    if command -v gh >/dev/null 2>&1; then
      if gh variable list --env "$environment" >/dev/null 2>&1; then
        ok "GitHub environment '$environment' exists and lists variables"
      else
        problem "GitHub environment '$environment' is not configured or gh is not authenticated"
      fi
    else
      problem "gh is not installed; cannot check the GitHub environment"
    fi
    return
  fi

  cat <<EOF
Open GitHub: Settings -> Environments -> New environment -> $environment

Required reviewers: at least you, ideally one other person.
Restrict deployment branches and tags to main and v* tags.

Then set these environment variables (not repository variables):
  gh variable set AWS_DEPLOY_ROLE_ARN --env $environment --body "$role_arn"
  gh variable set AWS_REGION --env $environment --body "${AWS_REGION:-}"
  gh variable set OWM_DOMAIN_NAME --env $environment --body "$OWM_DOMAIN_NAME"
  gh variable set OWM_HOSTED_ZONE_ID --env $environment --body "$OWM_HOSTED_ZONE_ID"
  gh variable set OWM_HOSTED_ZONE_NAME --env $environment --body "$OWM_HOSTED_ZONE_NAME"
  gh variable set OWM_SES_IDENTITY --env $environment --body "${OWM_SES_IDENTITY:-}"
  gh variable set OWM_EMAIL_FROM --env $environment --body "$OWM_EMAIL_FROM"
  gh variable set OWM_ALARM_EMAIL --env $environment --body "$OWM_ALARM_EMAIL"
  gh variable set OWM_MONTHLY_BUDGET_USD --env $environment --body "$OWM_MONTHLY_BUDGET_USD"
  gh variable set OWM_MONTHLY_SPEND_CAP_USD --env $environment --body "$OWM_MONTHLY_SPEND_CAP_USD"
  gh variable set OWM_SIGNIN_ALLOWED_EMAILS --env $environment --body "$OWM_SIGNIN_ALLOWED_EMAILS"
  gh variable set OWM_ALLOW_SEARCH_INDEXING --env $environment --body false
  gh variable set OWM_SES_PRODUCTION_ACCESS --env $environment --body "${OWM_SES_PRODUCTION_ACCESS:-false}"
  gh variable set OWM_STACK_PREFIX --env $environment --body OwmProd
  gh variable set OWM_NAME_PREFIX --env $environment --body owm-prod

Sentry DSN as a secret, not a variable:
  gh secret set OWM_SENTRY_DSN --env $environment

The deploy role needs no AWS access key.
EOF
  pause "Press Enter once the GitHub environment is configured."
}

step_10_first_tag() {
  cat <<'EOF'
First CI release (only a commit that has passed staging):
  git checkout main
  git pull
  git tag v0.1.0
  git push origin v0.1.0
  gh run watch

The workflow verifies the commit, waits for the production environment review,
then assumes the OIDC role and runs pnpm deploy:prod.
EOF
}

run_step() {
  local number="$1"
  local name="$2"
  local action="$3"
  if (( number < START )); then
    return
  fi
  say "Checkpoint $number — $name"
  "$action"
  if (( ! CHECK_ONLY )); then
    mark_done "$number"
  fi
}

if (( CHECK_ONLY )); then
  echo "Checking production prerequisites (read-only)."
fi

run_step 1 "Preflight" step_1_preflight
run_step 2 "Inputs" step_2_inputs
run_step 3 "CDK bootstrap" step_3_bootstrap
run_step 4 "First release" step_4_first_release
run_step 5 "Provider key" step_5_provider_key
run_step 6 "Complete release" step_6_complete_release
run_step 7 "SES" step_7_ses
run_step 8 "CI role" step_8_ci_role
run_step 9 "GitHub environment" step_9_github
run_step 10 "First tag" step_10_first_tag

if (( CHECK_ONLY )); then
  echo
  if (( PROBLEMS > 0 )); then
    echo "$PROBLEMS prerequisite(s) are not ready." >&2
    exit 1
  fi
  echo "All prerequisites look ready."
  exit 0
fi

echo
echo "Wizard finished at checkpoint $(read_state)."
echo "prod.env and .prod-wizard-state are gitignored; no provider key was written."
