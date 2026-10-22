# Postgres is canonical; Redis is transient

Job and Response state lives in Postgres and every status transition is a row update. BullMQ carries work and Redis pub/sub fans events out to SSE connections; neither is a source of truth. We chose this over letting BullMQ own job state because the UI, retries, 24-hour auto-skip and author-only visibility all need queryable, transactional state, and over a Postgres-only queue because the handoff already standardises on BullMQ.

**Considered options**: BullMQ as the authoritative state store (fast, but not transactional with content and invisible to SQL); `pg-boss` (one dependency, but a deviation from the accepted BullMQ stack); Redis only for pub/sub with a fully Postgres-driven scheduler (more custom code, no queue maturity). We did not choose a serverless queue because it would reopen the runtime and SSE decisions.

**Consequences**: Redis can be wiped and non-terminal Runs re-enqueued from Postgres. Every event written to Redis is also persisted (`activity_events`, `job_events`, `responses`) so `Last-Event-ID` can replay missed events. Two stores must be kept consistent in one direction only: Postgres first, then publish. Redis must run with `maxmemory-policy: noeviction`; ElastiCache Serverless is incompatible with BullMQ.
