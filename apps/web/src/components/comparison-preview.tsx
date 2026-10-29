import { cn } from '@/lib/utils';

export type PreviewModel = {
  name: string;
  monogram: string;
};

export function ComparisonPreview({
  base,
  challengers,
  title,
  categories,
  effort,
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
  baseSnippet?: string;
  challengerSnippet?: string;
  status: { label: string; tone: 'draft' | 'generating' | 'ready' };
  handle: string;
  note: string;
  className?: string;
}) {
  const [first, ...rest] = challengers;
  const effortLabel = ['Low', 'Med', 'High'][Math.max(0, Math.min(2, effort - 1))];
  const generating = status.tone === 'generating';
  const ready = status.tone === 'ready';

  return (
    <aside
      className={cn(
        'flex flex-col gap-[10px] self-start lg:sticky lg:top-[76px]',
        className,
      )}
    >
      <span className="micro-label">ON THE BOARD</span>
      <div
        className={cn(
          'flex flex-col gap-[9px] rounded-[2px] border bg-surface px-3 pb-[10px] pt-[11px]',
          generating ? 'border-accent-700' : 'border-transparent',
        )}
      >
        <div className="flex min-w-0 items-center gap-[6px]">
          <span className="chip chip-base min-w-0 flex-[0_1_auto]">
            <span className="monogram monogram-base">{base?.monogram ?? '–'}</span>
            <span className="overflow-hidden text-ellipsis">{base?.name ?? 'Base model'}</span>
          </span>
          <span className="text-[10.5px] font-medium text-neutral-500">vs</span>
          <span className="chip min-w-0 flex-[0_2_auto]">
            <span className="monogram">{first?.monogram ?? '–'}</span>
            <span className="overflow-hidden text-ellipsis">
              {first?.name ?? 'Compare to…'}
            </span>
          </span>
          {rest.length > 0 && (
            <span className="flex-none text-[11px] font-medium text-neutral-400">
              +{rest.length}
            </span>
          )}
        </div>

        <div
          className={cn(
            'font-heading text-[12px] font-medium leading-[1.3] tracking-[-0.005em] [text-wrap:pretty]',
            title ? 'text-text' : 'text-neutral-500',
          )}
        >
          {title || 'Your title appears here'}
        </div>

        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[2px] bg-neutral-700">
          <div className="bg-bg px-[7px] py-[6px]">
            <div
              className="text-[10.5px] font-normal leading-[1.4] text-neutral-300"
              style={{
                display: '-webkit-box',
                WebkitLineClamp: 3,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {baseSnippet || 'Base output preview'}
            </div>
          </div>
          <div className="bg-bg px-[7px] py-[6px]">
            <div
              className="text-[10.5px] font-normal leading-[1.4] text-neutral-500"
              style={{
                display: '-webkit-box',
                WebkitLineClamp: 3,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {challengerSnippet || 'Generated after scheduling'}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-[6px] text-[11px] font-normal text-neutral-400">
          {(categories.length ? categories : ['Category']).map((category) => (
            <span
              key={category}
              className="flex h-[18px] items-center rounded-[2px] bg-neutral-800 px-[6px] font-medium text-neutral-200"
            >
              {category}
            </span>
          ))}
          <span className="flex h-[10px] items-end gap-[2px]" title="Effort">
            <span className="h-[5px] w-[3px] rounded-[1px] bg-accent" />
            <span
              className={cn(
                'h-[7px] w-[3px] rounded-[1px]',
                effort >= 2 ? 'bg-accent' : 'bg-neutral-700',
              )}
            />
            <span
              className={cn(
                'h-[10px] w-[3px] rounded-[1px]',
                effort >= 3 ? 'bg-accent' : 'bg-neutral-700',
              )}
            />
          </span>
          <span>{effortLabel}</span>
        </div>

        <div className="flex items-center gap-[6px] text-[11px] font-normal text-neutral-500">
          <span className="h-[14px] w-[14px] rounded-[2px] bg-neutral-700" />
          <span className="text-neutral-300">@{handle}</span>
          <span>·</span>
          <span
            className={cn(
              'flex items-center gap-[4px]',
              ready ? 'text-accent-200' : generating ? 'text-accent-300' : 'text-neutral-500',
            )}
          >
            <span
              className={cn(
                'h-[6px] w-[6px] rounded-[2px]',
                ready ? 'bg-accent-200' : generating ? 'bg-accent-300 anim-pulse-fast' : 'bg-neutral-500',
              )}
            />
            {status.label}
          </span>
        </div>
      </div>
      <span className="text-[11px] font-normal leading-[1.45] text-neutral-500 [text-wrap:pretty]">
        {note}
      </span>
    </aside>
  );
}
