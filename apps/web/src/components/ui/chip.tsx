import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '@/lib/utils';

export function Chip({
  tone = 'neutral',
  className,
  children,
  ...rest
}: ComponentPropsWithoutRef<'span'> & {
  tone?: 'neutral' | 'base';
}) {
  return (
    <span className={cn('chip', tone === 'base' && 'chip-base', className)} {...rest}>
      {children}
    </span>
  );
}
