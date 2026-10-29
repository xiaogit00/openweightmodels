import { describe, expect, it } from 'vitest';
import {
  buildModelPickerView,
  groupCurrentModels,
  modelMatchesQuery,
  modelMatchesWeight,
  splitModelsByRelease,
  type PickableModel,
} from '../src/domain/model-picker';

const model = (overrides: Partial<PickableModel> & { id: string }): PickableModel => ({
  slug: 'llama-4-maverick',
  displayName: 'Llama 4 Maverick',
  openWeights: true,
  family: 'llama',
  release: 'current',
  ...overrides,
});

const models: PickableModel[] = [
  model({ id: 'llama-current', slug: 'llama-4-maverick', displayName: 'Llama 4 Maverick' }),
  model({
    id: 'qwen-current',
    slug: 'qwen-3-8-27b',
    displayName: 'Qwen3.8 27B',
    family: 'qwen',
  }),
  model({
    id: 'llama-previous',
    slug: 'llama-3-3-70b',
    displayName: 'Llama 3.3 70B',
    release: 'previous',
  }),
  model({
    id: 'claude-current',
    slug: 'claude-opus-5-5',
    displayName: 'Claude Opus 5.5',
    openWeights: false,
    family: 'claude',
  }),
  model({
    id: 'claude-previous',
    slug: 'claude-opus-5',
    displayName: 'Claude Opus 5',
    openWeights: false,
    family: 'claude',
    release: 'previous',
  }),
];

describe('Model picker search', () => {
  it('matches a display name or slug, ignoring case and surrounding space', () => {
    expect(modelMatchesQuery(models[0]!, ' maverick ')).toBe(true);
    expect(modelMatchesQuery(models[0]!, 'LLAMA-4')).toBe(true);
    expect(modelMatchesQuery(models[0]!, 'qwen')).toBe(false);
    expect(modelMatchesQuery(models[0]!, '   ')).toBe(true);
  });

  it('matches a model by its family name', () => {
    expect(modelMatchesQuery(models[3]!, 'claude')).toBe(true);
  });
});

describe('Model weight filter', () => {
  it('keeps every Model when the filter is all', () => {
    expect(models.every((candidate) => modelMatchesWeight(candidate, 'all'))).toBe(true);
  });

  it('keeps only open-weight or only frontier Models', () => {
    expect(modelMatchesWeight(models[0]!, 'open')).toBe(true);
    expect(modelMatchesWeight(models[0]!, 'frontier')).toBe(false);
    expect(modelMatchesWeight(models[3]!, 'frontier')).toBe(true);
    expect(modelMatchesWeight(models[3]!, 'open')).toBe(false);
  });
});

describe('Model release split', () => {
  it('partitions current and previous releases', () => {
    const split = splitModelsByRelease(models);

    expect(split.current.map((entry) => entry.id).sort()).toEqual([
      'claude-current',
      'llama-current',
      'qwen-current',
    ]);
    expect(split.previous.map((entry) => entry.id).sort()).toEqual([
      'claude-previous',
      'llama-previous',
    ]);
  });

  it('groups current releases into Open weights and Frontier API', () => {
    const groups = groupCurrentModels(splitModelsByRelease(models).current);

    expect(groups.openWeights.map((entry) => entry.id).sort()).toEqual([
      'llama-current',
      'qwen-current',
    ]);
    expect(groups.frontier.map((entry) => entry.id)).toEqual(['claude-current']);
  });
});

describe('Step 2 picker view', () => {
  it('shows current releases by default and keeps previous releases behind the disclosure', () => {
    const view = buildModelPickerView({ models });

    expect(view.sections.map((section) => section.key)).toEqual([
      'open-weights',
      'frontier-api',
    ]);
    expect(view.previousMatches).toBe(2);
    expect(view.empty).toBeNull();
  });

  it('shows previous releases when the disclosure is open', () => {
    const view = buildModelPickerView({ models, showPrevious: true });

    expect(view.sections.map((section) => section.key)).toEqual([
      'open-weights',
      'frontier-api',
      'previous',
    ]);
    expect(view.sections.at(-1)?.models.map((entry) => entry.id).sort()).toEqual([
      'claude-previous',
      'llama-previous',
    ]);
  });

  it('searches all releases, surfacing a collapsed previous release', () => {
    const view = buildModelPickerView({
      models,
      query: 'llama 3.3',
      showPrevious: false,
    });

    const previous = view.sections.find((section) => section.key === 'previous');
    expect(previous?.models.map((entry) => entry.id)).toEqual(['llama-previous']);
    expect(view.previousMatches).toBe(1);
  });

  it('applies the weight filter to current and previous releases', () => {
    const view = buildModelPickerView({ models, weight: 'frontier', showPrevious: true });

    expect(view.sections.map((section) => section.key)).toEqual([
      'frontier-api',
      'previous',
    ]);
    expect(view.sections.at(-1)?.models.map((entry) => entry.id)).toEqual([
      'claude-previous',
    ]);
    expect(view.previousMatches).toBe(1);
  });

  it('pins selected Models even when a search or collapse hides them', () => {
    const view = buildModelPickerView({
      models,
      query: 'claude',
      selectedIds: ['llama-previous', 'llama-current'],
      showPrevious: false,
    });

    expect(view.selected.map((entry) => entry.id)).toEqual([
      'llama-previous',
      'llama-current',
    ]);
    // A pinned Model that the query excludes stays in the strip, not below.
    expect(
      view.sections.flatMap((section) => section.models.map((entry) => entry.id)),
    ).not.toContain('llama-previous');
    expect(view.sections.map((section) => section.key)).toEqual([
      'frontier-api',
      'previous',
    ]);

    // Without a filter, the tile stays in its group so it keeps focus and can
    // be toggled off either there or in the strip.
    const unfiltered = buildModelPickerView({
      models,
      selectedIds: ['llama-current'],
    });
    expect(
      unfiltered.sections
        .flatMap((section) => section.models.map((entry) => entry.id)),
    ).toContain('llama-current');
  });

  it('reports an explicit empty state for a search that matches nothing', () => {
    const view = buildModelPickerView({ models, query: 'no-such-model' });

    expect(view.sections).toEqual([]);
    expect(view.empty).toBe('filters');
  });

  it('reports an explicit empty state when the registry has no Models', () => {
    const view = buildModelPickerView({ models: [] });

    expect(view.sections).toEqual([]);
    expect(view.empty).toBe('registry');
  });
});
