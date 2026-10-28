# 19: Write one prompt, paste one reply

**What to build:** An author can create a one-Turn Comparison without uploading a file: a "Write a prompt" tab takes a Prompt and a pasted Base reply. This lands the Turn-aware model underneath — the Conversation and Turn storage, one Response per Model per Turn, and a provider call that takes a message array — while every existing single-Prompt Comparison keeps working untouched.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Comparison storage has an ordered Turn list and one Response per Model per Turn; existing Comparisons are backfilled so each has exactly one Turn.
- [ ] The New Comparison form offers "Upload a conversation" and "Write a prompt"; the second accepts a Prompt and a Base reply and creates a one-Turn Comparison.
- [ ] A one-Turn Comparison schedules, replays, renders and publishes exactly as today; the existing upload path still works and lands as one Turn.
- [ ] Providers receive a message array; with one Turn it contains only that user message, and the mock provider still streams.
- [ ] Existing unit, integration, browser and visual tests pass unchanged.
