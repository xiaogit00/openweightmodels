/**
 * Wording for the Model pickers. A Model is either open-weight or a closed
 * frontier API, and a reader should never have to guess which one ran.
 */
export function modelWeightLabel(openWeights: boolean): string {
  return openWeights ? 'Open weights' : 'Frontier API';
}

/** Compact variant for dense menus and tabs. */
export function modelWeightShortLabel(openWeights: boolean): string {
  return openWeights ? 'Open' : 'Frontier';
}
