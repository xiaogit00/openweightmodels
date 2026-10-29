'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Bell,
  Broadcast,
  Check,
  CheckCircle,
  Circle,
  CircleNotch,
  Clock,
  MinusCircle,
  WarningCircle,
} from '@phosphor-icons/react';
import {
  runProgress,
  type ComparisonStatus,
  type JobRunState,
  type JobStatus,
  type ResponseStatus,
} from '@owm/core/client';
import { SiteHeader } from './site-header';
import { ComparisonPreview } from './comparison-preview';
import { groupReplays, type ReplayState } from '@/lib/job-replays';
import { isResponseStatus, responseErrorMessage, type JobStreamEvent } from '@/lib/run-events';
import { cn } from '@/lib/utils';

const STAGES = ['Scheduled', 'Resolving models', 'Calling hosted APIs', 'Ready'];

const RESOLVING_STAGE = 1;
const CALLING_STAGE = 2;
const ALL_STAGES_DONE = STAGES.length;

type RunPresentation = {
  label: string;
  icon: typeof Clock;
  colour: string;
  spinning?: boolean;
};

export type JobView = {
  jobId: string;
  jobStatus: JobStatus;
  scheduledAt: string;
  comparison: {
    id: string;
    title: string;
    categories: string[];
    effort: number;
    status: ComparisonStatus;
  };
  authorHandle: string;
  baseModel: { name: string; monogram: string } | null;
  baseSnippet: string;
  challengerSnippet: string;
  runs: JobRunState[];
};

type Connection = 'connecting' | 'live' | 'reconnecting';
type RunAction = 'retry' | 'skip';


function replayPresentation(replay: ReplayState): RunPresentation {
  if (replay.status === 'failed') {
    return {
      label: replay.failedRun?.error || 'API timeout',
      icon: WarningCircle,
      colour: 'text-neutral-200',
    };
  }
  if (replay.status === 'stopped') {
    return {
      label: `Stopped at turn ${replay.turnNumber}`,
      icon: MinusCircle,
      colour: 'text-neutral-500',
    };
  }
  if (replay.status === 'done') {
    return {
      label: `Done · ${replay.tokens} tok${
        replay.latencyMs !== null ? ` · ${(replay.latencyMs / 1000).toFixed(1)}s` : ''
      }`,
      icon: CheckCircle,
      colour: 'text-neutral-200',
    };
  }
  if (replay.status === 'calling' || replay.status === 'streaming') {
    const streaming = replay.status === 'streaming';
    return {
      label: streaming ? `Generating · ${replay.tokens} tok` : 'Calling API…',
      icon: CircleNotch,
      colour: 'text-accent-200',
      spinning: true,
    };
  }
  return { label: 'Queued', icon: Clock, colour: 'text-neutral-400' };
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'That action failed. Try again.';
}

async function ensureOk(response: Response, fallback: string) {
  if (response.ok) return;
  throw new Error(await responseErrorMessage(response, fallback));
}

export function JobSummary({ view }: { view: JobView }) {
  const router = useRouter();
  const [runs, setRuns] = useState(view.runs);
  const [jobReady, setJobReady] = useState(view.jobStatus === 'ready');
  const [comparisonStatus, setComparisonStatus] = useState(view.comparison.status);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [busy, setBusy] = useState<Record<string, RunAction>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const wasDisconnected = useRef(false);

  const resync = useCallback(async () => {
    try {
      const response = await fetch(`/api/jobs/${view.jobId}`, { cache: 'no-store' });
      if (!response.ok) return;
      const bundle = (await response.json()) as {
        job: { status: JobStatus };
        comparison: { status: ComparisonStatus };
        runs: JobRunState[];
      };
      setRuns(bundle.runs);
      setJobReady(bundle.job.status === 'ready');
      setComparisonStatus(bundle.comparison.status);
    } catch {
      // The stream keeps retrying; a snapshot can be read again on the next open.
    }
  }, [view.jobId]);

  useEffect(() => {
    const source = new EventSource(`/api/stream/jobs/${view.jobId}`);

    source.onopen = () => {
      setConnection('live');
      // The browser resumes with Last-Event-ID; this also covers changes the
      // author missed while the tab was asleep.
      if (wasDisconnected.current) void resync();
      wasDisconnected.current = false;
    };

    source.onerror = () => {
      wasDisconnected.current = true;
      setConnection('reconnecting');
    };

    source.onmessage = (message) => {
      let event: JobStreamEvent;
      try {
        event = JSON.parse(message.data) as JobStreamEvent;
      } catch {
        return;
      }

      if (event.type === 'job.ready') {
        setJobReady(true);
        setComparisonStatus((current) => (current === 'published' ? current : 'ready'));
        return;
      }

      if (event.type !== 'response.status') return;
      const payload = event.data?.payload ?? {};
      const responseId = typeof payload.responseId === 'string' ? payload.responseId : null;
      if (!responseId || !isResponseStatus(payload.status)) return;

      setRuns((current) =>
        current.map((run) => {
          if (run.id !== responseId) return run;
          const status = payload.status as ResponseStatus;
          const tokens =
            typeof payload.tokens === 'number' ? payload.tokens : status === 'queued' ? 0 : run.tokens;
          return {
            ...run,
            status,
            tokens,
            latencyMs:
              typeof payload.latencyMs === 'number' ? payload.latencyMs : run.latencyMs,
            error: status === 'failed' ? String(payload.error ?? 'API timeout') : null,
            attempt:
              typeof payload.attempt === 'number' ? payload.attempt : run.attempt,
            progress: runProgress(status, tokens),
          };
        }),
      );
    };

    return () => source.close();
  }, [view.jobId, resync]);

  const handleRunAction = async (run: JobRunState, action: RunAction) => {
    const previous = run;
    setBusy((current) => ({ ...current, [run.id]: action }));
    setRowErrors((current) => {
      const next = { ...current };
      delete next[run.id];
      return next;
    });

    // Update in place immediately; the SSE event confirms it moments later.
    setRuns((current) =>
      current.map((item) => {
        if (item.id === run.id) {
          return action === 'retry'
            ? {
                ...item,
                status: 'queued' as const,
                tokens: 0,
                latencyMs: null,
                error: null,
                attempt: item.attempt + 1,
                progress: 0,
              }
            : {
                ...item,
                status: 'skipped' as const,
                error: null,
                progress: 100,
              };
        }
        // Skip stops the Replay: later Turns of this Challenger are skipped too.
        if (
          action === 'skip' &&
          item.modelId === run.modelId &&
          item.turnNumber > run.turnNumber
        ) {
          return {
            ...item,
            status: 'skipped' as const,
            error: null,
            progress: 100,
          };
        }
        return item;
      }),
    );

    try {
      const response = await fetch(`/api/responses/${run.id}/${action}`, { method: 'POST' });
      await ensureOk(response, 'That action failed. Try again.');
    } catch (error) {
      setRuns((current) => current.map((item) => (item.id === run.id ? previous : item)));
      setRowErrors((current) => ({ ...current, [run.id]: errorText(error) }));
    } finally {
      setBusy((current) => {
        const next = { ...current };
        delete next[run.id];
        return next;
      });
    }
  };

  const publish = async () => {
    setPublishing(true);
    setPublishError(null);
    try {
      const response = await fetch(`/api/comparisons/${view.comparison.id}/publish`, {
        method: 'POST',
      });
      await ensureOk(response, 'Publishing failed. Try again.');
      setComparisonStatus('published');
      router.push(`/comparisons/${view.comparison.id}`);
    } catch (error) {
      setPublishError(errorText(error));
    } finally {
      setPublishing(false);
    }
  };

  const replays = groupReplays(runs);
  // A stopped Replay still produced the Turns it answered, so it counts towards
  // the at-least-one-done-Challenger rule for Publish.
  const doneCount = replays.filter((replay) =>
    replay.runs.some((run) => run.status === 'done'),
  ).length;
  const activeReplayCount = replays.filter((replay) => replay.status !== 'stopped').length;
  const settled =
    jobReady ||
    (runs.length > 0 &&
      runs.every((run) => run.status === 'done' || run.status === 'skipped'));
  const started = runs.some((run) =>
    ['calling', 'streaming', 'done', 'failed'].includes(run.status),
  );
  const stageIndex = settled
    ? ALL_STAGES_DONE
    : started
      ? CALLING_STAGE
      : RESOLVING_STAGE;
  const published = comparisonStatus === 'published';

  const connectionLabel =
    connection === 'live'
      ? 'Live'
      : connection === 'reconnecting'
        ? 'Reconnecting…'
        : 'Connecting…';

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader handle={view.authorHandle} variant="page" showNew={false} />

      <main className="mx-auto grid w-full max-w-[1120px] grid-cols-1 gap-8 px-5 pb-14 pt-[22px] lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="anim-rise flex min-w-0 flex-col gap-5">
          <div className="flex flex-col gap-1">
            <span className="flex flex-wrap items-center gap-x-[6px] text-[11px] font-medium uppercase tracking-[0.04em] text-neutral-500">
              <span data-relative-time>
                Job #{view.jobId.slice(-4).toUpperCase()} · Scheduled {view.scheduledAt} UTC
              </span>
              <span aria-hidden="true">·</span>
              <span
                role="status"
                aria-live="polite"
                className="flex items-center gap-[5px] normal-case tracking-normal"
              >
                <span
                  className={cn(
                    'h-[6px] w-[6px] rounded-[2px]',
                    connection === 'live' ? 'bg-accent anim-pulse' : 'bg-neutral-500',
                  )}
                />
                <span className={connection === 'live' ? 'text-accent-200' : 'text-neutral-400'}>
                  {connectionLabel}
                </span>
              </span>
            </span>
            <h1 className="m-0 font-heading text-[18px] font-medium leading-[1.2] tracking-[-0.015em] [text-wrap:pretty]">
              {view.comparison.title}
            </h1>
          </div>

          <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
            {STAGES.map((stage, index) => {
              const complete = index < stageIndex || settled;
              const current = index === stageIndex && !settled;
              return (
                <div key={stage} className="flex min-w-0 flex-col gap-[6px]">
                  <div
                    className={cn(
                      'h-[3px] rounded-[2px]',
                      complete
                        ? 'bg-accent'
                        : current
                          ? 'bg-accent-700'
                          : 'bg-neutral-700',
                    )}
                  />
                  <span
                    className={cn(
                      'flex items-center gap-[5px] text-[11px] font-medium',
                      index <= stageIndex || settled
                        ? 'text-text'
                        : 'text-neutral-500',
                    )}
                  >
                    {complete ? (
                      <Check size={12} weight="bold" />
                    ) : current ? (
                      <CircleNotch
                        size={12}
                        className="anim-spin"
                        />
                    ) : (
                      <Circle size={12} />
                    )}
                    <span className="truncate">{stage}</span>
                  </span>
                </div>
              );
            })}
          </div>

          <div className="flex flex-col rounded-[2px] bg-surface">
            <div className="flex items-center gap-[10px] border-b border-neutral-800 px-[14px] py-3">
              <span className="rounded-[2px] border border-accent-700 px-[6px] py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-accent-200">
                Base
              </span>
              <span className="text-[12px] font-medium">
                {view.baseModel?.name ?? 'Base model'}
              </span>
              <div className="flex-1" />
              <span className="flex items-center gap-1 text-[12px] font-normal text-neutral-400">
                <CheckCircle size={13} />
                Uploaded
              </span>
            </div>

            {replays.map((replay) => {
              const display = replayPresentation(replay);
              const Icon = display.icon;
              const actionRun = replay.failedRun;
              const pending = actionRun ? busy[actionRun.id] : undefined;
              const rowError = actionRun ? rowErrors[actionRun.id] : undefined;
              return (
                <div
                  key={replay.key}
                  className="flex flex-col gap-[7px] border-b border-neutral-800 px-[14px] py-3 last:border-b-0"
                >
                  <div className="flex flex-wrap items-center gap-[10px]">
                    <span className="grid h-[22px] w-[22px] flex-none place-items-center rounded-[2px] bg-neutral-700 text-[10px] font-semibold">
                      {replay.monogram}
                    </span>
                    <span className="text-[12px] font-medium">{replay.modelName}</span>
                    <span className="rounded-[2px] border border-neutral-700 px-[5px] py-[1px] text-[10px] font-medium text-neutral-400">
                      turn {replay.turnNumber} of {replay.turnCount}
                    </span>
                    <div className="flex-1" />
                    <span
                      className={cn(
                        'flex max-w-[230px] items-center gap-[5px] whitespace-nowrap text-[12px] font-medium',
                        display.colour,
                      )}
                      title={display.label}
                    >
                      <Icon
                        size={13}
                        className={cn('flex-none', display.spinning && 'anim-spin')}
                        />
                      <span className="truncate">{display.label}</span>
                    </span>
                    {actionRun && (
                      <span className="flex items-center gap-[6px]">
                        <button
                          type="button"
                          onClick={() => void handleRunAction(actionRun, 'retry')}
                          disabled={Boolean(pending)}
                          className="btn-secondary h-[26px] px-[10px] disabled:opacity-45"
                        >
                          {pending === 'retry' ? 'Retrying…' : 'Retry'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleRunAction(actionRun, 'skip')}
                          disabled={Boolean(pending)}
                          className="btn-neutral h-[26px] px-[10px] disabled:opacity-45"
                        >
                          {pending === 'skip' ? 'Skipping…' : 'Skip remaining'}
                        </button>
                      </span>
                    )}
                  </div>
                  <div
                    role="progressbar"
                    aria-label={`${replay.modelName} progress`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={replay.progress}
                    className="h-[3px] overflow-hidden rounded-[2px] bg-neutral-800"
                  >
                    <div
                      className={cn(
                        'h-[3px] rounded-[2px] transition-[width] duration-300',
                        replay.status === 'failed'
                          ? 'bg-neutral-500'
                          : replay.status === 'done'
                            ? 'bg-accent-500'
                            : 'bg-accent',
                      )}
                      style={{ width: `${replay.progress}%` }}
                    />
                  </div>
                  {rowError && (
                    <span className="text-[11px] font-normal text-danger" role="alert">
                      {rowError}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {settled ? (
            <div
              className="anim-rise-slow flex flex-col gap-2 rounded-[2px] border border-accent bg-accent-900 px-4 py-[14px]"
              aria-live="polite"
            >
              <div className="flex flex-wrap items-center gap-3">
                <CheckCircle size={20} className="flex-none text-accent-200" />
                <div className="flex min-w-[200px] flex-1 flex-col gap-[2px]">
                  <span className="font-heading text-[13px] font-medium">
                    {published ? 'Your comparison is on the board' : 'Your comparison is ready'}
                  </span>
                  <span className="text-[12px] font-normal text-neutral-300">
                    {doneCount} {doneCount === 1 ? 'challenger' : 'challengers'} generated.
                    {published
                      ? ' It is live for everyone to read, annotate and discuss.'
                      : ' Review it, or publish straight to the live board.'}
                  </span>
                </div>
                <Link
                  href={`/comparisons/${view.comparison.id}`}
                  className="btn-neutral h-8 whitespace-nowrap"
                >
                  {published ? 'View comparison' : 'Review first'}
                </Link>
                {!published && (
                  <button
                    type="button"
                    onClick={() => void publish()}
                    disabled={doneCount < 1 || publishing}
                    className="btn-primary h-8 whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-45"
                    title={
                      doneCount < 1
                        ? 'Publish needs at least one finished response.'
                        : undefined
                    }
                  >
                    <Broadcast size={13} />
                    {publishing ? 'Publishing…' : 'Publish to board'}
                  </button>
                )}
              </div>
              {!published && doneCount < 1 && (
                <span className="pl-[32px] text-[11px] font-normal text-neutral-400">
                  Publish is unavailable until at least one challenger finishes generating.
                </span>
              )}
              {publishError && (
                <span className="pl-[32px] text-[11px] font-normal text-danger" role="alert">
                  {publishError}
                </span>
              )}
            </div>
          ) : (
            <span className="flex items-center gap-[6px] text-[12px] font-normal text-neutral-500">
              <Bell size={13} />
              You can leave this page — we&apos;ll notify you when it&apos;s done.
            </span>
          )}
        </div>

        <ComparisonPreview
          base={view.baseModel}
          challengers={replays.map((replay) => ({
            name: replay.modelName,
            monogram: replay.monogram,
          }))}
          title={view.comparison.title}
          categories={view.comparison.categories}
          effort={view.comparison.effort}
          baseSnippet={view.baseSnippet}
          challengerSnippet={settled ? view.challengerSnippet : 'Generating…'}
          status={
            settled
              ? { label: 'Ready', tone: 'ready' }
              : { label: `Generating ${doneCount}/${activeReplayCount}`, tone: 'generating' }
          }
          handle={view.authorHandle}
          note={
            published
              ? 'Published to the live board.'
              : settled
                ? 'Only you can see this until you publish.'
                : 'Visible only to you while generating.'
          }
        />
      </main>
    </div>
  );
}
