import { describe, expect, it } from 'vitest';
import {
  MODEL_REGISTRY,
  modelRegistryRows,
  validateModelRegistry,
  type ModelRegistryEntry,
} from '../src/model-registry';

const OPEN_WEIGHT_FAMILIES = [
  'llama',
  'qwen',
  'deepseek',
  'mistral',
  'gemma',
  'phi',
  'kimi',
  'glm',
  'minimax',
  'gpt-oss',
  'nemotron',
] as const;

const FRONTIER_FAMILIES = ['claude', 'gpt', 'gemini', 'grok', 'command'] as const;

const entry = (
  overrides: Partial<ModelRegistryEntry> = {},
): ModelRegistryEntry => ({
  slug: 'test-model',
  displayName: 'Test Model',
  monogram: 'TM',
  provider: 'openrouter',
  apiModelId: 'test/model',
  apiBase: 'https://openrouter.ai/api/v1',
  etaSeconds: 6,
  openWeights: true,
  family: 'test',
  release: 'current',
  ...overrides,
});

describe('curated Model registry catalogue', () => {
  it('is internally consistent', () => {
    expect(validateModelRegistry(MODEL_REGISTRY)).toEqual([]);
  });

  it('covers every supported family, open-weight and frontier alike', () => {
    const families = new Set(MODEL_REGISTRY.map((model) => model.family));

    expect([...families].sort()).toEqual(
      [...OPEN_WEIGHT_FAMILIES, ...FRONTIER_FAMILIES].sort(),
    );
  });

  it('keeps one current release and at most one previous release per family', () => {
    for (const family of new Set(MODEL_REGISTRY.map((model) => model.family))) {
      const releases = MODEL_REGISTRY.filter((model) => model.family === family).map(
        (model) => model.release,
      );
      expect(releases.filter((release) => release === 'current'), family).toHaveLength(1);
      expect(
        releases.filter((release) => release === 'previous').length,
        family,
      ).toBeLessThanOrEqual(1);
    }
  });

  it('marks every Model in a family as either open-weight or frontier', () => {
    for (const family of new Set(MODEL_REGISTRY.map((model) => model.family))) {
      const entries = MODEL_REGISTRY.filter((model) => model.family === family);
      const weights = new Set(entries.map((model) => model.openWeights));
      expect(weights.size, family).toBe(1);
    }
  });

  it('never presents a closed Model as open-weight', () => {
    for (const model of MODEL_REGISTRY) {
      const shouldBeOpen = (OPEN_WEIGHT_FAMILIES as readonly string[]).includes(
        model.family,
      );
      expect(model.openWeights, model.slug).toBe(shouldBeOpen);
    }
  });

  it('rejects duplicate slugs', () => {
    const problems = validateModelRegistry([
      entry({ slug: 'same', apiModelId: 'a/one', monogram: 'AA' }),
      entry({
        slug: 'same',
        apiModelId: 'a/two',
        monogram: 'AB',
        release: 'previous',
      }),
    ]);

    expect(problems).toContainEqual({ code: 'duplicate_slug', slug: 'same' });
  });

  it('rejects duplicate provider model IDs', () => {
    const problems = validateModelRegistry([
      entry({ slug: 'one', apiModelId: 'same/model', monogram: 'AA' }),
      entry({
        slug: 'two',
        apiModelId: 'same/model',
        monogram: 'AB',
        release: 'previous',
      }),
    ]);

    expect(problems).toContainEqual({
      code: 'duplicate_api_model_id',
      apiModelId: 'same/model',
    });
  });

  it('rejects a missing monogram', () => {
    const problems = validateModelRegistry([entry({ monogram: '   ' })]);

    expect(problems).toContainEqual({ code: 'missing_monogram', slug: 'test-model' });
  });

  it('rejects a duplicate monogram', () => {
    const problems = validateModelRegistry([
      entry({ slug: 'one' }),
      entry({ slug: 'two', apiModelId: 'test/two', release: 'previous' }),
    ]);

    expect(problems).toContainEqual({ code: 'duplicate_monogram', monogram: 'TM' });
  });

  it('rejects an unparseable ETA', () => {
    const problems = validateModelRegistry([
      entry({ slug: 'nan-eta', etaSeconds: Number.NaN }),
      entry({ slug: 'zero-eta', etaSeconds: 0, release: 'previous' }),
    ]);

    expect(problems).toContainEqual({ code: 'invalid_eta', slug: 'nan-eta' });
    expect(problems).toContainEqual({ code: 'invalid_eta', slug: 'zero-eta' });
  });

  it('rejects a family with no current release', () => {
    const problems = validateModelRegistry([entry({ release: 'previous' })]);

    expect(problems).toContainEqual({ code: 'missing_current', family: 'test' });
  });

  it('rejects two previous releases of the same family', () => {
    const problems = validateModelRegistry([
      entry({ slug: 'one' }),
      entry({ slug: 'two', apiModelId: 'test/two', release: 'previous' }),
      entry({ slug: 'three', apiModelId: 'test/three', release: 'previous' }),
    ]);

    expect(problems).toContainEqual({
      code: 'duplicate_release',
      family: 'test',
      release: 'previous',
    });
  });

  it('produces database rows that carry the open-weights flag', () => {
    const rows = modelRegistryRows();

    expect(rows).toHaveLength(MODEL_REGISTRY.length);
    for (const model of MODEL_REGISTRY) {
      expect(rows.find((row) => row.slug === model.slug)?.openWeights).toBe(
        model.openWeights,
      );
    }
  });
});
