import { describe, expect, it } from 'vitest';
import {
  buildModelChips,
  groupBoardModels,
  groupSelection,
  isGroupOpen,
  toggleVisibleSelection,
} from '../src/domain/board-models';

const model = (
  slug: string,
  displayName: string,
  weightClass: 'fly' | 'light' | 'middle' | 'heavy' | null,
) => ({ slug, displayName, weightClass });

const MODELS = [
  model('llama', 'Llama 3.3 70B', 'middle'),
  model('qwen', 'Qwen3.8 27B', 'light'),
  model('gemma', 'Gemma 4 31B', 'light'),
  model('phi', 'Phi 4', 'light'),
  model('frontier', 'GPT-6 Sol', null),
  model('deepseek', 'DeepSeek V4.1 Flash', 'heavy'),
];

describe('Board model groups', () => {
  it('orders groups by weight class, then Frontier, and drops empty classes', () => {
    const groups = groupBoardModels(MODELS);

    expect(groups.map((entry) => entry.key)).toEqual([
      'light',
      'middle',
      'heavy',
      'frontier',
    ]);
    expect(groups[0].label).toBe('Light');
    expect(groups[0].ariaLabel).toBe('Light weight');
    expect(groups[0].range).toBe('~32 GB');
    expect(groups[0].title).toBe('Light weight · ~32 GB · One 24 GB gaming GPU');
    expect(groups[3]).toMatchObject({
      label: 'Frontier',
      ariaLabel: 'Frontier API',
      range: 'API',
      title: 'Frontier API · hosted only · size undisclosed',
    });
  });

  it('returns no groups when nothing is visible', () => {
    expect(groupBoardModels([])).toEqual([]);
  });
});

describe('Group selection state', () => {
  const visible = ['qwen', 'gemma', 'phi'];

  it('counts only the visible models', () => {
    expect(groupSelection([], visible)).toEqual({
      selected: 0,
      visible: 3,
      state: 'unchecked',
    });
    expect(groupSelection(['qwen'], visible)).toEqual({
      selected: 1,
      visible: 3,
      state: 'mixed',
    });
    expect(groupSelection(['qwen', 'gemma', 'phi'], visible)).toEqual({
      selected: 3,
      visible: 3,
      state: 'checked',
    });
  });

  it('cannot report more selected than visible', () => {
    const state = groupSelection(['qwen', 'gemma', 'phi', 'llama'], visible);

    expect(state.selected).toBe(3);
    expect(state.visible).toBe(3);
    expect(state.state).toBe('checked');
  });
});

describe('Toggling a visible group', () => {
  it('selects every visible model and leaves hidden selections alone', () => {
    expect(toggleVisibleSelection(['llama'], ['qwen', 'gemma'])).toEqual([
      'llama',
      'qwen',
      'gemma',
    ]);
  });

  it('deselects only the visible models when all of them are selected', () => {
    expect(
      toggleVisibleSelection(['llama', 'qwen', 'gemma', 'phi'], ['qwen', 'gemma']),
    ).toEqual(['llama', 'phi']);
  });
});

describe('Group collapse predicate', () => {
  it('starts open at lg and collapsed below it, keeping per-group overrides', () => {
    expect(isGroupOpen({}, 'light', true)).toBe(true);
    expect(isGroupOpen({}, 'light', false)).toBe(false);
    expect(isGroupOpen({ light: true }, 'light', true)).toBe(false);
    expect(isGroupOpen({ light: false }, 'light', false)).toBe(true);
  });
});

describe('Board model chips', () => {
  const counts = { llama: 7, qwen: 6, gemma: 4, deepseek: 2 };
  const models = MODELS;

  it('keeps one chip per selected model when its class is not fully selected', () => {
    const chips = buildModelChips({
      selected: ['qwen', 'llama'],
      models,
      counts,
    });

    expect(chips).toEqual([
      { key: 'model:qwen', label: 'Qwen3.8 27B', slugs: ['qwen'] },
      { key: 'model:llama', label: 'Llama 3.3 70B', slugs: ['llama'] },
    ]);
  });

  it('collapses a whole class into one chip, including a selected zero-count model', () => {
    const chips = buildModelChips({
      selected: ['qwen', 'gemma', 'phi'],
      models,
      counts,
    });

    expect(chips).toEqual([
      {
        key: 'class:light',
        label: 'Light weight · 3 models',
        slugs: ['qwen', 'gemma', 'phi'],
      },
    ]);
  });

  it('does not collapse a class with only one model that has comparisons', () => {
    const chips = buildModelChips({
      selected: ['deepseek'],
      models,
      counts,
    });

    expect(chips).toEqual([
      { key: 'model:deepseek', label: 'DeepSeek V4.1 Flash', slugs: ['deepseek'] },
    ]);
  });

  it('never collapses Frontier into a class chip without comparisons', () => {
    const chips = buildModelChips({
      selected: ['frontier'],
      models,
      counts,
    });

    expect(chips).toEqual([
      { key: 'model:frontier', label: 'GPT-6 Sol', slugs: ['frontier'] },
    ]);
  });

  it('falls back to the slug when a selected model is not in the list', () => {
    const chips = buildModelChips({
      selected: ['vanished'],
      models,
      counts,
    });

    expect(chips).toEqual([
      { key: 'model:vanished', label: 'vanished', slugs: ['vanished'] },
    ]);
  });
});
