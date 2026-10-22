import { afterEach, describe, expect, it } from 'vitest';
import {
  MockProvider,
  OpenAICompatibleProvider,
  assertProviderConfigured,
  getProvider,
} from '../src/providers';
import type { ModelRow } from '../src/queries';
import { fakeOpenAi, sse } from './fake-openai';

function model(overrides: Partial<ModelRow> = {}): ModelRow {
  return {
    id: 'model-id',
    slug: 'fixture-challenger',
    displayName: 'Fixture Challenger',
    monogram: 'FC',
    provider: 'openrouter',
    apiBase: null,
    apiModelId: 'fixture/challenger',
    etaSeconds: 4,
    enabled: true,
    createdAt: new Date(),
    ...overrides,
  };
}

const cleanups: Array<() => Promise<void>> = [];
const originalEnv = { ...process.env };

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  for (const key of ['PROVIDER', 'OPENROUTER_API_KEY', 'TOGETHER_API_KEY'] as const) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('OpenAI-compatible provider', () => {
  it('streams content and captures provider-reported tokens and cost', async () => {
    const providerServer = await fakeOpenAi(() => ({
      status: 200,
      contentType: 'text/event-stream',
      body: sse(
        JSON.stringify({ choices: [{ delta: { content: 'Hello' } }] }),
        JSON.stringify({ choices: [{ delta: { content: ' world' } }] }),
        JSON.stringify({
          choices: [],
          usage: {
            prompt_tokens: 7,
            completion_tokens: 2,
            total_tokens: 9,
            cost: 0.00123,
          },
        }),
        '[DONE]',
      ),
    }));
    cleanups.push(providerServer.close);

    const provider = new OpenAICompatibleProvider('test-key');
    const chunks: string[] = [];
    const result = await provider.generate({
      model: model({ apiBase: providerServer.baseUrl }),
      prompt: 'Say hello',
      attempt: 0,
      onToken: (chunk) => {
        chunks.push(chunk);
      },
    });

    expect(result).toEqual({ text: 'Hello world', tokens: 2, costUsd: 0.00123 });
    expect(chunks.join('')).toBe('Hello world');

    expect(providerServer.requests).toHaveLength(1);
    expect(providerServer.requests[0]).toMatchObject({
      url: '/v1/chat/completions',
      authorization: 'Bearer test-key',
      body: {
        model: 'fixture/challenger',
        messages: [{ role: 'user', content: 'Say hello' }],
        temperature: 0.7,
        max_tokens: 4096,
        stream: true,
        stream_options: { include_usage: true },
      },
    });
  });

  it('sends the same Prompt and generation parameters to every Challenger', async () => {
    const providerServer = await fakeOpenAi(() => ({
      status: 200,
      contentType: 'text/event-stream',
      body: sse('[DONE]'),
    }));
    cleanups.push(providerServer.close);

    const provider = new OpenAICompatibleProvider('test-key');
    const prompt = 'Explain a sliding-window rate limiter.';
    await provider.generate({
      model: model({ slug: 'first', apiModelId: 'vendor/first', apiBase: providerServer.baseUrl }),
      prompt,
      attempt: 0,
      onToken: () => {},
    });
    await provider.generate({
      model: model({ slug: 'second', apiModelId: 'vendor/second', apiBase: providerServer.baseUrl }),
      prompt,
      attempt: 0,
      onToken: () => {},
    });

    const [{ body: first }, { body: second }] = providerServer.requests;
    expect(first).toEqual(
      expect.objectContaining({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 4096,
        stream: true,
        stream_options: { include_usage: true },
      }),
    );
    const { model: firstModel, ...firstParams } = first!;
    const { model: secondModel, ...secondParams } = second!;
    expect(firstModel).toBe('vendor/first');
    expect(secondModel).toBe('vendor/second');
    expect(secondParams).toEqual(firstParams);
  });

  it('reports an HTTP failure without leaking the API key', async () => {
    const providerServer = await fakeOpenAi(() => ({
      status: 429,
      contentType: 'application/json',
      body: JSON.stringify({ error: { message: 'rate limited for Bearer test-key' } }),
    }));
    cleanups.push(providerServer.close);

    const provider = new OpenAICompatibleProvider('test-key');
    const error = (await provider
      .generate({
        model: model({ apiBase: providerServer.baseUrl }),
        prompt: 'Say hello',
        attempt: 0,
        onToken: () => {},
      })
      .catch((caught: unknown) => caught)) as Error;

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('provider returned 429');
    expect(error.message).toContain('rate limited');
    expect(error.message).toContain('[redacted]');
    expect(error.message).not.toContain('test-key');
  });

  it('surfaces an error event in the stream', async () => {
    const providerServer = await fakeOpenAi(() => ({
      status: 200,
      contentType: 'text/event-stream',
      body: sse(
        JSON.stringify({ choices: [{ delta: { content: 'partial' } }] }),
        JSON.stringify({ error: { message: 'upstream overloaded' } }),
      ),
    }));
    cleanups.push(providerServer.close);

    const provider = new OpenAICompatibleProvider('test-key');
    await expect(
      provider.generate({
        model: model({ apiBase: providerServer.baseUrl }),
        prompt: 'Say hello',
        attempt: 0,
        onToken: () => {},
      }),
    ).rejects.toThrow('upstream overloaded');
  });

  it('aborts a stalled provider call with a timeout error', async () => {
    const providerServer = await fakeOpenAi(() => {
      // Hold the response open so only the client timeout can end the call.
      return undefined;
    });
    cleanups.push(providerServer.close);

    // The 120s default is deliberately injectable so this stays a fast test.
    const provider = new OpenAICompatibleProvider('test-key', 50);
    const error = (await provider
      .generate({
        model: model({ apiBase: providerServer.baseUrl }),
        prompt: 'Say hello',
        attempt: 0,
        onToken: () => {},
      })
      .catch((caught: unknown) => caught)) as Error;

    expect(error.name).toBe('AbortError');
    expect(error.message).toContain('timed out');
    expect(error.message).toContain('50ms');
  });
});

describe('provider selection', () => {
  it('uses the mock provider by default', () => {
    delete process.env.PROVIDER;
    delete process.env.OPENROUTER_API_KEY;

    expect(getProvider(model())).toBeInstanceOf(MockProvider);
  });

  it('selects the real provider when PROVIDER=openrouter and a key is present', () => {
    process.env.PROVIDER = 'openrouter';
    process.env.OPENROUTER_API_KEY = 'test-key';

    expect(getProvider(model())).toBeInstanceOf(OpenAICompatibleProvider);
  });

  it('fails clearly when the real provider has no key', () => {
    process.env.PROVIDER = 'openrouter';
    delete process.env.OPENROUTER_API_KEY;

    expect(() => getProvider(model())).toThrow(/OPENROUTER_API_KEY/);
  });

  it('refuses to fall back to mock when a mock model is selected in a real mode', () => {
    process.env.PROVIDER = 'openrouter';
    process.env.OPENROUTER_API_KEY = 'test-key';

    expect(() => getProvider(model({ provider: 'mock' }))).toThrow(/fall back to mock/i);
  });

  it('refuses to route a model through a different provider than PROVIDER', () => {
    process.env.PROVIDER = 'together';
    process.env.TOGETHER_API_KEY = 'test-key';

    expect(() => getProvider(model({ provider: 'openrouter' }))).toThrow(
      /registered with provider "openrouter" but PROVIDER=together/,
    );
  });
});

describe('provider startup configuration', () => {
  it('needs no key in mock mode', () => {
    delete process.env.PROVIDER;
    delete process.env.OPENROUTER_API_KEY;

    expect(() => assertProviderConfigured()).not.toThrow();
  });

  it('requires the matching key in a real mode', () => {
    process.env.PROVIDER = 'openrouter';
    delete process.env.OPENROUTER_API_KEY;

    expect(() => assertProviderConfigured()).toThrow(/OPENROUTER_API_KEY/);
  });

  it('names the key for any OpenAI-compatible provider slug', () => {
    process.env.PROVIDER = 'together';
    delete process.env.TOGETHER_API_KEY;

    expect(() => assertProviderConfigured()).toThrow(/TOGETHER_API_KEY/);
  });

  it('accepts a configured real mode', () => {
    process.env.PROVIDER = 'openrouter';
    process.env.OPENROUTER_API_KEY = 'test-key';

    expect(() => assertProviderConfigured()).not.toThrow();
  });
});
