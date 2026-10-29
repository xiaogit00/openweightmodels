'use client';

import {
  ArrowCounterClockwise,
  ArrowSquareOut,
  CheckCircle,
  CircleNotch,
  Eye,
  EyeSlash,
  Flag,
  MagnifyingGlass,
  UserCheck,
  UserMinus,
  WarningCircle,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useCallback, useState } from 'react';
import type { AdminActionKind, AdminTargetType, ReportStatus, ReportTarget } from '@owm/core/client';
import { SiteHeader } from './site-header';

type AdminModel = {
  id: string;
  slug: string;
  displayName: string;
  monogram: string;
  provider: string;
  etaSeconds: number;
  enabled: boolean;
  responseCount: number;
};

type HiddenComparison = {
  id: string;
  title: string;
  authorHandle: string;
  status: string;
  publishedAt: string | null;
  takedownAt: string;
  takedownReason: string;
  takedownByHandle: string | null;
};

type AdminActionView = {
  id: string;
  action: AdminActionKind;
  actorHandle: string | null;
  targetType: AdminTargetType;
  targetId: string;
  targetLabel: string;
  reason: string | null;
  createdAt: string;
};

type Report = {
  id: string;
  targetType: ReportTarget;
  targetId: string;
  comparisonId: string | null;
  targetLabel: string;
  targetAuthorHandle: string;
  targetAuthorId: string | null;
  targetHidden: boolean;
  reporterHandle: string | null;
  reason: string;
  reasonLabel: string;
  detail: string | null;
  status: ReportStatus;
  createdAt: string;
  resolvedByHandle: string | null;
  resolvedAt: string | null;
  resolution: string | null;
};

type SuspendedUser = {
  id: string;
  handle: string;
  suspendedAt: string;
  suspensionReason: string;
  suspendedByHandle: string | null;
};

type PublishedComparison = {
  id: string;
  title: string;
  authorHandle: string;
  publishedAt: string | null;
};

type Overview = {
  models: AdminModel[];
  publishedComparisons: PublishedComparison[];
  hiddenComparisons: HiddenComparison[];
  reports: Report[];
  suspendedUsers: SuspendedUser[];
  recentActions: AdminActionView[];
};

type Props = {
  handle: string;
  overview: Overview;
};

const ACTION_LABELS: Record<AdminActionKind, string> = {
  'model.enabled': 'Enabled model',
  'model.disabled': 'Disabled model',
  'comparison.takedown': 'Took down comparison',
  'comparison.restored': 'Restored comparison',
  'comment.hidden': 'Hid comment',
  'comment.restored': 'Restored comment',
  'annotation.hidden': 'Hid annotation',
  'annotation.restored': 'Restored annotation',
  'user.suspended': 'Suspended member',
  'user.reinstated': 'Reinstated member',
  'report.resolved': 'Resolved report',
  'report.dismissed': 'Dismissed report',
};

const REPORT_TABS: Array<{ value: ReportStatus; label: string }> = [
  { value: 'open', label: 'Open' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'dismissed', label: 'Dismissed' },
];

function targetHref(report: Report) {
  if (!report.comparisonId) return null;
  if (report.targetType === 'comparison') return `/comparisons/${report.comparisonId}`;
  if (report.targetType === 'comment') {
    return `/comparisons/${report.comparisonId}#comment-${report.targetId}`;
  }
  return `/comparisons/${report.comparisonId}?annotations=1#annotation-${report.targetId}`;
}

function formatUtc(value: string | null) {
  if (!value) return '—';
  return `${value.slice(0, 16).replace('T', ' ')} UTC`;
}

async function failure(response: Response) {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body.error?.message ?? `Request failed with ${response.status}.`;
  } catch {
    return `Request failed with ${response.status}.`;
  }
}

export function AdminClient({ handle, overview: initialOverview }: Props) {
  const [overview, setOverview] = useState(initialOverview);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ id: string; title: string } | null>(null);
  const [reason, setReason] = useState('');
  const [reportTab, setReportTab] = useState<ReportStatus>('open');
  const [reportAction, setReportAction] = useState<{
    id: string;
    mode: 'hide' | 'suspend';
    reason: string;
  } | null>(null);

  const load = useCallback(async () => {
    const response = await fetch('/api/admin/overview');
    if (!response.ok) throw new Error(await failure(response));
    const next = (await response.json()) as { overview: Overview };
    setOverview(next.overview);
  }, []);

  const run = useCallback(
    async (key: string, action: () => Promise<Response>) => {
      setBusy(key);
      setError(null);
      try {
        const response = await action();
        if (!response.ok) throw new Error(await failure(response));
        await load();
        return true;
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'That action failed.');
        return false;
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  const toggleModel = (model: AdminModel) =>
    void run(`model:${model.id}`, () =>
      fetch(`/api/admin/models/${model.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: !model.enabled }),
      }),
    );

  const takedown = (comparison: { id: string; title: string }) => {
    if (!reason.trim()) {
      setError('Say why this comparison is being hidden.');
      return;
    }
    void run(`takedown:${comparison.id}`, () =>
      fetch(`/api/admin/comparisons/${comparison.id}/takedown`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      }),
    ).then((ok) => {
      if (ok) {
        setConfirming(null);
        setReason('');
      }
    });
  };

  const restore = (comparison: HiddenComparison) =>
    void run(`restore:${comparison.id}`, () =>
      fetch(`/api/admin/comparisons/${comparison.id}/restore`, { method: 'POST' }),
    );

  const hideReported = (report: Report) => {
    const reasonText = reportAction?.id === report.id ? reportAction.reason.trim() : '';
    if (!reasonText) {
      setError('Say why the reported content is being hidden.');
      return;
    }
    void run(`hide:${report.id}`, () =>
      fetch(`/api/admin/reports/${report.id}/hide`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: reasonText }),
      }),
    ).then((ok) => {
      if (ok) setReportAction(null);
    });
  };

  const dismiss = (report: Report) =>
    void run(`dismiss:${report.id}`, () =>
      fetch(`/api/admin/reports/${report.id}/dismiss`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ note: null }),
      }),
    );

  const restoreReported = (report: Report) =>
    void run(`restore-report:${report.id}`, () =>
      report.targetType === 'comparison'
        ? fetch(`/api/admin/comparisons/${report.targetId}/restore`, { method: 'POST' })
        : fetch('/api/admin/moderation/restore', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              targetType: report.targetType,
              targetId: report.targetId,
            }),
          }),
    );

  const suspend = (report: Report) => {
    if (!report.targetAuthorId) return;
    const reasonText = reportAction?.id === report.id ? reportAction.reason.trim() : '';
    if (!reasonText) {
      setError('Say why this member is being suspended.');
      return;
    }
    void run(`suspend:${report.targetAuthorId}`, () =>
      fetch(`/api/admin/users/${report.targetAuthorId}/suspend`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: reasonText }),
      }),
    ).then((ok) => {
      if (ok) setReportAction(null);
    });
  };

  const reinstate = (user: SuspendedUser) =>
    void run(`reinstate:${user.id}`, () =>
      fetch(`/api/admin/users/${user.id}/reinstate`, { method: 'POST' }),
    );

  const visibleReports = overview.reports.filter((report) => report.status === reportTab);
  const reportCounts = {
    open: overview.reports.filter((report) => report.status === 'open').length,
    resolved: overview.reports.filter((report) => report.status === 'resolved').length,
    dismissed: overview.reports.filter((report) => report.status === 'dismissed').length,
  };

  const needle = query.trim().toLowerCase();
  const visiblePublished = needle
    ? overview.publishedComparisons.filter(
        (comparison) =>
          comparison.title.toLowerCase().includes(needle) ||
          comparison.authorHandle.toLowerCase().includes(needle),
      )
    : overview.publishedComparisons;

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader handle={handle} signedIn variant="page" />

      <main className="mx-auto flex w-full max-w-[1180px] flex-col gap-8 px-5 pb-16 pt-6">
        <div className="flex flex-col gap-1.5">
          <h1 className="m-0 flex items-center gap-2 font-heading text-[20px] font-medium leading-[1.2]">
            <Eye size={18} />
            Admin
          </h1>
          <p className="m-0 max-w-[640px] text-[12px] leading-[1.55] text-neutral-400">
            Review reports, hide or restore reported content, suspend members, and enable or
            disable Models in the registry. Every action is recorded against your handle.
          </p>
        </div>

        {error && (
          <p
            role="alert"
            className="m-0 flex items-start gap-2 rounded-[2px] border border-danger px-3 py-2 text-[11px] text-danger"
          >
            <WarningCircle size={14} className="mt-px shrink-0" />
            {error}
          </p>
        )}

        <section className="flex flex-col gap-3" aria-labelledby="admin-reports">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="admin-reports" className="m-0 font-heading text-[14px] font-medium">
              Reports
            </h2>
            <p className="m-0 max-w-[520px] text-[11px] leading-[1.5] text-neutral-500">
              Hiding content settles every open report on that target. Suspension stops
              new writes but leaves existing content public until it is hidden here.
            </p>
          </div>

          <div
            role="tablist"
            aria-label="Report status"
            onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
              event.preventDefault();
              const index = REPORT_TABS.findIndex((tab) => tab.value === reportTab);
              const step = event.key === 'ArrowRight' ? 1 : -1;
              const next =
                REPORT_TABS[(index + step + REPORT_TABS.length) % REPORT_TABS.length];
              setReportTab(next.value);
              setReportAction(null);
              requestAnimationFrame(() =>
                document.getElementById(`report-tab-${next.value}`)?.focus(),
              );
            }}
            className="flex w-fit gap-[2px] rounded-[2px] bg-surface p-[2px]"
          >
            {REPORT_TABS.map((tab) => (
              <button
                key={tab.value}
                id={`report-tab-${tab.value}`}
                type="button"
                role="tab"
                aria-selected={reportTab === tab.value}
                tabIndex={reportTab === tab.value ? 0 : -1}
                onClick={() => {
                  setReportTab(tab.value);
                  setReportAction(null);
                }}
                className={`flex h-7 items-center gap-1.5 rounded-[2px] px-2.5 text-[11px] font-medium ${
                  reportTab === tab.value
                    ? 'bg-neutral-700 text-text'
                    : 'text-neutral-400 hover:text-text'
                }`}
              >
                <Flag size={12} />
                {tab.label}
                <span className="min-w-[16px] rounded-[2px] bg-neutral-800 px-1 text-center text-[10.5px] text-neutral-300">
                  {reportCounts[tab.value]}
                </span>
              </button>
            ))}
          </div>

          <ul className="m-0 flex list-none flex-col gap-px overflow-hidden rounded-[2px] border border-neutral-800 bg-neutral-800 p-0">
            {visibleReports.length === 0 && (
              <li className="bg-surface px-3 py-4 text-[11px] text-neutral-500">
                {reportTab === 'open'
                  ? 'No open reports. Readers can report a Comparison, comment or Annotation.'
                  : `No ${reportTab} reports.`}
              </li>
            )}
            {visibleReports.map((report) => {
              const open = report.status === 'open';
              const panel = reportAction?.id === report.id ? reportAction : null;
              const href = targetHref(report);
              const targetNoun = report.targetType;
              return (
                <li
                  key={report.id}
                  data-report={report.id}
                  data-report-status={report.status}
                  className="bg-surface px-3 py-2.5"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-[2px] bg-neutral-800 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-neutral-300">
                      {report.targetType}
                    </span>
                    {href ? (
                      <Link
                        href={href}
                        className="min-w-0 max-w-[420px] truncate text-[12px] font-medium text-neutral-100 hover:text-accent-200"
                      >
                        {report.targetLabel || 'Deleted content'}
                      </Link>
                    ) : (
                      <span className="text-[12px] text-neutral-400">Deleted content</span>
                    )}
                    <span className="text-[11px] text-neutral-500">
                      @{report.targetAuthorHandle} · reported by @
                      {report.reporterHandle ?? 'unknown'} · {formatUtc(report.createdAt)}
                    </span>
                    <div className="ml-auto flex flex-wrap items-center gap-1.5">
                      {open && (
                        <>
                          <button
                            type="button"
                            id={`report-hide-${report.id}`}
                            onClick={() =>
                              setReportAction({
                                id: report.id,
                                mode: 'hide',
                                reason: report.detail ?? '',
                              })
                            }
                            aria-expanded={panel?.mode === 'hide'}
                            aria-controls={`report-panel-${report.id}`}
                            className="btn-secondary h-7"
                          >
                            <EyeSlash size={12} />
                            Hide {targetNoun}
                          </button>
                          <button
                            type="button"
                            onClick={() => dismiss(report)}
                            disabled={busy !== null}
                            className="btn-ghost h-7"
                          >
                            {busy === `dismiss:${report.id}` ? (
                              <CircleNotch size={12} className="anim-spin" />
                            ) : null}
                            Dismiss
                          </button>
                          {report.targetAuthorId && (
                            <button
                              type="button"
                              id={`report-suspend-${report.id}`}
                              data-suspend-trigger
                              onClick={() =>
                                setReportAction({
                                  id: report.id,
                                  mode: 'suspend',
                                  reason: '',
                                })
                              }
                              aria-expanded={panel?.mode === 'suspend'}
                              aria-controls={`report-panel-${report.id}`}
                              className="btn-secondary h-7"
                            >
                              <UserMinus size={12} />
                              Suspend @{report.targetAuthorHandle}
                            </button>
                          )}
                        </>
                      )}
                      {report.targetHidden && (
                        <button
                          type="button"
                          data-restore-trigger
                          onClick={() => restoreReported(report)}
                          disabled={busy !== null}
                          className="btn-secondary h-7"
                        >
                          {busy === `restore-report:${report.id}` ? (
                            <CircleNotch size={12} className="anim-spin" />
                          ) : (
                            <ArrowCounterClockwise size={12} />
                          )}
                          Restore {targetNoun}
                        </button>
                      )}
                    </div>
                  </div>

                  <p className="m-0 mt-1 text-[11.5px] leading-[1.5] text-neutral-300">
                    <span className="text-neutral-500">Reason: </span>
                    {report.reasonLabel}
                    {report.detail ? ` — ${report.detail}` : ''}
                  </p>

                  {report.status !== 'open' && (
                    <p className="m-0 mt-0.5 text-[11px] text-neutral-500">
                      {report.status === 'resolved' ? 'Resolved' : 'Dismissed'} by @
                      {report.resolvedByHandle ?? 'unknown'} · {formatUtc(report.resolvedAt)}
                      {report.resolution ? ` · ${report.resolution}` : ''}
                    </p>
                  )}

                  {panel && (
                    <div
                      id={`report-panel-${report.id}`}
                      onKeyDown={(event) => {
                        if (event.key !== 'Escape') return;
                        event.preventDefault();
                        const trigger = document.getElementById(
                          `report-${panel.mode}-${report.id}`,
                        );
                        setReportAction(null);
                        requestAnimationFrame(() => trigger?.focus());
                      }}
                      className="mt-2 flex flex-col gap-2 border-l-2 border-neutral-700 pl-3"
                    >
                      <label
                        htmlFor={`report-reason-${report.id}`}
                        className="text-[11px] text-neutral-400"
                      >
                        {panel.mode === 'hide'
                          ? 'Why is this content being hidden? This is recorded against your handle.'
                          : `Why is @${report.targetAuthorHandle} being suspended? This is recorded against your handle.`}
                      </label>
                      <textarea
                        id={`report-reason-${report.id}`}
                        autoFocus
                        value={panel.reason}
                        onChange={(event) =>
                          setReportAction((current) =>
                            current ? { ...current, reason: event.target.value } : current,
                          )
                        }
                        maxLength={500}
                        rows={2}
                        className="w-full rounded-[2px] border border-neutral-700 bg-bg px-2 py-1.5 text-[12px] text-text focus:border-accent"
                      />
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          data-confirm-moderation
                          onClick={() =>
                            panel.mode === 'hide' ? hideReported(report) : suspend(report)
                          }
                          disabled={busy !== null}
                          className="btn-primary h-7"
                        >
                          {busy === `hide:${report.id}` ||
                          busy === `suspend:${report.targetAuthorId}` ? (
                            <CircleNotch size={12} className="anim-spin" />
                          ) : panel.mode === 'hide' ? (
                            <EyeSlash size={12} />
                          ) : (
                            <UserMinus size={12} />
                          )}
                          {panel.mode === 'hide' ? 'Confirm hide' : 'Confirm suspension'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setReportAction(null)}
                          className="btn-ghost h-7"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <section className="flex flex-col gap-3" aria-labelledby="admin-suspended">
          <h2 id="admin-suspended" className="m-0 font-heading text-[14px] font-medium">
            Suspended members
          </h2>
          <ul className="m-0 flex list-none flex-col gap-px overflow-hidden rounded-[2px] border border-neutral-800 bg-neutral-800 p-0">
            {overview.suspendedUsers.length === 0 && (
              <li className="bg-surface px-3 py-4 text-[11px] text-neutral-500">
                No one is suspended. Suspended members can read but cannot post, annotate,
                vote or report.
              </li>
            )}
            {overview.suspendedUsers.map((user) => (
              <li
                key={user.id}
                data-suspended-user={user.handle}
                className="bg-surface px-3 py-2.5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12px] font-medium text-neutral-100">
                    @{user.handle}
                  </span>
                  <span className="text-[11px] text-neutral-500">
                    suspended {formatUtc(user.suspendedAt)}
                    {user.suspendedByHandle ? ` by @${user.suspendedByHandle}` : ''}
                  </span>
                  <div className="ml-auto">
                    <button
                      type="button"
                      data-reinstate-trigger
                      onClick={() => reinstate(user)}
                      disabled={busy !== null}
                      className="btn-secondary h-7"
                    >
                      {busy === `reinstate:${user.id}` ? (
                        <CircleNotch size={12} className="anim-spin" />
                      ) : (
                        <UserCheck size={12} />
                      )}
                      Reinstate
                    </button>
                  </div>
                </div>
                <p className="m-0 mt-1 border-l-2 border-danger pl-2 text-[11px] leading-[1.5] text-neutral-400">
                  {user.suspensionReason}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-3" aria-labelledby="admin-models">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="admin-models" className="m-0 font-heading text-[14px] font-medium">
              Model registry
            </h2>
            <p className="m-0 text-[11px] text-neutral-500">
              Disabled Models leave every picker and cannot answer new turns.
              Existing Responses stay readable.
            </p>
          </div>
          <div
            role="region"
            aria-label="Model registry table"
            tabIndex={0}
            className="overflow-x-auto rounded-[2px] border border-neutral-800"
          >
            <table className="w-full min-w-[720px] border-collapse text-left text-[12px]">
              <thead className="bg-surface text-[10.5px] uppercase tracking-[0.08em] text-neutral-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Model</th>
                  <th className="px-3 py-2 font-medium">Provider</th>
                  <th className="px-3 py-2 font-medium">Responses</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {overview.models.map((model) => (
                  <tr key={model.id} className="border-t border-neutral-800">
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-2">
                        <span className="grid h-5 w-7 place-items-center rounded-[2px] bg-neutral-800 text-[10.5px] font-semibold text-neutral-200">
                          {model.monogram}
                        </span>
                        <span className="text-neutral-100">{model.displayName}</span>
                        <span className="text-[10.5px] text-neutral-500">{model.slug}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2 text-neutral-400">{model.provider}</td>
                    <td className="px-3 py-2 text-neutral-400">{model.responseCount}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex items-center gap-1 rounded-[2px] px-1.5 py-0.5 text-[10.5px] font-medium ${
                          model.enabled
                            ? 'bg-accent-900 text-accent-200'
                            : 'bg-neutral-800 text-neutral-400'
                        }`}
                      >
                        {model.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => void toggleModel(model)}
                        disabled={busy !== null}
                        aria-label={`${model.enabled ? 'Disable' : 'Enable'} ${model.displayName}`}
                        className="btn-secondary h-7"
                      >
                        {busy === `model:${model.id}` ? (
                          <CircleNotch size={12} className="anim-spin" />
                        ) : model.enabled ? (
                          <EyeSlash size={12} />
                        ) : (
                          <CheckCircle size={12} />
                        )}
                        {model.enabled ? 'Disable' : 'Enable'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="flex flex-col gap-3" aria-labelledby="admin-published">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h2 id="admin-published" className="m-0 font-heading text-[14px] font-medium">
              Published Comparisons
            </h2>
            <label className="flex h-8 w-full max-w-[320px] items-center gap-2 rounded-[2px] border border-neutral-700 bg-surface px-2.5 focus-within:border-accent">
              <MagnifyingGlass size={13} className="text-neutral-500" />
              <span className="sr-only">Find a published comparison</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Find by title or @handle"
                className="h-full w-full bg-transparent text-[12px] text-text"
              />
            </label>
          </div>
          <ul className="m-0 flex list-none flex-col gap-px overflow-hidden rounded-[2px] border border-neutral-800 bg-neutral-800 p-0">
            {visiblePublished.length === 0 && (
              <li className="bg-surface px-3 py-4 text-[11px] text-neutral-500">
                No published comparison matches that search.
              </li>
            )}
            {visiblePublished.map((comparison) => {
              const open = confirming?.id === comparison.id;
              return (
                <li key={comparison.id} className="bg-surface px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/comparisons/${comparison.id}`}
                      className="min-w-0 flex-1 truncate text-[12px] font-medium text-neutral-100 hover:text-accent-200"
                    >
                      {comparison.title}
                    </Link>
                    <span className="text-[11px] text-neutral-500">
                      @{comparison.authorHandle} · {formatUtc(comparison.publishedAt)}
                    </span>
                    <Link
                      href={`/comparisons/${comparison.id}`}
                      aria-label={`Open ${comparison.title}`}
                      className="btn-ghost h-7"
                    >
                      <ArrowSquareOut size={12} />
                      Open
                    </Link>
                    <button
                      type="button"
                      id={`takedown-trigger-${comparison.id}`}
                      onClick={() => {
                        setConfirming(open ? null : comparison);
                        setReason('');
                        setError(null);
                      }}
                      aria-expanded={open}
                      aria-controls={`takedown-panel-${comparison.id}`}
                      aria-label={`Take down ${comparison.title}`}
                      className="btn-secondary h-7"
                    >
                      <EyeSlash size={12} />
                      Take down
                    </button>
                  </div>
                  {open && (
                    <div
                      id={`takedown-panel-${comparison.id}`}
                      onKeyDown={(event) => {
                        if (event.key !== 'Escape') return;
                        event.preventDefault();
                        const trigger = document.getElementById(
                          `takedown-trigger-${comparison.id}`,
                        );
                        setConfirming(null);
                        setReason('');
                        requestAnimationFrame(() => trigger?.focus());
                      }}
                      className="mt-2 flex flex-col gap-2 border-l-2 border-neutral-700 pl-3"
                    >
                      <label
                        htmlFor={`takedown-reason-${comparison.id}`}
                        className="text-[11px] text-neutral-400"
                      >
                        Why is this being hidden? This is shown in the admin record.
                      </label>
                      <textarea
                        id={`takedown-reason-${comparison.id}`}
                        autoFocus
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                        maxLength={500}
                        rows={2}
                        className="w-full rounded-[2px] border border-neutral-700 bg-bg px-2 py-1.5 text-[12px] text-text focus:border-accent"
                      />
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => takedown(comparison)}
                          disabled={busy !== null}
                          className="btn-primary h-7"
                        >
                          {busy === `takedown:${comparison.id}` ? (
                            <CircleNotch size={12} className="anim-spin" />
                          ) : (
                            <EyeSlash size={12} />
                          )}
                          Confirm takedown
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setConfirming(null);
                            setReason('');
                          }}
                          className="btn-ghost h-7"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <section className="flex flex-col gap-3" aria-labelledby="admin-hidden">
          <h2 id="admin-hidden" className="m-0 font-heading text-[14px] font-medium">
            Hidden Comparisons
          </h2>
          <ul className="m-0 flex list-none flex-col gap-px overflow-hidden rounded-[2px] border border-neutral-800 bg-neutral-800 p-0">
            {overview.hiddenComparisons.length === 0 && (
              <li className="bg-surface px-3 py-4 text-[11px] text-neutral-500">
                Nothing is hidden. Taken-down Comparisons appear here with their reason and
                actor.
              </li>
            )}
            {overview.hiddenComparisons.map((comparison) => (
              <li key={comparison.id} className="bg-surface px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/comparisons/${comparison.id}`}
                    className="min-w-0 flex-1 truncate text-[12px] font-medium text-neutral-100 hover:text-accent-200"
                  >
                    {comparison.title}
                  </Link>
                  <span className="text-[11px] text-neutral-500">
                    @{comparison.authorHandle} · hidden {formatUtc(comparison.takedownAt)}
                    {comparison.takedownByHandle
                      ? ` by @${comparison.takedownByHandle}`
                      : ''}
                  </span>
                  <button
                    type="button"
                    onClick={() => void restore(comparison)}
                    disabled={busy !== null}
                    aria-label={`Restore ${comparison.title}`}
                    className="btn-secondary h-7"
                  >
                    {busy === `restore:${comparison.id}` ? (
                      <CircleNotch size={12} className="anim-spin" />
                    ) : (
                      <CheckCircle size={12} />
                    )}
                    Restore
                  </button>
                </div>
                <p className="m-0 mt-1 border-l-2 border-danger pl-2 text-[11px] leading-[1.5] text-neutral-400">
                  {comparison.takedownReason}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-3" aria-labelledby="admin-actions">
          <h2 id="admin-actions" className="m-0 font-heading text-[14px] font-medium">
            Recent admin actions
          </h2>
          <div
            role="region"
            aria-label="Admin action log"
            tabIndex={0}
            className="overflow-x-auto rounded-[2px] border border-neutral-800"
          >
            <table className="w-full min-w-[720px] border-collapse text-left text-[12px]">
              <thead className="bg-surface text-[10.5px] uppercase tracking-[0.08em] text-neutral-500">
                <tr>
                  <th className="px-3 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">Actor</th>
                  <th className="px-3 py-2 font-medium">Action</th>
                  <th className="px-3 py-2 font-medium">Target</th>
                  <th className="px-3 py-2 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody>
                {overview.recentActions.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-4 text-[11px] text-neutral-500">
                      No admin actions yet.
                    </td>
                  </tr>
                )}
                {overview.recentActions.map((action) => (
                  <tr key={action.id} className="border-t border-neutral-800">
                    <td className="whitespace-nowrap px-3 py-2 text-neutral-500">
                      {formatUtc(action.createdAt)}
                    </td>
                    <td className="px-3 py-2 text-neutral-300">
                      {action.actorHandle ? `@${action.actorHandle}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-neutral-300">
                      {ACTION_LABELS[action.action]}
                    </td>
                    <td className="px-3 py-2 text-neutral-200">{action.targetLabel}</td>
                    <td className="px-3 py-2 text-neutral-500">{action.reason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
