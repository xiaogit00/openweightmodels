'use client';

import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { SegmentedControl } from '../ui/segmented-control';
import type { TurnInfo } from './types';

/**
 * The rail above a multi-Turn transcript. Prev/next stay buttons with an
 * `aria-disabled` edge so keyboard focus is never lost, and the jump control is
 * a segmented group rather than a native select (decision 11).
 */
export function TurnRail({
  turns,
  currentIndex,
  atFirst,
  atLast,
  onPrevious,
  onNext,
  onGoToTurn,
}: {
  turns: TurnInfo[];
  currentIndex: number;
  atFirst: boolean;
  atLast: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onGoToTurn: (position: number) => void;
}) {
  const current = turns[currentIndex] ?? null;

  return (
    <div
      data-turn-rail
      role="group"
      aria-label="Turn navigation"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-neutral-800 bg-surface px-2 py-1.5 pl-2"
    >
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          aria-label="Previous turn"
          title="Previous turn"
          aria-disabled={atFirst}
          onClick={() => {
            if (!atFirst) onPrevious();
          }}
          className={cn(
            'grid h-[30px] w-[30px] place-items-center rounded-[var(--r)] text-neutral-300 transition-colors',
            atFirst
              ? 'cursor-not-allowed opacity-35'
              : 'hover:bg-neutral-800 hover:text-text',
          )}
        >
          <CaretLeft size={14} aria-hidden />
        </button>
        <span
          data-turn-indicator
          className="min-w-[84px] text-center text-[13.5px] font-medium text-text"
        >
          Turn {currentIndex + 1} of {turns.length}
        </span>
        <button
          type="button"
          aria-label="Next turn"
          title="Next turn"
          aria-disabled={atLast}
          onClick={() => {
            if (!atLast) onNext();
          }}
          className={cn(
            'grid h-[30px] w-[30px] place-items-center rounded-[var(--r)] text-neutral-300 transition-colors',
            atLast
              ? 'cursor-not-allowed opacity-35'
              : 'hover:bg-neutral-800 hover:text-text',
          )}
        >
          <CaretRight size={14} aria-hidden />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-[12.5px] text-neutral-400">Jump to</span>
        <SegmentedControl
          label="Jump to turn"
          className="max-w-full flex-wrap"
          value={current?.position ?? null}
          options={turns.map((turn, index) => ({
            value: turn.position,
            label: `Turn ${index + 1}`,
          }))}
          onChange={(position) => onGoToTurn(position)}
        />
      </div>
    </div>
  );
}
