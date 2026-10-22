import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_CHALLENGERS,
  describeSchedule,
  matchModelFromFrontMatter,
  resolveMaxChallengers,
  toggleChallenger,
  challengerDisabled,
} from '../src/domain/new-comparison';

const models = [
  { id: 'm-llama', slug: 'llama-3-3-70b', displayName: 'Llama 3.3 70B', etaSeconds: 8 },
  { id: 'm-qwen', slug: 'qwen-2-5-72b', displayName: 'Qwen2.5 72B', etaSeconds: 6 },
  { id: 'm-deepseek', slug: 'deepseek-v3', displayName: 'DeepSeek V3', etaSeconds: 9 },
  { id: 'm-mistral', slug: 'mistral-large', displayName: 'Mistral Large', etaSeconds: 5 },
  { id: 'm-gemma', slug: 'gemma-2-27b', displayName: 'Gemma 2 27B', etaSeconds: 7 },
  { id: 'm-phi', slug: 'phi-4', displayName: 'Phi-4', etaSeconds: 4 },
];
const picked = ['m-qwen', 'm-deepseek', 'm-mistral', 'm-gemma'];
const valid = {
  hasFile: true,
  baseModelId: 'm-llama',
  challengerIds: ['m-qwen'],
  prompt: 'Write a rate limiter.',
  models,
};

describe('matchModelFromFrontMatter', () => {
  it('matches a registry slug case-insensitively', () => {
    expect(matchModelFromFrontMatter('DeepSeek-V3', models)?.id).toBe('m-deepseek');
  });

  it('matches a display name with surrounding whitespace', () => {
    expect(matchModelFromFrontMatter('  llama 3.3 70b ', models)?.id).toBe('m-llama');
  });

  it('returns null for an unknown value so the form can ask the author to choose', () => {
    expect(matchModelFromFrontMatter('gpt-5', models)).toBeNull();
  });

  it('returns null when the file has no model key', () => {
    expect(matchModelFromFrontMatter(null, models)).toBeNull();
    expect(matchModelFromFrontMatter('   ', models)).toBeNull();
  });
});

describe('challenger selection', () => {
  it('disables the base model as a challenger', () => {
    expect(challengerDisabled('m-llama', 'm-llama', [])).toBe(true);
    expect(toggleChallenger('m-llama', 'm-llama', [])).toEqual([]);
  });

  it('disables every unselected tile at the configured maximum', () => {
    expect(challengerDisabled('m-phi', null, picked)).toBe(true);
    expect(challengerDisabled('m-phi', null, picked.slice(0, 3), 4)).toBe(false);
  });

  it('keeps selected tiles clickable at the maximum so the author can deselect', () => {
    expect(challengerDisabled('m-qwen', null, picked)).toBe(false);
  });

  it('toggles a challenger on and off without mutating the input', () => {
    const current = ['m-qwen'];
    expect(toggleChallenger('m-deepseek', null, current)).toEqual(['m-qwen', 'm-deepseek']);
    expect(toggleChallenger('m-qwen', null, current)).toEqual([]);
    expect(current).toEqual(['m-qwen']);
  });

  it('refuses a challenger above the configured maximum', () => {
    expect(toggleChallenger('m-phi', null, picked)).toEqual(picked);
    expect(toggleChallenger('m-phi', null, picked.slice(0, 3), 3)).toEqual(picked.slice(0, 3));
  });

  it('honours an operator-configured maximum', () => {
    expect(DEFAULT_MAX_CHALLENGERS).toBe(4);
    expect(resolveMaxChallengers('3')).toBe(3);
    expect(resolveMaxChallengers(undefined)).toBe(DEFAULT_MAX_CHALLENGERS);
    expect(resolveMaxChallengers('nonsense')).toBe(DEFAULT_MAX_CHALLENGERS);
    expect(resolveMaxChallengers('0')).toBe(DEFAULT_MAX_CHALLENGERS);
  });
});

describe('describeSchedule', () => {
  it('explains that a file is missing', () => {
    expect(
      describeSchedule({ ...valid, hasFile: false, baseModelId: null, challengerIds: [] }),
    ).toMatchObject({ ready: false, hint: 'Upload a base output to continue' });
  });

  it('asks for the base model once a file is loaded', () => {
    expect(
      describeSchedule({ ...valid, baseModelId: null, challengerIds: [] }),
    ).toMatchObject({ ready: false, hint: 'Pick the model that generated it' });
  });

  it('asks for at least one challenger once the base model is chosen', () => {
    expect(describeSchedule({ ...valid, challengerIds: [] })).toMatchObject({
      ready: false,
      hint: 'Choose at least one model to compare',
    });
  });

  it('refuses an empty prompt instead of letting the server substitute the front-matter one', () => {
    expect(describeSchedule({ ...valid, prompt: '   ' })).toMatchObject({
      ready: false,
      hint: 'Add a prompt to schedule',
    });
  });

  it('refuses a prompt over the upload limit', () => {
    expect(describeSchedule({ ...valid, prompt: 'x'.repeat(10_001) })).toMatchObject({
      ready: false,
      hint: 'Prompts are limited to 10,000 characters',
    });
  });

  it('estimates the number of calls and the slowest ETA', () => {
    expect(
      describeSchedule({
        ...valid,
        challengerIds: ['m-qwen', 'm-deepseek'],
      }),
    ).toEqual({ ready: true, hint: '2 hosted API calls · ~9s' });
  });
});
