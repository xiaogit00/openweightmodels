'use client';

import Link from 'next/link';
import {
  Check,
  Highlighter,
  LinkSimple,
  WarningCircle,
} from '@phosphor-icons/react';
import type {
  AnnotationKind,
  AnnotationView,
  PublicUser,
} from '@owm/core/client';
import { EFFORT_LEVELS, formatHandle, relativeTimeAgo } from '@owm/core/client';
import { Avatar } from '../avatar';
import { ReportControl } from '../report-control';
import { Chip } from '../ui/chip';
import { EffortGlyph } from '../ui/effort-glyph';
import { SegmentedControl } from '../ui/segmented-control';
import { KIND_FILTERS } from './kinds';
import type { ComparisonPageData } from './types';

type Props = {
  comparison: ComparisonPageData['comparison'];
  author: PublicUser;
  annotations: AnnotationView[];
  annOn: boolean;
  kind: 'All' | AnnotationKind;
  canWrite: boolean;
  viewerSignedIn: boolean;
  viewerSuspended: boolean;
  isAuthor: boolean;
  signInHref: string;
  copied: boolean;
  hasSelection: boolean;
  onToggleAnnotations: () => void;
  onKindChange: (kind: 'All' | AnnotationKind) => void;
  onCopyLink: () => void;
  onAnnotateSelection: (trigger: HTMLElement) => void;
};

/**
 * The Comparison head: meta, title and actions, plus the annotation toolbar
 * that appears when annotations are on. The Prompt lives in each response
 * column now, so there is no disclosure here.
 */
export function ComparisonHead({
  comparison,
  author,
  annotations,
  annOn,
  kind,
  canWrite,
  viewerSignedIn,
  viewerSuspended,
  isAuthor,
  signInHref,
  copied,
  hasSelection,
  onToggleAnnotations,
  onKindChange,
  onCopyLink,
  onAnnotateSelection,
}: Props) {
  const kindCount = (value: 'All' | AnnotationKind) =>
    value === 'All'
      ? annotations.length
      : annotations.filter((annotation) => annotation.kind === value).length;

  return (
    <div className="flex flex-col gap-5">
      {viewerSuspended && (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-lg border border-danger bg-danger-surface px-3.5 py-3 text-[13px] leading-[1.5] text-neutral-200"
        >
          <WarningCircle size={16} className="mt-px shrink-0 text-danger" aria-hidden />
          <span>
            <span className="font-medium text-danger">Your account is suspended.</span>{' '}
            You can keep reading, but posting, annotating, voting and reporting are
            disabled. Contact an Admin if you think this is a mistake.
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
        <div className="flex min-w-0 flex-1 basis-[480px] flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-neutral-400">
            {comparison.categories.map((category) => (
              <Chip key={category} className="h-[22px] px-[9px] text-[12.5px]">
                {category}
              </Chip>
            ))}
            <span className="flex items-center gap-2">
              <EffortGlyph effort={comparison.effort} />
              {EFFORT_LEVELS[comparison.effort - 1]?.label ?? 'Med'} effort
            </span>
            <span aria-hidden>·</span>
            <Avatar handle={author.handle} size={18} />
            <span className="text-neutral-200">{formatHandle(author.handle)}</span>
            <span>·</span>
            <span data-relative-time>
              {relativeTimeAgo(comparison.publishedAt ?? comparison.createdAt)}
            </span>
          </div>

          <h1 className="m-0 max-w-[900px] break-words font-heading text-[30px] font-medium leading-[1.15] tracking-[-0.02em] [text-wrap:pretty]">
            {comparison.title}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-pressed={annOn}
            onClick={onToggleAnnotations}
            className={
              annOn
                ? 'btn-secondary h-8 border-accent bg-accent-900 px-3 text-accent-200'
                : 'btn-secondary h-8 px-3'
            }
          >
            <Highlighter size={14} aria-hidden />
            Annotations
            <span className="min-w-5 rounded-[var(--r)] bg-neutral-800 px-1.5 text-center text-[11px] font-medium leading-[18px] text-neutral-200">
              {annotations.length}
            </span>
          </button>

          {!isAuthor && !viewerSuspended && (
            <span className="contents [&_a]:rounded-[var(--r)] [&_a]:text-[13px] [&_a]:font-medium [&_button]:rounded-[var(--r)] [&_button]:text-[13px] [&_button]:font-medium max-[800px]:[&_a]:w-8 max-[800px]:[&_a]:justify-center max-[800px]:[&_a]:gap-0 max-[800px]:[&_a]:px-0 max-[800px]:[&_a]:text-[0px] max-[800px]:[&_button]:w-8 max-[800px]:[&_button]:justify-center max-[800px]:[&_button]:gap-0 max-[800px]:[&_button]:px-0 max-[800px]:[&_button]:text-[0px]">
              <ReportControl
                targetType="comparison"
                targetId={comparison.id}
                signedIn={viewerSignedIn}
                signInHref={signInHref}
                className="btn-ghost h-8 px-2.5"
              />
            </span>
          )}

          <button type="button" onClick={onCopyLink} className="btn-ghost h-8">
            {copied ? <Check size={14} aria-hidden /> : <LinkSimple size={14} aria-hidden />}
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>
      </div>

      {annOn && (
        <div className="-mt-1 flex flex-wrap items-center gap-3">
          <SegmentedControl
            label="Filter annotations by kind"
            className="max-w-full flex-wrap"
            value={kind}
            options={KIND_FILTERS.map((filter) => ({
              value: filter.value,
              label: (
                <>
                  {filter.label}
                  <span className="text-[11px] font-normal text-neutral-400">
                    {kindCount(filter.value)}
                  </span>
                </>
              ),
              icon: <filter.Icon size={13} aria-hidden />,
            }))}
            onChange={onKindChange}
          />
          {canWrite ? (
            <span className="text-[13px] text-neutral-400">
              Select any text in a response to annotate it
            </span>
          ) : viewerSuspended ? (
            <span className="text-[13px] text-neutral-400">
              Annotations are read-only while your account is suspended.
            </span>
          ) : (
            <Link href={signInHref} className="text-[13px] font-medium">
              Sign in to annotate
            </Link>
          )}
          {selectionButton()}
        </div>
      )}
    </div>
  );

  function selectionButton() {
    if (!hasSelection || !canWrite) return null;
    return (
      <button
        type="button"
        onClick={(event) => onAnnotateSelection(event.currentTarget)}
        className="btn-secondary h-8"
      >
        <Highlighter size={14} aria-hidden />
        Annotate selection
      </button>
    );
  }
}
