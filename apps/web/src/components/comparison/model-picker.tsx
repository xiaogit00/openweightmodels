'use client';

import * as Popover from '@radix-ui/react-popover';
import { useEffect, useRef, useState } from 'react';
import {
  CaretDown,
  Check,
  CircleNotch,
  MagnifyingGlass,
  MinusCircle,
  Plus,
  WarningCircle,
} from '@phosphor-icons/react';
import {
  estimateConversationCalls,
  isPendingResponse,
  modelMatchesQuery,
  modelWeightShortLabel,
} from '@owm/core/client';
import { cn } from '@/lib/utils';
import { InitialsBadge } from '../ui/initials-badge';
import { MicroLabel } from '../ui/micro-label';
import { POPOVER_SURFACE } from '../ui/popover-surface';
import type { AddableModel, ComparisonResponseView } from './types';

export type ModelPickerProps = {
  active: ComparisonResponseView | null;
  challengers: ComparisonResponseView[];
  replayInProgress: ReadonlySet<string>;
  canAdd: boolean;
  atCap: boolean;
  models: AddableModel[];
  addingModelId: string | null;
  addError: string | null;
  turnCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSwitch: (slug: string) => void;
  onAdd: (model: AddableModel) => void;
};

function activeMeta(active: ComparisonResponseView | null): string {
  if (!active) return '';
  if (active.status === 'done') {
    return `${active.tokens.toLocaleString()} tok${
      active.latencyMs ? ` · ${(active.latencyMs / 1000).toFixed(1)}s` : ''
    }`;
  }
  if (isPendingResponse(active.status)) return 'generating…';
  if (active.status === 'failed') return 'failed';
  if (active.status === 'skipped') return 'stopped';
  return '';
}

/**
 * The right card header: the active Challenger, a picker menu listing every
 * Response, and the models that can still be added. The menu is a Radix portal
 * so a sticky header never clips it.
 */
export function ModelPicker({
  active,
  challengers,
  replayInProgress,
  canAdd,
  atCap,
  models,
  addingModelId,
  addError,
  turnCount,
  open,
  onOpenChange,
  onSwitch,
  onAdd,
}: ModelPickerProps) {
  const [confirming, setConfirming] = useState<AddableModel | null>(null);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const multiTurn = turnCount > 1;
  const calls = estimateConversationCalls(turnCount, 1);
  const callLabel = calls === 1 ? 'hosted API call' : 'hosted API calls';
  const matching = models.filter((model) => modelMatchesQuery(model, query));
  const pending = active ? isPendingResponse(active.status) : false;
  const showsAdd = canAdd && !atCap && models.length > 0;
  const meta = activeMeta(active);

  useEffect(() => {
    if (!open) {
      setConfirming(null);
      setQuery('');
    }
  }, [open]);

  const close = () => {
    setConfirming(null);
    onOpenChange(false);
  };

  return (
    <div className="relative z-[15] flex h-12 min-w-0 items-center gap-2.5 rounded-t-lg border border-neutral-700 bg-surface pl-2 pr-3.5">
      <Popover.Root
        open={open}
        onOpenChange={(value) => {
          if (value) {
            onOpenChange(true);
          } else {
            close();
          }
        }}
      >
        <Popover.Trigger asChild>
          <button
            type="button"
            data-model-picker
            data-add-button={canAdd ? '' : undefined}
            title={
              active
                ? `Compare with ${active.model.name}`
                : 'Choose a model to compare with'
            }
            className={cn(
              'flex h-8 min-w-0 items-center gap-2 rounded-[var(--r)] border px-2.5 text-[14px] font-medium text-text transition-colors',
              open
                ? 'border-accent bg-accent-900'
                : 'border-neutral-700 bg-bg hover:border-neutral-500',
            )}
          >
            <span className="min-w-0 truncate">{active?.model.name ?? 'Add model'}</span>
            {pending || (active && replayInProgress.has(active.model.slug)) ? (
              <CircleNotch
                size={12}
                className="anim-spin flex-none text-accent-300"
                aria-hidden
              />
            ) : active?.status === 'failed' ? (
              <WarningCircle size={12} className="flex-none text-danger" aria-hidden />
            ) : active?.status === 'skipped' ? (
              <MinusCircle size={12} className="flex-none text-neutral-400" aria-hidden />
            ) : null}
            <CaretDown size={12} className="flex-none text-neutral-400" aria-hidden />
          </button>
        </Popover.Trigger>

        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={6}
            aria-label="Model responses"
            data-add-menu
            onOpenAutoFocus={(event) => {
              if (searchRef.current) {
                event.preventDefault();
                searchRef.current.focus();
              }
            }}
            className={cn(
              POPOVER_SURFACE,
              'z-40 max-h-[calc(100vh-120px)] w-[min(290px,calc(100vw-32px))] gap-0.5 overflow-y-auto p-1.5',
            )}
          >
            {confirming ? (
              <>
                <MicroLabel className="px-2 pb-1 pt-1.5">Compare every turn</MicroLabel>
                <span className="flex items-center gap-2 px-2 pb-1 text-[13px] font-medium text-text">
                  <InitialsBadge initials={confirming.monogram} size={20} />
                  {confirming.displayName}
                </span>
                <span
                  data-add-replay-confirmation
                  className="px-2 pb-1.5 text-[12.5px] leading-[1.5] text-neutral-300"
                >
                  {confirming.displayName} answers {turnCount}{' '}
                  {turnCount === 1 ? 'turn' : 'turns'} · {calls} {callLabel}.
                </span>
                {addError && (
                  <span className="px-2 pb-1 text-[12px] text-danger" role="alert">
                    {addError}
                  </span>
                )}
                <div className="flex gap-1.5 px-1 pb-0.5">
                  <button
                    type="button"
                    disabled={Boolean(addingModelId)}
                    onClick={() => onAdd(confirming)}
                    className="btn-secondary h-8 flex-1 disabled:opacity-50"
                  >
                    {addingModelId === confirming.id ? 'Adding…' : 'Add model'}
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(addingModelId)}
                    onClick={() => setConfirming(null)}
                    className="btn-secondary h-8 flex-1 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <MicroLabel className="px-2 pb-1 pt-1.5">Responses</MicroLabel>
                <div className="flex flex-col gap-0.5">
                  {challengers.map((response) => {
                    const isActive = response.model.slug === active?.model.slug;
                    const rowPending = isPendingResponse(response.status);
                    const inProgress = replayInProgress.has(response.model.slug);
                    return (
                      <button
                        key={response.model.slug}
                        type="button"
                        data-challenger-tab={response.model.slug}
                        aria-current={isActive ? 'true' : undefined}
                        aria-label={
                          response.status === 'failed'
                            ? `${response.model.name} — failed: ${response.error ?? 'API timeout'}`
                            : inProgress || rowPending
                              ? `${response.model.name} — generating replies`
                              : response.status === 'skipped'
                                ? `${response.model.name} — stopped`
                                : undefined
                        }
                        onClick={() => {
                          onSwitch(response.model.slug);
                          onOpenChange(false);
                        }}
                        className={cn(
                          'flex h-9 items-center gap-2.5 rounded-[var(--r)] px-2 text-left text-[13px] font-medium text-text transition-colors',
                          isActive ? 'bg-neutral-800' : 'hover:bg-neutral-800',
                        )}
                      >
                        <InitialsBadge initials={response.model.monogram} size={20} />
                        <span className="min-w-0 flex-1 truncate">
                          {response.model.name}
                        </span>
                        {rowPending || inProgress ? (
                          <CircleNotch
                            size={12}
                            className="anim-spin flex-none text-accent-300"
                            aria-hidden
                          />
                        ) : null}
                        {response.status === 'failed' ? (
                          <WarningCircle size={13} className="flex-none text-danger" aria-hidden />
                        ) : null}
                        {response.status === 'skipped' ? (
                          <MinusCircle size={13} className="flex-none text-neutral-400" aria-hidden />
                        ) : null}
                        {isActive && !rowPending && !inProgress ? (
                          <Check size={14} className="flex-none text-accent-300" aria-hidden />
                        ) : null}
                      </button>
                    );
                  })}
                  {challengers.length === 0 && (
                    <span className="px-2 py-1 text-[12.5px] text-neutral-500">
                      No challenger responses
                    </span>
                  )}
                </div>

                {showsAdd && (
                  <>
                    <div className="my-1 h-px bg-neutral-800" />
                    <MicroLabel className="px-2 pb-1 pt-1.5">Add a model</MicroLabel>
                    <label className="relative block px-1 pb-1">
                      <span className="sr-only">Search models</span>
                      <MagnifyingGlass
                        size={13}
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
                        aria-hidden
                      />
                      <input
                        ref={searchRef}
                        type="search"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Search models…"
                        className="h-8 w-full rounded-[var(--r)] border border-neutral-600 bg-neutral-900 pl-7 pr-2 text-[12.5px] font-normal text-text placeholder:text-neutral-400 focus:border-accent"
                      />
                    </label>
                    <div
                      data-add-model-list
                      className="flex max-h-[260px] flex-col gap-0.5 overflow-y-auto"
                    >
                      {matching.map((model) => (
                        <button
                          key={model.id}
                          type="button"
                          disabled={Boolean(addingModelId)}
                          onClick={() => {
                            if (multiTurn) setConfirming(model);
                            else onAdd(model);
                          }}
                          className="flex h-9 flex-none items-center gap-2.5 rounded-[var(--r)] px-2 text-left text-[13px] font-medium text-text transition-colors hover:bg-neutral-800 disabled:opacity-50"
                        >
                          <Plus size={13} className="flex-none text-accent-300" aria-hidden />
                          <span className="min-w-0 flex-1 truncate">{model.displayName}</span>
                          <span
                            data-model-weight={model.openWeights ? 'open' : 'frontier'}
                            className={cn(
                              'flex-none rounded-[var(--r)] border px-1 py-px text-[10.5px] font-medium leading-none',
                              model.openWeights
                                ? 'border-neutral-600 text-neutral-400'
                                : 'border-accent-700 text-accent-200',
                            )}
                          >
                            {modelWeightShortLabel(model.openWeights)}
                          </span>
                          <span className="flex-none text-[12px] font-normal text-neutral-400">
                            {addingModelId === model.id
                              ? 'Adding…'
                              : `~${model.etaSeconds}s`}
                          </span>
                        </button>
                      ))}
                      {matching.length === 0 && (
                        <span className="px-2 py-1 text-[12px] text-neutral-400">
                          No models match “{query.trim()}”.
                        </span>
                      )}
                    </div>
                  </>
                )}

                {addError && !confirming && (
                  <span className="px-2 py-1 text-[12px] text-danger" role="alert">
                    {addError}
                  </span>
                )}
                <span className="px-2 pb-1 pt-1.5 text-[12px] leading-[1.45] text-neutral-400">
                  Runs the same prompt through the model&apos;s hosted API.
                </span>
              </>
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      <span className="hidden shrink-0 whitespace-nowrap text-[12px] text-neutral-400 min-[560px]:inline">
        {challengers.length} {challengers.length === 1 ? 'response' : 'responses'}
      </span>
      <div className="flex-1" />
      {replayInProgress.size > 0 && (
        <span
          data-replay-in-progress
          className="hidden shrink-0 whitespace-nowrap rounded-[var(--r)] border border-accent-700 px-1.5 py-1 text-[10.5px] font-medium leading-none text-accent-200 min-[900px]:inline-flex"
        >
          Replay in progress
        </span>
      )}
      {meta && (
        <span className="hidden shrink-0 whitespace-nowrap text-[12px] text-neutral-400 min-[900px]:inline">
          {meta}
        </span>
      )}
    </div>
  );
}
