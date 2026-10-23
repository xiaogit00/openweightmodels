# 12: Run real OpenRouter generations

**What to build:** Switching from the mock provider to a real OpenAI-compatible provider produces real Challenger Responses through the existing Job pipeline. Tokens stream into the Job view, final token count, latency and provider-reported cost are stored, and provider failures use the existing timeout, Retry and Skip path. Keys stay in environment/secret storage.

**Blocked by:** 03 — Watch a Job live, recover failures, and Publish.

**Status:** done

- [x] An environment switch selects the real provider; a missing key fails clearly and never falls back silently to mock.
- [x] A real streaming call persists the final content, token count, latency and cost when the provider reports it.
- [x] A 120-second timeout and provider errors produce Failed with a useful message, Retry and the 24-hour auto-skip.
- [x] Provider concurrency respects the configured cap.
- [x] The same Prompt and generation parameters are sent to every Challenger in a Comparison.
- [x] At least one real model call is verified end-to-end with a live key; mock remains the default for development and tests.
- [x] No API key appears in the database, logs, client bundle or committed files.

## Comments

Implementation complete. The live-key sign-off is recorded below.

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

- 2026-10-23 — Live-key sign-off. Added `packages/core/test/live-provider.test.ts` and `pnpm test:live`: one real `deepseek/deepseek-chat` call driven through `processRun` against Postgres and Redis. It asserts the Run is `done`, the content is non-empty, tokens > 0, latency > 0, `cost_usd` is non-null and positive, at least one `streaming` status reached `job_events`, and the Job and Comparison reach `ready`. Two consecutive runs passed:

  ```
  [live] deepseek/deepseek-chat: status=done tokens=946 latency=17221ms cost=$0.000977 chars=3523
  [live] deepseek/deepseek-chat: status=done tokens=914 latency=18053ms cost=$0.000944 chars=3376
  ```

  Only the `test:live` script runs the file (gated on `npm_lifecycle_event`), so `.env.local` cannot make `pnpm test` bill a provider call; running `pnpm test:live` without a key or without Postgres/Redis fails loudly instead of skipping green. `LIVE_PROVIDER_MODEL` overrides the model. `createJobFixture` now accepts the `apiModelId` option (the `api_model_id` column), and `provider-pipeline.test.ts` asserts the adapter requests exactly that id. `loadEnv()` now reads `.env.local` (Next-style precedence over `.env`), so the key can stay out of shell history. The key was never printed, logged or stored; only the response rows existed, and the fixture removed them.
