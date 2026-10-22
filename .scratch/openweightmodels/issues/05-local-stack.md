# 05: One-command local environment

**What to build:** A clean checkout can run the complete Milestone 1 experience with one command. The local stack includes web, worker, Postgres, Redis and Mailpit, applies migrations and dev seed, and supports the full upload → schedule → live Job → publish → annotate journey. Homebrew services remain documented as a fallback for machines without Docker.

**Blocked by:** 03 — Watch a Job live, recover failures, and Publish.

**Status:** ready-for-agent

- [ ] One documented command starts web, worker, Postgres, Redis and Mailpit with health checks and correct startup ordering.
- [ ] Migrations and dev seed run automatically or through one documented command, and re-running is idempotent.
- [ ] The seeded user can schedule a Comparison, watch the mock Job complete over SSE, publish it and open the Comparison.
- [ ] The web and worker containers share the same domain code and configuration as local development.
- [ ] `.env.example` documents every required variable; no secret or real credential is committed.
- [ ] The README documents both the Docker path and the Homebrew fallback, including how to reset the database.
- [ ] Stopping the stack does not silently delete data unless an explicit reset flag is used.
