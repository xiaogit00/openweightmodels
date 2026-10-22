'use client';

import Link from 'next/link';
import * as Popover from '@radix-ui/react-popover';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowBendUpLeft,
  ArrowFatUp,
  Bug,
  CaretDown,
  CaretRight,
  Check,
  CircleNotch,
  DotsThree,
  Ghost,
  Highlighter,
  LinkSimple,
  PaperPlaneRight,
  PencilSimple,
  Plus,
  Question,
  Stack,
  ThumbsUp,
  Trash,
  WarningCircle,
  X,
} from '@phosphor-icons/react';
import type {
  AnnotationKind,
  AnnotationView,
  CommentView,
  PublicUser,
  ResponseStatus,
} from '@owm/core/client';
import {
  ANNOTATION_KIND_META,
  ANNOTATION_KINDS,
  EFFORT_LEVELS,
  formatHandle,
  isPendingResponse,
  relativeTime,
  relativeTimeAgo,
} from '@owm/core/client';
import { Avatar } from './avatar';
import { ReportControl } from './report-control';
import { SiteHeader } from './site-header';
import { MarkdownView } from './markdown-view';
import { cn } from '@/lib/utils';
import { signInPath } from '@/lib/next-path';
import {
  countLiveComments,
  editCommentInTree,
} from '@/lib/discussion';
import type { ComparisonResponseView } from '@/lib/comparison-responses';
import {
  isResponseStatus,
  responseErrorMessage,
  type JobStreamEvent,
} from '@/lib/run-events';

export type { ComparisonResponseView } from '@/lib/comparison-responses';

export type ComparisonPageData = {
  comparison: {
    id: string;
    title: string;
    prompt: string;
    categories: string[];
    effort: number;
    status: string;
    createdAt: string;
    publishedAt: string | null;
    authorId: string;
  };
  author: PublicUser;
  baseModel: { slug: string; name: string; monogram: string };
  responses: ComparisonResponseView[];
  annotations: AnnotationView[];
  comments: CommentView[];
  models: Array<{
    id: string;
    slug: string;
    name: string;
    monogram: string;
    etaSeconds: number;
  }>;
  maxChallengers: number;
  currentUserId: string | null;
  viewerSignedIn: boolean;
  viewerSuspended: boolean;
  initialModel: string | null;
  initialAnnOn: boolean;
  handle: string | null;
};

const KIND_ICONS: Record<AnnotationKind, typeof Bug> = {
  bug: Bug,
  hallucination: Ghost,
  good: ThumbsUp,
  question: Question,
};

const KIND_FILTERS: Array<{ value: 'All' | AnnotationKind; label: string; Icon: typeof Bug }> = [
  { value: 'All', label: 'All', Icon: Stack },
  ...ANNOTATION_KINDS.map((kind) => ({
    value: kind,
    label: ANNOTATION_KIND_META[kind].label,
    Icon: KIND_ICONS[kind],
  })),
];

type Popover =
  | { mode: 'thread'; id: string; x: number; y: number }
  | {
      mode: 'new';
      responseId: string;
      startOffset: number;
      endOffset: number;
      quote: string;
      x: number;
      y: number;
    };

type Selection = {
  responseId: string;
  startOffset: number;
  endOffset: number;
  quote: string;
  x: number;
  y: number;
};

function EffortMeter({ effort }: { effort: number }) {
  return (
    <span className="flex h-[10px] items-end gap-[2px]" title="Effort">
      <span className="h-[5px] w-[3px] rounded-[1px] bg-accent" />
      <span
        className={cn('h-[7px] w-[3px] rounded-[1px]', effort >= 2 ? 'bg-accent' : 'bg-neutral-700')}
      />
      <span
        className={cn('h-[10px] w-[3px] rounded-[1px]', effort >= 3 ? 'bg-accent' : 'bg-neutral-700')}
      />
    </span>
  );
}

function ErrorLine({ message }: { message: string }) {
  return (
    <span className="flex items-center gap-1 text-[11px] text-danger">
      <X size={11} />
      {message}
    </span>
  );
}

const actionItem =
  'flex h-7 items-center gap-1.5 rounded-[2px] px-2 text-left text-[11.5px] font-medium text-neutral-200 transition-colors hover:bg-neutral-700 disabled:opacity-45';

const deleteButton =
  'h-7 flex-1 rounded-[2px] border border-danger px-2 text-[11px] font-medium text-danger transition-colors hover:bg-danger/10 disabled:opacity-45';

function InlineEditor({
  label,
  value,
  onChange,
  onSave,
  onCancel,
  busy,
  error,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
  error: string | null;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <textarea
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={5000}
        rows={3}
        autoFocus
        className="resize-y rounded-[2px] border border-neutral-700 bg-bg p-2 text-[12.5px] leading-[1.5] text-text outline-0 focus:border-accent"
      />
      {error && <ErrorLine message={error} />}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={busy || !value.trim()}
          onClick={onSave}
          className="btn-secondary h-7 disabled:opacity-45"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="btn-neutral h-7"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * One kebab menu for owner-only content. Delete asks for confirmation in the
 * menu, then closes itself when the API accepts the change.
 */
function ActionsMenu({
  label,
  noun,
  onEdit,
  onDelete,
}: {
  label: string;
  noun: string;
  onEdit: () => void;
  onDelete: () => Promise<string | null>;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setOpen(false);
    setConfirming(false);
    setError(null);
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const message = await onDelete();
    setBusy(false);
    if (message) {
      setError(message);
      return;
    }
    close();
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(value) => {
        if (value) {
          setOpen(true);
          setError(null);
        } else {
          close();
        }
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          data-actions-trigger
          className="grid h-6 w-6 place-items-center rounded-[2px] text-neutral-500 transition-colors hover:bg-neutral-700 hover:text-text"
        >
          <DotsThree size={16} weight="bold" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={4}
          data-popover
          data-actions-menu
          aria-label={`${noun} actions`}
          className="z-50 flex w-[180px] flex-col gap-[2px] rounded-[2px] border border-neutral-700 bg-neutral-800 p-1.5 shadow-lg"
        >
          {confirming ? (
            <>
              <span className="px-1 pb-1 text-[11px] leading-[1.4] text-neutral-300">
                Delete this {noun}?
              </span>
              {error && (
                <span className="px-1 pb-1 text-[11px] text-danger" role="alert">
                  {error}
                </span>
              )}
              <div className="flex gap-1.5">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void confirm()}
                  className={deleteButton}
                >
                  {busy ? 'Deleting…' : 'Delete'}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setConfirming(false);
                    setError(null);
                  }}
                  className="btn-neutral h-7 flex-1"
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  close();
                  onEdit();
                }}
                className={actionItem}
              >
                <PencilSimple size={13} />
                Edit
              </button>
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className={actionItem}
              >
                <Trash size={13} />
                Delete
              </button>
            </>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** The Annotation owner can retag it or delete the highlight and whole thread. */
function AnnotationActions({
  annotation,
  onChangeKind,
  onDelete,
}: {
  annotation: AnnotationView;
  onChangeKind: (annotation: AnnotationView, kind: AnnotationKind) => Promise<string | null>;
  onDelete: () => Promise<string | null>;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setOpen(false);
    setConfirming(false);
    setError(null);
  };

  const choose = async (kind: AnnotationKind) => {
    setBusy(true);
    setError(null);
    const message = await onChangeKind(annotation, kind);
    setBusy(false);
    if (message) setError(message);
    else close();
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const message = await onDelete();
    setBusy(false);
    if (message) setError(message);
    else close();
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(value) => {
        if (value) {
          setOpen(true);
          setError(null);
        } else {
          close();
        }
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="Annotation actions"
          data-actions-trigger
          className="grid h-6 w-6 place-items-center rounded-[2px] text-neutral-500 transition-colors hover:bg-neutral-700 hover:text-text"
        >
          <DotsThree size={16} weight="bold" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={4}
          data-popover
          data-actions-menu
          aria-label="Annotation actions"
          className="z-50 flex w-[220px] flex-col gap-[2px] rounded-[2px] border border-neutral-700 bg-neutral-800 p-1.5 shadow-lg"
        >
          {confirming ? (
            <>
              <span className="px-1 pb-1 text-[11px] leading-[1.4] text-neutral-300">
                Delete this annotation and its whole thread?
              </span>
              {error && (
                <span className="px-1 pb-1 text-[11px] text-danger" role="alert">
                  {error}
                </span>
              )}
              <div className="flex gap-1.5">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void confirm()}
                  className={deleteButton}
                >
                  {busy ? 'Deleting…' : 'Delete'}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setConfirming(false);
                    setError(null);
                  }}
                  className="btn-neutral h-7 flex-1"
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <span className="px-1 pb-0.5 pt-0.5 text-[10px] font-medium tracking-[0.06em] text-neutral-500">
                CHANGE KIND
              </span>
              <div className="grid grid-cols-2 gap-1">
                {ANNOTATION_KINDS.map((value) => {
                  const Icon = KIND_ICONS[value];
                  return (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={annotation.kind === value}
                      disabled={busy}
                      onClick={() => void choose(value)}
                      className={cn(
                        'flex h-7 items-center gap-1 rounded-[2px] border px-2 text-[11px] font-medium',
                        annotation.kind === value
                          ? 'border-accent text-accent-200'
                          : 'border-neutral-700 text-neutral-300',
                      )}
                    >
                      <Icon size={12} />
                      {ANNOTATION_KIND_META[value].label}
                    </button>
                  );
                })}
              </div>
              {error && (
                <span className="px-1 pt-1 text-[11px] text-danger" role="alert">
                  {error}
                </span>
              )}
              <div className="my-1 h-px bg-neutral-700" />
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className={actionItem}
              >
                <Trash size={13} />
                Delete annotation
              </button>
            </>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

type RunAction = 'retry' | 'dismiss';

export function ComparisonView(props: ComparisonPageData) {
  const {
    comparison,
    author,
    baseModel,
    responses,
    annotations: initialAnnotations,
    comments: initialComments,
    models,
    maxChallengers,
    currentUserId,
    viewerSignedIn,
    viewerSuspended,
    initialModel,
    initialAnnOn,
    handle,
  } = props;

  const isAuthor = currentUserId !== null && currentUserId === comparison.authorId;
  const canWrite = currentUserId !== null && !viewerSuspended;
  const signInHref = signInPath(`/comparisons/${comparison.id}`);
  const requireSignIn = () => {
    if (canWrite) return false;
    window.location.assign(signInHref);
    return true;
  };

  const [responseList, setResponseList] = useState(responses);
  const [menuOpen, setMenuOpen] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addingModelId, setAddingModelId] = useState<string | null>(null);
  const [runBusy, setRunBusy] = useState<{ id: string; action: RunAction } | null>(null);
  const [runError, setRunError] = useState<{ id: string; message: string } | null>(null);

  const base = responseList.find((response) => response.isBase);
  const challengers = responseList.filter(
    (response) =>
      !response.isBase &&
      (isAuthor ? response.status !== 'skipped' : response.status === 'done'),
  );
  const challengerTotal = responseList.filter(
    (response) => !response.isBase && response.status !== 'skipped',
  ).length;
  const atCap = challengerTotal >= maxChallengers;
  // The Add affordance belongs to published Comparisons; a ready draft still
  // goes through the Job page to publish.
  const canAdd = isAuthor && comparison.status === 'published';
  const initialSlug =
    challengers.find((response) => response.model.slug === initialModel)?.model.slug ??
    challengers[0]?.model.slug ??
    null;

  const [activeSlug, setActiveSlug] = useState<string | null>(initialSlug);
  const [annOn, setAnnOn] = useState(initialAnnOn);
  const [kind, setKind] = useState<'All' | AnnotationKind>('All');
  const [annotations, setAnnotations] = useState(initialAnnotations);
  const [comments, setComments] = useState(initialComments);
  const [popover, setPopover] = useState<Popover | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [newKind, setNewKind] = useState<AnnotationKind>('bug');
  const [newBody, setNewBody] = useState('');
  const [newError, setNewError] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [commentFilter, setCommentFilter] = useState('All');
  const [draft, setDraft] = useState('');
  const [about, setAbout] = useState<string | null>(null);
  const [replyParentId, setReplyParentId] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [commentEdit, setCommentEdit] = useState<{
    id: string;
    body: string;
    busy: boolean;
    error: string | null;
  } | null>(null);
  const [messageEdit, setMessageEdit] = useState<{
    annotationId: string;
    id: string;
    body: string;
    busy: boolean;
    error: string | null;
  } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const active = challengers.find((response) => response.model.slug === activeSlug) ?? null;
  const activeAnnotation = popover?.mode === 'thread'
    ? annotations.find((annotation) => annotation.id === popover.id) ?? null
    : null;
  const annotationPeople = activeAnnotation
    ? new Set(
        activeAnnotation.thread
          .filter((message) => !message.deletedAt)
          .map((message) => message.author.id),
      ).size
    : 0;

  const visibleAnnotations = useMemo(
    () => annotations.filter((annotation) => kind === 'All' || annotation.kind === kind),
    [annotations, kind],
  );

  const usedModelSlugs = useMemo(
    () => new Set(responseList.map((response) => response.model.slug)),
    [responseList],
  );
  const availableModels = useMemo(
    () =>
      models.filter(
        (model) => model.slug !== baseModel.slug && !usedModelSlugs.has(model.slug),
      ),
    [baseModel.slug, models, usedModelSlugs],
  );
  const pendingJobKey = useMemo(
    () =>
      [
        ...new Set(
          responseList
            .filter(
              (response) =>
                !response.isBase &&
                isPendingResponse(response.status) &&
                response.jobId,
            )
            .map((response) => response.jobId as string),
        ),
      ].join(','),
    [responseList],
  );

  const commentModels = useMemo(() => {
    const seen = new Set<string>();
    const rows: Array<{ id: string; slug: string; name: string; monogram: string }> = [];
    const reviewed = challengers.filter((response) => response.status === 'done');
    for (const model of [baseModel, ...reviewed.map((response) => response.model)]) {
      const match = models.find((item) => item.slug === model.slug);
      if (match && !seen.has(model.slug)) {
        seen.add(model.slug);
        rows.push(match);
      }
    }
    return rows;
  }, [baseModel, challengers, models]);

  const filteredComments = useMemo(() => {
    if (commentFilter === 'All') return comments;
    if (commentFilter === 'General') return comments.filter((comment) => !comment.aboutModel);
    return comments.filter((comment) => comment.aboutModel?.slug === commentFilter);
  }, [comments, commentFilter]);

  const totalComments = countLiveComments(comments);

  useEffect(() => {
    if (!popover) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('[data-popover]') || target.closest('[data-annotation-span]')) return;
      setPopover(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPopover(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [popover]);

  const resyncResponses = useCallback(async () => {
    try {
      const response = await fetch(`/api/comparisons/${comparison.id}/responses`, {
        cache: 'no-store',
      });
      if (!response.ok) return;
      const payload = (await response.json()) as {
        responses?: ComparisonResponseView[];
      };
      if (Array.isArray(payload.responses)) setResponseList(payload.responses);
    } catch {
      // The next settled event or a reload repairs the view.
    }
  }, [comparison.id]);

  const resyncComments = useCallback(async () => {
    try {
      const response = await fetch(`/api/comparisons/${comparison.id}`, {
        cache: 'no-store',
      });
      if (!response.ok) return;
      const payload = (await response.json()) as { comments?: CommentView[] };
      if (Array.isArray(payload.comments)) setComments(payload.comments);
    } catch {
      // The next reload repairs the view.
    }
  }, [comparison.id]);

  // An added Challenger reuses the Job event stream: one connection per Job
  // that still has a pending Run. Last-Event-ID replay covers reloads.
  useEffect(() => {
    if (!isAuthor || !pendingJobKey) return;
    const sources = pendingJobKey.split(',').map((jobId) => {
      const source = new EventSource(`/api/stream/jobs/${jobId}`);
      let opened = false;
      source.onopen = () => {
        if (opened) void resyncResponses();
        opened = true;
      };
      source.onmessage = (message) => {
        let event: JobStreamEvent;
        try {
          event = JSON.parse(message.data) as JobStreamEvent;
        } catch {
          return;
        }

        if (event.type === 'job.ready') {
          void resyncResponses();
          return;
        }
        if (event.type !== 'response.status') return;

        const payload = event.data?.payload ?? {};
        const responseId = typeof payload.responseId === 'string' ? payload.responseId : null;
        if (!responseId || !isResponseStatus(payload.status)) return;
        const status = payload.status;
        const tokens = typeof payload.tokens === 'number' ? payload.tokens : 0;

        setResponseList((current) =>
          current.map((item) =>
            item.id === responseId
              ? {
                  ...item,
                  status,
                  tokens: status === 'queued' ? 0 : tokens,
                  latencyMs:
                    typeof payload.latencyMs === 'number'
                      ? payload.latencyMs
                      : item.latencyMs,
                  error: status === 'failed' ? String(payload.error ?? 'API timeout') : null,
                }
              : item,
          ),
        );

        if (status === 'done' || status === 'failed' || status === 'skipped') {
          void resyncResponses();
        }
      };
      return source;
    });
    return () => sources.forEach((source) => source.close());
  }, [isAuthor, pendingJobKey, resyncResponses]);

  const rel = (rect: DOMRect) => {
    const grid = gridRef.current?.getBoundingClientRect();
    if (!grid) return { x: 0, y: 0 };
    return {
      x: Math.max(0, Math.min(rect.left - grid.left, grid.width - 304)),
      y: Math.max(0, rect.bottom - grid.top + 6),
    };
  };

  const openThread = (annotationId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    const position = rel(event.currentTarget.getBoundingClientRect());
    setSelection(null);
    setPopover({ mode: 'thread', id: annotationId, ...position });
  };

  const onMouseUp = () => {
    if (!annOn || !canWrite) return;
    setTimeout(() => {
      const browserSelection = window.getSelection();
      if (!browserSelection || browserSelection.isCollapsed || !browserSelection.rangeCount) {
        setSelection(null);
        return;
      }
      const anchor = browserSelection.anchorNode;
      const focus = browserSelection.focusNode;
      if (!anchor || anchor !== focus || anchor.nodeType !== Node.TEXT_NODE) {
        setSelection(null);
        return;
      }
      const element = (anchor.parentElement?.closest('[data-run]') as HTMLElement | null) ?? null;
      if (!element || element.getAttribute('data-annotatable') !== '1') {
        setSelection(null);
        return;
      }
      const responseId = element.getAttribute('data-response');
      const runStart = Number(element.getAttribute('data-start'));
      if (!responseId || !Number.isFinite(runStart)) return;
      const start = Math.min(browserSelection.anchorOffset, browserSelection.focusOffset);
      const end = Math.max(browserSelection.anchorOffset, browserSelection.focusOffset);
      const startOffset = runStart + start;
      const endOffset = runStart + end;
      const quote = browserSelection.toString();
      if (!quote.trim()) return;

      const overlaps = annotations.some(
        (annotation) =>
          annotation.responseId === responseId &&
          annotation.startOffset < endOffset &&
          annotation.endOffset > startOffset,
      );
      if (overlaps) {
        setSelection(null);
        return;
      }

      const rect = browserSelection.getRangeAt(0).getBoundingClientRect();
      const grid = gridRef.current?.getBoundingClientRect();
      if (!grid) return;
      setSelection({
        responseId,
        startOffset,
        endOffset,
        quote,
        x: Math.max(0, rect.left - grid.left),
        y: Math.max(0, rect.top - grid.top - 34),
      });
    }, 0);
  };

  const openNew = (event: React.MouseEvent) => {
    event.preventDefault();
    if (!selection) return;
    setNewBody('');
    setNewError(null);
    setPopover({
      mode: 'new',
      responseId: selection.responseId,
      startOffset: selection.startOffset,
      endOffset: selection.endOffset,
      quote: selection.quote,
      x: selection.x,
      y: selection.y + 34,
    });
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  };

  const saveAnnotation = async () => {
    if (!popover || popover.mode !== 'new') return;
    if (!newBody.trim()) {
      setNewError('Write something first.');
      return;
    }
    setSaving(true);
    setNewError(null);
    try {
      const response = await fetch('/api/annotations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          responseId: popover.responseId,
          kind: newKind,
          startOffset: popover.startOffset,
          endOffset: popover.endOffset,
          body: newBody,
        }),
      });
      const payload = (await response.json()) as {
        annotation?: AnnotationView;
        error?: { message?: string };
      };
      if (!response.ok || !payload.annotation) {
        setNewError(payload.error?.message ?? 'Could not save that annotation.');
        return;
      }
      setAnnotations((current) => [...current, payload.annotation!]);
      setPopover({ mode: 'thread', id: payload.annotation.id, x: popover.x, y: popover.y });
      setNewBody('');
    } finally {
      setSaving(false);
    }
  };

  const sendReply = async () => {
    if (!activeAnnotation || !replyDraft.trim() || saving) return;
    setSaving(true);
    try {
      const response = await fetch(
        `/api/annotations/${activeAnnotation.id}/messages`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ body: replyDraft }),
        },
      );
      const payload = (await response.json()) as {
        message?: AnnotationView['thread'][number];
        error?: { message?: string };
      };
      if (response.ok && payload.message) {
        setAnnotations((current) =>
          current.map((annotation) =>
            annotation.id === activeAnnotation.id
              ? { ...annotation, thread: [...annotation.thread, payload.message!] }
              : annotation,
          ),
        );
        setReplyDraft('');
      }
    } finally {
      setSaving(false);
    }
  };

  const voteAnnotation = async (annotation: AnnotationView) => {
    if (!canWrite || requireSignIn()) return;
    if (annotation.author.id === currentUserId) return;
    const response = await fetch('/api/votes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetType: 'annotation', targetId: annotation.id }),
    });
    if (!response.ok) return;
    const payload = (await response.json()) as { voted: boolean; count: number };
    setAnnotations((current) =>
      current.map((item) =>
        item.id === annotation.id
          ? { ...item, voted: payload.voted, votes: payload.count }
          : item,
      ),
    );
  };

  const voteComment = async (comment: CommentView) => {
    if (!canWrite || requireSignIn()) return;
    if (comment.author.id === currentUserId) return;
    const response = await fetch('/api/votes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetType: 'comment', targetId: comment.id }),
    });
    if (!response.ok) return;
    const payload = (await response.json()) as { voted: boolean; count: number };
    setComments((current) =>
      current.map((item) => {
        if (item.id === comment.id) {
          return { ...item, voted: payload.voted, votes: payload.count };
        }
        return {
          ...item,
          replies: item.replies.map((reply) =>
            reply.id === comment.id
              ? { ...reply, voted: payload.voted, votes: payload.count }
              : reply,
          ),
        };
      }),
    );
  };

  const postComment = async () => {
    if (requireSignIn()) return;
    if (!draft.trim() || posting) return;
    setPosting(true);
    setCommentError(null);
    try {
      const response = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          comparisonId: comparison.id,
          parentId: replyParentId,
          aboutModelId: about
            ? models.find((model) => model.slug === about)?.id
            : undefined,
          body: draft,
        }),
      });
      const payload = (await response.json()) as {
        comment?: CommentView;
        error?: { message?: string };
      };
      if (!response.ok || !payload.comment) {
        setCommentError(payload.error?.message ?? 'Could not post that comment.');
        return;
      }
      if (replyParentId) {
        setComments((current) =>
          current.map((comment) =>
            comment.id === replyParentId
              ? { ...comment, replies: [...comment.replies, payload.comment!] }
              : comment,
          ),
        );
      } else {
        setComments((current) => [payload.comment!, ...current]);
      }
      setDraft('');
      setReplyParentId(null);
    } finally {
      setPosting(false);
    }
  };

  const replyTo = (comment: CommentView) => {
    if (requireSignIn()) return;
    setDraft(`@${comment.author.handle} `);
    setAbout(comment.aboutModel?.slug ?? null);
    setReplyParentId(comment.id);
    composerRef.current?.focus();
  };

  const startCommentEdit = (comment: CommentView) => {
    setCommentEdit({ id: comment.id, body: comment.body, busy: false, error: null });
  };

  const saveCommentEdit = async (comment: CommentView) => {
    if (!commentEdit || commentEdit.id !== comment.id || commentEdit.busy) return;
    const body = commentEdit.body.trim();
    if (!body) {
      setCommentEdit((current) =>
        current ? { ...current, error: 'Write something first.' } : current,
      );
      return;
    }
    setCommentEdit((current) =>
      current ? { ...current, busy: true, error: null } : current,
    );
    try {
      const response = await fetch(`/api/comments/${comment.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      if (!response.ok) {
        const message = await responseErrorMessage(
          response,
          'Could not save that comment.',
        );
        setCommentEdit((current) =>
          current ? { ...current, busy: false, error: message } : current,
        );
        return;
      }
      setComments((current) => editCommentInTree(current, comment.id, body));
      setCommentEdit(null);
    } catch {
      setCommentEdit((current) =>
        current ? { ...current, busy: false, error: 'Could not save that comment.' } : current,
      );
    }
  };

  const deleteCommentAction = async (comment: CommentView) => {
    try {
      const response = await fetch(`/api/comments/${comment.id}`, { method: 'DELETE' });
      if (!response.ok) {
        return responseErrorMessage(response, 'Could not delete that comment.');
      }
      // Re-read the Discussion instead of guessing locally: a reply may have
      // arrived since this page loaded, which changes tombstone-vs-delete.
      await resyncComments();
      setCommentEdit((current) => (current?.id === comment.id ? null : current));
      return null;
    } catch {
      return 'Could not delete that comment.';
    }
  };

  const updateThreadMessage = (
    annotationId: string,
    messageId: string,
    update: (message: AnnotationView['thread'][number]) => AnnotationView['thread'][number],
  ) => {
    setAnnotations((current) =>
      current.map((annotation) =>
        annotation.id === annotationId
          ? {
              ...annotation,
              thread: annotation.thread.map((message) =>
                message.id === messageId ? update(message) : message,
              ),
            }
          : annotation,
      ),
    );
  };

  const startMessageEdit = (
    annotation: AnnotationView,
    message: AnnotationView['thread'][number],
  ) => {
    setMessageEdit({
      annotationId: annotation.id,
      id: message.id,
      body: message.body,
      busy: false,
      error: null,
    });
  };

  const saveMessageEdit = async (
    annotation: AnnotationView,
    message: AnnotationView['thread'][number],
  ) => {
    if (
      !messageEdit ||
      messageEdit.annotationId !== annotation.id ||
      messageEdit.id !== message.id ||
      messageEdit.busy
    ) {
      return;
    }
    const body = messageEdit.body.trim();
    if (!body) {
      setMessageEdit((current) =>
        current ? { ...current, error: 'Write something first.' } : current,
      );
      return;
    }
    setMessageEdit((current) =>
      current ? { ...current, busy: true, error: null } : current,
    );
    try {
      const response = await fetch(
        `/api/annotations/${annotation.id}/messages/${message.id}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ body }),
        },
      );
      if (!response.ok) {
        const error = await responseErrorMessage(
          response,
          'Could not save that message.',
        );
        setMessageEdit((current) =>
          current ? { ...current, busy: false, error } : current,
        );
        return;
      }
      updateThreadMessage(annotation.id, message.id, (item) => ({ ...item, body }));
      setMessageEdit(null);
    } catch {
      setMessageEdit((current) =>
        current ? { ...current, busy: false, error: 'Could not save that message.' } : current,
      );
    }
  };

  const deleteMessageAction = async (
    annotation: AnnotationView,
    message: AnnotationView['thread'][number],
  ) => {
    try {
      const response = await fetch(
        `/api/annotations/${annotation.id}/messages/${message.id}`,
        { method: 'DELETE' },
      );
      if (!response.ok) {
        return responseErrorMessage(response, 'Could not delete that message.');
      }
      updateThreadMessage(annotation.id, message.id, (item) => ({
        ...item,
        body: '',
        deletedAt: new Date().toISOString(),
      }));
      setMessageEdit((current) => (current?.id === message.id ? null : current));
      return null;
    } catch {
      return 'Could not delete that message.';
    }
  };

  const changeAnnotationKind = async (
    annotation: AnnotationView,
    kind: AnnotationKind,
  ) => {
    try {
      const response = await fetch(`/api/annotations/${annotation.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind }),
      });
      if (!response.ok) {
        return responseErrorMessage(response, 'Could not change that annotation.');
      }
      setAnnotations((current) =>
        current.map((item) => (item.id === annotation.id ? { ...item, kind } : item)),
      );
      return null;
    } catch {
      return 'Could not change that annotation.';
    }
  };

  const deleteAnnotationAction = async (annotation: AnnotationView) => {
    try {
      const response = await fetch(`/api/annotations/${annotation.id}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        return responseErrorMessage(response, 'Could not delete that annotation.');
      }
      setAnnotations((current) => current.filter((item) => item.id !== annotation.id));
      setPopover(null);
      return null;
    } catch {
      return 'Could not delete that annotation.';
    }
  };

  const addChallenger = async (model: ComparisonPageData['models'][number]) => {
    if (addingModelId || atCap) return;
    setAddingModelId(model.id);
    setAddError(null);
    try {
      const response = await fetch(`/api/comparisons/${comparison.id}/responses`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ modelId: model.id }),
      });
      const payload = (await response.json()) as {
        jobId?: string;
        responseId?: string;
        error?: { message?: string };
      };
      if (!response.ok || !payload.jobId || !payload.responseId) {
        setAddError(payload.error?.message ?? 'Could not add that model.');
        return;
      }

      const queuedView: ComparisonResponseView = {
        id: payload.responseId,
        jobId: payload.jobId,
        isBase: false,
        contentMd: '',
        tokens: 0,
        latencyMs: null,
        status: 'queued',
        error: null,
        model: { slug: model.slug, name: model.name, monogram: model.monogram },
        blocks: [],
      };
      setResponseList((current) => [...current, queuedView]);
      setMenuOpen(false);
      switchTab(model.slug);
    } catch {
      setAddError('Could not add that model. Try again.');
    } finally {
      setAddingModelId(null);
    }
  };

  const actOnRun = async (
    responseView: ComparisonResponseView,
    action: RunAction,
  ) => {
    if (runBusy) return;
    setRunBusy({ id: responseView.id, action });
    setRunError(null);
    try {
      const endpoint = action === 'retry' ? 'retry' : 'skip';
      const response = await fetch(
        `/api/responses/${responseView.id}/${endpoint}`,
        { method: 'POST' },
      );
      if (!response.ok) {
        setRunError({
          id: responseView.id,
          message: await responseErrorMessage(
            response,
            action === 'retry' ? 'Retry failed. Try again.' : 'Could not dismiss it.',
          ),
        });
        return;
      }

      if (action === 'retry') {
        setResponseList((current) =>
          current.map((item) =>
            item.id === responseView.id
              ? { ...item, status: 'queued', error: null, tokens: 0, latencyMs: null }
              : item,
          ),
        );
      } else {
        setResponseList((current) =>
          current.map((item) =>
            item.id === responseView.id
              ? { ...item, status: 'skipped', error: null }
              : item,
          ),
        );
        setActiveSlug((current) => {
          if (current !== responseView.model.slug) return current;
          const fallback = responseList.find(
            (item) =>
              item.id !== responseView.id &&
              !item.isBase &&
              item.status === 'done',
          );
          return fallback?.model.slug ?? null;
        });
      }
    } catch {
      setRunError({
        id: responseView.id,
        message: action === 'retry' ? 'Retry failed. Try again.' : 'Could not dismiss it.',
      });
    } finally {
      setRunBusy(null);
    }
  };

  const copyLink = async () => {
    const url = new URL(window.location.href);
    if (activeSlug) url.searchParams.set('model', activeSlug);
    url.searchParams.delete('annotations');
    await navigator.clipboard.writeText(url.toString());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const switchTab = (slug: string) => {
    setActiveSlug(slug);
    setPopover(null);
    const url = new URL(window.location.href);
    url.searchParams.set('model', slug);
    window.history.replaceState(null, '', `${url.pathname}${url.search}`);
  };

  const ago = (value: string) => relativeTimeAgo(value);

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader
        handle={handle}
        signedIn={viewerSignedIn}
        variant="page"
        signInHref={signInHref}
      />

      <main className="mx-auto flex w-full max-w-[1480px] flex-col gap-4 px-5 pb-12 pt-[18px]">
        {viewerSuspended && (
          <div
            role="status"
            className="flex max-w-[860px] items-start gap-2 rounded-[2px] border border-danger px-3 py-2 text-[11.5px] leading-[1.5] text-neutral-300"
          >
            <WarningCircle size={14} className="mt-px shrink-0 text-danger" />
            <span>
              <span className="font-medium text-danger">Your account is suspended.</span>{' '}
              You can keep reading, but posting, annotating, voting and reporting are
              disabled. Contact an Admin if you think this is a mistake.
            </span>
          </div>
        )}
        <div className="flex max-w-[860px] flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-neutral-400">
            {comparison.categories.map((category) => (
              <span
                key={category}
                className="flex h-5 items-center rounded-[2px] bg-neutral-800 px-[7px] font-medium text-neutral-200"
              >
                {category}
              </span>
            ))}
            <span className="flex items-center gap-2">
              <EffortMeter effort={comparison.effort} />
              {EFFORT_LEVELS[comparison.effort - 1]?.label ?? 'Med'} effort
            </span>
            <span>·</span>
            <Avatar handle={author.handle} size={14} />
            <span className="text-neutral-200">{formatHandle(author.handle)}</span>
            <span>· {ago(comparison.publishedAt ?? comparison.createdAt)}</span>
          </div>

          <h1 className="m-0 font-heading text-[20px] font-medium leading-[1.2] tracking-[-0.015em] [text-wrap:pretty]">
            {comparison.title}
          </h1>

          <button
            type="button"
            onClick={() => setPromptOpen((value) => !value)}
            className="flex items-center gap-[6px] self-start text-[12px] font-medium text-neutral-400 transition-colors hover:text-text"
          >
            {promptOpen ? <CaretDown size={12} /> : <CaretRight size={12} />}
            Prompt
          </button>
          {promptOpen && (
            <div className="rounded-[2px] bg-surface px-3 py-[10px] text-[12px] font-normal leading-[1.55] text-neutral-200 [text-wrap:pretty]">
              {comparison.prompt}
            </div>
          )}
        </div>

        <div className="sticky top-[52px] z-10 flex flex-wrap items-center gap-2 border-b border-neutral-800 bg-bg py-2">
          <button
            type="button"
            onClick={() => {
              setAnnOn((value) => !value);
              setPopover(null);
              setSelection(null);
            }}
            className={cn(
              'flex h-[30px] items-center gap-[6px] rounded-[2px] border px-2.5 text-[12px] font-medium',
              annOn
                ? 'border-accent bg-accent-900 text-accent-200'
                : 'border-neutral-700 text-neutral-200',
            )}
          >
            <Highlighter size={14} />
            Annotations
            <span className="min-w-[18px] rounded-[2px] bg-neutral-800 px-[5px] text-center text-[10px] font-medium leading-[18px] text-neutral-200">
              {annotations.length}
            </span>
          </button>

          {annOn && (
            <>
              <div className="flex gap-[2px] rounded-[2px] bg-surface p-[2px]">
                {KIND_FILTERS.map((filter) => (
                  <button
                    key={filter.value}
                    type="button"
                    onClick={() => {
                      setKind(filter.value);
                      setPopover(null);
                    }}
                    className={cn(
                      'flex h-6 items-center gap-1 rounded-[2px] px-2 text-[11px] font-medium',
                      kind === filter.value
                        ? 'bg-neutral-700 text-text'
                        : 'text-neutral-400',
                    )}
                  >
                    <filter.Icon size={12} />
                    {filter.label}
                  </button>
                ))}
              </div>
              {canWrite ? (
                <span className="text-[12px] text-neutral-500">
                  Select any text to annotate it
                </span>
              ) : viewerSuspended ? (
                <span className="text-[12px] text-neutral-500">
                  Annotations are read-only while your account is suspended.
                </span>
              ) : (
                <Link href={signInHref} className="text-[12px] font-medium text-accent-200">
                  Sign in to annotate
                </Link>
              )}
            </>
          )}

          <div className="flex-1" />
          {!isAuthor && !viewerSuspended && (
            <ReportControl
              targetType="comparison"
              targetId={comparison.id}
              signedIn={viewerSignedIn}
              signInHref={signInHref}
              className="btn-ghost h-[30px] px-2"
            />
          )}
          <button type="button" onClick={copyLink} className="btn-ghost">
            {copied ? <Check size={14} /> : <LinkSimple size={14} />}
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>

        <div
          ref={gridRef}
          onMouseUp={onMouseUp}
          className="relative grid items-start gap-3"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))' }}
        >
          {base && base.status === 'done' && (
            <section className="flex min-w-0 flex-col rounded-[2px] bg-surface">
              <div className="flex h-[42px] items-center gap-2 border-b border-neutral-800 px-3.5">
                <span className="rounded-[2px] border border-accent-700 px-1.5 py-1 text-[9px] font-semibold leading-none tracking-[0.08em] text-accent-200">
                  BASE
                </span>
                <span className="monogram monogram-base !h-[18px] !w-[18px] !text-[9px]">
                  {base.model.monogram}
                </span>
                <span className="text-[12px] font-medium">{base.model.name}</span>
                <div className="flex-1" />
                <span className="whitespace-nowrap text-[11px] text-neutral-500">
                  {base.tokens.toLocaleString()} tok
                  {base.latencyMs ? ` · ${(base.latencyMs / 1000).toFixed(1)}s` : ''}
                </span>
              </div>
              <div className="flex flex-col gap-3 px-4 pb-[18px] pt-3.5">
                <MarkdownView
                  responseId={base.id}
                  blocks={base.blocks}
                  annotations={visibleAnnotations}
                  annOn={annOn}
                  kindFilter={kind}
                  openId={popover?.mode === 'thread' ? popover.id : null}
                  onOpen={openThread}
                />
              </div>
            </section>
          )}

          <section className="relative flex min-w-0 flex-col rounded-[2px] bg-surface">
            <div className="flex h-[42px] min-w-0 items-stretch gap-[2px] overflow-x-auto border-b border-neutral-800 px-1.5 [scrollbar-width:none]">
              {challengers.map((response) => {
                const pending = isPendingResponse(response.status);
                const failed = response.status === 'failed';
                return (
                  <button
                    key={response.model.slug}
                    type="button"
                    data-challenger-tab={response.model.slug}
                    onClick={() => switchTab(response.model.slug)}
                    title={
                      pending
                        ? `Calling ${response.model.name} hosted API…`
                        : failed
                          ? response.error ?? 'API timeout'
                          : undefined
                    }
                    className={cn(
                      'my-[-1px] flex flex-none items-center gap-[6px] whitespace-nowrap border-b-2 px-2.5 text-[12px] font-medium transition-colors',
                      response.model.slug === activeSlug
                        ? 'border-accent text-text'
                        : 'border-transparent text-neutral-400 hover:text-text',
                    )}
                  >
                    <span className="monogram !h-[18px] !w-[18px] !text-[9px]">
                      {response.model.monogram}
                    </span>
                    {response.model.name}
                    {pending && (
                      <CircleNotch
                        size={12}
                        className="text-accent-300"
                        style={{ animation: 'spin-soft 1s linear infinite' }}
                      />
                    )}
                    {failed && <WarningCircle size={12} className="text-danger" />}
                  </button>
                );
              })}
              {challengers.length === 0 && (
                <span className="flex items-center px-2 text-[12px] text-neutral-500">
                  No challenger responses
                </span>
              )}
              {canAdd && (
                <Popover.Root
                  open={menuOpen}
                  onOpenChange={(open) => {
                    setMenuOpen(open);
                    if (open) setAddError(null);
                  }}
                >
                  <Popover.Trigger asChild>
                    <button
                      type="button"
                      data-add-button
                      disabled={atCap}
                      aria-label={
                        atCap
                          ? `Adding is disabled: ${challengerTotal} of ${maxChallengers} challengers`
                          : 'Add model'
                      }
                      title={
                        atCap
                          ? `A comparison can hold at most ${maxChallengers} challengers.`
                          : 'Generate another response from the same prompt.'
                      }
                      className={cn(
                        'flex flex-none items-center gap-[5px] whitespace-nowrap px-2.5 text-[12px] font-medium transition-colors',
                        atCap
                          ? 'cursor-not-allowed text-neutral-600'
                          : 'text-neutral-400 hover:text-accent-200',
                      )}
                    >
                      <Plus size={13} />
                      Add model
                      {atCap && (
                        <span className="text-[10px] text-neutral-500">
                          {challengerTotal} of {maxChallengers}
                        </span>
                      )}
                    </button>
                  </Popover.Trigger>
                  <Popover.Portal>
                    <Popover.Content
                      align="start"
                      sideOffset={6}
                      aria-label="Add model"
                      data-add-menu
                      className="z-40 flex w-[260px] flex-col gap-[2px] rounded-[2px] border border-neutral-700 bg-neutral-800 p-1.5 shadow-lg"
                    >
                      <span className="px-2 pb-1 pt-1.5 text-[10px] font-medium tracking-[0.06em] text-neutral-500">
                        GENERATE ANOTHER RESPONSE
                      </span>
                      {availableModels.map((model) => (
                        <button
                          key={model.id}
                          type="button"
                          disabled={Boolean(addingModelId)}
                          onClick={() => void addChallenger(model)}
                          className="flex h-8 items-center gap-2 rounded-[2px] px-2 text-left text-[12px] font-medium text-text transition-colors hover:bg-neutral-700 disabled:opacity-50"
                        >
                          <span className="monogram !h-[18px] !w-[18px] !text-[9px]">
                            {model.monogram}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{model.name}</span>
                          <span className="text-[11px] font-normal text-neutral-400">
                            {addingModelId === model.id ? 'Adding…' : `~${model.etaSeconds}s`}
                          </span>
                        </button>
                      ))}
                      {availableModels.length === 0 && (
                        <span className="px-2 py-1 text-[11px] text-neutral-400">
                          Every available model is already in this comparison.
                        </span>
                      )}
                      {addError && (
                        <span className="px-2 py-1 text-[11px] text-danger" role="alert">
                          {addError}
                        </span>
                      )}
                      <span className="px-2 pb-1 pt-1.5 text-[11px] leading-[1.4] text-neutral-500">
                        Runs the same prompt through the model&apos;s hosted API.
                      </span>
                    </Popover.Content>
                  </Popover.Portal>
                </Popover.Root>
              )}
            </div>

            {active && active.status === 'done' ? (
              <div className="flex flex-col gap-3 px-4 pb-[18px] pt-3.5">
                <span className="-mb-1 text-[11px] text-neutral-500">
                  {active.tokens.toLocaleString()} tok
                  {active.latencyMs ? ` · ${(active.latencyMs / 1000).toFixed(1)}s` : ''}
                </span>
                <MarkdownView
                  responseId={active.id}
                  blocks={active.blocks}
                  annotations={visibleAnnotations}
                  annOn={annOn}
                  kindFilter={kind}
                  openId={popover?.mode === 'thread' ? popover.id : null}
                  onOpen={openThread}
                />
              </div>
            ) : active && active.status === 'failed' ? (
              <div className="flex flex-col gap-3 px-4 pb-[18px] pt-3.5">
                <span className="flex items-center gap-2 text-[12px] font-medium text-danger">
                  <WarningCircle size={14} />
                  {active.error ?? 'API timeout'}
                </span>
                <span className="text-[12px] leading-[1.5] text-neutral-400">
                  Only you can see this failed response. Readers still see the
                  Comparison without it.
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={Boolean(runBusy)}
                    onClick={() => void actOnRun(active, 'retry')}
                    className="btn-secondary h-[28px] disabled:opacity-45"
                  >
                    {runBusy?.id === active.id && runBusy.action === 'retry'
                      ? 'Retrying…'
                      : 'Retry'}
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(runBusy)}
                    onClick={() => void actOnRun(active, 'dismiss')}
                    className="btn-neutral h-[28px] disabled:opacity-45"
                  >
                    {runBusy?.id === active.id && runBusy.action === 'dismiss'
                      ? 'Dismissing…'
                      : 'Dismiss'}
                  </button>
                </div>
                {runError?.id === active.id && (
                  <ErrorLine message={runError.message} />
                )}
              </div>
            ) : active && isPendingResponse(active.status) ? (
              <div className="flex flex-col gap-3 px-4 pb-[18px] pt-3.5" aria-live="polite">
                <span className="flex items-center gap-2 text-[12px] font-medium text-accent-200">
                  <CircleNotch
                    size={14}
                    style={{ animation: 'spin-soft 1s linear infinite' }}
                  />
                  Calling {active.model.name} hosted API…
                </span>
                <div className="flex flex-col gap-2">
                  <div
                    className="h-2 w-[92%] rounded-[2px] bg-neutral-800"
                    style={{ animation: 'shimmer 1.2s infinite' }}
                  />
                  <div
                    className="h-2 w-[78%] rounded-[2px] bg-neutral-800"
                    style={{ animation: 'shimmer 1.2s .15s infinite' }}
                  />
                  <div
                    className="h-16 rounded-[2px] bg-bg"
                    style={{ animation: 'shimmer 1.2s .3s infinite' }}
                  />
                  <div
                    className="h-2 w-[64%] rounded-[2px] bg-neutral-800"
                    style={{ animation: 'shimmer 1.2s .45s infinite' }}
                  />
                </div>
                <span className="text-[11px] text-neutral-500">
                  {active.status === 'queued'
                    ? 'Queued — waiting for a worker.'
                    : `${active.tokens.toLocaleString()} tok so far`}
                </span>
              </div>
            ) : (
              <div className="px-4 py-8 text-[12px] text-neutral-500">
                No response selected.
              </div>
            )}
          </section>

          {selection && (
            <button
              type="button"
              onMouseDown={openNew}
              style={{ position: 'absolute', top: selection.y, left: selection.x }}
              className="z-20 flex h-7 items-center gap-[5px] whitespace-nowrap rounded-[2px] border border-accent bg-neutral-800 px-2.5 text-[12px] font-medium text-accent-200 shadow-md"
            >
              <Highlighter size={13} />
              Annotate
            </button>
          )}

          {popover && (
            <div
              ref={popoverRef}
              data-popover
              data-annotation-popover
              style={{ position: 'absolute', top: popover.y, left: popover.x }}
              className="z-20 flex w-[300px] flex-col rounded-[2px] border border-neutral-700 bg-neutral-800 shadow-lg"
            >
              {popover.mode === 'thread' && activeAnnotation ? (
                <>
                  <div className="flex items-center gap-1.5 px-3 pt-2.5">
                    {(() => {
                      const Icon = KIND_ICONS[activeAnnotation.kind as AnnotationKind] ?? Bug;
                      return (
                        <span className="flex h-5 items-center gap-1 rounded-[2px] border border-accent-700 px-[7px] text-[11px] font-medium text-accent-200">
                          <Icon size={12} />
                          {ANNOTATION_KIND_META[activeAnnotation.kind as AnnotationKind]?.label}
                        </span>
                      );
                    })()}
                    <span className="text-[11px] text-neutral-400">
                      {annotationPeople} {annotationPeople === 1 ? 'person' : 'people'}
                    </span>
                    <div className="flex-1" />
                    {canWrite && activeAnnotation.author.id === currentUserId && (
                      <AnnotationActions
                        annotation={activeAnnotation}
                        onChangeKind={changeAnnotationKind}
                        onDelete={() => deleteAnnotationAction(activeAnnotation)}
                      />
                    )}
                    {activeAnnotation.author.id !== currentUserId && canWrite && (
                      <ReportControl
                        compact
                        targetType="annotation"
                        targetId={activeAnnotation.id}
                        signedIn
                        signInHref={signInHref}
                      />
                    )}
                    <button
                      type="button"
                      aria-label="Close annotation"
                      onClick={() => setPopover(null)}
                      className="btn-ghost h-6 w-6 p-0"
                    >
                      <X size={13} />
                    </button>
                  </div>

                  <div className="mx-3 mt-2 border-l-2 border-accent pl-2 text-[11.5px] leading-[1.45] text-neutral-300 max-h-[52px] overflow-hidden">
                    {activeAnnotation.quote}
                  </div>

                  <div className="flex max-h-[220px] flex-col gap-2.5 overflow-auto px-3 pt-2.5">
                    {activeAnnotation.thread.map((message) => {
                      const canManage =
                        canWrite && message.author.id === currentUserId && !message.deletedAt;
                      const editing =
                        messageEdit?.annotationId === activeAnnotation.id &&
                        messageEdit.id === message.id;
                      return (
                        <div key={message.id} className="flex gap-2">
                          <Avatar handle={message.author.handle} size={20} />
                          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <div className="flex items-center gap-1">
                              <span className="text-[11px] text-neutral-400">
                                <span className="font-medium text-neutral-100">
                                  {formatHandle(message.author.handle)}
                                </span>{' '}
                                · {ago(message.createdAt)}
                              </span>
                              <div className="flex-1" />
                              {canManage && !editing && (
                                <ActionsMenu
                                  label="Message actions"
                                  noun="message"
                                  onEdit={() => startMessageEdit(activeAnnotation, message)}
                                  onDelete={() => deleteMessageAction(activeAnnotation, message)}
                                />
                              )}
                            </div>
                            {editing && messageEdit ? (
                              <InlineEditor
                                label="Edit message"
                                value={messageEdit.body}
                                onChange={(body) =>
                                  setMessageEdit((current) =>
                                    current ? { ...current, body } : current,
                                  )
                                }
                                onSave={() => void saveMessageEdit(activeAnnotation, message)}
                                onCancel={() => setMessageEdit(null)}
                                busy={messageEdit.busy}
                                error={messageEdit.error}
                              />
                            ) : (
                              <span className="text-[12.5px] leading-[1.45] text-neutral-100 [text-wrap:pretty]">
                                {message.deletedAt ? (
                                  <span className="italic text-neutral-500">[deleted]</span>
                                ) : (
                                  message.body
                                )}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex items-center gap-1.5 px-3 py-2.5">
                    <button
                      type="button"
                      aria-label={
                        activeAnnotation.voted ? 'Remove annotation vote' : 'Vote on annotation'
                      }
                      disabled={activeAnnotation.author.id === currentUserId || !canWrite}
                      onClick={() => voteAnnotation(activeAnnotation)}
                      className={cn(
                        'flex h-7 items-center gap-1 rounded-[2px] border border-neutral-700 px-2 text-[11px] font-medium text-neutral-200',
                        activeAnnotation.voted && 'bg-accent-900',
                        activeAnnotation.author.id === currentUserId && 'cursor-not-allowed opacity-50',
                      )}
                    >
                      <ArrowFatUp size={12} />
                      {activeAnnotation.votes}
                    </button>
                    {canWrite ? (
                      <>
                        <input
                          value={replyDraft}
                          onChange={(event) => setReplyDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') void sendReply();
                          }}
                          placeholder="Reply…"
                          className="h-7 min-w-0 flex-1 rounded-[2px] border border-neutral-700 bg-bg px-2 text-[12px] text-text outline-0 focus:border-accent"
                        />
                        <button
                          type="button"
                          onClick={() => void sendReply()}
                          className="grid h-7 w-7 place-items-center rounded-[2px] border border-accent text-accent-200"
                        >
                          <PaperPlaneRight size={13} />
                        </button>
                      </>
                    ) : (
                      <Link
                        href={signInHref}
                        className="flex h-7 flex-1 items-center justify-center rounded-[2px] border border-neutral-700 text-[11px] font-medium text-neutral-300"
                      >
                        Sign in to reply
                      </Link>
                    )}
                  </div>
                </>
              ) : popover.mode === 'new' ? (
                <>
                  <div className="flex items-center gap-1.5 px-3 pt-2.5">
                    <span className="text-[12px] font-medium">New annotation</span>
                    <div className="flex-1" />
                    <button
                      type="button"
                      onClick={() => setPopover(null)}
                      className="btn-ghost h-6 w-6 p-0"
                    >
                      <X size={13} />
                    </button>
                  </div>
                  <div className="mx-3 mt-2 border-l-2 border-accent pl-2 text-[11.5px] leading-[1.45] text-neutral-300 max-h-[52px] overflow-hidden">
                    {popover.quote}
                  </div>
                  <div className="flex flex-col gap-2 px-3 pb-3 pt-2.5">
                    <div className="flex flex-wrap gap-1">
                      {ANNOTATION_KINDS.map((value) => {
                        const Icon = KIND_ICONS[value];
                        const activeKind = newKind === value;
                        return (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setNewKind(value)}
                            className={cn(
                              'flex h-6 items-center gap-1 rounded-[2px] border px-2 text-[11px] font-medium',
                              activeKind
                                ? 'border-accent text-accent-200'
                                : 'border-neutral-700 text-neutral-300',
                            )}
                          >
                            <Icon size={12} />
                            {ANNOTATION_KIND_META[value].label}
                          </button>
                        );
                      })}
                    </div>
                    <textarea
                      value={newBody}
                      onChange={(event) => setNewBody(event.target.value)}
                      placeholder="What stands out here?"
                      rows={3}
                      className="resize-none rounded-[2px] border border-neutral-700 bg-bg p-2 text-[12.5px] leading-[1.45] text-text outline-0 focus:border-accent"
                    />
                    {newError && <ErrorLine message={newError} />}
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void saveAnnotation()}
                      className="btn-secondary self-start"
                    >
                      Add annotation
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          )}
        </div>

        <section className="flex max-w-[860px] flex-col gap-3.5 pt-[18px]">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="m-0 font-heading text-[16px] font-medium">Discussion</h2>
            <span data-comment-count className="text-[12px] text-neutral-500">
              {totalComments}
            </span>
            <div className="flex-1" />
            <div className="flex flex-wrap gap-[2px] rounded-[2px] bg-surface p-[2px]">
              {[
                { value: 'All', label: 'All' },
                ...commentModels.map((model) => ({ value: model.slug, label: model.name })),
                { value: 'General', label: 'General' },
              ].map((filter) => (
                <button
                  key={filter.value}
                  type="button"
                  onClick={() => setCommentFilter(filter.value)}
                  className={cn(
                    'h-6 whitespace-nowrap rounded-[2px] px-[9px] text-[11px] font-medium',
                    commentFilter === filter.value
                      ? 'bg-neutral-700 text-text'
                      : 'text-neutral-400',
                  )}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>

          {canWrite ? (
            <div className="flex flex-col gap-2 rounded-[2px] bg-surface p-2.5">
              <textarea
                ref={composerRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Share what you noticed across the outputs…"
                rows={2}
                className="resize-y border-0 bg-transparent px-0.5 py-1 text-[12px] leading-[1.5] text-text outline-0"
              />
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-neutral-500">About</span>
                {[{ slug: null, name: 'General' }, ...commentModels].map((option) => {
                  const activeAbout = about === option.slug;
                  return (
                    <button
                      key={option.slug ?? 'general'}
                      type="button"
                      onClick={() => setAbout(option.slug)}
                      className={cn(
                        'h-[22px] whitespace-nowrap rounded-[2px] border px-2 text-[11px] font-medium',
                        activeAbout
                          ? 'border-accent text-accent-200'
                          : 'border-neutral-700 text-neutral-300',
                      )}
                    >
                      {option.name}
                    </button>
                  );
                })}
                <div className="flex-1" />
                {commentError && <ErrorLine message={commentError} />}
                <button
                  type="button"
                  disabled={posting}
                  onClick={() => void postComment()}
                  className="btn-secondary"
                >
                  Post
                </button>
              </div>
            </div>
          ) : viewerSuspended ? (
            <div className="flex flex-wrap items-center gap-2 rounded-[2px] border border-dashed border-danger bg-surface px-3 py-3">
              <span className="text-[12px] text-neutral-300">
                Your account is suspended, so the Discussion is read-only.
              </span>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2 rounded-[2px] border border-dashed border-neutral-700 bg-surface px-3 py-3">
              <span className="text-[12px] text-neutral-300">
                Sign in to join the discussion.
              </span>
              <Link href={signInHref} className="btn-secondary h-7">
                Sign in
              </Link>
            </div>
          )}

          <div className="flex flex-col">
            {filteredComments.length === 0 ? (
              <span className="py-4 text-[12px] text-neutral-500">No comments yet.</span>
            ) : (
              filteredComments.map((comment) => {
                const canManage =
                  canWrite && comment.author.id === currentUserId && !comment.deletedAt;
                const editing = commentEdit?.id === comment.id;
                return (
                  <div
                    key={comment.id}
                    id={`comment-${comment.id}`}
                    data-comment={comment.id}
                    className="flex gap-2.5 border-b border-neutral-800 py-3.5"
                  >
                    <Avatar handle={comment.author.handle} size={28} />
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-neutral-400">
                        <span className="font-medium text-neutral-100">
                          {formatHandle(comment.author.handle)}
                        </span>
                        <span>{relativeTime(comment.createdAt)}</span>
                        {comment.aboutModel && (
                          <span className="flex h-[18px] items-center rounded-[2px] border border-neutral-700 px-1.5 text-[10px] font-medium text-neutral-200">
                            on {comment.aboutModel.name}
                          </span>
                        )}
                        {canManage && !editing && (
                          <div className="ml-auto">
                            <ActionsMenu
                              label="Comment actions"
                              noun="comment"
                              onEdit={() => startCommentEdit(comment)}
                              onDelete={() => deleteCommentAction(comment)}
                            />
                          </div>
                        )}
                      </div>
                      {editing && commentEdit ? (
                        <InlineEditor
                          label="Edit comment"
                          value={commentEdit.body}
                          onChange={(body) =>
                            setCommentEdit((current) =>
                              current ? { ...current, body } : current,
                            )
                          }
                          onSave={() => void saveCommentEdit(comment)}
                          onCancel={() => setCommentEdit(null)}
                          busy={commentEdit.busy}
                          error={commentEdit.error}
                        />
                      ) : (
                        <div className="text-[12.5px] leading-[1.55] text-neutral-100 [text-wrap:pretty]">
                          {comment.deletedAt ? (
                            <span className="italic text-neutral-500">[deleted]</span>
                          ) : (
                            comment.body
                          )}
                        </div>
                      )}
                      {!comment.deletedAt && (
                        <div className="flex items-center gap-3 text-[11px] font-medium text-neutral-400">
                          <button
                            type="button"
                            aria-label={
                              comment.voted ? 'Remove comment vote' : 'Vote on comment'
                            }
                            disabled={comment.author.id === currentUserId || !canWrite}
                            onClick={() => void voteComment(comment)}
                            className={cn(
                              'flex items-center gap-1',
                              comment.voted && 'text-accent-200',
                              comment.author.id === currentUserId &&
                                'cursor-not-allowed opacity-50',
                            )}
                          >
                            <ArrowFatUp
                              size={13}
                              weight={comment.voted ? 'fill' : 'regular'}
                            />
                            {comment.votes}
                          </button>
                          {canWrite && (
                            <button
                              type="button"
                              onClick={() => replyTo(comment)}
                              className="flex items-center gap-1 transition-colors hover:text-text"
                            >
                              <ArrowBendUpLeft size={13} />
                              Reply
                            </button>
                          )}
                          {canWrite && comment.author.id !== currentUserId && (
                            <ReportControl
                              targetType="comment"
                              targetId={comment.id}
                              signedIn
                              signInHref={signInHref}
                            />
                          )}
                        </div>
                      )}

                      {comment.replies.map((reply) => {
                        const canManageReply =
                          canWrite && reply.author.id === currentUserId && !reply.deletedAt;
                        const editingReply = commentEdit?.id === reply.id;
                        return (
                          <div
                            key={reply.id}
                            id={`comment-${reply.id}`}
                            data-comment={reply.id}
                            className="mt-1 flex gap-2 border-l border-neutral-700 pl-3"
                          >
                            <Avatar handle={reply.author.handle} size={20} />
                            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                              <div className="flex items-center gap-1">
                                <span className="text-[11px] text-neutral-400">
                                  <span className="font-medium text-neutral-100">
                                    {formatHandle(reply.author.handle)}
                                  </span>{' '}
                                  · {relativeTime(reply.createdAt)}
                                </span>
                                <div className="flex-1" />
                                {canManageReply && !editingReply && (
                                  <ActionsMenu
                                    label="Reply actions"
                                    noun="reply"
                                    onEdit={() => startCommentEdit(reply)}
                                    onDelete={() => deleteCommentAction(reply)}
                                  />
                                )}
                              </div>
                              {editingReply && commentEdit ? (
                                <InlineEditor
                                  label="Edit reply"
                                  value={commentEdit.body}
                                  onChange={(body) =>
                                    setCommentEdit((current) =>
                                      current ? { ...current, body } : current,
                                    )
                                  }
                                  onSave={() => void saveCommentEdit(reply)}
                                  onCancel={() => setCommentEdit(null)}
                                  busy={commentEdit.busy}
                                  error={commentEdit.error}
                                />
                              ) : (
                                <span className="text-[12px] leading-[1.5] text-neutral-100">
                                  {reply.deletedAt ? (
                                    <span className="italic text-neutral-500">[deleted]</span>
                                  ) : (
                                    reply.body
                                  )}
                                </span>
                              )}
                              {!reply.deletedAt && (
                                <div className="mt-0.5 flex items-center gap-3 text-[11px] font-medium text-neutral-400">
                                  <button
                                    type="button"
                                    aria-label={
                                      reply.voted ? 'Remove reply vote' : 'Vote on reply'
                                    }
                                    disabled={reply.author.id === currentUserId || !canWrite}
                                    onClick={() => void voteComment(reply)}
                                    className={cn(
                                      'flex items-center gap-1',
                                      reply.voted && 'text-accent-200',
                                      reply.author.id === currentUserId &&
                                        'cursor-not-allowed opacity-50',
                                    )}
                                  >
                                    <ArrowFatUp
                                      size={12}
                                      weight={reply.voted ? 'fill' : 'regular'}
                                    />
                                    {reply.votes}
                                  </button>
                                  {canWrite && reply.author.id !== currentUserId && (
                                    <ReportControl
                                      targetType="comment"
                                      targetId={reply.id}
                                      signedIn
                                      signInHref={signInHref}
                                    />
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
