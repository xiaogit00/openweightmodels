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
          className={cn(
            'flex items-center gap-1 rounded-[2px] text-[11px] font-medium text-neutral-400 transition-colors hover:text-text',
            className,
          )}
        >
          <Flag size={12} />
          {compact ? <span className="sr-only">Report</span> : 'Report'}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          data-popover
          data-report-form
          aria-label={`Report this ${TARGET_NOUN[targetType]}`}
          className="z-50 flex w-[300px] flex-col gap-2.5 rounded-[2px] border border-neutral-700 bg-neutral-800 p-3 shadow-lg"
        >
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-medium">Report this {TARGET_NOUN[targetType]}</span>
            <div className="flex-1" />
            <button
              type="button"
              aria-label="Close report form"
              onClick={() => setOpen(false)}
              className="grid h-6 w-6 place-items-center rounded-[2px] text-neutral-400 hover:bg-neutral-700 hover:text-text"
            >
              <X size={12} />
            </button>
          </div>

          {sent ? (
            <div className="flex flex-col gap-1.5 py-1" role="status">
              <span className="flex items-center gap-1.5 text-[12px] font-medium text-accent-200">
                <CheckCircle size={14} />
                {sent === 'new' ? 'Reported' : 'Already reported'}
              </span>
              <span className="text-[11.5px] leading-[1.5] text-neutral-400">
                An Admin will review it. You do not need to report it again.
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="btn-secondary mt-1 h-7 self-start"
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
                      'flex h-7 items-center gap-2 rounded-[2px] border px-2 text-left text-[11.5px] font-medium',
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
                className="resize-y rounded-[2px] border border-neutral-700 bg-bg p-2 text-[11.5px] leading-[1.5] text-text focus:border-accent"
              />

              {error && (
                <span className="flex items-start gap-1 text-[11px] text-danger" role="alert">
                  <WarningCircle size={13} className="mt-px shrink-0" />
                  {error}
                </span>
              )}

              <button
                type="button"
                disabled={busy}
                onClick={() => void submit()}
                className="btn-secondary h-7 self-start disabled:opacity-45"
              >
                {busy ? <CircleNotch size={12} className="anim-spin" /> : <Flag size={12} />}
                {busy ? 'Reporting…' : 'Submit report'}
              </button>
            </>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
