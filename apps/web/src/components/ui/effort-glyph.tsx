import { cn } from '@/lib/utils';

const BARS = [4, 7, 10];

/**
 * Three 3px bars at 4/7/10px. Low lights one bar, Med two, High three. Purely
 * decorative: always render a readable effort label beside it.
 */
export function EffortGlyph({
  effort,
  title,
  className,
}: {
  /** 1 = Low, 2 = Med, 3 = High. */
  effort: number;
  /** Optional tooltip for surfaces that do not render the effort label. */
  title?: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      title={title}
      className={cn('inline-flex items-end gap-[2px]', className)}
      style={{ height: 10 }}
    >
      {BARS.map((height, index) => (
        <span
          key={height}
          className={cn(
            'w-[3px] rounded-[1px]',
            index < effort ? 'bg-accent' : 'bg-neutral-700',
          )}
          style={{ height }}
        />
      ))}
    </span>
  );
}
