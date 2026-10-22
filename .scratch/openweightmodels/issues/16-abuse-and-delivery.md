# 16: Abuse controls, spend caps and delivery pipeline

**What to build:** The production system has guardrails and a repeatable delivery path. Magic-link and API endpoints are rate-limited, provider spend has an absolute ceiling and alarms, operational failures are visible to a named owner, and deploys run through CI using short-lived AWS credentials rather than stored keys.

**Blocked by:** 13 — Deploy staging on AWS.

**Status:** ready-for-agent

- [ ] Magic-link requests are limited per email and per IP; verification attempts are rate-limited.
- [ ] Write and generation APIs enforce per-user and per-IP limits and return 429 with retry guidance.
- [ ] A configurable monthly spend cap and AWS budget alarms bound model and infrastructure cost; breaching the cap stops new generations safely.
- [ ] CloudWatch alarms cover ALB 5xx, unhealthy ECS tasks, queue depth and job failure rate, with a named owner.
- [ ] Application errors are reported to the chosen error tracker with enough context to diagnose a failed Run.
- [ ] CI runs typecheck, tests and build, then deploys through AWS OIDC without long-lived access keys.
- [ ] Migrations run automatically and safely during deployment, with a documented rollback path.
