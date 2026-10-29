import Link from 'next/link';
import { ChatCircle, Highlighter } from '@phosphor-icons/react/dist/ssr';
import type { ComparisonCard as CardData } from '@owm/core/client';
import { formatHandle, relativeTime } from '@owm/core/client';
import { Avatar } from './avatar';
import { cn } from '@/lib/utils';

const clamps = {
  title: {
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical' as const,
    overflow: 'hidden',
  },
  preview: {
    display: '-webkit-box',
    WebkitLineClamp: 3,
    WebkitBoxOrient: 'vertical' as const,
    overflow: 'hidden',
  },
};

function EffortMeter({ effort }: { effort: number }) {
  return (
    <span className="flex h-[10px] items-end gap-[2px]" title="Effort">
      <span className="h-[5px] w-[3px] rounded-[1px] bg-accent" />
      <span
        className={cn('h-[7px] w-[3px] rounded-[1px]', effort >= 2 ? 'bg-accent' : 'bg-neutral-700')}
      />
      <span
        className={cn('h-[10px] w-[3px] rounded-[1px]', effort >= 3 ? 'bg-accent' : 'bg-neutral-700')}
      />
    </span>
  );
}

export function ComparisonCardView({
  card,
  href,
  className,
  animation,
  preview = true,
  now,
}: {
  card: CardData;
  href?: string;
  className?: string;
  animation?: 'a' | 'b';
  preview?: boolean;
  /** Shared clock so relative times refresh without per-card timers. */
  now?: number;
}) {
  const [base, challenger, ...rest] = card.models;
  const effortLabel = ['Low', 'Med', 'High'][Math.max(0, Math.min(2, card.effort - 1))];

  const content = (
    <>
      <div className="flex min-w-0 items-center gap-[6px]">
        <span className="chip chip-base min-w-0 flex-[0_1_auto]">
          <span className="monogram monogram-base">{base?.monogram ?? '–'}</span>
          <span className="overflow-hidden text-ellipsis">{base?.name ?? 'Base model'}</span>
        </span>
        <span className="text-[10px] font-medium text-neutral-500">vs</span>
        <span className="chip min-w-0 flex-[0_2_auto]">
          <span className="monogram">{challenger?.monogram ?? '–'}</span>
          <span className="overflow-hidden text-ellipsis">
            {challenger?.name ?? 'Compare to…'}
          </span>
        </span>
        {rest.length > 0 && (
          <span className="flex-none text-[11px] font-medium text-neutral-400">
            +{rest.length}
          </span>
        )}
      </div>

      <div className="flex min-w-0 items-start gap-2">
        <div
          className="min-w-0 flex-1 font-heading text-[12px] font-medium leading-[1.3] tracking-[-0.005em] [text-wrap:pretty]"
          style={clamps.title}
        >
          {card.headline}
        </div>
        <span
          data-card-turn-count
          className="flex h-[16px] flex-none items-center rounded-[2px] border border-neutral-700 px-[5px] text-[10px] font-medium text-neutral-300"
        >
          {card.turnCount} {card.turnCount === 1 ? 'turn' : 'turns'}
        </span>
      </div>

      {preview && (
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[2px] bg-neutral-700">
          {[card.baseSnippet, card.challengerSnippet].map((snippet, index) => (
            <div key={index} className="bg-bg px-[7px] py-[6px]">
              <div
                className="text-[10.5px] font-normal leading-[1.4] text-neutral-300"
                style={clamps.preview}
              >
                {snippet || (index === 0 ? 'Base output preview' : 'Generated after scheduling')}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 text-[11px] font-normal text-neutral-400">
        <span className="flex h-[18px] items-center rounded-[2px] bg-neutral-800 px-[6px] font-medium text-neutral-200">
          {card.categories[0] ?? 'Uncategorised'}
        </span>
        <EffortMeter effort={card.effort} />
        <span>{effortLabel}</span>
        <span className="flex-1" />
        <span data-card-comment-count className="flex items-center gap-[3px]">
          <ChatCircle size={12} />
          {card.commentCount}
        </span>
        <span data-card-annotation-count className="flex items-center gap-[3px]">
          <Highlighter size={12} />
          {card.annotationCount}
        </span>
      </div>

      <div className="flex items-center gap-[6px] text-[11px] font-normal text-neutral-500">
        <Avatar handle={card.author.handle} size={14} />
        <span className="text-neutral-300">{formatHandle(card.author.handle)}</span>
        <span>·</span>
        <span data-relative-time>{relativeTime(card.publishedAt, now)}</span>
      </div>
    </>
  );

  const classes = cn(
    'card',
    animation === 'a' && 'arrive-a',
    animation === 'b' && 'arrive-b',
    className,
  );

  if (!href) {
    return <div className={classes}>{content}</div>;
  }

  return (
    <Link href={href} className={classes}>
      {content}
    </Link>
  );
}
