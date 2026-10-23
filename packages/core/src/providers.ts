import type { ModelRow } from './queries';
import { configuredAppUrl } from './app-url';

export type GenerateInput = {
  model: ModelRow;
  prompt: string;
  attempt: number;
  onToken: (chunk: string) => void | Promise<void>;
};

export type GenerateResult = {
  text: string;
  tokens: number;
  costUsd: number | null;
};

export interface Provider {
  generate(input: GenerateInput): Promise<GenerateResult>;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Remove a provider key from anything that may be logged or stored. */
export function redactSecrets(value: string, secret: string) {
  return secret ? value.split(secret).join('[redacted]') : value;
}

/** Pull the useful message out of an OpenAI-compatible error body. */
function providerError(status: number, body: string) {
  let detail = body;
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string } | string;
      message?: string;
    };
    if (typeof parsed.error === 'string') detail = parsed.error;
    else detail = parsed.error?.message ?? parsed.message ?? body;
  } catch {
    // A non-JSON body is still useful as-is.
  }
  return `provider returned ${status}: ${detail.slice(0, 300)}`;
}

function rateLimiterText(model: ModelRow) {
  switch (model.slug) {
    case 'qwen-2-5-72b':
      return `A sliding-window log is exact but stores every timestamp. A ring buffer of size \`limit\` gives O(1) checks and bounded memory:

\`\`\`go
type Limiter struct {
  mu  sync.Mutex
  buf []time.Time
  i   int
  win time.Duration
}

func (l *Limiter) Allow() bool {
  l.mu.Lock()
  defer l.mu.Unlock()
  now := time.Now()
  if now.Sub(l.buf[l.i]) < l.win {
    return false
  }
  l.buf[l.i] = now
  l.i = (l.i + 1) % len(l.buf)
  return true
}
\`\`\`

This version is per-limiter, not per-key. Wrap it in a \`sync.Map\` if you need one per client.`;
    case 'deepseek-v3':
      return `Two common approaches: a sliding log (exact, O(n) memory) and a sliding window counter (approximate, O(1) memory). I'll show the counter, which weights the previous window by how much of it still overlaps:

\`\`\`go
elapsed := now.Sub(windowStart)
weight := 1 - float64(elapsed)/float64(window)
rate := float64(prev)*weight + float64(curr)
if rate >= float64(limit) {
  return false
}
curr++
\`\`\`

The approximation error stays small under uniform traffic, but bursts right at a boundary can briefly exceed the limit. Use the log version if you need hard guarantees.`;
    case 'mistral-large':
      return `The simplest correct approach is \`golang.org/x/time/rate\`, but that is a token bucket, not a sliding window. Here is a minimal sliding log:

\`\`\`go
func (l *Limiter) Allow() bool {
  l.mu.Lock()
  defer l.mu.Unlock()
  cutoff := time.Now().Add(-l.window)
  for len(l.log) > 0 && l.log[0].Before(cutoff) {
    l.log = l.log[1:]
  }
  if len(l.log) >= l.limit {
    return false
  }
  l.log = append(l.log, time.Now())
  return true
}
\`\`\`

Reslicing keeps the backing array alive; copy periodically if the limiter is long-lived.`;
    case 'llama-3-3-70b':
    default:
      return `Here is a sliding-window rate limiter that tracks request timestamps per key. It is safe for concurrent use and evicts old entries lazily on each call.

\`\`\`go
type Limiter struct {
  mu     sync.Mutex
  window time.Duration
  limit  int
  hits   map[string][]time.Time
}

func (l *Limiter) Allow(key string) bool {
  l.mu.Lock()
  defer l.mu.Unlock()
  now := time.Now()
  h := l.hits[key]
  cut := 0
  for cut < len(h) && now.Sub(h[cut]) > l.window {
    cut++
  }
  h = h[cut:]
  if len(h) >= l.limit {
    return false
  }
  l.hits[key] = append(h, now)
  return true
}
\`\`\`

Memory grows with the number of distinct keys. Pair it with a periodic sweep if keys are user-supplied.

For distributed setups, swap the map for Redis sorted sets using a \`ZREMRANGEBYSCORE\` plus \`ZCARD\` pipeline.`;
  }
}

function genericText(model: ModelRow, prompt: string) {
  const subject = prompt.replace(/\s+/g, ' ').trim().slice(0, 140);
  return `${model.displayName} reads the task as: **${subject}${prompt.length > 140 ? '…' : ''}**

The useful answer is to separate the invariant from the implementation. First make the contract explicit, then choose the smallest mechanism that preserves it.

- State the inputs, outputs and failure mode.
- Prefer a bounded structure over an unbounded log when the limit is known.
- Make the trade-off visible rather than hiding it behind a helper.

\`\`\`text
1. Define the contract.
2. Pick the data structure.
3. Test the boundary, not just the happy path.
\`\`\`

If you want, I can turn this into a concrete implementation with tests.`;
}

function textFor(model: ModelRow, prompt: string) {
  if (/rate.?limit|sliding.?window|limiter/i.test(prompt)) {
    return rateLimiterText(model);
  }
  return genericText(model, prompt);
}

export class MockProvider implements Provider {
  async generate({ model, prompt, attempt, onToken }: GenerateInput): Promise<GenerateResult> {
    const text = textFor(model, prompt);
    const chunks = text.match(/\S+\s*/g) ?? [text];
    const failOnce = process.env.MOCK_FAIL_ONCE === 'true';
    const failModel = process.env.MOCK_FAIL_MODEL;
    const shouldFail = failOnce && attempt === 0 && (!failModel || failModel === model.slug);
    const baseDelay = Number(process.env.MOCK_DELAY_MS ?? 24);

    for (let index = 0; index < chunks.length; index += 1) {
      if (shouldFail && index > Math.floor(chunks.length * 0.45)) {
        throw new Error('API timeout');
      }
      await onToken(chunks[index] ?? '');
      if (baseDelay > 0) await delay(baseDelay);
    }

    return {
      text,
      tokens: Math.max(1, Math.ceil(text.length / 4)),
      // Cost is provider-reported; the mock has no provider to report one.
      costUsd: null,
    };
  }
}

export class OpenAICompatibleProvider implements Provider {
  constructor(
    private readonly apiKey: string,
    /** One call may stream for this long before it fails as a timeout. */
    private readonly timeoutMs = 120_000,
  ) {}

  private failure(error: unknown): Error {
    if (error instanceof Error && error.name === 'AbortError') {
      const timeout = new Error(`provider request timed out after ${this.timeoutMs}ms`);
      timeout.name = 'AbortError';
      return timeout;
    }
    const message = error instanceof Error ? error.message : String(error);
    return new Error(redactSecrets(message, this.apiKey).slice(0, 1000));
  }

  private endpoint(model: ModelRow) {
    const configured =
      model.apiBase?.trim() ||
      (model.provider === 'openrouter'
        ? process.env.OPENROUTER_BASE_URL?.trim() || 'https://openrouter.ai/api/v1'
        : '');
    if (!configured) {
      throw new Error(`Model "${model.slug}" has no API base URL configured.`);
    }
    const base = configured.replace(/\/+$/, '');
    return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
  }

  async generate({ model, prompt, onToken }: GenerateInput): Promise<GenerateResult> {
    const url = this.endpoint(model);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
          ...(model.provider === 'openrouter'
            ? {
                'HTTP-Referer': configuredAppUrl() ?? 'http://localhost:3000',
                'X-Title': 'OpenWeightModels',
              }
            : {}),
        },
        body: JSON.stringify({
          model: model.apiModelId ?? model.slug,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7,
          max_tokens: 4096,
          stream: true,
          // OpenAI-compatible providers only include the usage block (tokens
          // and, on aggregators such as OpenRouter, cost) when asked.
          stream_options: { include_usage: true },
        }),
      });

      if (!response.ok || !response.body) {
        const body = await response.text().catch(() => '');
        throw new Error(providerError(response.status, body));
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let text = '';
      let tokens = 0;
      let costUsd: number | null = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';

        for (const frame of frames) {
          for (const line of frame.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const data = trimmed.slice(5).trim();
            if (!data || data === '[DONE]') continue;
            let parsed: {
              choices?: Array<{ delta?: { content?: string } }>;
              usage?: { completion_tokens?: number; cost?: number };
              error?: { message?: string } | string;
            };
            try {
              parsed = JSON.parse(data);
            } catch {
              continue;
            }
            if (parsed.error) {
              const detail =
                typeof parsed.error === 'string'
                  ? parsed.error
                  : (parsed.error.message ?? 'unknown error');
              throw new Error(`provider stream error: ${detail}`);
            }
            const chunk = parsed.choices?.[0]?.delta?.content ?? '';
            if (chunk) {
              text += chunk;
              await onToken(chunk);
            }
            if (parsed.usage) {
              tokens = parsed.usage.completion_tokens ?? tokens;
              costUsd = typeof parsed.usage.cost === 'number' ? parsed.usage.cost : costUsd;
            }
          }
        }
      }

      return {
        text,
        tokens: tokens || Math.max(1, Math.ceil(text.length / 4)),
        costUsd,
      };
    } catch (error) {
      throw this.failure(error);
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * `PROVIDER` is the environment switch: `mock` by default, or the slug of an
 * OpenAI-compatible provider (OpenRouter first). There is no silent fallback:
 * a real mode only calls Models registered under that same provider.
 */
export function getProviderMode(): string {
  return (process.env.PROVIDER ?? 'mock').trim().toLowerCase() || 'mock';
}

/** Environment variable that holds a provider's key, e.g. `OPENROUTER_API_KEY`. */
export function apiKeyEnvVar(provider: string) {
  return `${provider.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`;
}

export function providerApiKey(provider: string): string | undefined {
  const value = process.env[apiKeyEnvVar(provider)]?.trim();
  return value || undefined;
}

/**
 * Fail the worker at boot rather than on every Run when a real provider has no
 * key. Mock mode is the development and test default and needs no secret.
 */
export function assertProviderConfigured() {
  const mode = getProviderMode();
  if (mode === 'mock') return;
  if (!providerApiKey(mode)) {
    throw new Error(
      `PROVIDER=${mode} requires ${apiKeyEnvVar(mode)}; refusing to start without a provider key.`,
    );
  }
}

export function getProvider(model: ModelRow): Provider {
  const mode = getProviderMode();
  if (mode === 'mock') return new MockProvider();

  if (model.provider === 'mock') {
    throw new Error(
      `Model "${model.slug}" is registered with the mock provider while PROVIDER=${mode}; refusing to fall back to mock.`,
    );
  }
  if (model.provider !== mode) {
    throw new Error(
      `Model "${model.slug}" is registered with provider "${model.provider}" but PROVIDER=${mode}.`,
    );
  }

  const key = providerApiKey(model.provider);
  if (!key) {
    throw new Error(
      `No API key configured for provider "${model.provider}": set ${apiKeyEnvVar(model.provider)}.`,
    );
  }
  return new OpenAICompatibleProvider(key);
}
