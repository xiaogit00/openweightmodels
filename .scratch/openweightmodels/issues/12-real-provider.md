# 12: Run real OpenRouter generations

**What to build:** Switching from the mock provider to a real OpenAI-compatible provider produces real Challenger Responses through the existing Job pipeline. Tokens stream into the Job view, final token count, latency and provider-reported cost are stored, and provider failures use the existing timeout, Retry and Skip path. Keys stay in environment/secret storage.

**Blocked by:** 03 — Watch a Job live, recover failures, and Publish.

**Status:** ready-for-human

- [x] An environment switch selects the real provider; a missing key fails clearly and never falls back silently to mock.
- [x] A real streaming call persists the final content, token count, latency and cost when the provider reports it.
- [x] A 120-second timeout and provider errors produce Failed with a useful message, Retry and the 24-hour auto-skip.
- [x] Provider concurrency respects the configured cap.
- [x] The same Prompt and generation parameters are sent to every Challenger in a Comparison.
- [ ] At least one real model call is verified end-to-end with a live key; mock remains the default for development and tests.
- [x] No API key appears in the database, logs, client bundle or committed files.

## Comments

Implementation complete; only the live-key smoke test remains.

- `PROVIDER=mock` stays the default. Setting `PROVIDER` to a real provider slug (for example `openrouter`) never falls back to mock: a missing `${PROVIDER}_API_KEY` fails worker startup with the variable named, and a Model registered under a different provider is rejected at run time.
- The OpenAI-compatible adapter sends the frozen Prompt with `temperature: 0.7`, `max_tokens: 4096`, streaming, `stream_options.include_usage`, and a fixed 120s timeout. It persists final content, provider completion tokens, latency and `cost_usd`, parses mid-stream error frames, and redacts the key from stored error messages.
- `PROVIDER_CONCURRENCY` is read once by the worker (`resolveConcurrency`); an invalid value fails startup.
- Verified with `pnpm typecheck` and `pnpm test` (184 core, 13 web, 9 worker). New coverage: `packages/core/test/providers.test.ts` and `packages/core/test/provider-pipeline.test.ts`, using a local OpenAI-compatible streaming server (`packages/core/test/fake-openai.ts`).
- Live sign-off (needs a real key):

  ```bash
  PROVIDER=openrouter OPENROUTER_API_KEY=sk-or-... pnpm dev
  # create a 1-Challenger Comparison, confirm the stream on the Job page,
  # then confirm responses.tokens/latency_ms/cost_usd are populated
  ```
