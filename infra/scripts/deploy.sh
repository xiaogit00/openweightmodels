#!/usr/bin/env bash
#
# Release the staging stack. The same sequence is safe on a clean AWS account:
# bootstrap CDK, create the foundation (VPC, RDS, Redis, ECR, secrets, SES,
# task definitions), build and push the images, run the migration task, then
# create/roll the ECS services.
#
# Required environment:
#   AWS_REGION (or AWS_DEFAULT_REGION)
#   OWM_DOMAIN_NAME                 e.g. staging.openweightmodels.com
#   OWM_HOSTED_ZONE_ID              Route 53 zone for the certificate and DNS
#     or OWM_CERTIFICATE_ARN        existing ACM certificate in the same region
#
# Optional:
#   OWM_SES_IDENTITY  (defaults to OWM_DOMAIN_NAME)
#   OWM_HOSTED_ZONE_NAME (zone name when it is a parent of OWM_DOMAIN_NAME)
#   OWM_EMAIL_FROM    (defaults to "OpenWeightModels <no-reply@DOMAIN>")
#   OWM_PROVIDER      (defaults to openrouter)
#   OWM_SIGNIN_ALLOWED_EMAILS  comma-separated allowlist; unset allows anyone
#   OWM_ALARM_EMAIL   required; the named owner of CloudWatch and budget alarms
#   OWM_MONTHLY_BUDGET_USD     AWS infrastructure budget (defaults to 200)
#   OWM_MONTHLY_SPEND_CAP_USD  provider-spend ceiling (defaults to 100)
#   OWM_SENTRY_DSN    error tracker DSN; unset logs structured errors only
#   OWM_ALLOW_SEARCH_INDEXING  true to allow crawlers in a public build (default false)
#   OWM_STACK_PREFIX  (defaults to OwmStaging)
#   OWM_NAME_PREFIX   (defaults to owm-staging)
#   IMAGE_TAG         (defaults to the current git commit)
#   PLATFORM          (defaults to linux/arm64)
#   SKIP_SMOKE=1      skip the post-deploy /api/health request
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

AWS_REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-}}"
DOMAIN="${OWM_DOMAIN_NAME:-}"
HOSTED_ZONE_ID="${OWM_HOSTED_ZONE_ID:-}"
HOSTED_ZONE_ID="${HOSTED_ZONE_ID#/hostedzone/}"
HOSTED_ZONE_NAME="${OWM_HOSTED_ZONE_NAME:-}"
CERTIFICATE_ARN="${OWM_CERTIFICATE_ARN:-}"
SES_IDENTITY="${OWM_SES_IDENTITY:-$DOMAIN}"
EMAIL_FROM="${OWM_EMAIL_FROM:-OpenWeightModels <no-reply@${DOMAIN}>}"
PROVIDER="${OWM_PROVIDER:-openrouter}"
STACK_PREFIX="${OWM_STACK_PREFIX:-OwmStaging}"
NAME_PREFIX="${OWM_NAME_PREFIX:-owm-staging}"
SIGNIN_ALLOWED_EMAILS="${OWM_SIGNIN_ALLOWED_EMAILS:-}"
ALARM_EMAIL="${OWM_ALARM_EMAIL:-}"
MONTHLY_BUDGET_USD="${OWM_MONTHLY_BUDGET_USD:-200}"
MONTHLY_SPEND_CAP_USD="${OWM_MONTHLY_SPEND_CAP_USD:-100}"
SENTRY_DSN="${OWM_SENTRY_DSN:-}"
TAG="${IMAGE_TAG:-$(git rev-parse --short=12 HEAD)}"
PLATFORM="${PLATFORM:-linux/arm64}"

FOUNDATION="${STACK_PREFIX}Foundation"
APP="${STACK_PREFIX}App"
OPS="${STACK_PREFIX}Ops"

if [[ -z "$AWS_REGION" ]]; then
  echo "Set AWS_REGION (or AWS_DEFAULT_REGION)." >&2
  exit 1
fi
if [[ -z "$DOMAIN" ]]; then
  echo "Set OWM_DOMAIN_NAME, for example staging.openweightmodels.com." >&2
  exit 1
fi
if [[ -z "$HOSTED_ZONE_ID" && -z "$CERTIFICATE_ARN" ]]; then
  echo "Set OWM_HOSTED_ZONE_ID (CDK creates the certificate) or OWM_CERTIFICATE_ARN." >&2
  exit 1
fi
if [[ ! "$ALARM_EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]]; then
  echo "Set OWM_ALARM_EMAIL to the person who owns alarms; it is required." >&2
  exit 1
fi
if [[ ! "$MONTHLY_SPEND_CAP_USD" =~ ^[0-9]+([.][0-9]+)?$ ]] || \
   [[ "$MONTHLY_SPEND_CAP_USD" == "0" ]]; then
  echo "OWM_MONTHLY_SPEND_CAP_USD must be a positive number." >&2
  exit 1
fi
if [[ -z "$SENTRY_DSN" ]]; then
  echo "Warning: OWM_SENTRY_DSN is unset; application errors go to structured logs only." >&2
fi
for tool in aws docker pnpm curl; do
  command -v "$tool" >/dev/null || {
    echo "Missing required tool: $tool" >&2
    exit 1
  }
done
if ! docker buildx version >/dev/null 2>&1; then
  echo "Docker Buildx is required (docker buildx version)." >&2
  exit 1
fi

export AWS_REGION

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
echo "Deploying $STACK_PREFIX to account $ACCOUNT in $AWS_REGION (image $TAG)"

if [[ -n "$HOSTED_ZONE_ID" ]]; then
  if ! ACTUAL_ZONE_NAME="$(aws route53 get-hosted-zone --id "$HOSTED_ZONE_ID" \
      --query 'HostedZone.Name' --output text 2>/dev/null)"; then
    echo "Route 53 hosted zone '$HOSTED_ZONE_ID' was not found in account $ACCOUNT." >&2
    echo "Export the real zone ID (it starts with Z and is not the 'Z...' placeholder)." >&2
    exit 1
  fi
  ACTUAL_ZONE_NAME="${ACTUAL_ZONE_NAME%.}"
  echo "Using Route 53 hosted zone $ACTUAL_ZONE_NAME ($HOSTED_ZONE_ID)"
  if [[ -n "$HOSTED_ZONE_NAME" && "$ACTUAL_ZONE_NAME" != "${HOSTED_ZONE_NAME%.}" ]]; then
    echo "Hosted zone $HOSTED_ZONE_ID is $ACTUAL_ZONE_NAME, but OWM_HOSTED_ZONE_NAME is $HOSTED_ZONE_NAME." >&2
    exit 1
  fi
fi

CONTEXT=(
  -c "domainName=$DOMAIN"
  -c "provider=$PROVIDER"
  -c "stackPrefix=$STACK_PREFIX"
  -c "namePrefix=$NAME_PREFIX"
  -c "imageTag=$TAG"
  -c "sesIdentity=$SES_IDENTITY"
  -c "emailFrom=$EMAIL_FROM"
  -c "alarmEmail=$ALARM_EMAIL"
  -c "monthlyBudgetUsd=$MONTHLY_BUDGET_USD"
  -c "monthlySpendCapUsd=$MONTHLY_SPEND_CAP_USD"
)
if [[ -n "$SENTRY_DSN" ]]; then
  CONTEXT+=(-c "sentryDsn=$SENTRY_DSN")
fi
if [[ -n "$HOSTED_ZONE_ID" ]]; then
  CONTEXT+=(-c "hostedZoneId=$HOSTED_ZONE_ID")
  if [[ -n "$HOSTED_ZONE_NAME" ]]; then
    CONTEXT+=(-c "hostedZoneName=$HOSTED_ZONE_NAME")
  fi
fi
if [[ -n "$CERTIFICATE_ARN" ]]; then
  CONTEXT+=(-c "certificateArn=$CERTIFICATE_ARN")
fi
if [[ -n "$SIGNIN_ALLOWED_EMAILS" ]]; then
  CONTEXT+=(-c "signinAllowedEmails=$SIGNIN_ALLOWED_EMAILS")
fi

deploy() {
  local stack="$1"
  shift
  pnpm --filter @owm/infra exec cdk deploy "$stack" \
    --require-approval never \
    "${CONTEXT[@]}" "$@"
}

output() {
  aws cloudformation describe-stacks \
    --stack-name "$1" \
    --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue" \
    --output text
}

# CDK bootstrapping is idempotent; do it once per account/region.
if ! aws cloudformation describe-stacks --stack-name CDKToolkit >/dev/null 2>&1; then
  echo "Bootstrapping CDK in aws://$ACCOUNT/$AWS_REGION"
  pnpm --filter @owm/infra exec cdk bootstrap "aws://$ACCOUNT/$AWS_REGION"
fi

# First run: the ECR repositories must exist before images can be pushed, and
# the task definitions can point at an image that does not exist yet because
# nothing runs until the App stack is created.
if ! aws ecr describe-repositories --repository-names "${NAME_PREFIX}-web" >/dev/null 2>&1; then
  echo "Creating the foundation stack before the first image push"
  deploy "$FOUNDATION"
fi

echo "Building and pushing $PLATFORM images"
aws ecr get-login-password --region "$AWS_REGION" |
  docker login --username AWS --password-stdin "$ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com"

WEB_REPO="$(output "$FOUNDATION" WebRepositoryUri)"
WORKER_REPO="$(output "$FOUNDATION" WorkerRepositoryUri)"
INDEXING="${OWM_ALLOW_SEARCH_INDEXING:-false}"
docker buildx build --platform "$PLATFORM" -f Dockerfile --target web \
  --build-arg "ALLOW_SEARCH_INDEXING=$INDEXING" \
  -t "$WEB_REPO:$TAG" --push .
docker buildx build --platform "$PLATFORM" -f Dockerfile --target worker \
  -t "$WORKER_REPO:$TAG" --push .

echo "Registering task definitions with $TAG"
deploy "$FOUNDATION"

if [[ "$PROVIDER" != "mock" ]]; then
  KEY_SECRET="$(output "$FOUNDATION" ProviderKeySecretArn)"
  if [[ -z "$(aws secretsmanager get-secret-value --secret-id "$KEY_SECRET" \
      --query SecretString --output text 2>/dev/null || true)" ]]; then
    echo "The provider key secret is empty. Set it before releasing:" >&2
    echo "  aws secretsmanager put-secret-value --secret-id $KEY_SECRET --secret-string <key>" >&2
    exit 1
  fi
fi

CLUSTER="$(output "$FOUNDATION" ClusterName)"
SUBNETS="$(output "$FOUNDATION" PrivateSubnetIds)"
MIGRATE_SG="$(output "$FOUNDATION" MigrateSecurityGroupId)"
MIGRATE_TASK="$(output "$FOUNDATION" MigrateTaskDefinitionArn)"
MIGRATE_LOG="$(output "$FOUNDATION" MigrateLogGroupName)"

echo "Running the database bootstrap task (migrate + model registry)"
TASK_ARN="$(aws ecs run-task \
  --cluster "$CLUSTER" \
  --task-definition "$MIGRATE_TASK" \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$MIGRATE_SG],assignPublicIp=DISABLED}" \
  --query 'tasks[0].taskArn' --output text)"

aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$TASK_ARN"
EXIT_CODE="$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK_ARN" \
  --query 'tasks[0].containers[0].exitCode' --output text)"
if [[ "$EXIT_CODE" != "0" ]]; then
  echo "Migration task exited with $EXIT_CODE. Recent logs:" >&2
  aws logs tail "$MIGRATE_LOG" --since 15m >&2 || true
  exit 1
fi

echo "Creating the App stack (ALB, HTTPS, services)"
deploy "$APP"

echo "Creating the Ops stack (alarms, budget and owner $ALARM_EMAIL)"
deploy "$OPS"

WEB_SERVICE="$(output "$APP" WebServiceName)"
WORKER_SERVICE="$(output "$APP" WorkerServiceName)"

update_service() {
  local service="$1"
  local family="$2"
  local revision
  revision="$(aws ecs describe-task-definition --task-definition "$family" \
    --query 'taskDefinition.taskDefinitionArn' --output text)"
  aws ecs update-service --cluster "$CLUSTER" --service "$service" \
    --task-definition "$revision" --force-new-deployment >/dev/null
}

# App stack services reference the task definition family. Pin them to the
# revision registered above so a release rolls even when the App template is
# unchanged, and force a fresh deployment after a successful migration.
update_service "$WEB_SERVICE" "$(output "$FOUNDATION" WebTaskDefinitionFamily)"
update_service "$WORKER_SERVICE" "$(output "$FOUNDATION" WorkerTaskDefinitionFamily)"

echo "Waiting for services to become stable"
aws ecs wait services-stable --cluster "$CLUSTER" --services "$WEB_SERVICE" "$WORKER_SERVICE"

APP_URL="https://$DOMAIN"
echo
echo "Staging is deployed: $APP_URL"
echo "  web logs:    aws logs tail $(output "$FOUNDATION" WebLogGroupName) --follow"
echo "  worker logs: aws logs tail $(output "$FOUNDATION" WorkerLogGroupName) --follow"
echo "  alarms:      aws cloudwatch describe-alarms --alarm-name-prefix ${NAME_PREFIX}"

if [[ "${SKIP_SMOKE:-0}" != "1" ]]; then
  echo "Checking $APP_URL/api/health"
  for attempt in $(seq 1 30); do
    if curl -fsS "$APP_URL/api/health" >/dev/null 2>&1; then
      echo "Health check passed"
      break
    fi
    if [[ "$attempt" == "30" ]]; then
      echo "Health check did not pass; inspect the web logs." >&2
      exit 1
    fi
    sleep 10
  done
fi
