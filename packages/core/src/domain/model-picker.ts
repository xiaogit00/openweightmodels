/**
 * Search, tab, section and pinning rules shared by every Model picker.
 *
 * Step 2 opens on an **All sizes** tab with one section per populated Weight
 * class, then Frontier. A Model's tab comes from its curated `weightClass`,
 * never from bucketing its Run size. Keeping these rules here means the New
 * Comparison form and the Add model menu cannot drift apart.
 */

import {
  WEIGHT_CLASSES,
  modelClassTab,
  weightClassLabel,
  type ModelClassTab,
  type WeightClassKey,
} from './weight-class';

/** The fields every picker needs from a Model. */
export type PickableModel = {
  id: string;
  slug: string;
  displayName: string;
  openWeights: boolean;
  family: string;
  publisher: string;
  weightClass: WeightClassKey | null;
  runSizeGb: number | null;
};

export type ModelPickerSectionKey = WeightClassKey | 'frontier';

export type ModelPickerSection<T extends PickableModel> = {
  key: ModelPickerSectionKey;
  /** Heading a reader sees above the group: `Light weight`, `Frontier API`. */
  label: string;
  /** Range and hardware hint, empty for Frontier. */
  hint: string;
  models: T[];
};

export type ModelPickerTab = {
  key: ModelClassTab;
  label: string;
  /** `12 models`, `32 · ~32 GB`, `8 · API`. */
  subline: string;
  /** Models matching the current query in this tab. */
  count: number;
};

export type ModelPickerView<T extends PickableModel> = {
  /** Picked Models in selection order; never filtered out by a tab or query. */
  selected: T[];
  /** The active tab's sections, in class order, empty sections omitted. */
  sections: ModelPickerSection<T>[];
  /** All sizes, one entry per populated class, then Frontier. */
  tabs: ModelPickerTab[];
  activeTab: ModelClassTab;
  /** Why the view has nothing to show, or null when it has sections. */
  empty: 'registry' | 'filters' | 'class' | null;
};

export function normaliseModelQuery(query: string | null | undefined): string {
  return (query ?? '').trim().toLowerCase();
}

/**
 * Matches display name, publisher, slug, family, or class label. The class
 * names make "heavy" a shortcut to a class without hunting through tabs.
 */
export function modelMatchesQuery(
  model: Pick<
    PickableModel,
    'displayName' | 'slug' | 'family' | 'publisher' | 'weightClass'
  >,
  query: string,
): boolean {
  const key = normaliseModelQuery(query);
  if (!key) return true;
  const classText = model.weightClass
    ? `${weightClassLabel(model.weightClass)} ${model.weightClass}`
    : weightClassLabel(null);
  return [
    model.displayName,
    model.slug,
    model.family,
    model.publisher,
    classText,
  ].some((value) => value.toLowerCase().includes(key));
}

function byDisplayName<T extends { displayName: string }>(left: T, right: T) {
  return left.displayName.localeCompare(right.displayName);
}

export type ModelClassGroup<T extends ClassifiableModel> = {
  key: WeightClassKey | 'frontier';
  /** `Light weight`, `Frontier API`. */
  label: string;
  /** `~32 GB · One 24 GB gaming GPU`, or the Frontier hint. */
  hint: string;
  models: T[];
};

/** The fields grouping needs; every picker row has them. */
export type ClassifiableModel = {
  displayName: string;
  weightClass: WeightClassKey | null;
};

/**
 * Groups Models into the class sections every picker uses, in class order then
 * Frontier. Empty groups are dropped. Class membership comes from the curated
 * `weightClass`, never from bucketing a Run size.
 */
export function groupModelsByClass<T extends ClassifiableModel>(
  models: readonly T[],
): ModelClassGroup<T>[] {
  const groups: Array<Omit<ModelClassGroup<T>, 'models'> & { models: T[] }> = [
    ...WEIGHT_CLASSES.map((definition) => ({
      key: definition.key,
      label: `${definition.label} weight`,
      hint: `${definition.range} · ${definition.hint}`,
      models: models
        .filter((model) => model.weightClass === definition.key)
        .sort(byDisplayName),
    })),
    {
      key: 'frontier',
      label: 'Frontier API',
      hint: 'Hosted only · size undisclosed',
      models: models.filter((model) => model.weightClass === null).sort(byDisplayName),
    },
  ];
  return groups.filter((group) => group.models.length > 0);
}

/** `All sizes` always, one tab per populated class, then Frontier. */
export function modelClassTabs(
  models: readonly PickableModel[],
  matchesQuery: readonly PickableModel[] = models,
): ModelPickerTab[] {
  const countIn = (tab: ModelClassTab) =>
    matchesQuery.filter((model) => tab === 'all' || modelClassTab(model) === tab)
      .length;

  return [
    {
      key: 'all',
      label: 'All sizes',
      subline: `${countIn('all')} models`,
      count: countIn('all'),
    },
    ...WEIGHT_CLASSES.filter((definition) =>
      models.some((model) => model.weightClass === definition.key),
    ).map((definition) => ({
      key: definition.key,
      label: definition.label,
      subline: `${countIn(definition.key)} · ${definition.range}`,
      count: countIn(definition.key),
    })),
    {
      key: 'frontier',
      label: 'Frontier',
      subline: `${countIn('frontier')} · API`,
      count: countIn('frontier'),
    },
  ];
}

/**
 * The view the New Comparison picker renders. Selected Models are pinned in
 * selection order above the tabs, so they survive a tab switch or a query;
 * the tile also stays in its section so it keeps focus and can be toggled off
 * there. Search applies within the active tab, while every tab's count still
 * reflects the query so a reader can see where matches live.
 */
export function buildModelPickerView<T extends PickableModel>(input: {
  models: readonly T[];
  selectedIds?: readonly string[];
  query?: string;
  tab?: ModelClassTab;
}): ModelPickerView<T> {
  const { models, selectedIds = [], query = '', tab = 'all' } = input;
  const activeTab = tab;
  const selected = selectedIds
    .map((id) => models.find((model) => model.id === id))
    .filter((model): model is T => Boolean(model));

  const matching = models.filter((model) => modelMatchesQuery(model, query));
  const tabs = modelClassTabs(models, matching);
  const groups = groupModelsByClass(matching);
  const sections =
    activeTab === 'all'
      ? groups
      : groups.filter((group) => group.key === activeTab);

  return {
    selected,
    sections,
    tabs,
    activeTab,
    empty:
      models.length === 0
        ? 'registry'
        : sections.length > 0
          ? null
          : activeTab === 'all'
            ? 'filters'
            : 'class',
  };
}
