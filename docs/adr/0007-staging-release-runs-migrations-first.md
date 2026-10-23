# Staging releases run a migration task before ECS services roll

Staging is split into two CDK stacks. `OwmStagingFoundation` owns the network,
RDS, ElastiCache, ECR, secrets, SES, logs, cluster and the web/worker/migrate
task definitions. `OwmStagingApp` owns the ALB and the two ECS services. A
release builds and pushes images, deploys the Foundation stack to register new
task-definition revisions, runs the `bootstrap` task (Drizzle migrations plus
the Model registry upsert) and waits for exit 0, then updates both services to
the new revisions and waits for `services-stable`.

The ECS services reference their task definition by **family** rather than by
ARN, and the release script pins the new revision. CDK therefore never imports
a task-definition ARN from the Foundation stack across stacks, which would make
CloudFormation refuse a Foundation update while the App stack uses the export.
The migration task runs from the same worker image, in the private subnets, with
the same database secret.

**Considered options**: one stack with the services rolling during `cdk deploy`
(migrations would run after new code was already serving, or require a second
deploy); a CloudFormation custom resource that starts and polls the ECS task
(more moving parts and a Lambda in the deployment path); CodeDeploy with a
lifecycle hook (correct but much more machinery for staging); the first web task
running migrations on startup (racing migrations across tasks).

**Consequences**: `pnpm deploy:staging` is the release path, not a bare
`cdk deploy`. Migrations are forward-only and must be compatible with the
currently running revision; the script does not roll the database back. A
failed migration stops the release before any service is updated. The App stack
is effectively created once; subsequent releases are Foundation updates plus
`aws ecs update-service` calls.
