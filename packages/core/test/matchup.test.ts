import { describe, expect, it } from 'vitest';
import { comparisonMatchup } from '../src/domain/matchup';

describe('Comparison matchup', () => {
  it('stays quiet when every model shares a class', () => {
    expect(
      comparisonMatchup([{ weightClass: 'light' }, { weightClass: 'light' }]),
    ).toEqual({
      kind: 'same',
      label: 'Same weight · Light',
      title: 'Same weight class: both models are Light weight',
    });
  });

  it('names the base class against the first different class', () => {
    expect(
      comparisonMatchup([{ weightClass: 'light' }, { weightClass: 'heavy' }]),
    ).toEqual({
      kind: 'across',
      label: 'Across weight class · Light vs Heavy',
      title: 'Across weight classes: Light weight vs Heavy weight',
    });
  });

  it('finds a mismatch in a later challenger, not only the first', () => {
    const matchup = comparisonMatchup([
      { weightClass: 'light' },
      { weightClass: 'light' },
      { weightClass: 'heavy' },
    ]);

    expect(matchup?.label).toBe('Across weight class · Light vs Heavy');
    expect(matchup?.title).toBe('Across weight classes: Light weight vs Heavy weight');
  });

  it('counts the models beyond the mismatched pair', () => {
    const matchup = comparisonMatchup([
      { weightClass: 'light' },
      { weightClass: 'heavy' },
      { weightClass: 'middle' },
      { weightClass: 'fly' },
    ]);

    expect(matchup?.label).toBe('Across weight class · Light vs Heavy + 2 more');
    expect(matchup?.title).toBe(
      'Across weight classes: Light weight vs Heavy weight + 2 more',
    );
  });

  it('treats two frontier models as the same group', () => {
    expect(comparisonMatchup([{ weightClass: null }, { weightClass: null }])).toEqual({
      kind: 'same',
      label: 'Same weight · API',
      title: 'Same weight class: both models are Frontier API',
    });
  });

  it('reads a frontier model as API in the across-weight copy', () => {
    expect(
      comparisonMatchup([{ weightClass: 'light' }, { weightClass: null }]),
    ).toEqual({
      kind: 'across',
      label: 'Across weight class · Light vs API',
      title: 'Across weight classes: Light weight vs Frontier API',
    });
  });

  it('has nothing to say about a card with fewer than two models', () => {
    expect(comparisonMatchup([])).toBeNull();
    expect(comparisonMatchup([{ weightClass: null }])).toBeNull();
  });
});
