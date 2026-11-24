/**
 * The Board sidebar's grouped MODELS list.
 *
 * Grouping is presentation only: the reader's selection and the URL stay lists
 * of Model slugs. Class membership comes from the curated `weightClass`, never
 * from bucketing a Run size, and Frontier is a display group rather than a
 * seventh class.
 */

import {
  WEIGHT_CLASSES,
  weightClassLabel,
  type WeightClassKey,
} from './weight-class';

/** The fields the grouped list and its chips need from a Board Model. */
export type SidebarModel = {
  slug: string;
  displayName: string;
  weightClass: WeightClassKey | null;
};

export type BoardModelGroup<T extends SidebarModel> = {
  key: WeightClassKey | 'frontier';
  /** Short class name for the header: `Light`, `Frontier API`. */
  label: string;
  /** The group's accessible name: `Light weight`, `Frontier API`. */
  ariaLabel: string;
  /** Range copy beside the header: `~32 GB`, or `API` for Frontier. */
  range: string;
  /** The header tooltip: `Light weight · ~32 GB · One 24 GB gaming GPU`. */
  title: string;
  /** The visible Models in registry order. */
  models: T[];
};

/** The Models in one class, in the order they were passed. */
function modelsInClass<T extends SidebarModel>(
  models: readonly T[],
  weightClass: WeightClassKey | null,
): T[] {
  return models.filter((model) => model.weightClass === weightClass);
}

/**
 * Groups the visible Models by class in WEIGHT_CLASSES order, then Frontier.
 * A group with no visible Models is dropped, so empty classes never render.
 */
export function groupBoardModels<T extends SidebarModel>(
  models: readonly T[],
): BoardModelGroup<T>[] {
  const groups: BoardModelGroup<T>[] = WEIGHT_CLASSES.map((definition) => ({
    key: definition.key,
    label: definition.label,
    ariaLabel: weightClassLabel(definition.key),
    range: definition.range,
    title: `${weightClassLabel(definition.key)} · ${definition.range} · ${definition.hint}`,
    models: modelsInClass(models, definition.key),
  }));

  groups.push({
    key: 'frontier',
    label: 'Frontier',
    ariaLabel: 'Frontier API',
    range: 'API',
    title: 'Frontier API · hosted only · size undisclosed',
    models: modelsInClass(models, null),
  });

  return groups.filter((group) => group.models.length > 0);
}

/** `Light weight · 3 models`, or `Frontier API · 2 models`. */
function classChipLabel(
  weightClass: WeightClassKey | null,
  count: number,
): string {
  return `${weightClassLabel(weightClass)} · ${count} model${count === 1 ? '' : 's'}`;
}

export type GroupSelection = {
  selected: number;
  visible: number;
  state: 'checked' | 'mixed' | 'unchecked';
};

/**
 * The tri-state of a group header over its visible Models only, so a hidden
 * zero-count selection can never produce `4/3`.
 */
export function groupSelection(
  selectedSlugs: readonly string[],
  visibleSlugs: readonly string[],
): GroupSelection {
  const selected = new Set(selectedSlugs);
  const count = visibleSlugs.filter((slug) => selected.has(slug)).length;
  return {
    selected: count,
    visible: visibleSlugs.length,
    state:
      count === 0 ? 'unchecked' : count === visibleSlugs.length ? 'checked' : 'mixed',
  };
}

/**
 * Select-all toggles the visible Models only: it adds any that are missing, or
 * removes the visible set when every one of them is already selected. Hidden
 * selections are left untouched.
 */
export function toggleVisibleSelection(
  selectedSlugs: readonly string[],
  visibleSlugs: readonly string[],
): string[] {
  if (visibleSlugs.length === 0) return [...selectedSlugs];

  const selected = new Set(selectedSlugs);
  if (visibleSlugs.every((slug) => selected.has(slug))) {
    const visible = new Set(visibleSlugs);
    return selectedSlugs.filter((slug) => !visible.has(slug));
  }

  const next = [...selectedSlugs];
  for (const slug of visibleSlugs) {
    if (!selected.has(slug)) {
      selected.add(slug);
      next.push(slug);
    }
  }
  return next;
}

/**
 * Groups start open at `lg` and above and collapsed below it. Per-group
 * toggles override that default for the session.
 */
export function isGroupOpen(
  collapsed: Readonly<Record<string, boolean>>,
  key: string,
  wide: boolean,
): boolean {
  return !(collapsed[key] ?? !wide);
}

export type BoardModelChip = {
  key: string;
  label: string;
  /** Every Model slug the chip removes when clicked. */
  slugs: string[];
};

/**
 * The Model filter chips. When every Model with Comparisons in a class is
 * selected and the class has more than one such Model, the individual chips
 * collapse into one class chip. That chip also represents selected Models in
 * the class with zero Comparisons, and removing it clears them all.
 */
export function buildModelChips(input: {
  selected: readonly string[];
  models: readonly SidebarModel[];
  counts: Readonly<Record<string, number>>;
}): BoardModelChip[] {
  const { selected, models, counts } = input;
  const selectedSet = new Set(selected);
  const modelsBySlug = new Map(models.map((model) => [model.slug, model]));
  const chips: BoardModelChip[] = [];
  const collapsed = new Set<string>();

  for (const definition of WEIGHT_CLASSES) {
    const inClass = modelsInClass(models, definition.key);
    const used = inClass.filter((model) => (counts[model.slug] ?? 0) > 0);
    const selectedInClass = inClass.filter((model) => selectedSet.has(model.slug));
    if (
      used.length > 1 &&
      used.every((model) => selectedSet.has(model.slug)) &&
      selectedInClass.length > 0
    ) {
      for (const model of selectedInClass) collapsed.add(model.slug);
      chips.push({
        key: `class:${definition.key}`,
        label: classChipLabel(definition.key, selectedInClass.length),
        slugs: selectedInClass.map((model) => model.slug),
      });
    }
  }

  for (const slug of selectedSet) {
    if (collapsed.has(slug)) continue;
    const model = modelsBySlug.get(slug);
    chips.push({
      key: `model:${slug}`,
      label: model?.displayName ?? slug,
      slugs: [slug],
    });
  }

  return chips;
}
