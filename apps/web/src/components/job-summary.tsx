import Link from 'next/link';
import {
  Bell,
  Check,
  CheckCircle,
  Circle,
  CircleNotch,
  Clock,
  MinusCircle,
  WarningCircle,
} from '@phosphor-icons/react/dist/ssr';
import type { JobBundle } from '@owm/core';
import type { JobRunState } from '@owm/core/client';
import { SiteHeader } from './site-header';
import { ComparisonPreview } from './comparison-preview';
import { cn } from '@/lib/utils';

const STAGES = ['Scheduled', 'Resolving models', 'Calling hosted APIs', 'Ready'];

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

const RESOLVING_STAGE = 1;
const CALLING_STAGE = 2;

export function JobSummary({ bundle }: { bundle: JobBundle }) {
  const { job, comparison, author, baseModel, baseSnippet, runs } = bundle;
  const settled = job.status === 'ready';
  const stageIndex = settled
    ? STAGES.length
    : job.status === 'scheduled'
      ? RESOLVING_STAGE
      : CALLING_STAGE;
  const doneCount = runs.filter((run) => run.status === 'done').length;
  const nonSkippedCount = runs.filter((run) => run.status !== 'skipped').length;
  const scheduledAt = job.createdAt.toISOString().slice(11, 16);

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader handle={author.handle} variant="page" showNew={false} />

      <main className="mx-auto grid w-full max-w-[1120px] grid-cols-1 gap-8 px-5 pb-14 pt-[22px] lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-5" style={{ animation: 'rise .25s ease-out' }}>
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-neutral-500">
              Job #{job.id.slice(-4).toUpperCase()} · Scheduled {scheduledAt} UTC
            </span>
            <h1 className="m-0 font-heading text-[18px] font-medium leading-[1.2] tracking-[-0.015em] [text-wrap:pretty]">
              {comparison.title}
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
                {baseModel?.name ?? 'Base model'}
              </span>
              <div className="flex-1" />
              <span className="flex items-center gap-1 text-[12px] font-normal text-neutral-400">
                <CheckCircle size={13} />
                Uploaded
              </span>
            </div>

            {runs.map((run) => {
              const view = presentation(run);
              const Icon = view.icon;
              return (
                <div
                  key={run.id}
                  className="flex flex-col gap-[7px] border-b border-neutral-800 px-[14px] py-3 last:border-b-0"
                >
                  <div className="flex items-center gap-[10px]">
                    <span className="grid h-[22px] w-[22px] flex-none place-items-center rounded-[2px] bg-neutral-700 text-[9px] font-semibold">
                      {run.monogram}
                    </span>
                    <span className="text-[12px] font-medium">{run.modelName}</span>
                    <div className="flex-1" />
                    <span
                      className={cn(
                        'flex max-w-[230px] items-center gap-[5px] whitespace-nowrap text-[12px] font-medium',
                        view.colour,
                      )}
                      title={view.label}
                    >
                      <Icon
                        size={13}
                        className="flex-none"
                        style={
                          view.spinning
                            ? { animation: 'spin-soft 1s linear infinite' }
                            : undefined
                        }
                      />
                      <span className="truncate">{view.label}</span>
                    </span>
                  </div>
                  <div className="h-[3px] overflow-hidden rounded-[2px] bg-neutral-800">
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
                </div>
              );
            })}
          </div>

          {settled ? (
            <div
              className="flex flex-wrap items-center gap-3 rounded-[2px] border border-accent bg-accent-900 px-4 py-[14px]"
              style={{ animation: 'rise .3s ease-out' }}
            >
              <CheckCircle size={20} className="flex-none text-accent-200" />
              <div className="flex min-w-[200px] flex-1 flex-col gap-[2px]">
                <span className="font-heading text-[13px] font-medium">
                  Your comparison is ready
                </span>
                <span className="text-[12px] font-normal text-neutral-300">
                  {doneCount} {doneCount === 1 ? 'response' : 'responses'} generated. Review it
                  before publishing to the live board.
                </span>
              </div>
              <Link
                href={`/comparisons/${comparison.id}`}
                className="btn-neutral h-8 whitespace-nowrap"
              >
                Review first
              </Link>
            </div>
          ) : (
            <span className="flex items-center gap-[6px] text-[12px] font-normal text-neutral-500">
              <Bell size={13} />
              You can leave this page — we&apos;ll notify you when it&apos;s done.
            </span>
          )}
        </div>

        <ComparisonPreview
          base={baseModel}
          challengers={runs.map((run) => ({
            name: run.modelName,
            monogram: run.monogram,
          }))}
          title={comparison.title}
          categories={comparison.categories}
          effort={comparison.effort}
          baseSnippet={baseSnippet}
          challengerSnippet={settled ? undefined : 'Generating…'}
          status={
            settled
              ? { label: 'Ready', tone: 'ready' }
              : { label: `Generating ${doneCount}/${nonSkippedCount}`, tone: 'generating' }
          }
          handle={author.handle}
          note={
            settled
              ? 'Only you can see this until you publish.'
              : 'Visible only to you while generating.'
          }
        />
      </main>
    </div>
  );
}
