# 20: Replay every Turn of a Conversation

**What to build:** A Conversation with several Turns can be replayed end to end, even though the import form does not exist yet: creation accepts a Turn script with a Base reply per Turn, each Challenger answers every Turn in order, and the Job page shows one row per Challenger with its Turn progress. A Turn that fails can be retried without losing earlier answers, and skipping stops that Challenger's Replay for good. A basic stacked transcript makes the result readable and publishable.

**Blocked by:** 19 — Write one prompt, paste one reply.

**Status:** ready-for-agent

- [ ] Creation accepts up to 6 Turns plus one Base reply per Turn and queues one Replay per Challenger.
- [ ] For Turn n, each Challenger receives the Conversation's user messages 1..n and its own Responses 1..n-1; it never receives the Base model's replies or reasoning content.
- [ ] Turns of one Challenger run in order; different Challengers run in parallel.
- [ ] Each Turn has its own status, tokens, latency, error and attempt; a failure marks only that Turn.
- [ ] The Job page shows one row per Challenger with "turn n of m" and aggregate progress.
- [ ] Retry resumes at the failed Turn; Skip cascades to every later Turn of that Challenger; a Replay is finished when all its Turns are done or skipped.
- [ ] Publish unlocks when every Challenger's Replay is finished, and a stopped Replay is labelled as such on the Comparison.
- [ ] Limits (6 Turns, 0.5 MB, 100,000 characters) are enforced before a Job is queued.
- [ ] `BACKEND.md` documents the message-array contract, per-Turn status and the Replay lifecycle.
