import { Chip } from './ui/chip';
import { EffortGlyph } from './ui/effort-glyph';
import { InitialsBadge } from './ui/initials-badge';
import { MicroLabel } from './ui/micro-label';
import { cn, initials } from '@/lib/utils';

export type PreviewModel = {
  name: string;
  monogram: string;
};

/**
 * The Board card shape, driven by form state. It mirrors the Board's card
 * pattern (surface, neutral-800 hairline, `--r-lg`, 18px gaps) without being a
 * second implementation of the clickable card: this one is inert and always a
 * Draft.
 */
export function ComparisonPreview({
  base,
  challengers,
  title,
  categories,
  effort,
  turnCount,
  baseSnippet,
  challengerSnippet,
  status,
  handle,
  note,
  className,
}: {
  base?: PreviewModel | null;
  challengers: PreviewModel[];
  title: string;
  categories: string[];
  effort: number;
  turnCount?: number;
  baseSnippet?: string;
  challengerSnippet?: string;
  status: { label: string; tone: 'draft' | 'generating' | 'ready' };
  handle: string;
  note: string;
  className?: string;
}) {
  const [first, ...rest] = challengers;
  const effortLabel = ['Low', 'Med', 'High'][Math.max(0, Math.min(2, effort - 1))];
  const category = categories[0];
  const generating = status.tone === 'generating';
  const ready = status.tone === 'ready';

  return (
    <aside
      className={cn(
        'flex flex-col gap-3 self-start lg:sticky lg:top-[76px]',
        className,
      )}
    >
      <MicroLabel>ON THE BOARD</MicroLabel>

      <div className="flex flex-col gap-[18px] rounded-lg border border-neutral-800 bg-surface px-5 pb-[18px] pt-5">
        <div className="flex min-w-0 items-center gap-2.5 text-[12px] text-neutral-300">
          <Chip
            className={cn(
              'h-[22px] px-2 text-[12px]',
              category ? 'text-neutral-200' : 'text-neutral-400',
            )}
          >
            {category ?? 'Category'}
          </Chip>
          <EffortGlyph effort={effort} title="Effort" />
          <span className="whitespace-nowrap">{effortLabel} effort</span>
          <span className="flex-1" />
          {turnCount !== undefined && (
            <span className="whitespace-nowrap">
              {turnCount} {turnCount === 1 ? 'turn' : 'turns'}
            </span>
          )}
        </div>

        <div
          className={cn(
            'line-clamp-2 font-heading text-[17px] font-medium leading-[1.35] tracking-[-0.01em] [text-wrap:pretty]',
            title ? 'text-text' : 'text-neutral-400',
          )}
        >
          {title || 'Your title appears here'}
        </div>

        <div className="flex flex-col gap-3.5">
          <div className="flex flex-col gap-1.5">
            <div className="flex min-w-0 items-center gap-2 text-[13px] text-neutral-200">
              <InitialsBadge
                initials={base?.monogram ?? '–'}
                size={20}
                tone="base"
              />
              <span className="truncate">{base?.name ?? 'Base model'}</span>
              <span className="flex-none rounded-xs border border-accent-700 px-[5px] text-[10.5px] font-semibold uppercase leading-4 tracking-[0.08em] text-accent-200">
                BASE
              </span>
            </div>
            <div className="line-clamp-2 text-[13.5px] leading-[1.6] text-neutral-300">
              {baseSnippet || 'Base output preview'}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex min-w-0 items-center gap-2 text-[13px] text-neutral-200">
              <InitialsBadge initials={first?.monogram ?? '–'} size={20} />
              <span className="truncate">{first?.name ?? 'Compare to…'}</span>
              {rest.length > 0 && (
                <span className="flex-none whitespace-nowrap text-[12px] font-normal text-neutral-400">
                  +{rest.length} more
                </span>
              )}
            </div>
            <div
              className={cn(
                'line-clamp-2 text-[13.5px] leading-[1.6]',
                challengerSnippet
                  ? 'text-neutral-300'
                  : 'italic text-neutral-400',
              )}
            >
              {challengerSnippet || 'Generated after scheduling'}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-neutral-800 pt-3.5 text-[12.5px] text-neutral-300">
          <InitialsBadge initials={initials(handle)} size={20} />
          <span className="text-neutral-200">@{handle}</span>
          <span>·</span>
          <span
            className={cn(
              'flex items-center gap-1.5',
              ready
                ? 'text-accent-200'
                : generating
                  ? 'text-accent-300'
                  : 'text-neutral-300',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                ready
                  ? 'bg-accent-200'
                  : generating
                    ? 'anim-pulse-fast bg-accent-300'
                    : 'bg-neutral-500',
              )}
            />
            {status.label}
          </span>
        </div>
      </div>

      <span className="text-[13px] font-normal leading-[1.5] text-neutral-400 [text-wrap:pretty]">
        {note}
      </span>
    </aside>
  );
}
