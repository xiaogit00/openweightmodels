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
  RESPONSE_STATUSES,
  runProgress,
  type ComparisonStatus,
  type JobRunState,
  type JobStatus,
  type ResponseStatus,
} from '@owm/core/client';
import { SiteHeader } from './site-header';
import { ComparisonPreview } from './comparison-preview';
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

function presentation(run: JobRunState): RunPresentation {
  switch (run.status) {
    case 'calling':
      return {
        label: 'Calling API…',
        icon: CircleNotch,
        colour: 'text-accent-200',
        spinning: true,
      };
    case 'streaming':
      return {
        label: `Generating · ${run.tokens} tok`,
        icon: CircleNotch,
        colour: 'text-accent-200',
        spinning: true,
      };
    case 'done':
      return {
        label: `Done · ${run.tokens} tok${
          run.latencyMs !== null ? ` · ${(run.latencyMs / 1000).toFixed(1)}s` : ''
        }`,
        icon: CheckCircle,
        colour: 'text-neutral-200',
      };
    case 'failed':
      return {
        label: run.error || 'API timeout',
        icon: WarningCircle,
        colour: 'text-neutral-200',
      };
    case 'skipped':
      return { label: 'Skipped', icon: MinusCircle, colour: 'text-neutral-500' };
    default:
      return { label: 'Queued', icon: Clock, colour: 'text-neutral-400' };
  }
}

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

type JobEventEnvelope = {
  type: string;
  data?: { payload?: Record<string, unknown> };
};

function isResponseStatus(value: unknown): value is ResponseStatus {
  return (
    typeof value === 'string' &&
    (RESPONSE_STATUSES as readonly string[]).includes(value)
  );
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'That action failed. Try again.';
}

async function ensureOk(response: Response, fallback: string) {
  if (response.ok) return;
  const body = (await response.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  throw new Error(body?.error?.message ?? fallback);
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
      let event: JobEventEnvelope;
      try {
        event = JSON.parse(message.data) as JobEventEnvelope;
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
      current.map((item) =>
        item.id === run.id
          ? action === 'retry'
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
              }
          : item,
      ),
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

  const doneCount = runs.filter((run) => run.status === 'done').length;
  const nonSkippedCount = runs.filter((run) => run.status !== 'skipped').length;
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
        <div className="flex min-w-0 flex-col gap-5" style={{ animation: 'rise .25s ease-out' }}>
          <div className="flex flex-col gap-1">
            <span className="flex flex-wrap items-center gap-x-[6px] text-[11px] font-medium uppercase tracking-[0.04em] text-neutral-500">
              <span>
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
                    connection === 'live' ? 'bg-accent' : 'bg-neutral-500',
                  )}
                  style={
                    connection === 'live'
                      ? { animation: 'pulse-soft 1.6s infinite' }
                      : undefined
                  }
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
                        style={{ animation: 'spin-soft 1s linear infinite' }}
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
              <span className="rounded-[2px] border border-accent-700 px-[6px] py-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-accent-200">
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

            {runs.map((run) => {
              const display = presentation(run);
              const Icon = display.icon;
              const pending = busy[run.id];
              const rowError = rowErrors[run.id];
              return (
                <div
                  key={run.id}
                  className="flex flex-col gap-[7px] border-b border-neutral-800 px-[14px] py-3 last:border-b-0"
                >
                  <div className="flex flex-wrap items-center gap-[10px]">
                    <span className="grid h-[22px] w-[22px] flex-none place-items-center rounded-[2px] bg-neutral-700 text-[9px] font-semibold">
                      {run.monogram}
                    </span>
                    <span className="text-[12px] font-medium">{run.modelName}</span>
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
                        className="flex-none"
                        style={
                          display.spinning
                            ? { animation: 'spin-soft 1s linear infinite' }
                            : undefined
                        }
                      />
                      <span className="truncate">{display.label}</span>
                    </span>
                    {run.status === 'failed' && (
                      <span className="flex items-center gap-[6px]">
                        <button
                          type="button"
                          onClick={() => void handleRunAction(run, 'retry')}
                          disabled={Boolean(pending)}
                          className="btn-secondary h-[26px] px-[10px] disabled:opacity-45"
                        >
                          {pending === 'retry' ? 'Retrying…' : 'Retry'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleRunAction(run, 'skip')}
                          disabled={Boolean(pending)}
                          className="btn-neutral h-[26px] px-[10px] disabled:opacity-45"
                        >
                          {pending === 'skip' ? 'Skipping…' : 'Skip'}
                        </button>
                      </span>
                    )}
                  </div>
                  <div
                    role="progressbar"
                    aria-label={`${run.modelName} progress`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={run.progress}
                    className="h-[3px] overflow-hidden rounded-[2px] bg-neutral-800"
                  >
                    <div
                      className={cn(
                        'h-[3px] rounded-[2px] transition-[width] duration-300',
                        run.status === 'failed'
                          ? 'bg-neutral-500'
                          : run.status === 'done'
                            ? 'bg-accent-500'
                            : 'bg-accent',
                      )}
                      style={{ width: `${run.progress}%` }}
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
              className="flex flex-col gap-2 rounded-[2px] border border-accent bg-accent-900 px-4 py-[14px]"
              style={{ animation: 'rise .3s ease-out' }}
              aria-live="polite"
            >
              <div className="flex flex-wrap items-center gap-3">
                <CheckCircle size={20} className="flex-none text-accent-200" />
                <div className="flex min-w-[200px] flex-1 flex-col gap-[2px]">
                  <span className="font-heading text-[13px] font-medium">
                    {published ? 'Your comparison is on the board' : 'Your comparison is ready'}
                  </span>
                  <span className="text-[12px] font-normal text-neutral-300">
                    {doneCount} {doneCount === 1 ? 'response' : 'responses'} generated.
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
          challengers={runs.map((run) => ({
            name: run.modelName,
            monogram: run.monogram,
          }))}
          title={view.comparison.title}
          categories={view.comparison.categories}
          effort={view.comparison.effort}
          baseSnippet={view.baseSnippet}
          challengerSnippet={settled ? view.challengerSnippet : 'Generating…'}
          status={
            settled
              ? { label: 'Ready', tone: 'ready' }
              : { label: `Generating ${doneCount}/${nonSkippedCount}`, tone: 'generating' }
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
