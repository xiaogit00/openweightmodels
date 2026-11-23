import {
  weightClassDefinition,
  type WeightClassKey,
} from '@owm/core/client';
import { cn } from '@/lib/utils';

const TAB_HEIGHTS = [3, 5, 7, 9, 11, 13];
const MINI_HEIGHTS = TAB_HEIGHTS.map((height) => Math.round(height * 0.75));

/**
 * Six bars rising with the Weight class, extending the effort glyph. The
 * lit-bar count comes from the class definition, never from Run size. Purely
 * decorative: every surface renders the class name as text or a title.
 */
export function SizeGlyph({
  weightClass,
  variant = 'tab',
  title,
  className,
}: {
  weightClass: WeightClassKey;
  variant?: 'tab' | 'mini';
  title?: string;
  className?: string;
}) {
  const definition = weightClassDefinition(weightClass);
  const heights = variant === 'mini' ? MINI_HEIGHTS : TAB_HEIGHTS;
  const lit = Math.max(0, (definition?.bars ?? 1) - 1);

  return (
    <span
      aria-hidden
      title={title}
      data-size-glyph={weightClass}
      className={cn('inline-flex items-end', className)}
      style={{
        height: variant === 'mini' ? 10 : 13,
        gap: variant === 'mini' ? 1.5 : 2,
      }}
    >
      {heights.map((height, bar) => (
        <span
          key={height}
          className={cn(
            'rounded-[1px]',
            variant === 'mini' ? 'w-[2px]' : 'w-[3px]',
            bar <= lit ? 'bg-accent' : 'bg-neutral-600',
          )}
          style={{ height }}
        />
      ))}
    </span>
  );
}
