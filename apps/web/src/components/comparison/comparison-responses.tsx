'use client';

import { Check, Copy, WarningCircle } from '@phosphor-icons/react';
import { isPendingResponse } from '@owm/core/client';
import type { AnnotationView, Block } from '@owm/core/client';
import { cn } from '@/lib/utils';
import { MarkdownView } from '../markdown-view';
import { InitialsBadge } from '../ui/initials-badge';
import { MicroLabel } from '../ui/micro-label';
import { ModelPicker, type ModelPickerProps } from './model-picker';
import { GeneratingState, TurnStateLine } from './turn-state';
import type {
  ComparisonPageData,
  ComparisonResponseView,
  RunAction,
  TurnInfo,
} from './types';

export type ComparisonResponsesProps = {
  turns: TurnInfo[];
  multiTurn: boolean;
  responseList: ComparisonResponseView[];
  baseModel: ComparisonPageData['baseModel'];
  annOn: boolean;
  kind: string;
  annotations: AnnotationView[];
  openAnnotationId: string | null;
  onOpenAnnotation: (annotationId: string, trigger: HTMLElement) => void;
  activeStoppedAt: number | null;
  isAuthor: boolean;
  runBusy: { id: string; action: RunAction } | null;
  runError: { id: string; message: string } | null;
  onRun: (response: ComparisonResponseView, action: RunAction) => void;
  copiedResponseId: string | null;
  onCopyResponse: (response: ComparisonResponseView) => void;
  picker: ModelPickerProps;
};

function turnMeta(response: ComparisonResponseView | null | undefined) {
  if (!response || response.status !== 'done') return '';
  return `${response.tokens.toLocaleString()} tok`;
}

function blocksToText(blocks: Block[]): string {
  return blocks
    .map((block) => {
      if (block.type === 'paragraph' || block.type === 'heading') {
        return block.runs.map((run) => run.text).join('');
      }
      if (block.type === 'code') return block.text;
      if (block.type === 'list') {
        return block.items
          .map((item, index) =>
            `${block.ordered ? `${index + 1}. ` : '• '}${item
              .map((run) => run.text)
              .join('')}`,
          )
          .join('\n');
      }
      if (block.type === 'blockquote') return blocksToText(block.blocks);
      return '';
    })
    .filter(Boolean)
    .join('\n\n');
}

export function copyResponseText(response: ComparisonResponseView): string {
  return blocksToText(response.blocks);
}

type CellProps = {
  side: 'base' | 'active';
  turn: TurnInfo;
  index: number;
  multiTurn: boolean;
  response: ComparisonResponseView | null | undefined;
  fallback: { name: string; monogram: string };
  annOn: boolean;
  kind: string;
  annotations: AnnotationView[];
  openAnnotationId: string | null;
  onOpenAnnotation: (annotationId: string, trigger: HTMLElement) => void;
  activeStoppedAt: number | null;
  turnCount: number;
  isAuthor: boolean;
  runBusy: { id: string; action: RunAction } | null;
  runError: { id: string; message: string } | null;
  onRun: (response: ComparisonResponseView, action: RunAction) => void;
  copiedResponseId: string | null;
  onCopyResponse: (response: ComparisonResponseView) => void;
};

function ResponseCell({
  side,
  turn,
  index,
  multiTurn,
  response,
  fallback,
  annOn,
  kind,
  annotations,
  openAnnotationId,
  onOpenAnnotation,
  activeStoppedAt,
  turnCount,
  isAuthor,
  runBusy,
  runError,
  onRun,
  copiedResponseId,
  onCopyResponse,
}: CellProps) {
  const done = response?.status === 'done';
  const pending = Boolean(response && isPendingResponse(response.status));
  const failed = response?.status === 'failed';
  const name = response?.model.name ?? fallback.name;
  const monogram = response?.model.monogram ?? fallback.monogram;
  const meta = turnMeta(response);

  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-5 border-x border-neutral-700 bg-bg px-6 pb-3 pt-6',
        index > 0 && 'border-t border-t-neutral-800',
        side === 'active' &&
          'max-[800px]:border-t max-[800px]:border-t-neutral-800',
      )}
    >
      {multiTurn && (
        <div className="flex items-center gap-2.5">
          <MicroLabel>Turn {index + 1}</MicroLabel>
          <div className="flex-1" />
          {meta && <span className="text-[12px] text-neutral-400">{meta}</span>}
        </div>
      )}

      <div
        className={cn(
          'max-w-[85%] self-end whitespace-pre-wrap break-words rounded-[var(--r-bubble)] bg-neutral-800 px-4 py-3 text-[14.5px] leading-[1.55] text-neutral-100 [text-wrap:pretty]',
          side === 'active' && 'max-[800px]:hidden',
        )}
      >
        {turn.prompt}
      </div>

      <div className="flex flex-col gap-3.5">
        <div className="flex items-center gap-2">
          <InitialsBadge
            initials={monogram}
            size={24}
            tone={side === 'base' ? 'base' : 'neutral'}
          />
          <span className="text-[13px] font-medium text-neutral-300">{name}</span>
          {side === 'base' && (
            <span className="rounded-[var(--r)] border border-accent-700 px-1.5 py-0.5 text-[10.5px] font-semibold leading-none tracking-[0.08em] text-accent-200 min-[800px]:hidden">
              BASE
            </span>
          )}
        </div>

        {done && response ? (
          <>
            <MarkdownView
              responseId={response.id}
              blocks={response.blocks}
              annotations={annotations}
              annOn={annOn}
              kindFilter={kind}
              openId={openAnnotationId}
              onOpen={onOpenAnnotation}
            />
            <div className="-ml-1.5 flex">
              <button
                type="button"
                aria-label="Copy response"
                title="Copy response"
                onClick={() => onCopyResponse(response)}
                className="grid h-7 w-7 place-items-center rounded-[var(--r)] text-neutral-400 transition-colors hover:bg-surface hover:text-text"
              >
                {copiedResponseId === response.id ? (
                  <Check size={15} aria-hidden />
                ) : (
                  <Copy size={15} aria-hidden />
                )}
              </button>
            </div>
          </>
        ) : pending && response && side === 'active' ? (
          <GeneratingState response={response} />
        ) : (
          <div className="flex flex-col gap-2.5">
            <TurnStateLine
              response={response}
              stoppedAtTurn={side === 'active' ? activeStoppedAt : null}
              turnNumber={turn.position + 1}
              turnCount={turnCount}
            />
            {failed && isAuthor && response && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={Boolean(runBusy)}
                    onClick={() => onRun(response, 'retry')}
                    className="btn-secondary h-8 disabled:opacity-45"
                  >
                    {runBusy?.id === response.id && runBusy.action === 'retry'
                      ? 'Retrying…'
                      : 'Retry'}
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(runBusy)}
                    onClick={() => onRun(response, 'dismiss')}
                    className="btn-secondary h-8 disabled:opacity-45"
                  >
                    {runBusy?.id === response.id && runBusy.action === 'dismiss'
                      ? 'Skipping…'
                      : 'Skip remaining'}
                  </button>
                </div>
                {runError?.id === response.id && (
                  <span
                    className="flex items-center gap-1.5 text-[12px] text-danger"
                    role="alert"
                  >
                    <WarningCircle size={13} aria-hidden />
                    {runError.message}
                  </span>
                )}
              </>
            )}
            {failed && !multiTurn && (
              <span className="flex items-start gap-1.5 text-[12.5px] leading-[1.55] text-neutral-400">
                <WarningCircle size={13} className="mt-px shrink-0" aria-hidden />
                {isAuthor
                  ? 'Only you can see this failed response. Readers still see the comparison without it.'
                  : 'This response is not visible to readers.'}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Two continuous response cards. The header row sticks under the site header;
 * each Turn is one row so both columns start at the same height. Below 800px
 * the columns stack in Prompt → Base → Challenger order and the headers stop
 * sticking.
 */
export function ComparisonResponses({
  turns,
  multiTurn,
  responseList,
  baseModel,
  annOn,
  kind,
  annotations,
  openAnnotationId,
  onOpenAnnotation,
  activeStoppedAt,
  isAuthor,
  runBusy,
  runError,
  onRun,
  copiedResponseId,
  onCopyResponse,
  picker,
}: ComparisonResponsesProps) {
  const baseResponse = responseList.find((response) => response.isBase) ?? null;
  const baseName = baseResponse?.model.name ?? baseModel.name;
  const baseMeta = turnMeta(baseResponse);

  return (
    <div>
      <div className="z-10 grid grid-cols-1 gap-x-4 min-[800px]:sticky min-[800px]:top-[53px] min-[800px]:grid-cols-2">
        <div className="relative z-[14] hidden h-12 min-w-0 items-center gap-2.5 rounded-t-lg border border-neutral-700 bg-surface px-[18px] min-[800px]:flex">
          <span className="flex-none rounded-[var(--r)] border border-accent-700 px-1.5 py-1 text-[10.5px] font-semibold leading-none tracking-[0.08em] text-accent-200">
            BASE
          </span>
          <span className="min-w-0 truncate text-[14.5px] font-medium">{baseName}</span>
          <div className="flex-1" />
          {baseMeta && (
            <span className="whitespace-nowrap text-[12px] text-neutral-400">
              {baseMeta}
            </span>
          )}
        </div>
        <ModelPicker {...picker} />
      </div>

      <div className="grid grid-cols-1 gap-x-4 min-[800px]:grid-cols-2">
        {turns.map((turn, index) => {
          const turnBase = responseList.find(
            (response) => response.isBase && response.turn.position === turn.position,
          );
          const turnActive = picker.active
            ? responseList.find(
                (response) =>
                  !response.isBase &&
                  response.model.slug === picker.active?.model.slug &&
                  response.turn.position === turn.position,
              )
            : null;

          return (
            <section
              key={turn.position}
              data-turn={turn.position + 1}
              data-turn-section={turn.position}
              className="col-span-1 grid min-w-0 grid-cols-1 gap-x-4 min-[800px]:col-span-2 min-[800px]:grid-cols-2"
            >
              <ResponseCell
                side="base"
                turn={turn}
                index={index}
                multiTurn={multiTurn}
                response={turnBase}
                fallback={{ name: baseName, monogram: baseModel.monogram }}
                annOn={annOn}
                kind={kind}
                annotations={annotations}
                openAnnotationId={openAnnotationId}
                onOpenAnnotation={onOpenAnnotation}
                activeStoppedAt={activeStoppedAt}
                turnCount={turns.length}
                isAuthor={isAuthor}
                runBusy={runBusy}
                runError={runError}
                onRun={onRun}
                copiedResponseId={copiedResponseId}
                onCopyResponse={onCopyResponse}
              />
              <ResponseCell
                side="active"
                turn={turn}
                index={index}
                multiTurn={multiTurn}
                response={turnActive}
                fallback={{
                  name: picker.active?.model.name ?? 'Challenger',
                  monogram: picker.active?.model.monogram ?? '--',
                }}
                annOn={annOn}
                kind={kind}
                annotations={annotations}
                openAnnotationId={openAnnotationId}
                onOpenAnnotation={onOpenAnnotation}
                activeStoppedAt={activeStoppedAt}
                turnCount={turns.length}
                isAuthor={isAuthor}
                runBusy={runBusy}
                runError={runError}
                onRun={onRun}
                copiedResponseId={copiedResponseId}
                onCopyResponse={onCopyResponse}
              />
            </section>
          );
        })}

        <div className="hidden h-4 rounded-b-lg border-x border-b border-neutral-700 bg-bg min-[800px]:block" />
        <div className="h-4 rounded-b-lg border-x border-b border-neutral-700 bg-bg" />
      </div>
    </div>
  );
}
