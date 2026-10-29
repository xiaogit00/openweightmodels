'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type SegmentedOption<T extends string | number> = {
  value: T;
  label: ReactNode;
  /** Optional leading icon. Decorative icons should set aria-hidden. */
  icon?: ReactNode;
  title?: string;
};

/**
 * A segmented control: one track, one pressed button at a time. It is a
 * `group` of toggle buttons rather than tabs because it filters or sets a
 * value in place instead of swapping panels, so `aria-pressed` is the honest
 * state. `value` that matches no option simply leaves every button unpressed,
 * which is how a cleared filter renders.
 */
export function SegmentedControl<T extends string | number>({
  label,
  value,
  options,
  onChange,
  stretch = false,
  className,
  itemClassName,
}: {
  label: string;
  value: T | null;
  options: ReadonlyArray<SegmentedOption<T>>;
  onChange: (value: T) => void;
  stretch?: boolean;
  className?: string;
  itemClassName?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn('segmented', className)}
      data-stretch={stretch ? 'true' : undefined}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={cn('segmented-item', itemClassName)}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
