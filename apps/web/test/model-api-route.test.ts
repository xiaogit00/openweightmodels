import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getModels } = vi.hoisted(() => ({ getModels: vi.fn() }));

vi.mock('@owm/core', () => ({
  getModels,
  DomainError: class DomainError extends Error {},
  reportError: vi.fn(),
}));

import { GET } from '../src/app/api/models/route';

const model = {
  id: '00000000-0000-0000-0000-000000000001',
  slug: 'qwen-3-8-27b',
  displayName: 'Qwen3.8 27B',
  monogram: 'Q8',
  provider: 'openrouter',
  apiBase: 'https://openrouter.ai/api/v1',
  apiModelId: 'qwen/qwen3.8-27b',
  etaSeconds: 6,
  openWeights: true,
  enabled: true,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  family: 'qwen',
  publisher: 'Alibaba',
  weightClass: 'light' as const,
  runSizeGb: 32,
  totalParams: '27B',
  activeParams: null,
};

describe('GET /api/models', () => {
  beforeEach(() => {
    getModels.mockReset();
  });

  it('serves curated class metadata and never a release slot', async () => {
    getModels.mockResolvedValue([model]);

    const response = await GET();
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      models: Array<Record<string, unknown>>;
    };

    expect(payload.models).toHaveLength(1);
    expect(payload.models[0]).toMatchObject({
      slug: 'qwen-3-8-27b',
      name: 'Qwen3.8 27B',
      publisher: 'Alibaba',
      openWeights: true,
      family: 'qwen',
      weightClass: 'light',
      runSizeGb: 32,
      totalParams: '27B',
      activeParams: null,
    });
    expect(payload.models[0]).not.toHaveProperty('release');
    expect(payload.models[0]).not.toHaveProperty('apiModelId');
  });

  it('serves a nullable class and size for a frontier Model', async () => {
    getModels.mockResolvedValue([
      {
        ...model,
        id: '00000000-0000-0000-0000-000000000002',
        slug: 'claude-opus-5-5',
        displayName: 'Claude Opus 5.5',
        openWeights: false,
        publisher: 'Anthropic',
        weightClass: null,
        runSizeGb: null,
        totalParams: null,
      },
    ]);

    const response = await GET();
    const payload = (await response.json()) as {
      models: Array<Record<string, unknown>>;
    };

    expect(payload.models[0]).toMatchObject({
      weightClass: null,
      runSizeGb: null,
      totalParams: null,
      activeParams: null,
    });
  });
});
