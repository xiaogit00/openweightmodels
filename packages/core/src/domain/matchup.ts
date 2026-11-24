/**
 * The Board card's matchup line: a one-sentence claim about the Weight classes
 * of every Model on the card.
 *
 * "Same weight" means *every* Model shares a class, not just the Base and the
 * first Challenger, so a hidden mismatch cannot read as a same-class
 * Comparison. Frontier Models count as one group and print as `API`.
 */

import {
  weightClassLabel,
  weightClassShortLabel,
  type WeightClassKey,
} from './weight-class';

export type MatchupModel = {
  weightClass: WeightClassKey | null;
};

export type ComparisonMatchup = {
  kind: 'same' | 'across';
  /** The visible tag copy. Short labels only, e.g. `Light` and `API`. */
  label: string;
  /** The tooltip, naming each class in full and any extra Models. */
  title: string;
};

/** Inside a matchup tag a Frontier Model reads `API`, not `Frontier API`. */
function matchupShortLabel(weightClass: WeightClassKey | null): string {
  return weightClass ? weightClassShortLabel(weightClass) : 'API';
}

/**
 * Composes the matchup for a card with two or more Models. A card with fewer
 * than two has nothing to compare, so it renders no line at all.
 */
export function comparisonMatchup(
  models: readonly MatchupModel[],
): ComparisonMatchup | null {
  const [base, ...challengers] = models;
  if (!base || challengers.length === 0) return null;

  const baseClass = base.weightClass;
  const mismatchIndex = challengers.findIndex(
    (model) => model.weightClass !== baseClass,
  );

  if (mismatchIndex === -1) {
    return {
      kind: 'same',
      label: `Same weight · ${matchupShortLabel(baseClass)}`,
      title: `Same weight class: both models are ${weightClassLabel(baseClass)}`,
    };
  }

  const different = challengers[mismatchIndex];
  // Models beyond the named pair: everything after the first mismatch.
  const extra = challengers.length - mismatchIndex - 1;
  const suffix = extra > 0 ? ` + ${extra} more` : '';

  return {
    kind: 'across',
    label: `Across weight class · ${matchupShortLabel(
      baseClass,
    )} vs ${matchupShortLabel(different.weightClass)}${suffix}`,
    title: `Across weight classes: ${weightClassLabel(
      baseClass,
    )} vs ${weightClassLabel(different.weightClass)}${suffix}`,
  };
}
