import { formatRunSize, memoryBarPercent } from '@owm/core/client';
import { cn } from '@/lib/utils';

/**
 * A 4px track whose fill places the Run size on the one global 3 GB–2 TB log
 * scale, with the GB value always beside it. The bar is decorative; the text
 * label carries the size for screen readers.
 */
export function MemoryBar({
  runSizeGb,
  selected = false,
  className,
}: {
  runSizeGb: number;
  selected?: boolean;
  className?: string;
}) {
  const percent = memoryBarPercent(runSizeGb);
  return (
    <span className={cn('flex w-full items-center gap-2.5', className)}>
      <span
        data-memory-bar
        aria-hidden
        className="relative h-1 flex-1 overflow-hidden rounded-[2px] bg-neutral-800"
      >
        <span
          className={cn(
            'absolute inset-y-0 left-0 rounded-[2px]',
            selected ? 'bg-accent' : 'bg-neutral-400',
          )}
          style={{ width: `${percent.toFixed(2)}%` }}
        />
      </span>
      <span
        data-run-size
        className="min-w-[52px] whitespace-nowrap text-right font-mono text-[11px] text-neutral-300"
      >
        {formatRunSize(runSizeGb)}
      </span>
    </span>
  );
}
