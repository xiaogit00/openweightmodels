# 12: Run real OpenRouter generations

**What to build:** Switching from the mock provider to a real OpenAI-compatible provider produces real Challenger Responses through the existing Job pipeline. Tokens stream into the Job view, final token count, latency and provider-reported cost are stored, and provider failures use the existing timeout, Retry and Skip path. Keys stay in environment/secret storage.

**Blocked by:** 03 — Watch a Job live, recover failures, and Publish.

**Status:** ready-for-agent

- [ ] An environment switch selects the real provider; a missing key fails clearly and never falls back silently to mock.
- [ ] A real streaming call persists the final content, token count, latency and cost when the provider reports it.
- [ ] A 120-second timeout and provider errors produce Failed with a useful message, Retry and the 24-hour auto-skip.
- [ ] Provider concurrency respects the configured cap.
- [ ] The same Prompt and generation parameters are sent to every Challenger in a Comparison.
- [ ] At least one real model call is verified end-to-end with a live key; mock remains the default for development and tests.
- [ ] No API key appears in the database, logs, client bundle or committed files.
