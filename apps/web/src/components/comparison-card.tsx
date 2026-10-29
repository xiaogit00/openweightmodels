import Link from 'next/link';
import { ChatCircle, Highlighter } from '@phosphor-icons/react/dist/ssr';
import type { ComparisonCard as CardData } from '@owm/core/client';
import { formatHandle, relativeTime } from '@owm/core/client';
import { Avatar } from './avatar';
import { EffortGlyph } from './ui/effort-glyph';
import { InitialsBadge } from './ui/initials-badge';
import { cn } from '@/lib/utils';

const clampTitle = {
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical' as const,
  overflow: 'hidden',
};

const clampPreview = {
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical' as const,
  overflow: 'hidden',
};

function ModelPreviewRow({
  name,
  monogram,
  tone,
  snippet,
  tag,
  extra,
  placeholder,
}: {
  name: string;
  monogram: string;
  tone: 'base' | 'neutral';
  snippet: string;
  tag?: string;
  extra?: string;
  placeholder: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-[6px]">
      <div className="flex min-w-0 items-center gap-2 text-[13px] text-neutral-200">
        <InitialsBadge initials={monogram} size={20} tone={tone} />
        <span className="min-w-0 truncate">{name}</span>
        {tag ? (
          <span className="flex-none rounded-[var(--r)] border border-accent-700 px-[5px] text-[10.5px] font-semibold uppercase leading-4 tracking-[0.08em] text-accent-200">
            {tag}
          </span>
        ) : null}
        {extra ? (
          <span className="flex-none whitespace-nowrap text-[12px] text-neutral-400">
            {extra}
          </span>
        ) : null}
      </div>
      <div
        className={cn(
          'text-[13.5px] leading-[1.6]',
          snippet ? 'text-neutral-300' : 'italic text-neutral-500',
        )}
        style={clampPreview}
      >
        {snippet || placeholder}
      </div>
    </div>
  );
}

/**
 * The Board card, and the same card reused as the live preview in New
 * comparison. `href` makes the whole card a link; omit it for the preview.
 *
 * Optional preview props:
 * - `preview` (default true) renders the Base/Challenger excerpt block.
 * - `draft` renders a "Draft" footer instead of the relative publish time.
 * - `now` is the shared clock for relative times.
 */
export function ComparisonCardView({
  card,
  href,
  className,
  animation,
  preview = true,
  now,
  draft = false,
}: {
  card: CardData;
  href?: string;
  className?: string;
  animation?: 'a' | 'b';
  preview?: boolean;
  /** Shared clock so relative times refresh without per-card timers. */
  now?: number;
  /** The New comparison preview shows "Draft" instead of a publish time. */
  draft?: boolean;
}) {
  const [base, challenger, ...rest] = card.models;
  const effortLabel = ['Low', 'Med', 'High'][Math.max(0, Math.min(2, card.effort - 1))];

  const content = (
    <>
      <div className="flex min-w-0 items-center gap-[10px] text-[12px] text-neutral-300">
        <span className="inline-flex h-[22px] flex-none items-center rounded-[var(--r)] bg-neutral-800 px-2 text-neutral-200">
          {card.categories[0] ?? 'Uncategorised'}
        </span>
        <EffortGlyph effort={card.effort} title="Effort" />
        <span className="whitespace-nowrap">{effortLabel} effort</span>
        <span className="flex-1" />
        <span data-card-turn-count className="whitespace-nowrap">
          {card.turnCount} {card.turnCount === 1 ? 'turn' : 'turns'}
        </span>
      </div>

      <div
        className="font-heading text-[17px] font-medium leading-[1.35] tracking-[-0.01em] [text-wrap:pretty]"
        style={clampTitle}
      >
        {card.headline}
      </div>

      {preview && (
        <div className="flex flex-1 flex-col gap-[14px]">
          <ModelPreviewRow
            name={base?.name ?? 'Base model'}
            monogram={base?.monogram ?? '–'}
            tone="base"
            snippet={card.baseSnippet}
            tag="BASE"
            placeholder="Base output preview"
          />
          <ModelPreviewRow
            name={challenger?.name ?? 'Compare to…'}
            monogram={challenger?.monogram ?? '–'}
            tone="neutral"
            snippet={card.challengerSnippet}
            extra={rest.length > 0 ? `+${rest.length} more` : undefined}
            placeholder="Generated after scheduling"
          />
        </div>
      )}

      <div className="mt-auto flex items-center gap-2 border-t border-neutral-800 pt-[14px] text-[12.5px] text-neutral-300">
        <Avatar handle={card.author.handle} size={20} />
        <span className="text-neutral-200">{formatHandle(card.author.handle)}</span>
        <span aria-hidden>·</span>
        {draft ? (
          <span className="flex items-center gap-[6px]">
            Draft
            <span aria-hidden className="h-[6px] w-[6px] rounded-full bg-neutral-500" />
          </span>
        ) : (
          <span data-relative-time>{relativeTime(card.publishedAt, now)}</span>
        )}
        <span className="flex-1" />
        <span
          data-card-comment-count
          title="Comments"
          className="flex items-center gap-[5px]"
        >
          <ChatCircle size={14} aria-hidden />
          {card.commentCount}
        </span>
        <span
          data-card-annotation-count
          title="Annotations"
          className="ml-2 flex items-center gap-[5px]"
        >
          <Highlighter size={14} aria-hidden />
          {card.annotationCount}
        </span>
      </div>
    </>
  );

  const classes = cn(
    // `card` is the stable Board test hook. The utilities below replace the
    // legacy dense card while keeping that hook for every existing spec.
    'card flex min-w-0 flex-col gap-[18px] rounded-[var(--r-lg)] border border-neutral-800 bg-surface px-5 pb-[18px] pt-5 text-text hover:border-neutral-700 hover:bg-neutral-900 hover:[transform:none]',
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
