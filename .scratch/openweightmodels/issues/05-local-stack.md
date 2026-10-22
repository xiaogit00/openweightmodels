# 05: One-command local environment

**What to build:** A clean checkout can run the complete Milestone 1 experience with one command. The local stack includes web, worker, Postgres, Redis and Mailpit, applies migrations and dev seed, and supports the full upload → schedule → live Job → publish → annotate journey. Homebrew services remain documented as a fallback for machines without Docker.

**Blocked by:** 03 — Watch a Job live, recover failures, and Publish.

**Status:** done

- [x] One documented command starts web, worker, Postgres, Redis and Mailpit with health checks and correct startup ordering.
- [x] Migrations and dev seed run automatically or through one documented command, and re-running is idempotent.
- [x] The seeded user can schedule a Comparison, watch the mock Job complete over SSE, publish it and open the Comparison.
- [x] The web and worker containers share the same domain code and configuration as local development.
- [x] `.env.example` documents every required variable; no secret or real credential is committed.
- [x] The README documents both the Docker path and the Homebrew fallback, including how to reset the database.
- [x] Stopping the stack does not silently delete data unless an explicit reset flag is used.

## Comments

- 2026-10-22 — Implemented. `docker compose up --build` is the one command. `docker-compose.yml` runs Postgres 17, Redis 8 (AOF, `noeviction`) and Mailpit v1.29 alongside a one-shot `migrate` service and the web and worker containers. All three app services build the same `Dockerfile` `dev` target, bind-mount the repo, keep the image's `node_modules` in anonymous volumes, and share `@owm/core` through the workspace. Postgres, Redis and Mailpit have health checks; `migrate` waits for healthy Postgres; web and worker wait for `service_completed_successfully` and healthy Redis (web also Mailpit). Web health checks `/api/models`; the worker gained a liveness `/healthz` that only listens when `WORKER_HEALTH_PORT` is set, which compose sets to 3001 so local and E2E worker runs keep their ports free.
- `pnpm db:init` (new) applies migrations, then seeds only when both `users` and `comparisons` are empty, so every start is idempotent and never truncates existing data. `pnpm db:seed` still replaces content on request; it now truncates and inserts inside one transaction, so a failed seed rolls back to empty and the next `db:init` retries instead of seeing a half-seeded database with users present. The entrypoint/close boilerplate is shared through `packages/core/src/db/run-script.ts`.
- Data lives in the named volumes `postgres-data` and `redis-data`. `docker compose down` keeps them; only `docker compose down --volumes` or `pnpm stack:reset` deletes data. `pnpm stack:seed` is the explicit reseed, and `pnpm stack:logs` follows both app containers.
- Verified on the Homebrew path (no Docker on this machine): `pnpm db:init` run twice against a scratch database seeded 3 users / 16 Comparisons / 6 Annotations on the first run and logged "data present, skipping seed" on the second. `pnpm dev` then served the seeded `@mira` identity; a two-Challenger Comparison reached Ready in about two seconds with token and latency data, published, appeared on the Board for anonymous readers, and accepted an Annotation with a thread reply, a Comment and a vote from `@kev`. `pnpm typecheck`, `pnpm test` (122 core, 6 worker), `pnpm build` and `pnpm test:e2e` pass.
- **Caveat:** Docker is not installed on this machine, so `docker compose up` itself was not executed. The compose file validates against the official compose-spec JSON schema, and `packages/core/test/local-stack.test.ts` asserts the services, shared image, startup ordering, health checks, named volumes, pinned images and `.env.example` host ports without needing Docker. The Dockerfile and Next 16 command line were reviewed against local `next dev --help`, but the first person with a Docker daemon should run `docker compose up --build` to confirm the image build and bind mounts.
- `.env.example` now documents the compose host ports (`POSTGRES_PORT`, `REDIS_PORT`, `MAILPIT_SMTP_PORT`, `MAILPIT_UI_PORT`, `WEB_PORT`), the optional `WORKER_HEALTH_PORT`, `DATABASE_POOL_MAX` and `MOCK_FAIL_MODEL`, and notes that Homebrew Postgres needs the OS user in `DATABASE_URL`. No `.env` is copied into the image or referenced by `env_file`; compose supplies the container URLs explicitly.
