# 24: Add a Challenger to a published multi-Turn Comparison

**What to build:** Add model on a published multi-Turn Comparison replays every stored Turn for the new model, using the stored user messages and never the Base model's replies. The confirmation states the Turn count and the call estimate, and the new Replay appears in the Comparison as it progresses.

**Blocked by:** 22 — Read a multi-Turn Comparison; 23 — Board, search and titles for conversations.

**Status:** ready-for-agent

- [ ] Adding a model to a published Comparison creates a Replay over every Turn.
- [ ] The confirmation states "replays 6 turns" (or the actual count) and the call estimate.
- [ ] The new Replay streams into the published Comparison with a "Replay in progress" marker.
- [ ] Existing Challengers and the published state are unaffected.
- [ ] The Challenger cap still applies across the whole Comparison.
