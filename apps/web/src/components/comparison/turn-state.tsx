'use client';

import { CircleNotch, MinusCircle, WarningCircle, X } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import type { ComparisonResponseView } from './types';

export function ErrorLine({ message }: { message: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[12px] text-danger" role="alert">
      <X size={12} aria-hidden />
      {message}
    </span>
  );
}

/**
 * A Turn's reply can be missing for five different reasons. Each one reads in
 * place, beside the other model, so a reader never has to guess why a reply is
 * absent. A stopped Replay is named at the Turn where it stopped and on every
 * Turn it never reached.
 */
export function TurnStateLine({
  response,
  stoppedAtTurn = null,
  turnNumber = null,
  turnCount = null,
  className,
}: {
  response: ComparisonResponseView | null | undefined;
  stoppedAtTurn?: number | null;
  turnNumber?: number | null;
  turnCount?: number | null;
  className?: string;
}) {
  const status = response?.status;
  const tokens = response?.tokens ?? 0;
  const error = response?.error ?? null;

  if (status === 'failed') {
    return (
      <span
        className={cn(
          'flex items-start gap-2 text-[12.5px] font-medium leading-[1.5] text-danger',
          className,
        )}
      >
        <WarningCircle size={15} className="mt-px shrink-0" aria-hidden />
        {error ?? 'API timeout'}
      </span>
    );
  }
  if (status === 'skipped') {
    if (stoppedAtTurn !== null) {
      return (
        <span
          className={cn(
            'flex items-start gap-2 text-[12.5px] leading-[1.55] text-neutral-400',
            className,
          )}
        >
          <MinusCircle size={15} className="mt-px shrink-0" aria-hidden />
          {turnNumber === stoppedAtTurn
            ? `Stopped at turn ${stoppedAtTurn}${turnCount ? ` of ${turnCount}` : ''} — this comparison ends here.`
            : `Skipped — this Challenger stopped at turn ${stoppedAtTurn}.`}
        </span>
      );
    }
    return (
      <span
        className={cn(
          'flex items-start gap-2 text-[12.5px] leading-[1.55] text-neutral-400',
          className,
        )}
      >
        <MinusCircle size={15} className="mt-px shrink-0" aria-hidden />
        Skipped — this turn has no reply.
      </span>
    );
  }
  if (status === 'queued') {
    return (
      <span
        className={cn(
          'flex items-center gap-2 text-[12.5px] font-medium text-accent-200',
          className,
        )}
      >
        <CircleNotch size={14} className="anim-spin" aria-hidden />
        <span aria-live="polite">Queued for this turn.</span>
      </span>
    );
  }
  if (status === 'calling' || status === 'streaming') {
    return (
      <span
        className={cn(
          'flex flex-wrap items-center gap-2 text-[12.5px] font-medium text-accent-200',
          className,
        )}
      >
        <CircleNotch size={14} className="anim-spin" aria-hidden />
        <span aria-live="polite">
          {status === 'streaming' ? 'Generating this turn…' : 'Calling the hosted API…'}
        </span>
        {status === 'streaming' && (
          <span className="text-[12px] font-normal text-neutral-400">
            {tokens.toLocaleString()} tok so far
          </span>
        )}
      </span>
    );
  }
  return (
    <span className={cn('text-[12.5px] leading-[1.55] text-neutral-500', className)}>
      No response for this turn.
    </span>
  );
}

/**
 * The in-flight Challenger cell: an accent line naming the model, then skeleton
 * bars. The shimmer is switched off by the shared reduced-motion rule.
 */
export function GeneratingState({ response }: { response: ComparisonResponseView }) {
  const streaming = response.status === 'streaming';
  return (
    <div className="flex flex-col gap-2.5" aria-live="polite">
      <span className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-accent-200">
        <CircleNotch size={14} className="anim-spin" aria-hidden />
        {response.status === 'queued' ? (
          <span>Queued — waiting for a worker.</span>
        ) : (
          <span>Calling {response.model.name} hosted API…</span>
        )}
        {streaming && (
          <span className="text-[12px] font-normal text-neutral-400">
            {response.tokens.toLocaleString()} tok so far
          </span>
        )}
      </span>
      <div className="flex flex-col gap-2.5" aria-hidden>
        <div className="anim-shimmer h-[9px] w-[92%] rounded-[var(--r)] bg-neutral-800" />
        <div
          className="anim-shimmer h-[9px] w-[78%] rounded-[var(--r)] bg-neutral-800"
          style={{ animationDelay: '.15s' }}
        />
        <div
          className="anim-shimmer h-[72px] rounded-[var(--r)] bg-neutral-900"
          style={{ animationDelay: '.3s' }}
        />
        <div
          className="anim-shimmer h-[9px] w-[64%] rounded-[var(--r)] bg-neutral-800"
          style={{ animationDelay: '.45s' }}
        />
      </div>
    </div>
  );
}
