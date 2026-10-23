# 13: Deploy staging on AWS

**What to build:** A staging environment runs the real production topology on AWS: separate web and worker containers on ECS Fargate behind an ALB, RDS Postgres, node-based ElastiCache Redis, SES for magic links, ECR for images, Secrets Manager for credentials and CloudWatch for logs. Migrations run as a deployment task. The Board, SSE, scheduling, a real generation, publishing and annotations all work over HTTPS.

**Blocked by:** 05 — One-command local environment; 07 — Sign in with email magic links; 12 — Run real OpenRouter generations.

**Status:** ready-for-human

- [ ] A documented CDK deployment bootstraps a clean AWS account and creates the staging stack.
- [x] Web and worker run as separate ECS Fargate services with health checks and correct scaling minima.
- [ ] The ALB idle timeout is raised and SSE survives more than five minutes without traffic; heartbeats are visible.
- [x] RDS PostgreSQL and node-based ElastiCache Redis (cluster mode off, `noeviction`) are provisioned; a migration task runs before the web service rolls.
- [x] Provider keys, database credentials and SES credentials live in Secrets Manager and are injected at runtime; nothing secret is in the repository or database. (SES uses the web task role instead of stored SMTP credentials, so there is no SES secret to rotate.)
- [ ] SES sends a magic link to a verified address while the account is in the sandbox.
- [ ] The staging URL supports Board, sign-in, upload, real generation, publish, Comparison and Annotation.
- [x] Logs, basic metrics and a monthly cost estimate are documented.

## Comments

- 2026-10-23 — Implemented and synth/test-verified; the three unchecked items require a real AWS account and deploy. `infra/` is a CDK TypeScript app with `OwmStagingFoundation` (VPC, RDS 17, ElastiCache 7 with a `redis7` `noeviction` parameter group and TLS, ECR, secrets, SES identity, log groups, cluster, web/worker/migrate task definitions) and `OwmStagingApp` (ALB with HTTPS, HTTP→HTTPS redirect, 4000s idle timeout, `/api/health` target-group check, two Fargate services with circuit breakers and auto-scaling minima). `Dockerfile` gained ARM64 `web` (Next standalone) and `worker` (tsx runtime + migrations) targets. `pnpm deploy:staging` (`infra/scripts/deploy.sh`) bootstraps CDK, creates ECR before the first push, builds/pushes images, registers task definitions, refuses an empty provider secret, runs `db/bootstrap.ts` (Drizzle migrations plus the Model registry, never dev content), then creates the App stack and pins both services to the new revision after the migration exits 0 (ADR 0007). Database credentials are injected as Secrets Manager fields and assembled into a URL in-process; Redis uses host/port/TLS; the provider key is worker-only; magic links use SES v2 through the web task role (`EMAIL_TRANSPORT=ses`). `/api/health` returns 503 only when Postgres is unreachable and `degraded` (200) when Redis is down. `infra/test/*` synthesizes both stacks offline (idle timeout, HTTPS redirect, health check, Fargate/ARM64, secrets, RDS/Redis, SES policy, logs, service minima, release ordering) and `packages/core/test/config.test.ts`, `apps/web/test/{health,mail-ses}.test.ts` and `packages/core/test/model-registry.test.ts` cover the new seams. `docs/DEPLOYMENT.md` covers prerequisites, secrets, first deploy, release, SSE/SES smoke checks, rollback, operations and the ~$130–160/month estimate. Remaining owner steps: supply the domain/Route53 zone (or ACM certificate), run `pnpm deploy:staging`, put the OpenRouter key in Secrets Manager, verify the SES identity, and run the staging smoke checklist, including the 5-minute SSE heartbeat check.
