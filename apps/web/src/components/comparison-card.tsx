import Link from 'next/link';
import {
  ChatCircle,
  Equals,
  Highlighter,
  Lightning,
} from '@phosphor-icons/react/dist/ssr';
import type { ComparisonCard as CardData, WeightClassKey } from '@owm/core/client';
import { comparisonMatchup, formatHandle, relativeTime } from '@owm/core/client';
import { Avatar } from './avatar';
import { EffortGlyph } from './ui/effort-glyph';
import { ModelIcon } from './ui/model-icon';
import { WeightClassMark } from './ui/weight-class-mark';
import { cn } from '@/lib/utils';

const clampTitle = {
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical' as const,
  overflow: 'hidden',
};

const clampPreview = {
  display: '-webkit-box',
  WebkitLineClamp: 3,
  WebkitBoxOrient: 'vertical' as const,
  overflow: 'hidden',
};

/**
 * One side of the Board card's side-by-side preview. `weightClass` is omitted
 * for the quiet placeholder column shown when a card has no Challenger; `null`
 * is a real class (Frontier) and renders the cloud.
 */
function PreviewColumn({
  name,
  monogram,
  avatarUrl,
  tone,
  snippet,
  placeholder,
  weightClass,
  runSizeGb,
  extra,
}: {
  name: string;
  monogram: string;
  avatarUrl: string | null;
  tone: 'base' | 'neutral';
  snippet: string;
  placeholder: string;
  weightClass?: WeightClassKey | null;
  runSizeGb?: number | null;
  extra?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-[var(--r-lg)] bg-bg p-3">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-[6px] text-[12px] text-neutral-200">
          <ModelIcon avatarUrl={avatarUrl} monogram={monogram} size={18} tone={tone} />
          {/* Two lines rather than one: at the Board's 320px minimum the
              name gets barely a word per line once the badge is placed. */}
          <span data-model-name className="line-clamp-2 min-w-0 break-words">
            {name}
          </span>
        </div>
        {/* The class mark and the Challenger count sit on their own line so
            neither competes with the name for width. The row is rendered even
            when empty so the two columns keep their names and snippets aligned. */}
        <div className="flex min-h-4 min-w-0 items-center gap-[6px] text-[11px] leading-none text-neutral-400">
          {weightClass !== undefined ? (
            <WeightClassMark
              weightClass={weightClass}
              runSizeGb={runSizeGb ?? null}
              showLabel
            />
          ) : null}
          {extra ? (
            <span className="min-w-0 truncate whitespace-nowrap">{extra}</span>
          ) : null}
        </div>
      </div>
      <div
        className={cn(
          'text-[13px] leading-[1.6]',
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
 * - `preview` (default true) renders the side-by-side Base/Challenger excerpt block.
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
  const matchup = comparisonMatchup(card.models);
  const effortLabel = ['Low', 'Med', 'High'][Math.max(0, Math.min(2, card.effort - 1))];

  const content = (
    <>
      <div className="flex min-w-0 items-center gap-[10px] text-[12px] text-neutral-300">
        <span
          data-card-category
          data-card-category-slug={card.categories[0]?.slug ?? ''}
          className="inline-flex h-[22px] flex-none items-center rounded-[var(--r)] bg-neutral-800 px-2 text-neutral-200"
        >
          {card.categories[0]?.name ?? 'Uncategorised'}
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

      {matchup && (
        <div className="-mt-[10px] flex min-w-0">
          <span
            data-matchup={matchup.kind}
            title={matchup.title}
            className="inline-flex h-6 max-w-full items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-[var(--r)] border border-matchup-border bg-matchup-fill pl-2 pr-[9px] text-[11.5px] font-medium text-matchup-text"
          >
            {matchup.kind === 'same' ? (
              <Equals size={13} aria-hidden className="flex-none" />
            ) : (
              <Lightning size={13} weight="fill" aria-hidden className="flex-none" />
            )}
            <span className="min-w-0 overflow-hidden text-ellipsis pr-px">
              {matchup.label}
            </span>
          </span>
        </div>
      )}

      {preview && (
        <div className="flex flex-1 flex-col gap-[10px]">
          <div className="grid grid-cols-2 gap-3">
            <PreviewColumn
              name={base?.name ?? 'Base model'}
              monogram={base?.monogram ?? '–'}
              avatarUrl={base?.avatarUrl ?? null}
              tone="base"
              snippet={card.baseSnippet}
              placeholder="Base output preview"
              weightClass={base?.weightClass}
              runSizeGb={base?.runSizeGb}
            />
            <PreviewColumn
              name={challenger?.name ?? 'Compare to…'}
              monogram={challenger?.monogram ?? '–'}
              avatarUrl={challenger?.avatarUrl ?? null}
              tone="neutral"
              snippet={card.challengerSnippet}
              placeholder="Generated after scheduling"
              weightClass={challenger?.weightClass}
              runSizeGb={challenger?.runSizeGb}
              extra={rest.length > 0 ? `+${rest.length} more` : undefined}
            />
          </div>
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
