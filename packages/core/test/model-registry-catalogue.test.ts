import { describe, expect, it } from 'vitest';
import {
  MODEL_REGISTRY,
  modelRegistryRows,
  validateModelRegistry,
  type ModelRegistryEntry,
} from '../src/model-registry';
import {
  WEIGHT_CLASS_KEYS,
  type WeightClassKey,
} from '../src/domain/weight-class';

const entry = (
  overrides: Partial<ModelRegistryEntry> = {},
): ModelRegistryEntry => ({
  slug: 'test-model',
  displayName: 'Test Model',
  monogram: 'TM',
  avatarUrl: '/model-icons/test.svg',
  publisher: 'Test Lab',
  provider: 'openrouter',
  apiModelId: 'test/model',
  apiBase: 'https://openrouter.ai/api/v1',
  etaSeconds: 6,
  openWeights: true,
  family: 'test',
  weightClass: 'light',
  runSizeGb: 32,
  totalParams: '27B',
  activeParams: null,
  ...overrides,
});

/**
 * The rows of `design_handoff_weight_class/models_by_weight_class_curated.csv`
 * that resolved to a replayable Model on OpenRouter on 2026-11-23. Thirteen
 * CSV rows named a version the provider does not serve and were not added.
 */
const VERIFIED_CSV: ReadonlyArray<{
  slug: string;
  weightClass: WeightClassKey;
  runSizeGb: number;
  totalParams: string;
  activeParams?: string;
}> = [
  { slug: 'llama-3-2-3b', weightClass: 'fly', runSizeGb: 5, totalParams: '3B' },
  { slug: 'ministral-3b', weightClass: 'fly', runSizeGb: 6, totalParams: '3B' },
  { slug: 'qwen-3-5-9b', weightClass: 'feather', runSizeGb: 12, totalParams: '9B' },
  { slug: 'ministral-8b', weightClass: 'feather', runSizeGb: 12, totalParams: '8B' },
  { slug: 'ministral-14b', weightClass: 'feather', runSizeGb: 20, totalParams: '14B' },
  {
    slug: 'gpt-oss-20b',
    weightClass: 'feather',
    runSizeGb: 24,
    totalParams: '21B',
    activeParams: '3.6B',
  },
  { slug: 'qwen-3-8-27b', weightClass: 'light', runSizeGb: 32, totalParams: '27B' },
  {
    slug: 'nemotron-3-5-lightning',
    weightClass: 'light',
    runSizeGb: 32,
    totalParams: '30B',
    activeParams: '3B',
  },
  { slug: 'glm-4-7-flash', weightClass: 'light', runSizeGb: 32, totalParams: '30B', activeParams: '3B' },
  { slug: 'muse-glimmer-30b', weightClass: 'light', runSizeGb: 32, totalParams: '29.6B' },
  { slug: 'gemma-4-31b', weightClass: 'light', runSizeGb: 32, totalParams: '31B' },
  { slug: 'llama-3-3-70b', weightClass: 'middle', runSizeGb: 64, totalParams: '70B' },
  {
    slug: 'qwen3-coder-next-80b-a3b',
    weightClass: 'middle',
    runSizeGb: 64,
    totalParams: '80B',
    activeParams: '3B',
  },
  { slug: 'glm-4-5-air', weightClass: 'middle', runSizeGb: 96, totalParams: '106B', activeParams: '12B' },
  {
    slug: 'gpt-oss-120b',
    weightClass: 'middle',
    runSizeGb: 96,
    totalParams: '117B',
    activeParams: '5.1B',
  },
  { slug: 'mistral-small-4', weightClass: 'middle', runSizeGb: 96, totalParams: '119B', activeParams: '6B' },
  {
    slug: 'nemotron-3-5-super-vl',
    weightClass: 'middle',
    runSizeGb: 96,
    totalParams: '120B',
    activeParams: '12B',
  },
  {
    slug: 'qwen-3-5-122b-a10b',
    weightClass: 'middle',
    runSizeGb: 96,
    totalParams: '122B',
    activeParams: '10B',
  },
  { slug: 'mistral-medium-3-5-128b', weightClass: 'middle', runSizeGb: 104, totalParams: '128B' },
  { slug: 'minimax-m2-7', weightClass: 'heavy', runSizeGb: 144, totalParams: '230B', activeParams: '10B' },
  { slug: 'glm-5-3-flash', weightClass: 'heavy', runSizeGb: 144, totalParams: '320B', activeParams: '18B' },
  { slug: 'inkling-small', weightClass: 'heavy', runSizeGb: 200, totalParams: '276B', activeParams: '12B' },
  { slug: 'deepseek-v4-flash', weightClass: 'heavy', runSizeGb: 208, totalParams: '284B', activeParams: '13B' },
  { slug: 'hy3', weightClass: 'heavy', runSizeGb: 208, totalParams: '295B', activeParams: '21B' },
  { slug: 'mimo-v2-6-flash', weightClass: 'heavy', runSizeGb: 216, totalParams: '309B', activeParams: '15B' },
  { slug: 'minimax-m3-1-flash', weightClass: 'heavy', runSizeGb: 272, totalParams: '428B', activeParams: '23B' },
  { slug: 'glm-5-3', weightClass: 'super-heavy', runSizeGb: 304, totalParams: '744B', activeParams: '40B' },
  { slug: 'deepseek-v4-pro', weightClass: 'super-heavy', runSizeGb: 1008, totalParams: '1.6T', activeParams: '49B' },
  { slug: 'kimi-k3', weightClass: 'super-heavy', runSizeGb: 1548, totalParams: '2.8T' },
];

/**
 * Models verified against `https://openrouter.ai/api/v1/models` on 2026-11-28.
 * Qwen3.8 Flash Next was listed in the design CSV as unavailable on
 * 2026-11-23; it is served now under `qwen/qwen3.8-flash`.
 */
const VERIFIED_ADDITIONS: ReadonlyArray<{
  slug: string;
  apiModelId: string;
  weightClass: WeightClassKey;
  runSizeGb: number;
  totalParams: string;
  activeParams?: string;
}> = [
  {
    slug: 'bonsai-2-27b',
    apiModelId: 'prism-ml/ternary-bonsai-2-27b',
    weightClass: 'feather',
    runSizeGb: 16,
    totalParams: '27B',
  },
  {
    slug: 'inkling-2-mini',
    apiModelId: 'thinkingmachines/inkling-2-mini',
    weightClass: 'light',
    runSizeGb: 32,
    totalParams: '26.4B',
    activeParams: '3.4B',
  },
  {
    slug: 'qwen-3-8-flash-next',
    apiModelId: 'qwen/qwen3.8-flash',
    weightClass: 'middle',
    runSizeGb: 96,
    totalParams: '125B',
    activeParams: '6B',
  },
];

describe('curated Model registry catalogue', () => {
  it('is internally consistent', () => {
    expect(validateModelRegistry(MODEL_REGISTRY)).toEqual([]);
  });

  it('adds every verified CSV row with its curated class and Run size', () => {
    for (const expected of VERIFIED_CSV) {
      const model = MODEL_REGISTRY.find((entry) => entry.slug === expected.slug);
      expect(model, expected.slug).toBeDefined();
      expect(model, expected.slug).toMatchObject({
        weightClass: expected.weightClass,
        runSizeGb: expected.runSizeGb,
        totalParams: expected.totalParams,
        activeParams: expected.activeParams ?? null,
      });
    }
  });

  it('adds the later verified Models with their curated class and Run size', () => {
    for (const expected of VERIFIED_ADDITIONS) {
      const model = MODEL_REGISTRY.find((entry) => entry.slug === expected.slug);
      expect(model, expected.slug).toBeDefined();
      expect(model, expected.slug).toMatchObject({
        apiModelId: expected.apiModelId,
        weightClass: expected.weightClass,
        runSizeGb: expected.runSizeGb,
        totalParams: expected.totalParams,
        activeParams: expected.activeParams ?? null,
      });
    }
  });

  it('reports a populated section for every Weight class', () => {
    const coverage = Object.fromEntries(
      WEIGHT_CLASS_KEYS.map((key) => [
        key,
        MODEL_REGISTRY.filter((model) => model.weightClass === key).length,
      ]),
    ) as Record<WeightClassKey, number>;

    for (const key of WEIGHT_CLASS_KEYS) expect(coverage[key], key).toBeGreaterThan(0);
    console.info('[model-registry] class coverage', coverage);
  });

  it('gives every open-weight entry a class, Run size and parameter count', () => {
    for (const model of MODEL_REGISTRY.filter((entry) => entry.openWeights)) {
      expect(model.weightClass, model.slug).not.toBeNull();
      expect(model.runSizeGb, model.slug).toBeGreaterThan(0);
      expect(model.totalParams, model.slug).toBeTruthy();
    }
  });

  it('gives every frontier entry no class and no Run size', () => {
    for (const model of MODEL_REGISTRY.filter((entry) => !entry.openWeights)) {
      expect(model.weightClass, model.slug).toBeNull();
      expect(model.runSizeGb, model.slug).toBeNull();
      expect(model.totalParams, model.slug).toBeNull();
      expect(model.activeParams, model.slug).toBeNull();
    }
  });

  it('carries no release slot anywhere in the catalogue', () => {
    for (const model of MODEL_REGISTRY) {
      expect(model).not.toHaveProperty('release');
    }
    for (const row of modelRegistryRows()) {
      expect(row).not.toHaveProperty('release');
      expect(row).not.toHaveProperty('family');
      expect(row).not.toHaveProperty('weightClass');
      expect(row).not.toHaveProperty('runSizeGb');
      expect(row).not.toHaveProperty('publisher');
      expect(row).not.toHaveProperty('avatarUrl');
    }
  });

  it('rejects duplicate slugs', () => {
    const problems = validateModelRegistry([
      entry({ slug: 'same', apiModelId: 'a/one', monogram: 'AA' }),
      entry({ slug: 'same', apiModelId: 'a/two', monogram: 'AB' }),
    ]);

    expect(problems).toContainEqual({ code: 'duplicate_slug', slug: 'same' });
  });

  it('rejects duplicate provider model IDs', () => {
    const problems = validateModelRegistry([
      entry({ slug: 'one', apiModelId: 'same/model', monogram: 'AA' }),
      entry({ slug: 'two', apiModelId: 'same/model', monogram: 'AB' }),
    ]);

    expect(problems).toContainEqual({
      code: 'duplicate_api_model_id',
      apiModelId: 'same/model',
    });
  });

  it('allows a repeated monogram', () => {
    const problems = validateModelRegistry([
      entry({ slug: 'one', apiModelId: 'a/one', monogram: 'TM' }),
      entry({ slug: 'two', apiModelId: 'a/two', monogram: 'TM' }),
    ]);

    expect(problems).toEqual([]);
  });

  it('rejects a missing monogram or publisher', () => {
    const problems = validateModelRegistry([
      entry({ slug: 'no-monogram', monogram: '   ', apiModelId: 'a/one' }),
      entry({ slug: 'no-publisher', publisher: '  ', apiModelId: 'a/two' }),
    ]);

    expect(problems).toContainEqual({ code: 'missing_monogram', slug: 'no-monogram' });
    expect(problems).toContainEqual({ code: 'missing_publisher', slug: 'no-publisher' });
  });

  it('rejects a missing Model icon', () => {
    const problems = validateModelRegistry([
      entry({ slug: 'no-avatar', avatarUrl: '   ', apiModelId: 'a/one' }),
    ]);

    expect(problems).toContainEqual({ code: 'missing_avatar', slug: 'no-avatar' });
  });

  it('rejects an unparseable ETA', () => {
    const problems = validateModelRegistry([
      entry({ slug: 'nan-eta', etaSeconds: Number.NaN, apiModelId: 'a/one' }),
      entry({ slug: 'zero-eta', etaSeconds: 0, apiModelId: 'a/two' }),
    ]);

    expect(problems).toContainEqual({ code: 'invalid_eta', slug: 'nan-eta' });
    expect(problems).toContainEqual({ code: 'invalid_eta', slug: 'zero-eta' });
  });

  it('requires a class, Run size and parameters on an open-weight entry', () => {
    const problems = validateModelRegistry([
      entry({
        slug: 'bare',
        weightClass: null,
        runSizeGb: null,
        totalParams: null,
      }),
    ]);

    expect(problems).toContainEqual({ code: 'missing_weight_class', slug: 'bare' });
    expect(problems).toContainEqual({ code: 'missing_run_size', slug: 'bare' });
    expect(problems).toContainEqual({ code: 'missing_total_params', slug: 'bare' });
  });

  it('rejects class, Run size or parameters on a frontier entry', () => {
    const problems = validateModelRegistry([
      entry({ slug: 'closed', openWeights: false }),
    ]);

    expect(problems).toContainEqual({ code: 'weight_class_on_frontier', slug: 'closed' });
    expect(problems).toContainEqual({ code: 'run_size_on_frontier', slug: 'closed' });
    expect(problems).toContainEqual({ code: 'params_on_frontier', slug: 'closed' });
  });

  it('produces database rows that carry the open-weights flag only', () => {
    const rows = modelRegistryRows();

    expect(rows).toHaveLength(MODEL_REGISTRY.length);
    for (const model of MODEL_REGISTRY) {
      expect(rows.find((row) => row.slug === model.slug)?.openWeights).toBe(
        model.openWeights,
      );
    }
  });
});
