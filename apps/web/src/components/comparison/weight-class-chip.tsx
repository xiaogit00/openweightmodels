import { formatRunSize, type WeightClassKey } from '@owm/core/client';
import { cn } from '@/lib/utils';
import {
  WeightClassMark,
  weightClassMarkTitle,
} from '../ui/weight-class-mark';

/**
 * The Weight class and Run size of one column on a Comparison. Always prints
 * the class as text beside the glyph; Frontier Models never show a GB because
 * their Run size is undisclosed.
 */
export function ComparisonWeightClassChip({
  weightClass,
  runSizeGb,
  className,
}: {
  weightClass: WeightClassKey | null;
  runSizeGb: number | null;
  className?: string;
}) {
  return (
    <span
      data-weight-chip
      data-weight-class={weightClass ?? 'frontier'}
      title={weightClassMarkTitle(weightClass, runSizeGb)}
      className={cn(
        'inline-flex h-[22px] flex-none items-center gap-1.5 whitespace-nowrap rounded-[var(--r)] border border-neutral-700 px-2 text-[12px] text-neutral-300',
        className,
      )}
    >
      <WeightClassMark
        weightClass={weightClass}
        runSizeGb={runSizeGb}
        showLabel
      />
      {weightClass && runSizeGb != null && (
        <span className="font-mono text-[11px] text-neutral-400">
          {formatRunSize(runSizeGb)}
        </span>
      )}
    </span>
  );
}

/** The trailing class label on a Response or Add-a-model menu row. */
export function WeightClassRowLabel({
  weightClass,
  runSizeGb,
}: {
  weightClass: WeightClassKey | null;
  runSizeGb: number | null;
}) {
  return (
    <span
      data-weight-row-label
      data-weight-class={weightClass ?? 'frontier'}
      title={weightClassMarkTitle(weightClass, runSizeGb)}
      className="inline-flex flex-none items-center gap-1.5 whitespace-nowrap text-[11.5px] font-normal text-neutral-400"
    >
      <WeightClassMark
        weightClass={weightClass}
        runSizeGb={runSizeGb}
        showLabel
      />
    </span>
  );
}
