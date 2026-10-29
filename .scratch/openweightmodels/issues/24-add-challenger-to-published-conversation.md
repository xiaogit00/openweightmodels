# 24: Add a Challenger to a published multi-Turn Comparison

**What to build:** Add model on a published multi-Turn Comparison replays every stored Turn for the new model, using the stored user messages and never the Base model's replies. The confirmation states the Turn count and the call estimate, and the new Replay appears in the Comparison as it progresses.

**Blocked by:** 22 — Read a multi-Turn Comparison; 23 — Board, search and titles for conversations.

**Status:** done

- [x] Adding a model to a published Comparison creates a Replay over every Turn.
- [x] The confirmation states "replays 6 turns" (or the actual count) and the call estimate.
- [x] The new Replay streams into the published Comparison with a "Replay in progress" marker.
- [x] Existing Challengers and the published state are unaffected.
- [x] The Challenger cap still applies across the whole Comparison.

## Comments

- 2026-10-29 — Implemented. `addModelToComparison` now queues one Response per stored Turn on one Job and enqueues only the first Turn, so the existing sequential Replay chaining (`enqueueNextTurn`, Retry, Skip) carries the new Challenger through the whole Conversation. It returns `{ jobId, responseId, turnCount, estimatedCalls, responses }`; the cap still counts distinct Challenger Models, not Turns.
- The public read now includes the whole Replay once its first Turn is done, so pending, streaming and failed Turns are visible in place instead of appearing only after the entire Replay settles. A Challenger with no done Turn remains author-only, preserving the failed-add rule. `modelsWithReplayInProgress` drives a visible "Replay in progress" tab marker; the representative tab Response prefers a failed or pending Turn over a done one, so a paused or stuck Replay is labelled honestly.
- The multi-Turn Add model menu was extracted into a shared `AddModelMenu`. A multi-Turn selection opens a confirmation reading "{model} replays 3 turns · 3 hosted API calls." before any call is made; a one-Turn Comparison keeps the existing click-to-add behaviour and trigger padding. The client seeds one queued pane per returned Response so the Replay appears immediately and the Job's SSE events update those exact rows.
- `docs/DECISIONS.md` #19 and edge case 6 now record the multi-Turn streaming rule rather than the old all-pending-author-only rule; `BACKEND.md`'s add-model section and API table match. Wording follows the ticket's mandated "replays N turns" and "Replay in progress" even though the general wording rule avoids "Replay".
- Coverage: `add-challenger.test.ts` asserts one Response per Turn, the queued author view, reader visibility once Turn 1 is done, completion, unchanged existing content and published state, a 3-Turn card, and the cap counting Challengers not Turns; `comparison-responses.test.ts` covers the in-progress marker; `e2e/add-challenger-multi-turn.spec.ts` covers confirmation copy, cancel, immediate marker, reader visibility and completion.
- Verification: `pnpm typecheck`, `pnpm test` (240 core, 79 web, 9 worker, 24 infra) and the full `pnpm test:e2e` suite (39 browser tests) pass. The regenerated `apps/web/next-env.d.ts` dev-path churn was reverted as unrelated.
