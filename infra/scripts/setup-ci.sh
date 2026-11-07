#!/usr/bin/env bash
#
# One-time setup for GitHub Actions deploys. Creates the OIDC provider (or
# imports one) and the deploy role, then prints the role ARN to store as the
# `AWS_DEPLOY_ROLE_ARN` variable in the matching GitHub environment.
#
# Set OWM_ENVIRONMENT=production for OwmProdCi (owm-prod-github-deploy). The
# production role trusts only the `production` GitHub environment; the staging
# role keeps the branch + environment trust.
#
# After this, `pnpm deploy:staging` or `pnpm deploy:prod` runs from CI with a
# short-lived token; no AWS access key is stored in GitHub.
#
# Required environment:
#   AWS_REGION (or AWS_DEFAULT_REGION)
#   OWM_GITHUB_REPO       owner/repository
#   OWM_ALARM_EMAIL       named alarm owner
#   OWM_GITHUB_SUBJECT_PREFIX  optional; the OIDC `sub` prefix, e.g.
#                         repo:owner@123/repo@456. Detected with `gh` when unset.
#   OWM_DOMAIN_NAME       hostname used by the stacks
#   OWM_HOSTED_ZONE_ID or OWM_CERTIFICATE_ARN
#
# Optional:
#   OWM_ENVIRONMENT                staging (default) or production
#   OWM_GITHUB_ENVIRONMENT         defaults to OWM_ENVIRONMENT
#   OWM_GITHUB_BRANCH              branch allowed to deploy staging (defaults to main)
#   OWM_GITHUB_OIDC_PROVIDER_ARN   reuse an existing provider
#   OWM_STACK_PREFIX / OWM_NAME_PREFIX
#   OWM_SES_IDENTITY / OWM_HOSTED_ZONE_NAME / OWM_EMAIL_FROM / OWM_PROVIDER
#   OWM_SES_PRODUCTION_ACCESS      true or false (defaults to false)
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

AWS_REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-}}"
ENVIRONMENT="${OWM_ENVIRONMENT:-staging}"
if [[ "$ENVIRONMENT" != "staging" && "$ENVIRONMENT" != "production" ]]; then
  echo "OWM_ENVIRONMENT must be staging or production (got '$ENVIRONMENT')." >&2
  exit 1
fi
if [[ "$ENVIRONMENT" == "production" ]]; then
  DEFAULT_STACK_PREFIX=OwmProd
  DEFAULT_NAME_PREFIX=owm-prod
else
  DEFAULT_STACK_PREFIX=OwmStaging
  DEFAULT_NAME_PREFIX=owm-staging
fi
STACK_PREFIX="${OWM_STACK_PREFIX:-$DEFAULT_STACK_PREFIX}"
NAME_PREFIX="${OWM_NAME_PREFIX:-$DEFAULT_NAME_PREFIX}"
if [[ "$STACK_PREFIX" != "$DEFAULT_STACK_PREFIX" || "$NAME_PREFIX" != "$DEFAULT_NAME_PREFIX" ]]; then
  echo "OWM_ENVIRONMENT=$ENVIRONMENT requires OWM_STACK_PREFIX=$DEFAULT_STACK_PREFIX and OWM_NAME_PREFIX=$DEFAULT_NAME_PREFIX." >&2
  exit 1
fi

DOMAIN="${OWM_DOMAIN_NAME:-}"
HOSTED_ZONE_ID="${OWM_HOSTED_ZONE_ID:-}"
HOSTED_ZONE_ID="${HOSTED_ZONE_ID#/hostedzone/}"
HOSTED_ZONE_NAME="${OWM_HOSTED_ZONE_NAME:-}"
CERTIFICATE_ARN="${OWM_CERTIFICATE_ARN:-}"
SES_IDENTITY="${OWM_SES_IDENTITY:-$DOMAIN}"
EMAIL_FROM="${OWM_EMAIL_FROM:-OpenWeightModels <no-reply@${DOMAIN}>}"
PROVIDER="${OWM_PROVIDER:-openrouter}"
ALARM_EMAIL="${OWM_ALARM_EMAIL:-}"
GITHUB_REPO="${OWM_GITHUB_REPO:-}"
GITHUB_BRANCH="${OWM_GITHUB_BRANCH:-main}"
GITHUB_ENVIRONMENT="${OWM_GITHUB_ENVIRONMENT:-$ENVIRONMENT}"
GITHUB_OIDC_PROVIDER_ARN="${OWM_GITHUB_OIDC_PROVIDER_ARN:-}"
GITHUB_SUBJECT_PREFIX="${OWM_GITHUB_SUBJECT_PREFIX:-}"
MONTHLY_BUDGET_USD="${OWM_MONTHLY_BUDGET_USD:-200}"
MONTHLY_SPEND_CAP_USD="${OWM_MONTHLY_SPEND_CAP_USD:-100}"
SES_PRODUCTION_ACCESS="${OWM_SES_PRODUCTION_ACCESS:-false}"

if [[ -z "$AWS_REGION" ]]; then
  echo "Set AWS_REGION (or AWS_DEFAULT_REGION)." >&2
  exit 1
fi
if [[ -z "$DOMAIN" ]]; then
  echo "Set OWM_DOMAIN_NAME." >&2
  exit 1
fi
if [[ -z "$GITHUB_REPO" || ! "$GITHUB_REPO" =~ ^[^/]+/[^/]+$ ]]; then
  echo "Set OWM_GITHUB_REPO=owner/repository." >&2
  exit 1
fi
if [[ ! "$ALARM_EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]]; then
  echo "Set OWM_ALARM_EMAIL to a real address." >&2
  exit 1
fi
if [[ -z "$HOSTED_ZONE_ID" && -z "$CERTIFICATE_ARN" ]]; then
  echo "Set OWM_HOSTED_ZONE_ID or OWM_CERTIFICATE_ARN." >&2
  exit 1
fi
if [[ ! "$SES_PRODUCTION_ACCESS" =~ ^(true|false)$ ]]; then
  echo "OWM_SES_PRODUCTION_ACCESS must be true or false." >&2
  exit 1
fi
command -v aws >/dev/null || { echo "Missing required tool: aws" >&2; exit 1; }

# New GitHub repositories use immutable OIDC subjects, which embed the owner and
# repository IDs. Ask GitHub for the exact prefix so the trust policy matches
# the token instead of assuming the older name-only form.
if [[ -z "$GITHUB_SUBJECT_PREFIX" ]] && command -v gh >/dev/null 2>&1; then
  GITHUB_SUBJECT_PREFIX="$(gh api "repos/$GITHUB_REPO/actions/oidc/customization/sub" \
    --jq '.sub_claim_prefix' 2>/dev/null || true)"
fi
GITHUB_SUBJECT_PREFIX="${GITHUB_SUBJECT_PREFIX:-repo:$GITHUB_REPO}"
if [[ ! "$GITHUB_SUBJECT_PREFIX" =~ ^repo:[^:]+$ ]]; then
  echo "OWM_GITHUB_SUBJECT_PREFIX must look like repo:owner/repo or repo:owner@id/repo@id." >&2
  exit 1
fi

export AWS_REGION
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
echo "Creating the GitHub OIDC deploy role for $GITHUB_REPO in account $ACCOUNT"
echo "Environment: $ENVIRONMENT (GitHub environment: $GITHUB_ENVIRONMENT)"
echo "OIDC subject prefix: $GITHUB_SUBJECT_PREFIX"

CONTEXT=(
  -c "environment=$ENVIRONMENT"
  -c "domainName=$DOMAIN"
  -c "provider=$PROVIDER"
  -c "stackPrefix=$STACK_PREFIX"
  -c "namePrefix=$NAME_PREFIX"
  -c "sesIdentity=$SES_IDENTITY"
  -c "emailFrom=$EMAIL_FROM"
  -c "alarmEmail=$ALARM_EMAIL"
  -c "monthlyBudgetUsd=$MONTHLY_BUDGET_USD"
  -c "monthlySpendCapUsd=$MONTHLY_SPEND_CAP_USD"
  -c "sesProductionAccess=$SES_PRODUCTION_ACCESS"
  -c "githubRepo=$GITHUB_REPO"
  -c "githubBranch=$GITHUB_BRANCH"
  -c "githubEnvironment=$GITHUB_ENVIRONMENT"
  -c "githubSubjectPrefix=$GITHUB_SUBJECT_PREFIX"
)
if [[ -n "$HOSTED_ZONE_ID" ]]; then
  CONTEXT+=(-c "hostedZoneId=$HOSTED_ZONE_ID")
  if [[ -n "$HOSTED_ZONE_NAME" ]]; then
    CONTEXT+=(-c "hostedZoneName=$HOSTED_ZONE_NAME")
  fi
fi
if [[ -n "$CERTIFICATE_ARN" ]]; then
  CONTEXT+=(-c "certificateArn=$CERTIFICATE_ARN")
fi
if [[ -n "$GITHUB_OIDC_PROVIDER_ARN" ]]; then
  CONTEXT+=(-c "githubOidcProviderArn=$GITHUB_OIDC_PROVIDER_ARN")
fi

if ! aws cloudformation describe-stacks --stack-name CDKToolkit >/dev/null 2>&1; then
  echo "Bootstrapping CDK in aws://$ACCOUNT/$AWS_REGION"
  pnpm --filter @owm/infra exec cdk bootstrap "aws://$ACCOUNT/$AWS_REGION"
fi

CI_STACK="${STACK_PREFIX}Ci"
pnpm --filter @owm/infra exec cdk deploy "$CI_STACK" \
  --require-approval never \
  "${CONTEXT[@]}"

ROLE_ARN="$(aws cloudformation describe-stacks \
  --stack-name "$CI_STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='DeployRoleArn'].OutputValue" \
  --output text)"

echo
echo "Store this as the AWS_DEPLOY_ROLE_ARN variable in the GitHub '$GITHUB_ENVIRONMENT' environment:"
echo "  $ROLE_ARN"
echo
echo "Also set the $GITHUB_ENVIRONMENT environment variables/secrets listed in docs/DEPLOYMENT.md §7"
echo "or docs/PRODUCTION.md."
