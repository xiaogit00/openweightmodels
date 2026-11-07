#!/usr/bin/env bash
#
# Release an OpenWeightModels environment (staging by default). The same
# sequence is safe on a clean AWS account: bootstrap CDK, create the foundation
# (VPC, RDS, Redis, ECR, secrets, SES, task definitions), build and push the
# images, run the migration task, then create/roll the ECS services.
#
# Set OWM_ENVIRONMENT=production for the production profile (OwmProd/owm-prod).
# The profile is rejected if the prefixes belong to the other environment.
#
# Required environment:
#   AWS_REGION (or AWS_DEFAULT_REGION)
#   OWM_DOMAIN_NAME                 e.g. staging.openweightmodels.com
#   OWM_HOSTED_ZONE_ID              Route 53 zone for the certificate and DNS
#     or OWM_CERTIFICATE_ARN        existing ACM certificate in the same region
#
# Optional:
#   OWM_ENVIRONMENT   staging (default) or production
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
#   OWM_SES_PRODUCTION_ACCESS  true to narrow the SES send grant (default false)
#   OWM_STACK_PREFIX  (defaults to OwmStaging or OwmProd)
#   OWM_NAME_PREFIX   (defaults to owm-staging or owm-prod)
#   IMAGE_TAG         (defaults to the current git commit)
#   PLATFORM          (defaults to linux/arm64)
#   SKIP_BUILD=1      reuse an existing IMAGE_TAG in both ECR repositories
#   SKIP_SNAPSHOT=1   skip the production pre-migration RDS snapshot
#   SKIP_SMOKE=1      skip the post-deploy /api/health request
#
# Optional sizing/count overrides (CDK context):
#   OWM_WEB_DESIRED_COUNT, OWM_MIN_WEB_TASKS, OWM_MAX_WEB_TASKS
#   OWM_WORKER_DESIRED_COUNT, OWM_MIN_WORKER_TASKS, OWM_MAX_WORKER_TASKS
#   OWM_WEB_CPU, OWM_WEB_MEMORY, OWM_WORKER_CPU, OWM_WORKER_MEMORY
#   OWM_DB_INSTANCE_CLASS, OWM_DB_INSTANCE_SIZE, OWM_DB_ALLOCATED_STORAGE,
#   OWM_DB_MAX_ALLOCATED_STORAGE, OWM_DB_BACKUP_RETENTION_DAYS
#   OWM_CACHE_NODE_TYPE, OWM_NAT_GATEWAYS
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
  echo "Refusing to deploy $STACK_PREFIX/$NAME_PREFIX with the $ENVIRONMENT profile." >&2
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
SIGNIN_ALLOWED_EMAILS="${OWM_SIGNIN_ALLOWED_EMAILS:-}"
ALARM_EMAIL="${OWM_ALARM_EMAIL:-}"
MONTHLY_BUDGET_USD="${OWM_MONTHLY_BUDGET_USD:-200}"
MONTHLY_SPEND_CAP_USD="${OWM_MONTHLY_SPEND_CAP_USD:-100}"
SENTRY_DSN="${OWM_SENTRY_DSN:-}"
SES_PRODUCTION_ACCESS="${OWM_SES_PRODUCTION_ACCESS:-false}"
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
  echo "Set OWM_DOMAIN_NAME, for example example.com." >&2
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
if [[ ! "$SES_PRODUCTION_ACCESS" =~ ^(true|false)$ ]]; then
  echo "OWM_SES_PRODUCTION_ACCESS must be true or false." >&2
  exit 1
fi
if [[ -z "$SENTRY_DSN" ]]; then
  echo "Warning: OWM_SENTRY_DSN is unset; application errors go to structured logs only." >&2
fi
for tool in aws pnpm curl; do
  command -v "$tool" >/dev/null || {
    echo "Missing required tool: $tool" >&2
    exit 1
  }
done
if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  command -v docker >/dev/null || {
    echo "Missing required tool: docker" >&2
    exit 1
  }
  if ! docker buildx version >/dev/null 2>&1; then
    echo "Docker Buildx is required (docker buildx version)." >&2
    exit 1
  fi
fi

export AWS_REGION

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
echo "Deploying $STACK_PREFIX ($ENVIRONMENT) to account $ACCOUNT in $AWS_REGION (image $TAG)"

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
  -c "environment=$ENVIRONMENT"
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
  -c "sesProductionAccess=$SES_PRODUCTION_ACCESS"
)

# Sizing and count values derived by the profile can be tuned per release
# without a code change. Only forward a key when the operator set it, so the
# environment profile stays the default.
add_optional_context() {
  local key="$1"
  local value="$2"
  if [[ -n "$value" ]]; then
    CONTEXT+=(-c "$key=$value")
  fi
}

add_optional_context webDesiredCount "${OWM_WEB_DESIRED_COUNT:-}"
add_optional_context minWebTasks "${OWM_MIN_WEB_TASKS:-}"
add_optional_context maxWebTasks "${OWM_MAX_WEB_TASKS:-}"
add_optional_context workerDesiredCount "${OWM_WORKER_DESIRED_COUNT:-}"
add_optional_context minWorkerTasks "${OWM_MIN_WORKER_TASKS:-}"
add_optional_context maxWorkerTasks "${OWM_MAX_WORKER_TASKS:-}"
add_optional_context webCpu "${OWM_WEB_CPU:-}"
add_optional_context webMemoryMiB "${OWM_WEB_MEMORY:-}"
add_optional_context workerCpu "${OWM_WORKER_CPU:-}"
add_optional_context workerMemoryMiB "${OWM_WORKER_MEMORY:-}"
add_optional_context dbInstanceClass "${OWM_DB_INSTANCE_CLASS:-}"
add_optional_context dbInstanceSize "${OWM_DB_INSTANCE_SIZE:-}"
add_optional_context dbAllocatedStorage "${OWM_DB_ALLOCATED_STORAGE:-}"
add_optional_context dbMaxAllocatedStorage "${OWM_DB_MAX_ALLOCATED_STORAGE:-}"
add_optional_context dbBackupRetentionDays "${OWM_DB_BACKUP_RETENTION_DAYS:-}"
add_optional_context cacheNodeType "${OWM_CACHE_NODE_TYPE:-}"
add_optional_context natGateways "${OWM_NAT_GATEWAYS:-}"

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
FOUNDATION_CREATED=0
if ! aws ecr describe-repositories --repository-names "${NAME_PREFIX}-web" >/dev/null 2>&1; then
  echo "Creating the foundation stack before the first image push"
  deploy "$FOUNDATION"
  FOUNDATION_CREATED=1
fi

if [[ "${SKIP_BUILD:-0}" == "1" ]]; then
  echo "Checking that image $TAG already exists in both ECR repositories"
  for repository in web worker; do
    repository_name="${NAME_PREFIX}-${repository}"
    if ! aws ecr describe-images \
        --repository-name "$repository_name" \
        --image-ids "imageTag=$TAG" >/dev/null 2>&1; then
      echo "Image $TAG is not in $repository_name; cannot use SKIP_BUILD=1." >&2
      exit 1
    fi
  done
  echo "Using the existing $TAG images"
else
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
fi

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

# Production rollback point. Skip the snapshot only when this run created the
# database for the first time. A retry after a failed migration still snapshots
# the partially migrated database before trying again.
snapshot_database() {
  if [[ "$ENVIRONMENT" != "production" ]]; then
    return
  fi
  if [[ "${SKIP_SNAPSHOT:-0}" == "1" ]]; then
    echo "Skipping the pre-migration snapshot because SKIP_SNAPSHOT=1"
    return
  fi
  if [[ "$FOUNDATION_CREATED" == "1" ]]; then
    echo "Skipping the pre-migration snapshot: the database was created in this run"
    return
  fi

  local db_id
  db_id="$(output "$FOUNDATION" DatabaseInstanceIdentifier)"
  if [[ -z "$db_id" || "$db_id" == "None" ]]; then
    echo "The foundation stack did not report DatabaseInstanceIdentifier; refusing to migrate without a snapshot." >&2
    exit 1
  fi
  if ! aws rds describe-db-instances --db-instance-identifier "$db_id" >/dev/null 2>&1; then
    echo "Skipping the pre-migration snapshot: database $db_id does not exist yet"
    return
  fi

  local snapshot_tag
  snapshot_tag="$(printf '%s' "$TAG" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9-' '-')"
  local snapshot="${NAME_PREFIX}-pre-${snapshot_tag}-$(date -u +%Y%m%dT%H%M%SZ)"
  echo "Taking the pre-migration snapshot $snapshot"
  if ! aws rds create-db-snapshot \
      --db-instance-identifier "$db_id" \
      --db-snapshot-identifier "$snapshot" >/dev/null; then
    echo "Could not start snapshot $snapshot; aborting before the migration task." >&2
    exit 1
  fi
  if ! aws rds wait db-snapshot-completed --db-snapshot-identifier "$snapshot"; then
    echo "Snapshot $snapshot did not complete; aborting before the migration task." >&2
    exit 1
  fi
  echo "Snapshot $snapshot is available"
}

snapshot_database

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
echo "$STACK_PREFIX is deployed: $APP_URL"
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
