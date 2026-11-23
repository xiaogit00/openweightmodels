import { describe, expect, it } from 'vitest';
import {
  buildModelPickerView,
  modelClassTabs,
  modelMatchesQuery,
  type PickableModel,
} from '../src/domain/model-picker';

const model = (overrides: Partial<PickableModel> & { id: string }): PickableModel => ({
  slug: 'llama-3-3-70b',
  displayName: 'Llama 3.3 70B',
  openWeights: true,
  family: 'llama',
  publisher: 'Meta',
  weightClass: 'middle',
  runSizeGb: 64,
  ...overrides,
});

const models: PickableModel[] = [
  model({
    id: 'llama-middle',
    slug: 'llama-3-3-70b',
    displayName: 'Llama 3.3 70B',
    weightClass: 'middle',
    runSizeGb: 64,
  }),
  model({
    id: 'qwen-light',
    slug: 'qwen-3-8-27b',
    displayName: 'Qwen3.8 27B',
    family: 'qwen',
    publisher: 'Alibaba',
    weightClass: 'light',
    runSizeGb: 32,
  }),
  model({
    id: 'ministral-fly',
    slug: 'ministral-3b',
    displayName: 'Ministral 3B',
    family: 'ministral',
    publisher: 'Mistral',
    weightClass: 'fly',
    runSizeGb: 6,
  }),
  model({
    id: 'kimi-heavy',
    slug: 'kimi-k3',
    displayName: 'Kimi K3',
    family: 'kimi',
    publisher: 'Moonshot AI',
    weightClass: 'super-heavy',
    runSizeGb: 1548,
  }),
  model({
    id: 'claude-frontier',
    slug: 'claude-opus-5-5',
    displayName: 'Claude Opus 5.5',
    openWeights: false,
    family: 'claude',
    publisher: 'Anthropic',
    weightClass: null,
    runSizeGb: null,
  }),
];

describe('Model picker search', () => {
  it('matches display name, slug, family, publisher or class label', () => {
    expect(modelMatchesQuery(models[0]!, ' maverick llama ')).toBe(false);
    expect(modelMatchesQuery(models[0]!, 'LLAMA-3-3')).toBe(true);
    expect(modelMatchesQuery(models[1]!, 'alibaba')).toBe(true);
    expect(modelMatchesQuery(models[2]!, 'ministral')).toBe(true);
    expect(modelMatchesQuery(models[3]!, 'super heavy')).toBe(true);
    expect(modelMatchesQuery(models[3]!, 'heavy')).toBe(true);
    expect(modelMatchesQuery(models[4]!, 'frontier')).toBe(true);
    expect(modelMatchesQuery(models[0]!, 'frontier')).toBe(false);
    expect(modelMatchesQuery(models[0]!, '   ')).toBe(true);
  });
});

describe('Weight class tabs', () => {
  it('offers All sizes, one tab per populated class, then Frontier', () => {
    const tabs = modelClassTabs(models);

    expect(tabs.map((tab) => tab.key)).toEqual([
      'all',
      'fly',
      'light',
      'middle',
      'super-heavy',
      'frontier',
    ]);
    expect(tabs.map((tab) => tab.count)).toEqual([5, 1, 1, 1, 1, 1]);
  });

  it('formats a class subline with its range and Frontier with API', () => {
    const tabs = modelClassTabs(models);

    expect(tabs[0]?.subline).toBe('5 models');
    expect(tabs.find((tab) => tab.key === 'light')?.subline).toBe('1 · ~32 GB');
    expect(tabs.at(-1)?.subline).toBe('1 · API');
  });

  it('lets tab counts follow the query without dropping an empty class tab', () => {
    const tabs = modelClassTabs(
      models,
      models.filter((entry) => modelMatchesQuery(entry, 'mistral')),
    );

    expect(tabs.map((tab) => tab.key)).toContain('middle');
    expect(tabs.find((tab) => tab.key === 'fly')?.count).toBe(1);
    expect(tabs.find((tab) => tab.key === 'middle')?.count).toBe(0);
  });
});

describe('Step 2 picker view', () => {
  it('opens on All sizes with every populated class then Frontier', () => {
    const view = buildModelPickerView({ models });

    expect(view.activeTab).toBe('all');
    expect(view.sections.map((section) => section.key)).toEqual([
      'fly',
      'light',
      'middle',
      'super-heavy',
      'frontier',
    ]);
    expect(view.sections.find((section) => section.key === 'light')?.label).toBe(
      'Light weight',
    );
    expect(view.sections.at(-1)?.label).toBe('Frontier API');
    expect(view.empty).toBeNull();
  });

  it('shows only the active class section', () => {
    const view = buildModelPickerView({ models, tab: 'light' });

    expect(view.sections).toHaveLength(1);
    expect(view.sections[0]?.models.map((entry) => entry.id)).toEqual(['qwen-light']);
  });

  it('applies search within the active tab', () => {
    expect(
      buildModelPickerView({ models, tab: 'light', query: 'qwen' }).sections,
    ).toHaveLength(1);
    expect(
      buildModelPickerView({ models, tab: 'fly', query: 'qwen' }).sections,
    ).toHaveLength(0);
  });

  it('matches a class label on All sizes', () => {
    const view = buildModelPickerView({ models, query: 'heavy' });

    expect(view.sections.map((section) => section.key)).toEqual(['super-heavy']);
  });

  it('pins selected Models even when a tab or search hides them', () => {
    const view = buildModelPickerView({
      models,
      tab: 'fly',
      query: 'ministral',
      selectedIds: ['qwen-light', 'llama-middle'],
    });

    expect(view.selected.map((entry) => entry.id)).toEqual([
      'qwen-light',
      'llama-middle',
    ]);
    // A pinned Model that the tab excludes stays in the strip, not below.
    expect(
      view.sections.flatMap((section) => section.models.map((entry) => entry.id)),
    ).toEqual(['ministral-fly']);
  });

  it('reports a class-specific empty state', () => {
    const view = buildModelPickerView({ models, tab: 'fly', query: 'llama' });

    expect(view.sections).toEqual([]);
    expect(view.empty).toBe('class');
  });

  it('reports an explicit empty state for a query that matches nothing', () => {
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
