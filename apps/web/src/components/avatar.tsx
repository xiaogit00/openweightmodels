import { cn, initials } from '@/lib/utils';

export function Avatar({
  handle,
  size = 28,
  className,
}: {
  handle: string;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'grid flex-none place-items-center rounded-[2px] bg-neutral-700 text-neutral-200',
        className,
      )}
      style={{
        width: size,
        height: size,
        // The accessibility floor is 10px; initials stay readable in the
        // smallest 14px card avatar.
        fontSize: Math.max(10, Math.round(size * 0.36)),
      }}
      aria-hidden
    >
      {initials(handle)}
    </span>
  );
}
