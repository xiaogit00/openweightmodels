# 13: Deploy staging on AWS

**What to build:** A staging environment runs the real production topology on AWS: separate web and worker containers on ECS Fargate behind an ALB, RDS Postgres, node-based ElastiCache Redis, SES for magic links, ECR for images, Secrets Manager for credentials and CloudWatch for logs. Migrations run as a deployment task. The Board, SSE, scheduling, a real generation, publishing and annotations all work over HTTPS.

**Blocked by:** 05 — One-command local environment; 07 — Sign in with email magic links; 12 — Run real OpenRouter generations.

**Status:** ready-for-agent

- [ ] A documented CDK deployment bootstraps a clean AWS account and creates the staging stack.
- [ ] Web and worker run as separate ECS Fargate services with health checks and correct scaling minima.
- [ ] The ALB idle timeout is raised and SSE survives more than five minutes without traffic; heartbeats are visible.
- [ ] RDS PostgreSQL and node-based ElastiCache Redis (cluster mode off, `noeviction`) are provisioned; a migration task runs before the web service rolls.
- [ ] Provider keys, database credentials and SES credentials live in Secrets Manager and are injected at runtime; nothing secret is in the repository or database.
- [ ] SES sends a magic link to a verified address while the account is in the sandbox.
- [ ] The staging URL supports Board, sign-in, upload, real generation, publish, Comparison and Annotation.
- [ ] Logs, basic metrics and a monthly cost estimate are documented.
