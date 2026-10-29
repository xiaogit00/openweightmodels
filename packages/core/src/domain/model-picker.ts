/**
 * Search, grouping and pinning rules shared by every Model picker.
 *
 * The registry keeps two releases per Model family: the current one and, while
 * the vendor still serves it, the previous one. Current releases carry the
 * default view; previous releases stay behind a disclosure but are always
 * findable by search. Keeping these rules here means the New Comparison form
 * and the Add model menu cannot drift apart.
 */

import type { ModelRelease } from './types';

export type ModelWeightFilter = 'all' | 'open' | 'frontier';

/** The fields every picker needs from a Model. */
export type PickableModel = {
  id: string;
  slug: string;
  displayName: string;
  openWeights: boolean;
  family: string;
  release: ModelRelease;
};

export type ModelPickerSectionKey = 'open-weights' | 'frontier-api' | 'previous';

export type ModelPickerSection<T extends PickableModel> = {
  key: ModelPickerSectionKey;
  /** Heading a reader sees above the group. */
  label: string;
  models: T[];
};

export type ModelPickerView<T extends PickableModel> = {
  /** Picked Models in selection order; never filtered out or collapsed. */
  selected: T[];
  /** Current releases first, then matching or expanded previous releases. */
  sections: ModelPickerSection<T>[];
  /** Previous releases matching the query and weight filter, for the disclosure. */
  previousMatches: number;
  /** Why the view has nothing to show, or null when it has sections. */
  empty: 'registry' | 'filters' | null;
};

export function normaliseModelQuery(query: string | null | undefined): string {
  return (query ?? '').trim().toLowerCase();
}

/**
 * Matches the Model's display name, slug or family. Family makes a search for
 * “claude” find every release without the reader knowing its exact name.
 */
export function modelMatchesQuery(
  model: Pick<PickableModel, 'displayName' | 'slug' | 'family'>,
  query: string,
): boolean {
  const key = normaliseModelQuery(query);
  if (!key) return true;
  return [model.displayName, model.slug, model.family].some((value) =>
    value.toLowerCase().includes(key),
  );
}

export function modelMatchesWeight(
  model: Pick<PickableModel, 'openWeights'>,
  weight: ModelWeightFilter,
): boolean {
  if (weight === 'all') return true;
  return weight === 'open' ? model.openWeights : !model.openWeights;
}

function byDisplayName<T extends PickableModel>(left: T, right: T) {
  return left.displayName.localeCompare(right.displayName);
}

export function splitModelsByRelease<T extends PickableModel>(
  models: readonly T[],
): { current: T[]; previous: T[] } {
  return {
    current: models.filter((model) => model.release === 'current').sort(byDisplayName),
    previous: models.filter((model) => model.release === 'previous').sort(byDisplayName),
  };
}

export function groupCurrentModels<T extends PickableModel>(
  models: readonly T[],
): { openWeights: T[]; frontier: T[] } {
  return {
    openWeights: models.filter((model) => model.openWeights),
    frontier: models.filter((model) => !model.openWeights),
  };
}

/**
 * The view the New Comparison picker renders. Selected Models are also pinned
 * in selection order in the strip above, so they survive a filter or a
 * collapsed disclosure; the tile stays in its group too so it keeps focus.
 * Searching always reaches previous releases, even while the disclosure is
 * collapsed; clearing the query folds them away again.
 */
export function buildModelPickerView<T extends PickableModel>(input: {
  models: readonly T[];
  selectedIds?: readonly string[];
  query?: string;
  weight?: ModelWeightFilter;
  showPrevious?: boolean;
}): ModelPickerView<T> {
  const { models, selectedIds = [], query = '', weight = 'all', showPrevious = false } = input;
  const selected = selectedIds
    .map((id) => models.find((model) => model.id === id))
    .filter((model): model is T => Boolean(model));

  // Selected Models stay in their groups too, so a tile keeps its focus and
  // checked state after selection; the strip above only adds a shortcut that
  // survives filters and collapse.
  const matches = models.filter(
    (model) => modelMatchesQuery(model, query) && modelMatchesWeight(model, weight),
  );
  const { current, previous } = splitModelsByRelease(matches);
  const groups = groupCurrentModels(current);

  const sections: ModelPickerSection<T>[] = [];
  if (groups.openWeights.length) {
    sections.push({
      key: 'open-weights',
      label: 'Open weights',
      models: groups.openWeights,
    });
  }
  if (groups.frontier.length) {
    sections.push({
      key: 'frontier-api',
      label: 'Frontier API',
      models: groups.frontier,
    });
  }
  // Search scans every release: previous models surface while a query is
  // active, and the disclosure keeps them visible once it is opened.
  if (previous.length && (showPrevious || normaliseModelQuery(query) !== '')) {
    sections.push({
      key: 'previous',
      label: 'Previous releases',
      models: previous,
    });
  }

  return {
    selected,
    sections,
    previousMatches: previous.length,
    empty:
      models.length === 0
        ? 'registry'
        : matches.length === 0
          ? 'filters'
          : null,
  };
}
