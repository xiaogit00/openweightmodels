# 20: Replay every Turn of a Conversation

**What to build:** A Conversation with several Turns can be replayed end to end, even though the import form does not exist yet: creation accepts a Turn script with a Base reply per Turn, each Challenger answers every Turn in order, and the Job page shows one row per Challenger with its Turn progress. A Turn that fails can be retried without losing earlier answers, and skipping stops that Challenger's Replay for good. A basic stacked transcript makes the result readable and publishable.

**Blocked by:** 19 — Write one prompt, paste one reply.

**Status:** done

- [x] Creation accepts up to 6 Turns plus one Base reply per Turn and queues one Replay per Challenger.
- [x] For Turn n, each Challenger receives the Conversation's user messages 1..n and its own Responses 1..n-1; it never receives the Base model's replies or reasoning content.
- [x] Turns of one Challenger run in order; different Challengers run in parallel.
- [x] Each Turn has its own status, tokens, latency, error and attempt; a failure marks only that Turn.
- [x] The Job page shows one row per Challenger with "turn n of m" and aggregate progress.
- [x] Retry resumes at the failed Turn; Skip cascades to every later Turn of that Challenger; a Replay is finished when all its Turns are done or skipped.
- [x] Publish unlocks when every Challenger's Replay is finished, and a stopped Replay is labelled as such on the Comparison.
- [x] Limits (6 Turns, 0.5 MB, 100,000 characters) are enforced before a Job is queued.
- [x] `BACKEND.md` documents the message-array contract, per-Turn status and the Replay lifecycle.


## Comments

- Implemented: Turn script creation (`turns` form field / `CreateComparisonInput.turns`), sequential Replay chaining, per-Turn statuses, Retry/Skip semantics, grouped Job rows, basic stacked transcript with a stopped-Replay label, limits, and the `BACKEND.md` contract update.
- `pnpm typecheck`, `pnpm test` and the full `pnpm test:e2e` suite pass (36 browser tests).
- Leaving multi-Turn Add model to ticket 24; the multi-Turn reader is deliberately basic until ticket 22.
