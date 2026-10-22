# 01: Run a scheduled Challenger through the worker

**What to build:** A scheduled Comparison's queued Challenger Runs are processed without manual intervention. Each Run moves through Queued → Calling API → Generating → Done, persists its Response, and emits live status. A failed Run can be Retried or Skipped, or is auto-skipped after 24 hours. When every Run in the Job is Done or Skipped, the Job and Comparison become Ready and the Author receives an in-app notification.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] A worker process starts from the documented development command and consumes the generation queue.
- [ ] A queued Run calls the mock provider, persists streamed content, token count and latency, and reaches Done.
- [ ] Job and Comparison become Ready only when every Run in that Job is Done or Skipped.
- [ ] A forced mock failure produces Failed with an error; Retry increments the attempt and succeeds; Skip settles the Run.
- [ ] A failed Run left untouched is auto-skipped after the configured 24-hour delay.
- [ ] Job events are persisted and emitted for Calling, Generating, Done/Failed and Job Ready.
- [ ] The Author receives one in-app job-ready notification when the Job settles.
- [ ] No duplicate Response row or duplicate notification is created by retries or concurrent completion.

## Comments

- 2026-10-22 — Implemented. `apps/worker` now boots from `pnpm dev:worker` (and `pnpm dev`), consumes `run` and `auto-skip`, loads the repo-root `.env`, and shuts down cleanly on SIGINT/SIGTERM.
- Covered by 7 core lifecycle tests (`packages/core/test/jobs.test.ts`) and 3 worker tests (`apps/worker/test/run-worker.test.ts`): streamed completion with content/tokens/latency, readiness gating, forced failure → retry, skip, auto-skip, single notification under concurrent finalisation, and one provider call for a duplicate delivery. Integration suites skip with a warning when Postgres or Redis is unavailable.
- Defects found and fixed while testing: BullMQ rejects `:` in custom job ids, so the auto-skip job was never scheduled; auto-skip ids are now attempt-scoped so retries get a fresh 24-hour window; `job.ready` is unique per Author per Job via a partial index; `queued → calling` is now an atomic claim.
- Migration `0001_fuzzy_tag.sql` adds the notification index; `pnpm db:migrate` now loads the repo-root `.env`.
- Manual smoke: `pnpm dev:worker` logs `[worker] consuming owm-runs with concurrency 4`.
