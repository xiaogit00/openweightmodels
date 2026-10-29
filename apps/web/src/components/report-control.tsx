'use client';

import * as Popover from '@radix-ui/react-popover';
import { CheckCircle, CircleNotch, Flag, WarningCircle, X } from '@phosphor-icons/react';
import Link from 'next/link';
import { useState } from 'react';
import {
  REPORT_REASON_META,
  REPORT_REASONS,
  type ReportReason,
  type ReportTarget,
} from '@owm/core/client';
import { cn } from '@/lib/utils';
import { POPOVER_SURFACE } from './ui/popover-surface';

const TARGET_NOUN: Record<ReportTarget, string> = {
  comparison: 'comparison',
  comment: 'comment',
  annotation: 'annotation',
};

type Props = {
  targetType: ReportTarget;
  targetId: string;
  signedIn: boolean;
  signInHref: string;
  /** Icon-only trigger for tight rows such as the annotation thread header. */
  compact?: boolean;
  className?: string;
};

/**
 * Files one report per reader per target. The API is idempotent, so a double
 * click shows "already reported" instead of adding queue noise.
 */
export function ReportControl({
  targetType,
  targetId,
  signedIn,
  signInHref,
  compact = false,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason>('spam');
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<'new' | 'duplicate' | null>(null);
  const [reported, setReported] = useState(false);

  if (!signedIn) {
    return (
      <Link
        href={signInHref}
        className={cn('flex items-center gap-1 text-[11px] font-medium text-neutral-400 hover:text-text', className)}
      >
        <Flag size={12} />
        {compact ? null : 'Report'}
        {compact ? <span className="sr-only">Sign in to report</span> : null}
      </Link>
    );
  }

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          targetType,
          targetId,
          reason,
          detail: detail.trim() || null,
        }),
      });
      const payload = (await response.json()) as {
        report?: { duplicate?: boolean };
        error?: { message?: string };
      };
      if (!response.ok || !payload.report) {
        setError(payload.error?.message ?? 'Could not file that report.');
        return;
      }
      setSent(payload.report.duplicate ? 'duplicate' : 'new');
      setReported(true);
    } catch {
      setError('Could not file that report. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) {
          setError(null);
          setSent(null);
        }
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          data-report-trigger
          aria-label={`Report this ${TARGET_NOUN[targetType]}`}
          aria-pressed={reported}
          className={cn(
            'flex items-center gap-1.5 rounded-[var(--r)] text-[12.5px] font-medium text-neutral-400 transition-colors hover:text-text',
            reported && 'text-accent-300',
            className,
          )}
        >
          <Flag size={13} weight={reported ? 'fill' : 'regular'} aria-hidden />
          {compact ? (
            <span className="sr-only">{reported ? 'Reported' : 'Report'}</span>
          ) : (
            (reported ? 'Reported' : 'Report')
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          data-popover
          data-report-form
          aria-label={`Report this ${TARGET_NOUN[targetType]}`}
          className={cn(POPOVER_SURFACE, 'z-50 w-[320px] gap-3 p-3.5')}
        >
          <div className="flex items-center gap-2">
            <span className="text-[13.5px] font-medium">
              Report this {TARGET_NOUN[targetType]}
            </span>
            <div className="flex-1" />
            <button
              type="button"
              aria-label="Close report form"
              onClick={() => setOpen(false)}
              className="grid h-[26px] w-[26px] place-items-center rounded-[var(--r)] text-neutral-400 hover:bg-neutral-800 hover:text-text"
            >
              <X size={13} aria-hidden />
            </button>
          </div>

          {sent ? (
            <div className="flex flex-col gap-1.5 py-1" role="status">
              <span className="flex items-center gap-1.5 text-[13px] font-medium text-accent-200">
                <CheckCircle size={15} aria-hidden />
                {sent === 'new' ? 'Reported' : 'Already reported'}
              </span>
              <span className="text-[12.5px] leading-[1.5] text-neutral-400">
                An Admin will review it. You do not need to report it again.
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="btn-secondary mt-1 h-8 self-start"
              >
                Close
              </button>
            </div>
          ) : (
            <>
              <div
                role="radiogroup"
                aria-label="Reason"
                className="flex flex-col gap-[3px]"
              >
                {REPORT_REASONS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={reason === value}
                    onClick={() => setReason(value)}
                    className={cn(
                      'flex h-8 items-center gap-2 rounded-[var(--r)] border px-2.5 text-left text-[12.5px] font-medium',
                      reason === value
                        ? 'border-accent text-accent-200'
                        : 'border-neutral-700 text-neutral-300',
                    )}
                  >
                    <span
                      className={cn(
                        'h-2 w-2 rounded-full',
                        reason === value ? 'bg-accent' : 'bg-neutral-600',
                      )}
                    />
                    {REPORT_REASON_META[value]}
                  </button>
                ))}
              </div>

              <textarea
                aria-label="Details for the Admin"
                value={detail}
                onChange={(event) => setDetail(event.target.value)}
                maxLength={500}
                rows={2}
                placeholder="Anything else an Admin should know? (optional)"
                className="resize-y rounded-[var(--r)] border border-neutral-700 bg-surface px-2.5 py-2 text-[13px] leading-[1.5] text-text focus:border-accent"
              />

              {error && (
                <span className="flex items-start gap-1.5 text-[12px] text-danger" role="alert">
                  <WarningCircle size={14} className="mt-px shrink-0" aria-hidden />
                  {error}
                </span>
              )}

              <button
                type="button"
                disabled={busy}
                onClick={() => void submit()}
                className="btn-secondary h-8 self-start disabled:opacity-45"
              >
                {busy ? (
                  <CircleNotch size={13} className="anim-spin" aria-hidden />
                ) : (
                  <Flag size={13} aria-hidden />
                )}
                {busy ? 'Reporting…' : 'Submit report'}
              </button>
            </>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
