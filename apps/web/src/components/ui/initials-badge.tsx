import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '@/lib/utils';

/**
 * A square monogram used for Models and people. Initials are the one place
 * allowed below the 10.5px type floor: they are decorative and always sit
 * next to the name they abbreviate.
 *
 * The letters are drawn as generated content from `data-initials` rather than
 * a text node so that a button whose accessible name is the full label (for
 * example "Account menu for @mira") is not also announcing "MI", and so the
 * label-in-name check sees a decorative graphic instead of visible text.
 */
export function InitialsBadge({
  initials,
  size = 20,
  tone = 'neutral',
  className,
  ...rest
}: ComponentPropsWithoutRef<'span'> & {
  initials: string;
  /** 20, 22, 24 or 28px in the redesign. */
  size?: number;
  tone?: 'neutral' | 'base';
}) {
  return (
    <span
      aria-hidden
      data-initials={initials}
      className={cn('monogram', tone === 'base' && 'monogram-base', className)}
      style={{
        width: size,
        height: size,
        fontSize: Math.min(11, Math.max(9, Math.round(size * 0.36))),
      }}
      {...rest}
    />
  );
}
