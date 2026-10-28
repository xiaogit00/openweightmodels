# 19: Write one prompt, paste one reply

**What to build:** An author can create a one-Turn Comparison without uploading a file: a "Write a prompt" tab takes a Prompt and a pasted Base reply. This lands the Turn-aware model underneath — the Conversation and Turn storage, one Response per Model per Turn, and a provider call that takes a message array — while every existing single-Prompt Comparison keeps working untouched.

**Blocked by:** None (can start immediately).

**Status:** done

- [x] Comparison storage has an ordered Turn list and one Response per Model per Turn; existing Comparisons are backfilled so each has exactly one Turn.
- [x] The New Comparison form offers "Upload a conversation" and "Write a prompt"; the second accepts a Prompt and a Base reply and creates a one-Turn Comparison.
- [x] A one-Turn Comparison schedules, replays, renders and publishes exactly as today; the existing upload path still works and lands as one Turn.
- [x] Providers receive a message array; with one Turn it contains only that user message, and the mock provider still streams.
- [x] Existing unit, integration, browser and visual tests pass unchanged.

## Comments

- 2026-10-28 — Implemented. Storage now has a `turns` table (`comparison_id`, zero-based `position`, `prompt`) and every Response carries a `turn_id`; `responses` is unique on `(turn_id, model_id)` with one Base Response per Turn. Migration `0006` creates the table, backfills one Turn per existing Comparison from `comparisons.prompt` (minting UUIDv7 ids in SQL), attaches every existing Response, then makes `turn_id` required. Verified against a scratch database seeded with a legacy Comparison. `comparisons.prompt` stays as the denormalised first-Turn headline so Board search, the Job page and account export need no join.
- Creation accepts either the uploaded file or a pasted `base_output`; both resolve to one Turn and the Response/Job shape is unchanged. The API rejects a request carrying both, and defaults a missing title to a summary of the prompt on the write path. The form puts "Upload a conversation" and "Write a prompt" in one toggle group. Providers now take a `ChatMessage[]` — one user message for a single-Turn Comparison — and the mock still streams from the latest user message. `addModelToComparison` attaches the new Replay to the first Turn.
- Verification: `pnpm typecheck`, `pnpm --filter @owm/core test` (214 passed, 1 skipped), `pnpm test:e2e` (35 passed) and `pnpm --filter @owm/web build` all pass. Existing Comparison and Job visual baselines are unchanged; `new-comparison-1440.png` was regenerated because the form gained the tab row. To keep the message-array seam honest, `providers.test.ts` call sites moved from `prompt` to `messages`, `provider-pipeline.test.ts` now asserts the full one-message array, and `pipeline.test.ts` covers creation from a pasted Base output, title defaulting and the output limits. No browser behaviour outside the new tab changed.
