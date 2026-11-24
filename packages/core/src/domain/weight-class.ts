/**
 * Weight classes and the memory ("Run size") scale shared by every picker.
 *
 * A Model's class is curated registry metadata, never computed from its Run
 * size on the client: the class decides which tab and section a Model appears
 * in, so bucketing here would let display copy and data drift apart. The ranges
 * below are display copy only.
 */

export const WEIGHT_CLASS_KEYS = [
  'fly',
  'feather',
  'light',
  'middle',
  'heavy',
  'super-heavy',
] as const;

export type WeightClassKey = (typeof WEIGHT_CLASS_KEYS)[number];

/** The curated class and Run size every Model-shaped payload carries. */
export type WeightClassMetadata = {
  weightClass: WeightClassKey | null;
  runSizeGb: number | null;
};

export type WeightClassDefinition = {
  key: WeightClassKey;
  /** Short name for a tab, a chip and a card tooltip. */
  label: string;
  /** Display range, shown beside the tab count and in a section header. */
  range: string;
  /** One-line hardware hint shown in a section header. */
  hint: string;
  /** How many of the six size bars are lit, 1–6. */
  bars: number;
};

/** Ordered small to large; the section and tab order follows this array. */
export const WEIGHT_CLASSES: readonly WeightClassDefinition[] = [
  { key: 'fly', label: 'Fly', range: '≤ 12 GB', hint: 'Phone or laptop', bars: 1 },
  {
    key: 'feather',
    label: 'Feather',
    range: '12–24 GB',
    hint: '16 GB laptop or mid GPU',
    bars: 2,
  },
  {
    key: 'light',
    label: 'Light',
    range: '~32 GB',
    hint: 'One 24 GB gaming GPU',
    bars: 3,
  },
  {
    key: 'middle',
    label: 'Middle',
    range: '64–104 GB',
    hint: '80 GB GPU or 96 GB Mac',
    bars: 4,
  },
  {
    key: 'heavy',
    label: 'Heavy',
    range: '144–272 GB',
    hint: 'GPU + large RAM offload',
    bars: 5,
  },
  {
    key: 'super-heavy',
    label: 'Super Heavy',
    range: '300 GB+',
    hint: 'Datacenter cluster',
    bars: 6,
  },
];

/** The value of the `?class=` URL parameter and of the Step 2 tab bar. */
export const MODEL_CLASS_TABS = ['all', ...WEIGHT_CLASS_KEYS, 'frontier'] as const;
export type ModelClassTab = (typeof MODEL_CLASS_TABS)[number];

const CLASS_BY_KEY = new Map(WEIGHT_CLASSES.map((entry) => [entry.key, entry]));

export function weightClassDefinition(
  key: WeightClassKey | null | undefined,
): WeightClassDefinition | undefined {
  return key ? CLASS_BY_KEY.get(key) : undefined;
}

export function isWeightClassKey(value: unknown): value is WeightClassKey {
  return typeof value === 'string' && CLASS_BY_KEY.has(value as WeightClassKey);
}

/** `Light weight`, or `Frontier API` when the Model has no class. */
export function weightClassLabel(key: WeightClassKey | null | undefined): string {
  const short = weightClassShortLabel(key);
  return weightClassDefinition(key) ? `${short} weight` : short;
}

/** The compact class name for a chip, a menu row or a card: `Light`, `Frontier API`. */
export function weightClassShortLabel(key: WeightClassKey | null | undefined): string {
  return weightClassDefinition(key)?.label ?? 'Frontier API';
}

/** The class section a Model belongs to; frontier Models share one bucket. */
export function modelClassTab(model: {
  weightClass: WeightClassKey | null;
}): WeightClassKey | 'frontier' {
  return model.weightClass ?? 'frontier';
}

/** Read a tab from the URL, falling back to All sizes for anything unknown. */
export function parseModelClassTab(value: string | null | undefined): ModelClassTab {
  if (value === 'all' || value === 'frontier') return value;
  return isWeightClassKey(value) ? value : 'all';
}

/** `4 GB`, or `1.5 TB` once the Run size passes a thousand gigabytes. */
export function formatRunSize(gb: number): string {
  if (gb < 1000) return `${gb} GB`;
  // One decimal place, with a trailing `.0` stripped: 1 TB, not 1.0 TB.
  return `${Number((gb / 1000).toFixed(1))} TB`;
}

/**
 * Where a Run size sits on the one global log scale from 3 GB to 2 TB. The
 * same scale is used in every tab so a Fly bar and a Super Heavy bar remain
 * comparable.
 */
export function memoryBarPercent(gb: number): number {
  if (!Number.isFinite(gb) || gb <= 0) return 0;
  const start = Math.log(3);
  const end = Math.log(2000);
  const position = ((Math.log(gb) - start) / (end - start)) * 100;
  return Math.max(0, Math.min(100, position));
}

/** `27B`, or `80B total / 3B active` when the Model is a mixture of experts. */
export function parameterSummary(
  totalParams: string | null | undefined,
  activeParams: string | null | undefined,
): string {
  if (!totalParams) return '';
  if (!activeParams || activeParams === totalParams) return totalParams;
  return `${totalParams} total / ${activeParams} active`;
}
