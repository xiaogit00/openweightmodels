import { cn, initials } from '@/lib/utils';
import { InitialsBadge } from './ui/initials-badge';

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
    <InitialsBadge initials={initials(handle)} size={size} className={cn('text-neutral-200', className)} />
  );
}
