import { describe, expect, it } from 'vitest';
import {
  modelWeightLabel,
  modelWeightShortLabel,
} from '../src/domain/model-labels';

describe('Model weight labels', () => {
  it('names open-weight Models so a reader knows the weights are published', () => {
    expect(modelWeightLabel(true)).toBe('Open weights');
    expect(modelWeightShortLabel(true)).toBe('Open');
  });

  it('names frontier Models as closed API models, not open-weight', () => {
    expect(modelWeightLabel(false)).toBe('Frontier API');
    expect(modelWeightShortLabel(false)).toBe('Frontier');
  });
});
