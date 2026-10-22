'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowBendUpLeft,
  ArrowFatUp,
  Bug,
  CaretDown,
  CaretRight,
  Check,
  Ghost,
  Highlighter,
  LinkSimple,
  PaperPlaneRight,
  Question,
  Stack,
  ThumbsUp,
  X,
} from '@phosphor-icons/react';
import type {
  AnnotationKind,
  AnnotationView,
  Block,
  CommentView,
  PublicUser,
} from '@owm/core/client';
import {
  ANNOTATION_KIND_META,
  ANNOTATION_KINDS,
  EFFORT_LEVELS,
  relativeTime,
} from '@owm/core/client';
import { Avatar } from './avatar';
import { SiteHeader } from './site-header';
import { MarkdownView } from './markdown-view';
import { cn } from '@/lib/utils';
import { signInPath } from '@/lib/next-path';

export type ComparisonResponseView = {
  id: string;
  isBase: boolean;
  contentMd: string;
  tokens: number;
  latencyMs: number | null;
  status: string;
  error: string | null;
  model: { slug: string; name: string; monogram: string };
  blocks: Block[];
};

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
  models: Array<{ id: string; slug: string; name: string; monogram: string }>;
  currentUserId: string | null;
  viewerSignedIn: boolean;
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

export function ComparisonView(props: ComparisonPageData) {
  const {
    comparison,
    author,
    baseModel,
    responses,
    annotations: initialAnnotations,
    comments: initialComments,
    models,
    currentUserId,
    viewerSignedIn,
    initialModel,
    initialAnnOn,
    handle,
  } = props;

  const base = responses.find((response) => response.isBase);
  const canWrite = currentUserId !== null;
  const signInHref = signInPath(`/comparisons/${comparison.id}`);
  const requireSignIn = () => {
    if (canWrite) return false;
    window.location.assign(signInHref);
    return true;
  };
  const challengers = responses.filter(
    (response) => !response.isBase && response.status === 'done',
  );
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
  const gridRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const active = challengers.find((response) => response.model.slug === activeSlug) ?? null;
  const activeAnnotation = popover?.mode === 'thread'
    ? annotations.find((annotation) => annotation.id === popover.id) ?? null
    : null;

  const visibleAnnotations = useMemo(
    () => annotations.filter((annotation) => kind === 'All' || annotation.kind === kind),
    [annotations, kind],
  );

  const commentModels = useMemo(() => {
    const seen = new Set<string>();
    const rows: Array<{ id: string; slug: string; name: string; monogram: string }> = [];
    for (const model of [baseModel, ...challengers.map((response) => response.model)]) {
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

  const totalComments = comments.reduce(
    (total, comment) => total + 1 + comment.replies.length,
    0,
  );

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
    if (requireSignIn()) return;
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
    if (requireSignIn()) return;
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

  const ago = (value: string) => {
    const label = relativeTime(value);
    return label === 'just now' ? label : `${label} ago`;
  };

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader
        handle={handle}
        signedIn={viewerSignedIn}
        variant="page"
        signInHref={signInHref}
      />

      <main className="mx-auto flex w-full max-w-[1480px] flex-col gap-4 px-5 pb-12 pt-[18px]">
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
            <span className="text-neutral-200">@{author.handle}</span>
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
              ) : (
                <Link href={signInHref} className="text-[12px] font-medium text-accent-200">
                  Sign in to annotate
                </Link>
              )}
            </>
          )}

          <div className="flex-1" />
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
              {challengers.map((response) => (
                <button
                  key={response.model.slug}
                  type="button"
                  onClick={() => switchTab(response.model.slug)}
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
                </button>
              ))}
              {challengers.length === 0 && (
                <span className="flex items-center px-2 text-[12px] text-neutral-500">
                  No challenger responses
                </span>
              )}
            </div>

            {active ? (
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
                      {new Set(activeAnnotation.thread.map((message) => message.author.id)).size}{' '}
                      {new Set(activeAnnotation.thread.map((message) => message.author.id)).size === 1
                        ? 'person'
                        : 'people'}
                    </span>
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
                    {activeAnnotation.quote}
                  </div>

                  <div className="flex max-h-[220px] flex-col gap-2.5 overflow-auto px-3 pt-2.5">
                    {activeAnnotation.thread.map((message) => (
                      <div key={message.id} className="flex gap-2">
                        <Avatar handle={message.author.handle} size={20} />
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <span className="text-[11px] text-neutral-400">
                            <span className="font-medium text-neutral-100">
                              @{message.author.handle}
                            </span>{' '}
                            · {ago(message.createdAt)}
                          </span>
                          <span className="text-[12.5px] leading-[1.45] text-neutral-100 [text-wrap:pretty]">
                            {message.body}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center gap-1.5 px-3 py-2.5">
                    <button
                      type="button"
                      aria-label={
                        activeAnnotation.voted ? 'Remove annotation vote' : 'Vote on annotation'
                      }
                      disabled={activeAnnotation.author.id === currentUserId}
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
            <span className="text-[12px] text-neutral-500">{totalComments}</span>
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
              filteredComments.map((comment) => (
                <div
                  key={comment.id}
                  className="flex gap-2.5 border-b border-neutral-800 py-3.5"
                >
                  <Avatar handle={comment.author.handle} size={28} />
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-neutral-400">
                      <span className="font-medium text-neutral-100">@{comment.author.handle}</span>
                      <span>{relativeTime(comment.createdAt)}</span>
                      {comment.aboutModel && (
                        <span className="flex h-[18px] items-center rounded-[2px] border border-neutral-700 px-1.5 text-[10px] font-medium text-neutral-200">
                          on {comment.aboutModel.name}
                        </span>
                      )}
                    </div>
                    <div className="text-[12.5px] leading-[1.55] text-neutral-100 [text-wrap:pretty]">
                      {comment.deletedAt ? (
                        <span className="italic text-neutral-500">[deleted]</span>
                      ) : (
                        comment.body
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-[11px] font-medium text-neutral-400">
                      <button
                        type="button"
                        aria-label={comment.voted ? 'Remove comment vote' : 'Vote on comment'}
                        disabled={comment.author.id === currentUserId}
                        onClick={() => void voteComment(comment)}
                        className={cn(
                          'flex items-center gap-1',
                          comment.voted && 'text-accent-200',
                          comment.author.id === currentUserId && 'cursor-not-allowed opacity-50',
                        )}
                      >
                        <ArrowFatUp size={13} weight={comment.voted ? 'fill' : 'regular'} />
                        {comment.votes}
                      </button>
                      <button
                        type="button"
                        onClick={() => replyTo(comment)}
                        className="flex items-center gap-1 transition-colors hover:text-text"
                      >
                        <ArrowBendUpLeft size={13} />
                        Reply
                      </button>
                    </div>

                    {comment.replies.map((reply) => (
                      <div
                        key={reply.id}
                        className="mt-1 flex gap-2 border-l border-neutral-700 pl-3"
                      >
                        <Avatar handle={reply.author.handle} size={20} />
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[11px] text-neutral-400">
                            <span className="font-medium text-neutral-100">
                              @{reply.author.handle}
                            </span>{' '}
                            · {relativeTime(reply.createdAt)}
                          </span>
                          <span className="text-[12px] leading-[1.5] text-neutral-100">
                            {reply.deletedAt ? (
                              <span className="italic text-neutral-500">[deleted]</span>
                            ) : (
                              reply.body
                            )}
                          </span>
                          <button
                            type="button"
                            aria-label={reply.voted ? 'Remove reply vote' : 'Vote on reply'}
                            disabled={reply.author.id === currentUserId}
                            onClick={() => void voteComment(reply)}
                            className={cn(
                              'mt-0.5 flex items-center gap-1 text-[11px] font-medium text-neutral-400',
                              reply.voted && 'text-accent-200',
                              reply.author.id === currentUserId && 'cursor-not-allowed opacity-50',
                            )}
                          >
                            <ArrowFatUp size={12} weight={reply.voted ? 'fill' : 'regular'} />
                            {reply.votes}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
