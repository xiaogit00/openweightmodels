import type { CSSProperties, ComponentPropsWithoutRef } from 'react';
import { cn } from '@/lib/utils';
import { InitialsBadge } from './initials-badge';

/**
 * A Model's provider/family mark inside the same square tile the monogram
 * used. The SVG is applied as a mask so the mark takes `currentColor` and
 * follows the surrounding theme (and the base/accent tone). When a Model has
 * no local icon, the monogram is still shown, so pre-registry rows never
 * render an empty tile.
 */
export function ModelIcon({
  avatarUrl,
  monogram,
  size = 20,
  tone = 'neutral',
  className,
  ...rest
}: ComponentPropsWithoutRef<'span'> & {
  avatarUrl: string | null | undefined;
  monogram: string;
  /** 18, 20, 22, 24 or 28px, matching InitialsBadge. */
  size?: number;
  tone?: 'neutral' | 'base';
}) {
  if (!avatarUrl) {
    return (
      <InitialsBadge
        initials={monogram}
        size={size}
        tone={tone}
        className={className}
        {...rest}
      />
    );
  }

  const mask: CSSProperties = {
    WebkitMaskImage: `url("${avatarUrl}")`,
    maskImage: `url("${avatarUrl}")`,
    WebkitMaskRepeat: 'no-repeat',
    maskRepeat: 'no-repeat',
    WebkitMaskPosition: 'center',
    maskPosition: 'center',
    WebkitMaskSize: '72%',
    maskSize: '72%',
  };

  return (
    <span
      aria-hidden
      className={cn('monogram', tone === 'base' && 'monogram-base', className)}
      style={{ width: size, height: size }}
      {...rest}
    >
      <span className="block h-full w-full bg-current" style={mask} />
    </span>
  );
}
