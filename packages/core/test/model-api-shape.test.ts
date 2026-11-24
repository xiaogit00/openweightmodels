import { describe, expect, it } from 'vitest';
import {
  attachModelMetadata,
  cardModelFromRow,
  type ModelRow,
} from '../src/queries';

const row = (overrides: Partial<ModelRow> = {}): ModelRow => ({
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
  ...overrides,
});

describe('public Model payload', () => {
  it('attaches curated class, size, parameters and publisher by slug', () => {
    const model = attachModelMetadata(row());

    expect(model).toMatchObject({
      slug: 'qwen-3-8-27b',
      family: 'qwen',
      publisher: 'Alibaba',
      weightClass: 'light',
      runSizeGb: 32,
      totalParams: '27B',
      activeParams: null,
    });
  });

  it('exposes a nullable class and Run size for a frontier Model', () => {
    const model = attachModelMetadata(
      row({
        slug: 'claude-opus-5-5',
        displayName: 'Claude Opus 5.5',
        openWeights: false,
      }),
    );

    expect(model.weightClass).toBeNull();
    expect(model.runSizeGb).toBeNull();
    expect(model.totalParams).toBeNull();
    expect(model.activeParams).toBeNull();
  });

  it('has no release slot and never buckets an unknown row into a class', () => {
    const model = attachModelMetadata(
      row({ slug: 'legacy-fixture', displayName: 'Legacy Fixture' }),
    );

    expect(model).not.toHaveProperty('release');
    expect(model.weightClass).toBeNull();
    expect(model.runSizeGb).toBeNull();
    expect(model.publisher).toBe('Unknown');
  });
});

describe('Board card Model projection', () => {
  it('carries class and Run size for every Model, including extra challengers', () => {
    const cardModels = [
      row({ id: 'base', slug: 'qwen-3-8-27b' }),
      row({
        id: 'challenger-1',
        slug: 'llama-3-3-70b',
        displayName: 'Llama 3.3 70B',
        monogram: 'L3',
      }),
      row({
        id: 'challenger-2',
        slug: 'claude-opus-5-5',
        displayName: 'Claude Opus 5.5',
        monogram: 'C6',
        openWeights: false,
      }),
    ].map(cardModelFromRow);

    expect(cardModels).toEqual([
      {
        id: 'base',
        slug: 'qwen-3-8-27b',
        name: 'Qwen3.8 27B',
        monogram: 'Q8',
        weightClass: 'light',
        runSizeGb: 32,
      },
      {
        id: 'challenger-1',
        slug: 'llama-3-3-70b',
        name: 'Llama 3.3 70B',
        monogram: 'L3',
        weightClass: 'middle',
        runSizeGb: 64,
      },
      {
        id: 'challenger-2',
        slug: 'claude-opus-5-5',
        name: 'Claude Opus 5.5',
        monogram: 'C6',
        weightClass: null,
        runSizeGb: null,
      },
    ]);
  });
});
