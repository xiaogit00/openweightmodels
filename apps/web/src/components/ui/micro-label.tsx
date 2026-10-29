import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '@/lib/utils';

/** 10.5px / 500 / 0.08em uppercase, for section labels and metadata groups. */
export function MicroLabel({ className, children, ...rest }: ComponentPropsWithoutRef<'span'>) {
  return (
    <span className={cn('micro-label', className)} {...rest}>
      {children}
    </span>
  );
}
