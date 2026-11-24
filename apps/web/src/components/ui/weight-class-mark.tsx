import { Cloud } from '@phosphor-icons/react';
import {
  formatRunSize,
  weightClassDefinition,
  weightClassLabel,
  weightClassShortLabel,
  type WeightClassKey,
} from '@owm/core/client';
import { cn } from '@/lib/utils';
import { SizeGlyph } from './size-glyph';

/**
 * The one way to mark a Model's Weight class. Open-weight Models render the
 * mini size glyph; a Frontier Model (`weightClass: null`) renders a cloud. The
 * composed `title` always names the class and, where known, the Run size.
 *
 * The glyph or icon is decorative. A caller that prints no visible label gets
 * an `aria-label` on the wrapper instead; pass `showLabel` to print the short
 * class name beside the mark.
 */
export function WeightClassMark({
  weightClass,
  runSizeGb,
  showLabel = false,
  className,
}: {
  weightClass: WeightClassKey | null;
  runSizeGb?: number | null;
  /** Print the short class name, e.g. `Light`, beside the glyph. */
  showLabel?: boolean;
  className?: string;
}) {
  const label = weightClassShortLabel(weightClass);
  const title = weightClassMarkTitle(weightClass, runSizeGb);

  return (
    <span
      className={cn('inline-flex flex-none items-center gap-1.5', className)}
      title={title}
      {...(showLabel ? {} : { role: 'img', 'aria-label': title })}
    >
      {weightClass ? (
        <SizeGlyph weightClass={weightClass} variant="mini" />
      ) : (
        <Cloud size={12} aria-hidden />
      )}
      {showLabel && <span>{label}</span>}
    </span>
  );
}

/** The tooltip every surface uses for a class mark. */
export function weightClassMarkTitle(
  weightClass: WeightClassKey | null,
  runSizeGb?: number | null,
): string {
  if (!weightClass) return 'Frontier API · hosted only · size undisclosed';

  const label = weightClassLabel(weightClass);
  if (runSizeGb != null) {
    return `${label} · ${formatRunSize(runSizeGb)} to run at 4-bit`;
  }
  const range = weightClassDefinition(weightClass)?.range;
  return range ? `${label} · ${range}` : label;
}
