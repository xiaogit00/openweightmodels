# Web search, grounding, and reasoning

**Research note — 2026-11-28.** How hosted (OpenRouter) and local open-weight models get live web results, what those results do to the prompt and the context window, where reasoning happens, and how to reproduce the same behaviour without OpenRouter.

Claims are tagged:

- **Verified** — stated in the linked primary source at the time of writing.
- **Inference** — mechanically implied by verified facts, not stated verbatim.
- **Gap** — could not be confirmed from a primary source.

Version sensitivity is severe here: flag names, parser names, and even response fields change between minor releases. Treat every command as "as of the linked docs".

---

## TL;DR

1. There are three distinct things people call "search": a **request transform** (OpenRouter's `web` plugin), a **server-side tool the model calls** (`openrouter:web_search`), and a **client-side tool loop** (your harness executes a function). Only the last two let the model decide *whether* and *what* to search.
2. The `web` plugin performs **one search per request, before decoding**, and injects the results as a **system message before the user message**. The model never sees a tool. This is why it works with any model, including models with no function-calling ability.
3. **`engine: "native"` on a non-native model silently performs no search.** It does not error and does not fall back. The server tool's `native` does fall back to Exa.
4. As of this snapshot, OpenRouter marks **the plugin and `:online` as deprecated** in favour of the `openrouter:web_search` server tool. The plugin still works and is fully documented.
5. Defaults: `max_results: 5`; Exa highlights are **~2,000–4,000 characters per result**, so a default search adds roughly **2,500–5,000 input tokens** per request. `search_context_size` is the real cost dial (5K / 15K / 30K chars per result for `low` / `medium` / `high`).
6. Search text consumes **input/context** budget, not `max_tokens`. `max_tokens` only caps completion, and **reasoning tokens count against it**.
7. With the plugin, there is exactly **one reasoning phase**, with results already in context. With the server tool, the order is **reason → search → reason → … → answer**, so a multi-hop request pays for several reasoning phases.
8. Citations arrive **separately from the text**: a `delta.annotations` chunk on Chat Completions (after content, de facto), or an `annotation.added` / final-message annotation on Responses. Buffer the text before rendering citations.
9. Locally, the same split exists: **(a) retrieve-then-inject** (works with any model, mirrors the plugin) and **(b) native tool calls** (requires a tool-aware chat template *and* a parser in the serving stack). Most local deployment failures are a template/parser mismatch.
10. In this repo, the provider parser reads only `delta.content`. Reasoning and annotations are currently dropped — reasoning still costs money, citations still appear inline as markdown links, but there is no structured sources list.

---

# Part I — OpenRouter

## 1. Three surfaces

| Surface | Enabled via | Who searches | Who decides | Frequency |
|---|---|---|---|---|
| `web` plugin | `plugins: [{ id: "web" }]` | OpenRouter / engine | Harness (always) | Once per request |
| `:online` suffix | `model: "vendor/model:online"` | same as plugin | Harness (always) | Once per request |
| Server tool | `tools: [{ type: "openrouter:web_search" }]` | OpenRouter or provider | **The model** | 0–N per request |
| User-defined tool | `tools: [{ type: "function", … }]` | Your application | The model | 0–N per request |

OpenRouter's own comparison table: plugins "always run once"; server tools are model-invoked 0–N times; user-defined tools are executed by your app ([Plugins](https://openrouter.ai/docs/guides/features/plugins), [Server tools](https://openrouter.ai/docs/guides/features/server-tools)).

## 2. The `web` plugin lifecycle

### 2.1 Exa path (default for non-native models)

```
CLIENT
  │  POST /chat/completions { plugins:[{id:"web"}], messages:[...] }
  ▼
OPENROUTER
  │  1. read plugin config
  │  2. derive a query from the prompt          <-- mechanism undocumented
  │  3. call the engine (Exa by default)
  │       highlights ≈ 2,000–4,000 chars/result
  │       numResults = max_results (default 5)
  │  4. build text: <search_prompt with current date> + results
  │  5. PREPEND as a system message before the user message
  ▼
PROVIDER  (one completion call; the model sees only prompt tokens)
  │  decode: [reasoning tokens] -> [content tokens]
  │  content cites with markdown links per instruction
  ▼
OPENROUTER
  │  6. attach url_citation annotations (spans over final text)
  │  7. stream text deltas → delta.annotations → usage chunk
  ▼
CLIENT  (buffer text; citations arrive late)
```

Verified points:

- "The web plugin **runs a single search before the model starts writing**" ([benchmark post](https://openrouter.ai/blog/announcements/web-search-benchmark)).
- "Your prompt is passed to Exa… The results are then merged into a prompt." / "The plugin injects this as a **system message before the user message** in the request payload" ([announcement](https://openrouter.ai/blog/announcements/introducing-web-search-via-the-api)).
- Results are Exa **highlights**, not full pages: "extractive excerpts… typically ~2,000–4,000 characters per result", with `[...]` separating excerpts from the same page ([plugin docs](https://openrouter.ai/docs/features/web-search)).

**Gap:** no doc says whether the query is the last user message, a rewrite, or a condensation of history. For multi-turn chats a follow-up like "and the second one?" has no searchable entity unless history is included. There is no documented way to pass an explicit query to the plugin.

**Gap:** the literal serialisation of each result inside the system message (numbering, labels, URL placement) is not documented. Do not build a parser against an assumed format.

### 2.2 The citation instruction is the enforcement mechanism

The default `search_prompt` is:

```
A web search was conducted on `date`. Incorporate the following web search results into your response.

IMPORTANT: Cite them using markdown links named using the domain of the source.
Example: [nytimes.com](https://nytimes.com/some-page).
```

It is replaceable via `plugins[].search_prompt`. Replacing it without the "IMPORTANT: Cite…" line removes the only citation instruction. There is no post-hoc validation, retry, or guarantee that the model cites real result URLs.

**Gap:** how `url_citation` spans are produced on the Exa path (parsed from the model's markdown? matched against returned URLs?) is undocumented.

### 2.3 `:online`

`:online` is documented as exactly equivalent to `plugins: [{ id: "web" }]`. The docs' own snippet substitutes `openrouter/auto` for the model, which is misleading — the model part is preserved in practice. `:free:online` also works, and **search still costs money on free models** ([plugin docs](https://openrouter.ai/docs/features/web-search)).

## 3. Engines, and the silent-native trap

Default when `engine` is omitted:

- **Native** for OpenAI, Anthropic, Google, Perplexity and xAI models that support it.
- **Exa** for everything else, or when native is unsupported.

Explicit `engine` values: `native`, `exa`, `firecrawl`, `parallel`, `perplexity`, plus engine-specific `mode`.

The critical asymmetry ([plugin docs](https://openrouter.ai/docs/features/web-search) vs [server-tool docs](https://openrouter.ai/docs/guides/features/server-tools/web-search)):

| Setting | Model without native search |
|---|---|
| Plugin, `engine: "native"` | **No search at all** — no error, no fallback |
| Plugin, engine omitted | Falls back to Exa |
| Server tool, `engine: "native"` | **Falls back to Exa** |
| Server tool, `engine: "auto"` (default) | Native if available, else Exa |

Native-provider coverage, per the server-tool page: OpenAI GPT-4.1/5+, o3/o4-mini; Anthropic Claude 3.5 Haiku, 3.7 Sonnet, 4+; Google Gemini 3+; xAI Grok 4+; all Perplexity models. Older OpenAI models (GPT-4o, GPT-4 Turbo) are **not** native and fall back to Exa on the server-tool path.

**Fairness implication:** if a comparison mixes model families, an omitted `engine` sends some challengers through native search and others through Exa — different result sets, formatting and pricing. Pinning `"engine": "exa"` gives every challenger the same retrieval path.

## 4. The `openrouter:web_search` server tool

```
CLIENT → OPENROUTER: tools:[{ type:"openrouter:web_search", parameters:{…} }]
OPENROUTER: agent loop, step budget max_tool_calls (default 30)
  ┌──────────────────────────────────────────────────────┐
  │ decode step                                          │
  │   model reasons (reasoning tokens, billed)           │
  │   model emits {query}  ── or ──► final answer        │
  └──────────────────────────────────────────────────────┘
        │ if call
        ▼
  execute search (native | exa | firecrawl | parallel | perplexity)
        ▼
  append tool result (urls, titles, snippets) to context
        └──► back to decode (0..N times)
        ▼
  final message + url_citation annotations
  usage.server_tool_use_details + usage.cost (search included)
```

Verified behaviour ([server-tool docs](https://openrouter.ai/docs/guides/features/server-tools/web-search)):

- The model decides whether to search and **writes the query**.
- It may search multiple times in one request.
- Results are returned to the model as tool output.
- `max_uses` caps searches; `max_total_results` caps cumulative results; `max_tool_calls` (default 30) caps steps.
- On Responses, the call is a visible `openrouter:web_search` output item with `action.query` and optional `action.sources`.

Useful parameters: `max_results` (per call, default 5; ignored with native), `search_context_size` (Exa → 5K/15K/30K chars per result), `max_characters` (per result, overrides context size), `allowed_domains` / `excluded_domains`, `user_location` (native only).

**Gap:** the Chat Completions wire shape of the server-tool result is not documented; every example uses `/v1/responses`. Assume a tool-role message but do not hard-code a `tool_call_id` format.

**Gap:** "any model can call" is the docs' claim, but the model must at least be able to emit a parseable call. Verify per model.

## 5. How models process the results

On the Exa plugin path there is **no tool protocol**: results are ordinary prompt tokens in a system message. Consequences:

- No schema, no call/response cycle, no tool-calling ability required.
- The model **cannot** influence what is searched, cannot refine, cannot search twice, cannot decline.
- Its only degrees of freedom are how to use the text and whether to obey the citation instruction.
- Same prompt + different search results = different answer. This is **grounding at request time**, not deterministic RAG over a fixed index.

## 6. Context window

Per-result and total cost ([plugin docs](https://openrouter.ai/docs/features/web-search), [server-tool docs](https://openrouter.ai/docs/guides/features/server-tools/web-search), [Exa](https://docs.exa.ai/reference/contents-retrieval-with-exa-api)):

| Config | Characters | ≈ tokens @ 4 chars/tok |
|---|---|---|
| 5 × 2,000 (adaptive low) | 10,000 | ~2,500 |
| 5 × 4,000 (adaptive high) | 20,000 | ~5,000 |
| 5 × 5,000 (`low`) | 25,000 | ~6,250 |
| 5 × 15,000 (`medium`) | 75,000 | ~18,750 |
| 5 × 30,000 (`high`) | 150,000 | ~37,500 |
| 25 × 30,000 (max × high) | 750,000 | ~187,500 |

The 4 chars/token ratio is a rule of thumb, not a tokenizer. Treat as ±25%. Add per-result title/URL and the preamble.

Important interactions:

- **Per turn, not one-off.** The plugin runs once per request. Turn *n* pays for a fresh search block *in addition to* the whole conversation. The previous block is not persisted by OpenRouter; the client re-sends its own messages and the plugin re-runs.
- **Prefix caching.** A system message injected at position 0 changes every turn (date + results), invalidating prefix caching for everything after it. The server tool appends results inside the turn, so the conversation prefix stays cacheable. This is a real, often-overlooked cost difference. **Inference** from the documented injection position and per-request behaviour.
- **`max_tokens` is completion-only.** Search text consumes input/context, not `max_tokens`. But a large search block can leave less room for output; if input + requested output exceeds the context window, the request fails or truncates (OpenRouter's context compression removes middle messages when enabled — [message transforms](https://openrouter.ai/docs/guides/features/message-transforms)).
- **Prompt tokens are billed.** OpenRouter states the search fee is "in addition to the LLM usage for the search result prompt tokens". OpenAI bills "search content tokens at model rates" ($10/1k calls + tokens); Anthropic says search results "count as input tokens … in later conversation turns"; Google charges per search query ($14/1k on Gemini 3+).

## 7. Where reasoning happens

Reasoning is **completion output, generated in the same decode loop**, before or interleaved with visible content. It is not a separate preprocessing call.

Fields ([Reasoning tokens](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens)):

- Chat Completions: `message.reasoning` (string), `message.reasoning_details` (structured), and `reasoning_content` as an alias.
- Responses: `reasoning` items in `output`, with raw `content` and/or `summary`.
- OpenAI o-series may not return the reasoning text at all; only `reasoning_tokens` is exposed.
- DeepSeek/Qwen expose `reasoning_content`; Anthropic uses thinking blocks with a `budget_tokens`.

Budget rules (**verified**):

> "Reasoning tokens count against `max_output_tokens`. On most providers, the request's `max_output_tokens` limit applies to reasoning and visible output combined. If the limit is small enough that the model spends all of it reasoning, the response returns `status: "incomplete"` … and the reasoning tokens are still billed."

On Chat Completions the same applies to `max_tokens` / `max_completion_tokens`: if the model spends the whole budget reasoning, you get `finish_reason: "length"` with empty `content`. Detect it with `usage.completion_tokens_details.reasoning_tokens`.

Ordering:

- **Plugin (Exa):** one reasoning phase; results are in context from token 1.
- **Server tool / native:** reason → search → reason again → answer. OpenRouter's own o3 example shows exactly `reasoning → web_search_call → reasoning → message` ([Responses web search](https://openrouter.ai/docs/api_reference/responses/web-search)).

Budget warning: an agentic loop that searches 10 times pays for ten reasoning phases over a growing context. OpenRouter's benchmark notes models averaged 10.3 searches when correct and 19.7 when incorrect — **failure is the expensive case**.

## 8. Annotations and streaming

Chat Completions shape (nested):

```json
{
  "type": "url_citation",
  "url_citation": {
    "url": "https://…",
    "title": "…",
    "content": "…",
    "start_index": 100,
    "end_index": 200
  }
}
```

Responses shape is **flat** (fields directly on the annotation) and adds `uncited: true` for "consulted but not quoted".

When they arrive:

- Chat Completions: as a separate `delta.annotations` array, **after** the text deltas. This field is **not in the published `ChatStreamDelta` schema**; it is de-facto behaviour implemented by OpenRouter's own SDK.
- Responses: `response.output_text.annotation.added` events and/or the final message.
- `start_index`/`end_index` index into the final text, so citations cannot be rendered mid-stream safely. Buffer the full text, then anchor.

## 9. Pricing and `usage.cost`

Search fees are per request for most engines:

| Engine | Rate | Includes |
|---|---|---|
| Exa instant/fast/auto | $0.007 / request | up to 10 results, then $0.001 each |
| Exa deep-lite/deep | $0.012 / request | up to 10 results |
| Exa deep-reasoning | $0.015 / request | up to 10 results |
| Parallel turbo/fast | $0.001 / request | up to 10 results |
| Parallel basic/advanced | $0.005 / request | up to 10 results |
| Perplexity | $0.005 / request | — |
| Firecrawl | $0.005 / search + $0.0125 / result | 5 results = $0.0675 |
| Native | provider passthrough | OpenAI $10/1k calls; Anthropic $10/1k searches; Google $14/1k queries (Gemini 3+) |

Plus **model tokens for the search content**. The fee is cheap; the injected tokens are the recurring cost.

- **Server tool:** OpenRouter explicitly states server-tool usage is included in `usage.cost`.
- **Plugin:** not documented whether the fee lands in `usage.cost`. The field is defined as "the total amount charged to your account", so it almost certainly does — but reconcile against the billing UI before trusting it.

## 10. Deprecation status

As of the docs snapshot, the plugin and `:online` are **deprecated** in favour of `openrouter:web_search`. They remain functional and documented. The migration is not drop-in: the plugin always searches once; the server tool lets the model search 0–N times and returns a different result shape. If you already send an OpenAI-style `web_search` tool, OpenRouter says it **hoists it** into `openrouter:web_search` automatically.

---

# Part II — What this means in OpenWeightModels

## 11. Current wiring

`packages/core/src/providers.ts`:

- `webSearchPlugins()` (lines ~61–69) adds `plugins: [{ id: "web", max_results: N }]` only when `OPENROUTER_WEB_SEARCH === 'true'` **and** `model.provider === 'openrouter'`.
- The request is still a plain `/chat/completions` call with `stream: true` and `stream_options.include_usage`.
- `MAX_OUTPUT_TOKENS = 16_384` is shared across challengers for fairness (line ~39).
- The SSE parser reads only `choices[0].delta.content`; `delta.reasoning`, `delta.reasoning_details` and `delta.annotations` are ignored.

`packages/core/src/services/jobs.ts` calls `provider.generate()` once per Response. Each turn is a separate provider call, so a multi-turn replay with search enabled performs **one search per turn per challenger**.

## 12. What we measured in this repo

Same prompt ("cheapest flights to Bali in January from Singapore"), direct OpenRouter calls, November 2026:

| Call | Plugin | Finish | Visible answer | Prompt tokens | Completion tokens | Cost |
|---|---|---|---|---|---|---|
| Qwen 3.5 9B | no | stop | "As an AI, I cannot access real-time flight inventory…" | 39 | 818 | $0.00008 |
| Qwen 3.5 9B | yes | length* | Fares, dates, airlines, inline citations | 3,832 | 900 | $0.00734 |
| Bonsai 2 27B | yes, 900 cap | length | **empty** | 4,156 | 900 (all reasoning) | $0.00776 |
| Bonsai 2 27B | yes, 16,384 cap | stop | Full comparison table + recommendation | 4,129 | 8,315 (6,979 reasoning) | $0.01147 |

\*Qwen hit the probe's 900-token cap, not the app's 16,384.

What this confirms:

1. The plugin is the switch. Without it the model refuses; with it the same model answers from live fares.
2. **The search block is ~4,000 prompt tokens**, ~100× the plain prompt. That is the recurring cost.
3. **Bonsai is a reasoning model**: at a 900 cap it spent everything on `reasoning` and emitted nothing. At 16,384 it finished, but 6,979 of 8,315 completion tokens were reasoning (84%). It also returned `reasoning` + `reasoning_details`, matching OpenRouter's generic schema.
4. Reported `usage.cost` for the Qwen search call was $0.00734 — essentially the $0.007 Exa fee plus a fraction of a cent of tokens. This is consistent with (but does not prove) the fee being included in `usage.cost`.

## 13. Gaps in the current implementation

| Gap | Effect | Fix |
|---|---|---|
| `delta.annotations` ignored | No structured sources; only whatever markdown links the model wrote | Parse the annotation chunk, store it, render a sources list |
| `delta.reasoning` ignored | Fine for display; reasoning is invisible but still billed and consumes `max_tokens` | No display needed; account for it in budget |
| Only completion tokens stored (`responses.tokens`) | UI understates context cost; search's ~4K prompt tokens are invisible | Store `prompt_tokens` if you want attribution |
| `engine` not pinned | Mixed native/Exa retrieval if frontier models are added | Add `"engine": "exa"` for a uniform comparison |
| Plugin is deprecated | Still works; migration path changes behaviour | Plan the server-tool migration separately |
| Per-model reasoning burn | A reasoning-heavy challenger can hit the shared 16,384 cap and return empty text | Consider a per-model output cap or reasoning budget — but that weakens fairness |

`packages/core/src/spend.ts` sums `responses.cost_usd` for the monthly cap. If the plugin fee is not in `usage.cost`, the cap under-counts search spend until reconciled from billing.

---

# Part III — Local models

## 14. The two architectures

### 14a. Retrieve-then-inject (RAG-style)

```
question → harness searches → harness formats results → messages:[system, user+sources] → model → answer
```

- Works with **any** chat model, including base/completion models and models with no tool training.
- This is exactly what OpenRouter's plugin does.
- The model never chooses to search; one shot, no refinement.
- The injected text is ordinary tokens: it occupies context, is re-sent every turn (stateless API), and changes the KV-cache prefix.

### 14b. Native tool / function-calling loop

```
tools → model emits tool_call → harness executes → role:"tool" result → model re-called → … → answer
```

- Requires **two independent pieces**: a tool-aware chat template that renders `tools`, `tool_calls` and `role:"tool"`, **and** a parser in the serving stack that lifts the model's text into `message.tool_calls`.
- Failure mode: template without parser → raw `<tool_call>` markup in `content`, `finish_reason: "stop"`, loop silently exits. Parser without matching template → prose that never calls.
- Supports multi-hop and query refinement; every round re-sends the full history plus tool results, so context grows **within** one user turn.

### Choosing

| Situation | Use |
|---|---|
| Small model, no tool training, one lookup | 14a |
| Base model or strict context/latency budget | 14a |
| Capable tool-trained model, multi-hop research | 14b |
| You need auditable retrieval (exact injected string) | 14a |
| You need the model to decide whether to search | 14b |

## 15. Inference engine support

### vLLM

```bash
vllm serve Qwen/Qwen2.5-7B-Instruct \
  --enable-auto-tool-choice \
  --tool-call-parser hermes \
  --reasoning-parser qwen3
```

- `--enable-auto-tool-choice` is mandatory; the parser selected by `--tool-call-parser` is loaded only when it is set.
- Parser names (selection): `hermes` (Qwen2.5/QwQ), `qwen3_xml` (Qwen3-Coder), `llama3_json`, `llama4_pythonic`, `mistral`, `deepseek_v3`, `deepseek_v31`, `openai` (gpt-oss/Harmony), `kimi_k2`, `glm45`/`glm47`, `granite4`.
- Reasoning parsers: `deepseek_r1`, `qwen3`, `glm45`, `gemma4`, etc.
- Reasoning is returned as `message.reasoning` (formerly `reasoning_content`; old clients silently read an empty field). Streaming uses `delta.reasoning`.
- **Tool calls are parsed only from `content`, never from `reasoning`.** A model that emits calls inside its thinking block will not trigger the parser.
- Interleaved thinking (reasoning between tool calls) is supported for Kimi-K2-Thinking and MiniMax-M2; the client must append the assistant's `reasoning` to the tool-call message or the next round loses the rationale.

Source: [vLLM tool calling](https://docs.vllm.ai/en/latest/features/tool_calling.html), [reasoning outputs](https://docs.vllm.ai/en/latest/features/reasoning_outputs.html), [interleaved thinking](https://docs.vllm.ai/en/latest/features/interleaved_thinking.html).

### llama.cpp / `llama-server`

```bash
llama-server --jinja -fa -m model.gguf --chat-template-file my-tool-template.jinja
```

- Built-in tool handlers cover Llama 3.x, Functionary, Hermes 2/3, Qwen 2.5, Mistral Nemo, Command R7B, DeepSeek R1, GPT-OSS. Unknown templates fall back to a "Generic" handler.
- `--reasoning-format {none,deepseek,deepseek-legacy}` controls whether thinking lands in `message.reasoning_content` or stays in `content`.
- `--reasoning-budget N` caps thinking inside the generation budget; `-n/--n-predict` caps total output.
- `--grammar` / `--json-schema` constrain output syntax, but **do not** guarantee a valid `tool_calls` envelope (Gap).
- Check `GET /props` for a tool-aware `chat_template`; current server default port is **9931**.
- Primary sources disagree on whether `--jinja` is still required (README says default enabled; function-calling doc says pass it). Pass it explicitly.

Source: [function calling](https://github.com/ggml-org/llama.cpp/blob/master/docs/function-calling.md), [server flags](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md).

### Ollama

- `POST /api/chat` accepts `tools`, `think`, and `options.num_predict`.
- Reasoning is `message.thinking`, separate from `message.content`.
- The OpenAI-compatible `/v1/chat/completions` supports `tools` but **not `tool_choice`**.
- Ollama's tool message uses `tool_name`, **not** `tool_call_id`; pick one API shape and stay in it.

Source: [tool calling](https://docs.ollama.com/capabilities/tool-calling), [thinking](https://docs.ollama.com/capabilities/thinking), [OpenAI compatibility](https://docs.ollama.com/openai).

### LM Studio

- OpenAI-compatible at `:1234/v1`; returns `finish_reason: "tool_calls"`; streams argument fragments.
- Two tiers: **Native** (tool-aware template + parser) and **Default**, which injects a `[TOOL_REQUEST]{…}[END_TOOL_REQUEST]` system prompt and parses it — a prompt-injection shim over models without native tool support.
- `tool_choice: "required"` is llama.cpp-engine only.

Source: [LM Studio tools](https://lmstudio.ai/docs/developer/openai-compat/tools).

### SGLang

- `--tool-call-parser qwen|qwen3_coder|llama3|llama4|mistral|deepseekv3|…`, plus `/parse_function_call`.
- `tool_choice:"required"` and named calls use EBNF grammar (Xgrammar backend).
- Streaming caveat: "most tool parsers do not check that the model closed each call"; a custom stop sequence inside arguments can yield truncated-but-valid JSON.

Source: [SGLang tool parser](https://docs.sglang.ai/advanced_features/tool_parser.html).

### Hugging Face Transformers

```python
inputs = tokenizer.apply_chat_template(
    messages, tools=tools, add_generation_prompt=True,
    return_dict=True, return_tensors="pt",
)
```

- `tools=` accepts JSON schemas or plain Python functions (schema generated from type hints/docstrings).
- Tool-call `arguments` is a **dict** in HF, not the OpenAI JSON string.
- `parse_response()` extracts calls for supported models; otherwise you parse the text.
- `documents=` is the RAG hook — templates can render retrieved documents directly.

Source: [HF tool use](https://huggingface.co/docs/transformers/en/chat_extras), [chat templates](https://huggingface.co/docs/transformers/en/chat_templating).

## 16. Local reasoning handling

| Stack | Field | Control |
|---|---|---|
| vLLM | `message.reasoning` / `delta.reasoning` | `--reasoning-parser`, `thinking_token_budget` |
| llama.cpp | `message.reasoning_content` | `--reasoning-format`, `--reasoning-budget` |
| Ollama | `message.thinking` | `think: true/false/"level"` |
| Transformers | `reasoning_content` in templates | `continue_final_message="reasoning_content"` |
| LM Studio | not documented | — |

Reasoning is the **same decode loop**: the model emits a start delimiter, ordinary tokens, an end delimiter, then the answer. Qwen3 splits on token id `151668` (`</think>`); DeepSeek-R1 sometimes needs a forced `\n` to start thinking. Reasoning tokens count against `max_tokens` / `num_predict` / `max_new_tokens`. A model that thinks for 8K tokens with `max_tokens=1024` returns `finish_reason:"length"` and no answer.

History hygiene: Qwen3's card says prior assistant turns should contain only the final output, not the thinking; its template handles this. If your harness bypasses the template, you must strip reasoning yourself.

## 17. Search backends

### Self-hosted

| Backend | Auth / cost | Returns |
|---|---|---|
| **SearXNG** | self-hosted, no key | JSON via `/search?q=…&format=json`; `format=json` **must** be enabled in `settings.yml` or you get 403. Snippets, not full pages. |
| **Vane** (formerly Perplexica) | MIT, Docker; bundles SearXNG | Perplexity-style answer with cited sources; uses a local or OpenAI-compatible LLM. |
| **Firecrawl (self-host)** | Docker; disable auth for trusted local use | `/v2/scrape` → cleaned page markdown; search/crawl routes in the default stack. |

### Hosted

| Backend | Auth | Price (list) | Returns |
|---|---|---|---|
| **Brave** | `X-Subscription-Token` | $5/1k requests | snippets; `/llm/context` returns ranked passages |
| **Tavily** | `Bearer tvly-…` | 1 credit basic, 2 advanced | ~500-char chunks; `include_raw_content` for full page |
| **Exa** | `Bearer` / `x-api-key` | $4–7/1k | highlights (LLM-selected) or full `text` |
| **Serper** | API key | ~$1/1k | Google SERP snippets |
| **DDGS** (`ddgs`) | none | free, scraping-based | snippets; `.extract()` for full pages |

Architecture note: most search APIs return **snippets**; reading a full page is a second call. Chat apps model this as two settings: "search engine" and "web loader/scraper".

## 18. Frameworks and ready-made apps

| Framework | What it gives you | Assumes |
|---|---|---|
| **LangChain / LangGraph** | `create_agent`, `@tool`, `ToolNode`, loop + streaming | provider adapter exposes `tool_calls` |
| **LlamaIndex** | `FunctionAgent`, `ReActAgent`, `CodeActAgent` | function-calling model for `FunctionAgent` |
| **smolagents** | `CodeAgent` writes Python actions | model can write code; no native tools required |
| **Pydantic AI** | `@agent.tool`, typed schema, implicit loop | native tools/functions API |
| **Vercel AI SDK** | `tool()`, `stopWhen`, `toolChoice`, `repairToolCall` | provider supports tools |
| **OpenAI Agents SDK** | `@function_tool`, runner loop, sessions, MCP | Chat Completions tool support; hosted web search only on Responses |
| **MCP** | protocol for tool discovery/calls | your client converts schemas and runs the loop |

None of these produce citation annotations for you. If you want verifiable citations, put numbered URLs in the tool result and instruct the model, or post-process the answer against the retrieved set.

Ready-made local apps:

- **Open WebUI** — separate Search Engine and Web Loader; "Traditional RAG" (inject) vs "Agentic" (model calls `search_web`/`fetch_url`). `search_web` snippets are **not** added to the citations panel because no page was opened.
- **LibreChat** — `searchProvider` + `scraperProvider` + optional reranker; SearXNG needs JSON format and SSRF allowlisting.
- **AnythingLLM** — agent mode uses native tool calling by default, with a prompt-based fallback when native tool calling is disabled.

## 19. Minimal code

Both sketches target an OpenAI-compatible local endpoint (`http://localhost:8000/v1` for vLLM; `:9931` llama.cpp; `:11434/v1` Ollama; `:1234/v1` LM Studio). They are sketches: no retries, timeouts, auth, or streaming.

### 19a. Retrieve-then-inject (works with any model)

```python
import requests
from openai import OpenAI

client = OpenAI(base_url="http://localhost:8000/v1", api_key="dummy")
SEARX = "http://localhost:8080/search"   # format=json enabled in settings.yml

def search(query: str, n: int = 5) -> list[dict]:
    r = requests.get(SEARX, params={"q": query, "format": "json"}, timeout=15)
    r.raise_for_status()
    return r.json().get("results", [])[:n]

def answer(question: str) -> str:
    hits = search(question)
    sources = "\n\n".join(
        f"[{i}] {h.get('title', '')}\n{h.get('url', '')}\n{h.get('content', '')}"
        for i, h in enumerate(hits, 1)
    )
    messages = [
        {"role": "system",
         "content": "Answer using only the numbered sources. Cite with [n]."},
        {"role": "user",
         "content": f"Question: {question}\n\nSources:\n{sources}"},
    ]
    resp = client.chat.completions.create(
        model="Qwen/Qwen3-8B",
        messages=messages,
        temperature=0.2,
        max_tokens=800,          # covers reasoning + answer
    )
    return resp.choices[0].message.content
```

No `tools=` anywhere. Citations are a prompt convention; keep `hits` if you want to verify `[n]` markers after the fact.

### 19b. Native tool loop

```python
import json
import requests
from openai import OpenAI

client = OpenAI(base_url="http://localhost:8000/v1", api_key="dummy")

TOOLS = [{
    "type": "function",
    "function": {
        "name": "web_search",
        "description": "Search the live web. Returns titles, URLs and snippets.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "max_results": {"type": "integer", "default": 5},
            },
            "required": ["query"],
        },
    },
}]

def web_search(query: str, max_results: int = 5) -> list[dict]:
    r = requests.get("http://localhost:8080/search",
                     params={"q": query, "format": "json"}, timeout=15)
    r.raise_for_status()
    return [
        {"title": h.get("title"), "url": h.get("url"), "snippet": h.get("content")}
        for h in r.json().get("results", [])[:max_results]
    ]

messages = [{"role": "user", "content": "Summarise the latest vLLM tool-calling flags."}]

for _ in range(6):                              # hard stop
    resp = client.chat.completions.create(
        model="Qwen/Qwen2.5-7B-Instruct",
        messages=messages,
        tools=TOOLS,
        tool_choice="auto",                    # Ollama /v1 does NOT support this
        max_tokens=1024,
    )
    choice = resp.choices[0]
    msg = choice.message

    if choice.finish_reason != "tool_calls":
        print(msg.content)
        break

    messages.append(msg)                        # assistant message with tool_calls
    for tc in msg.tool_calls:
        args = json.loads(tc.function.arguments or "{}")
        try:
            content = json.dumps(web_search(**args))
        except Exception as e:                  # surface errors to the model
            content = json.dumps({"error": str(e)})
        messages.append({
            "role": "tool",
            "tool_call_id": tc.id,              # must match the assistant's call id
            "content": content,                 # always a string
        })
else:
    print("stopped: step limit without a final answer")
```

Notes:

- Preserve `msg.reasoning` on the assistant tool-call message for interleaved-thinking models, or the next round loses the rationale.
- Do not add a `stop` sequence that can appear inside tool arguments; SGLang warns it yields truncated-but-valid JSON with `finish_reason:"tool_calls"`.
- If the server's template is not tool-aware, `finish_reason` stays `"stop"` and `<tool_call>` markup leaks into `content`; check `GET /props` first.

## 20. Comparison

| Dimension | OpenRouter `web` plugin | Local retrieve-then-inject | Local tool loop |
|---|---|---|---|
| Who searches | OpenRouter / engine | your harness | your harness, on the model's request |
| Who decides | harness (always) | your harness | the model |
| Query formulation | engine (undocumented) | your harness | the model, with refinement |
| Multi-hop | no | no (unless you loop) | yes, bounded by your step limit |
| Context cost | ~2.5K–5K tokens per turn at defaults | whatever you inject, per request | schemas + calls + results, per round |
| Model requirements | any | any chat model | tool-aware template + parser + trained model |
| Citation fidelity | structured `url_citation` spans | none; prompt convention only | URLs in tool results; model may ignore |
| Failure visibility | provider-side | exact injected string | parser failures look like normal prose |
| Best fit | quick grounding of any model | small/local/base models | capable local models, research |

---

## 21. Sources

**OpenRouter**

- Plugin: https://openrouter.ai/docs/features/web-search
- Server tool: https://openrouter.ai/docs/guides/features/server-tools/web-search
- Server tools overview: https://openrouter.ai/docs/guides/features/server-tools
- Plugins overview: https://openrouter.ai/docs/guides/features/plugins
- `:online` variant: https://openrouter.ai/docs/guides/routing/model-variants/online
- Reasoning tokens: https://openrouter.ai/docs/guides/best-practices/reasoning-tokens
- Usage accounting: https://openrouter.ai/docs/cookbook/administration/usage-accounting
- Streaming: https://openrouter.ai/docs/api_reference/streaming
- Context compression: https://openrouter.ai/docs/guides/features/message-transforms
- Responses web search: https://openrouter.ai/docs/api_reference/responses/web-search
- Announcement (system-message injection): https://openrouter.ai/blog/announcements/introducing-web-search-via-the-api
- Benchmark (single pre-decode search): https://openrouter.ai/blog/announcements/web-search-benchmark
- OpenAPI spec: https://openrouter.ai/openapi.json

**Local inference**

- vLLM: https://docs.vllm.ai/en/latest/features/tool_calling.html · https://docs.vllm.ai/en/latest/features/reasoning_outputs.html · https://docs.vllm.ai/en/latest/features/interleaved_thinking.html
- llama.cpp: https://github.com/ggml-org/llama.cpp/blob/master/docs/function-calling.md · https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md
- Ollama: https://docs.ollama.com/capabilities/tool-calling · https://docs.ollama.com/capabilities/thinking · https://docs.ollama.com/openai
- LM Studio: https://lmstudio.ai/docs/developer/openai-compat/tools
- SGLang: https://docs.sglang.ai/advanced_features/tool_parser.html
- Transformers: https://huggingface.co/docs/transformers/en/chat_extras · https://huggingface.co/docs/transformers/en/chat_templating

**Models**

- Qwen3-8B: https://huggingface.co/Qwen/Qwen3-8B
- DeepSeek-R1: https://huggingface.co/deepseek-ai/DeepSeek-R1
- DeepSeek thinking mode: https://api-docs.deepseek.com/guides/thinking_mode/
- Anthropic extended thinking: https://docs.claude.com/en/docs/build-with-claude/extended-thinking
- OpenAI reasoning: https://platform.openai.com/docs/guides/reasoning

**Search backends**

- SearXNG: https://docs.searxng.org/dev/search_api.html
- Vane (ex-Perplexica): https://github.com/ItzCrazyKns/Vane
- Firecrawl self-host: https://docs.firecrawl.dev/contributing/self-host
- Brave: https://brave.com/search/api/
- Tavily: https://docs.tavily.com/documentation/api-reference/endpoint/search
- Exa: https://docs.exa.ai/reference/search · https://exa.ai/pricing
- Serper: https://serper.dev/
- ddgs: https://github.com/deedy5/ddgs

**Frameworks and apps**

- LangChain agents: https://docs.langchain.com/oss/python/langchain/agents
- LlamaIndex agents: https://docs.llamaindex.ai/en/stable/understanding/agent/
- smolagents: https://huggingface.co/docs/smolagents/en/conceptual_guides/intro_agents
- Pydantic AI: https://ai.pydantic.dev/tools/
- Vercel AI SDK: https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling
- OpenAI Agents SDK: https://openai.github.io/openai-agents-python/tools/
- MCP tools: https://modelcontextprotocol.io/specification/2025-06-18/server/tools
- Open WebUI: https://docs.openwebui.com/features/chat-conversations/web-search/
- LibreChat: https://www.librechat.ai/docs/configuration/librechat_yaml/object_structure/web_search
- AnythingLLM: https://docs.anythingllm.com/agent/usage/web-browsing

## 22. Open questions

1. How the plugin derives its search query (last user message vs. rewrite vs. history).
2. The literal per-result serialisation inside the injected system message.
3. Plugin search-failure behaviour: fail the completion, proceed ungrounded, or inject an empty block.
4. Whether/how plugin fees appear in `usage.cost` (server tools: documented yes).
5. How `url_citation` spans are computed on the Exa path.
6. Chat Completions wire shape of a server-tool result.
7. `max_total_results` default (docs say N/A, OpenAPI schema says 50).
8. Whether OpenRouter filters search results for prompt injection.
9. Bonsai 2 27B's reasoning field shape in general (our probe saw `reasoning` + `reasoning_details`).
10. LM Studio's reasoning field name and separation.
11. Whether llama.cpp grammar-constrains the `tool_calls` envelope.
