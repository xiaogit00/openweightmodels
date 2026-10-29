'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowBendUpLeft, ArrowFatUp } from '@phosphor-icons/react';
import type { AnnotationKind, AnnotationView, CommentView } from '@owm/core/client';
import {
  formatHandle,
  isPendingResponse,
  relativeTime,
} from '@owm/core/client';
import { Avatar } from './avatar';
import { ReportControl } from './report-control';
import { SiteHeader } from './site-header';
import { SegmentedControl } from './ui/segmented-control';
import { cn } from '@/lib/utils';
import { signInPath } from '@/lib/next-path';
import {
  countLiveComments,
  editCommentInTree,
} from '@/lib/discussion';
import { modelsWithReplayInProgress } from '@/lib/comparison-responses';
import {
  isResponseStatus,
  responseErrorMessage,
  type JobStreamEvent,
} from '@/lib/run-events';
import { ComparisonHead } from './comparison/comparison-head';
import {
  ANNOTATION_POPOVER_GUTTER,
  ANNOTATION_POPOVER_WIDTH,
  AnnotateSelectionButton,
  AnnotationPopover,
  type AnnotationPopoverState,
  type AnnotationSelection,
  type MessageEditState,
} from './comparison/annotations';
import {
  ActionsMenu,
  InlineEditor,
} from './comparison/content-actions';
import {
  ComparisonResponses,
  copyResponseText,
} from './comparison/comparison-responses';
import { ErrorLine } from './comparison/turn-state';
import { TurnRail } from './comparison/turn-rail';
import type {
  AddableModel,
  ComparisonPageData,
  ComparisonResponseView,
  RunAction,
} from './comparison/types';

export type { ComparisonPageData, ComparisonResponseView } from './comparison/types';

/** Site header (53) + sticky response headers (48) + 8px breathing room. */
const TURN_SCROLL_OFFSET = 53 + 48 + 8;
/** The last Turn whose top is above this point owns the rail's label. */
const TURN_SPY_THRESHOLD = 200;

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
  const [activeTurnPosition, setActiveTurnPosition] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addingModelId, setAddingModelId] = useState<string | null>(null);
  const [runBusy, setRunBusy] = useState<{ id: string; action: RunAction } | null>(null);
  const [runError, setRunError] = useState<{ id: string; message: string } | null>(null);

  const turns = useMemo(() => {
    const byPosition = new Map<number, { position: number; prompt: string }>();
    for (const response of responseList) {
      if (!byPosition.has(response.turn.position)) {
        byPosition.set(response.turn.position, {
          position: response.turn.position,
          prompt: response.turn.prompt,
        });
      }
    }
    return [...byPosition.values()].sort((left, right) => left.position - right.position);
  }, [responseList]);
  const multiTurn = turns.length > 1;
  const challengers = useMemo(() => {
    const bySlug = new Map<string, ComparisonResponseView>();
    // A Model becomes public once it has a finished Turn. From then on its whole
    // Replay is visible, so pending and failed Turns can drive the tab's state.
    const publicSlugs = new Set(
      responseList
        .filter((item) => !item.isBase && item.status === 'done')
        .map((item) => item.model.slug),
    );
    const rank = (status: ComparisonResponseView['status']) =>
      status === 'failed' ? 4 : isPendingResponse(status) ? 3 : status === 'done' ? 2 : 1;
    for (const response of [...responseList]
      .filter((item) => !item.isBase)
      .sort((left, right) => left.turn.position - right.turn.position)) {
      if (!isAuthor && !publicSlugs.has(response.model.slug)) continue;
      const existing = bySlug.get(response.model.slug);
      if (!existing || rank(response.status) > rank(existing.status)) {
        bySlug.set(response.model.slug, response);
      }
    }
    return [...bySlug.values()];
  }, [responseList, isAuthor]);
  const challengerTotal = new Set(
    responseList
      .filter((response) => !response.isBase && response.status !== 'skipped')
      .map((response) => response.model.slug),
  ).size;
  // A newly added Replay streams into the published Comparison: its model is
  // marked while later Turns are still queued, calling or streaming.
  const replayInProgress = useMemo(
    () =>
      modelsWithReplayInProgress(responseList, {
        includeModelsWithoutDoneTurn: isAuthor,
      }),
    [responseList, isAuthor],
  );
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
  const [popover, setPopover] = useState<AnnotationPopoverState | null>(null);
  const [selection, setSelection] = useState<AnnotationSelection | null>(null);
  const [newKind, setNewKind] = useState<AnnotationKind>('bug');
  const [newBody, setNewBody] = useState('');
  const [newError, setNewError] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedResponseId, setCopiedResponseId] = useState<string | null>(null);
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
  const [messageEdit, setMessageEdit] = useState<MessageEditState | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const navLockRef = useRef(0);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const closePopover = useCallback((restoreFocus = true) => {
    const opener = openerRef.current;
    setPopover(null);
    // The span or button that opened the popover gets focus back. It may have
    // been deleted in the meantime (deleting an Annotation removes its span).
    if (restoreFocus && opener?.isConnected) {
      requestAnimationFrame(() => opener.focus());
    }
  }, []);

  const active = challengers.find((response) => response.model.slug === activeSlug) ?? null;
  const activeStoppedAt = active
    ? ([...responseList]
        .filter(
          (response) =>
            !response.isBase &&
            response.model.slug === active.model.slug &&
            response.status === 'skipped',
        )
        .sort((left, right) => left.turn.position - right.turn.position)[0]?.turn.position ?? null)
    : null;
  const currentTurnIndex = Math.max(
    0,
    turns.findIndex((turn) => turn.position === activeTurnPosition),
  );
  const atFirstTurn = currentTurnIndex <= 0;
  const atLastTurn = currentTurnIndex >= turns.length - 1;

  const goToTurn = useCallback((position: number) => {
    setActiveTurnPosition(position);
    const section = transcriptRef.current?.querySelector<HTMLElement>(
      `[data-turn-section="${position}"]`,
    );
    if (!section) return;
    // Clear the site header (53px) and the sticky response headers (48px) plus
    // an 8px breath, rather than hiding the Turn heading under them.
    const top =
      section.getBoundingClientRect().top +
      window.scrollY -
      (TURN_SCROLL_OFFSET);
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    // The scroll below fires the observer; do not let it argue with the Turn
    // the reader just asked for while the page is still moving.
    navLockRef.current = Date.now() + 1500;
    window.scrollTo({ top: Math.max(0, top), behavior: reduce ? 'auto' : 'smooth' });
  }, []);

  // Keep the rail's "Turn n of m" honest while the reader scrolls the
  // transcript themselves. The last Turn whose top is above 200px wins.
  const turnKey = turns.map((turn) => turn.position).join(',');
  useEffect(() => {
    if (!multiTurn) return;
    const pickCurrentTurn = () => {
      const root = transcriptRef.current;
      if (!root || turns.length === 0) return;
      let next = turns[0]!.position;
      for (const turn of turns) {
        const section = root.querySelector<HTMLElement>(
          `[data-turn-section="${turn.position}"]`,
        );
        if (section && section.getBoundingClientRect().top < TURN_SPY_THRESHOLD) {
          next = turn.position;
        }
      }
      setActiveTurnPosition((current) => (current === next ? current : next));
    };

    let frame = 0;
    const onScroll = () => {
      if (Date.now() < navLockRef.current) return;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        pickCurrentTurn();
      });
    };
    // A finished programmatic scroll releases the observer at once instead of
    // waiting out the fallback lock.
    const onScrollEnd = () => {
      navLockRef.current = 0;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('scrollend', onScrollEnd);
    window.addEventListener('resize', onScroll);
    pickCurrentTurn();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('scrollend', onScrollEnd);
      window.removeEventListener('resize', onScroll);
    };
  }, [multiTurn, turnKey]);

  const turnForResponse = useCallback(
    (responseId: string) => {
      const response = responseList.find((item) => item.id === responseId);
      if (!response) return null;
      const index = turns.findIndex((turn) => turn.position === response.turn.position);
      return index < 0 ? null : { number: index + 1, total: turns.length };
    },
    [responseList, turns],
  );
  const activeAnnotation = popover?.mode === 'thread'
    ? annotations.find((annotation) => annotation.id === popover.id) ?? null
    : null;
  const activeAnnotationTurn = activeAnnotation
    ? turnForResponse(activeAnnotation.responseId)
    : null;
  const newAnnotationTurn = popover?.mode === 'new'
    ? turnForResponse(popover.responseId)
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
        rows.push({
          id: match.id,
          slug: match.slug,
          name: match.displayName,
          monogram: match.monogram,
        });
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
      closePopover(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const target = event.target as HTMLElement;
      // A nested Radix menu or the report form closes itself first.
      if (target.closest('[data-popover]') && !target.closest('[data-annotation-popover]')) {
        return;
      }
      // Escape in a text field with a draft keeps the popover open and only
      // leaves the field, so a reply is never discarded by a stray keypress.
      const field = target.closest('input, textarea, [contenteditable="true"]') as
        | HTMLInputElement
        | HTMLTextAreaElement
        | HTMLElement
        | null;
      if (field && 'value' in field && field.value.trim()) {
        // Keep focus inside the dialog so a screen reader stays in context;
        // the draft and the dialog both survive.
        popoverRef.current?.focus({ preventScroll: true });
        return;
      }
      closePopover();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [popover, closePopover]);

  // Move focus into the popover when it opens. The thread focuses its dialog
  // container so a screen reader announces it; a new Annotation starts in the
  // textarea, where the author is about to type.
  useEffect(() => {
    if (!popover) return;
    const node = popoverRef.current;
    if (!node) return;
    const target =
      popover.mode === 'new' ? node.querySelector<HTMLElement>('textarea') : node;
    target?.focus({ preventScroll: true });
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
      // Clamp a 320px popover inside the grid with a 4px edge.
      x: Math.max(
        0,
        Math.min(
          rect.left - grid.left,
          grid.width - (ANNOTATION_POPOVER_WIDTH + ANNOTATION_POPOVER_GUTTER),
        ),
      ),
      y: Math.max(0, rect.bottom - grid.top + 6),
    };
  };

  const openThread = (annotationId: string, trigger: HTMLElement) => {
    openerRef.current = trigger;
    const position = rel(trigger.getBoundingClientRect());
    setSelection(null);
    setPopover({ mode: 'thread', id: annotationId, ...position });
  };

  const captureSelection = () => {
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
        x: Math.max(
          0,
          Math.min(
            rect.left - grid.left,
            grid.width - (ANNOTATION_POPOVER_WIDTH + ANNOTATION_POPOVER_GUTTER),
          ),
        ),
        y: Math.max(0, rect.top - grid.top - 38),
        bottom: Math.max(0, rect.bottom - grid.top),
      });
    }, 0);
  };

  const openNew = (trigger: HTMLElement) => {
    if (!selection) return;
    openerRef.current = trigger;
    setNewBody('');
    setNewError(null);
    setPopover({
      mode: 'new',
      responseId: selection.responseId,
      startOffset: selection.startOffset,
      endOffset: selection.endOffset,
      quote: selection.quote,
      x: selection.x,
      y: selection.bottom + 6,
    });
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
      closePopover();
      return null;
    } catch {
      return 'Could not delete that annotation.';
    }
  };

  const addChallenger = async (model: AddableModel) => {
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
        turnCount?: number;
        responses?: Array<{ id: string; turnId: string; position: number }>;
        error?: { message?: string };
      };
      if (
        !response.ok ||
        !payload.jobId ||
        !payload.responseId ||
        !payload.responses?.length
      ) {
        setAddError(payload.error?.message ?? 'Could not add that model.');
        return;
      }

      // Show the whole Replay at once: one queued pane per stored Turn. The
      // server returns the Response ids so the Job's status events update these
      // exact rows as the Replay advances.
      const turnByPosition = new Map(
        responseList.map((item) => [item.turn.position, item.turn]),
      );
      const queuedViews: ComparisonResponseView[] = payload.responses.map((entry) => ({
        id: entry.id,
        jobId: payload.jobId!,
        isBase: false,
        contentMd: '',
        tokens: 0,
        latencyMs: null,
        status: 'queued',
        error: null,
        model: { slug: model.slug, name: model.displayName, monogram: model.monogram },
        turn: turnByPosition.get(entry.position) ?? {
          id: entry.turnId,
          position: entry.position,
          prompt: comparison.prompt,
        },
        blocks: [],
      }));
      setResponseList((current) => [...current, ...queuedViews]);
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
        // Skipping stops the Challenger here: this Turn and every later Turn of
        // the same model become skipped, matching the server's cascade.
        setResponseList((current) =>
          current.map((item) =>
            item.model.slug === responseView.model.slug &&
            item.turn.position >= responseView.turn.position
              ? { ...item, status: 'skipped', error: null }
              : item,
          ),
        );
        setActiveSlug((current) => {
          if (current !== responseView.model.slug) return current;
          const keptEarlierTurn = responseList.some(
            (item) =>
              item.model.slug === responseView.model.slug &&
              item.status === 'done' &&
              item.turn.position < responseView.turn.position,
          );
          if (keptEarlierTurn) return current;
          const fallback = responseList.find(
            (item) => !item.isBase && item.status === 'done',
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

  const copyResponse = async (response: ComparisonResponseView) => {
    try {
      await navigator.clipboard.writeText(copyResponseText(response));
      setCopiedResponseId(response.id);
      setTimeout(() => {
        setCopiedResponseId((current) => (current === response.id ? null : current));
      }, 1500);
    } catch {
      // Clipboard access can be refused; the button simply stays unchanged.
    }
  };

  const switchTab = (slug: string) => {
    setActiveSlug(slug);
    setPopover(null);
    const url = new URL(window.location.href);
    url.searchParams.set('model', slug);
    window.history.replaceState(null, '', `${url.pathname}${url.search}`);
  };

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader
        handle={handle}
        signedIn={viewerSignedIn}
        variant="page"
        signInHref={signInHref}
      />

      <main className="mx-auto flex w-full max-w-[1280px] flex-col gap-5 px-8 pb-[72px] pt-9">
        <ComparisonHead
          comparison={comparison}
          author={author}
          annotations={annotations}
          annOn={annOn}
          kind={kind}
          canWrite={canWrite}
          viewerSignedIn={viewerSignedIn}
          viewerSuspended={viewerSuspended}
          isAuthor={isAuthor}
          signInHref={signInHref}
          copied={copied}
          hasSelection={Boolean(selection)}
          onToggleAnnotations={() => {
            setAnnOn((value) => !value);
            setPopover(null);
            setSelection(null);
          }}
          onKindChange={(value) => {
            setKind(value);
            setPopover(null);
          }}
          onCopyLink={() => void copyLink()}
          onAnnotateSelection={(trigger) => openNew(trigger)}
        />

        {multiTurn && (
          <TurnRail
            turns={turns}
            currentIndex={currentTurnIndex}
            atFirst={atFirstTurn}
            atLast={atLastTurn}
            onPrevious={() => {
              const previous = turns[currentTurnIndex - 1];
              if (previous) goToTurn(previous.position);
            }}
            onNext={() => {
              const next = turns[currentTurnIndex + 1];
              if (next) goToTurn(next.position);
            }}
            onGoToTurn={goToTurn}
          />
        )}

        <div
          ref={gridRef}
          onMouseUp={captureSelection}
          onKeyUp={(event) => {
            // Caret browsing (F7) lets a keyboard user select text; releasing
            // Shift or an arrow key surfaces the same Annotate affordance.
            const target = event.target as HTMLElement;
            if (target.closest('input, textarea, [contenteditable="true"]')) return;
            if (event.key === 'Shift' || event.shiftKey) captureSelection();
          }}
          className="relative"
        >
          <div ref={transcriptRef} data-conversation-transcript>
            <ComparisonResponses
              turns={turns}
              multiTurn={multiTurn}
              responseList={responseList}
              baseModel={baseModel}
              annOn={annOn}
              kind={kind}
              annotations={visibleAnnotations}
              openAnnotationId={popover?.mode === 'thread' ? popover.id : null}
              onOpenAnnotation={openThread}
              activeStoppedAt={activeStoppedAt === null ? null : activeStoppedAt + 1}
              isAuthor={isAuthor}
              runBusy={runBusy}
              runError={runError}
              onRun={(response, action) => void actOnRun(response, action)}
              copiedResponseId={copiedResponseId}
              onCopyResponse={(response) => void copyResponse(response)}
              picker={{
                active,
                challengers,
                replayInProgress,
                canAdd,
                atCap,
                models: availableModels,
                addingModelId,
                addError,
                turnCount: turns.length,
                open: menuOpen,
                onOpenChange: (open) => {
                  setMenuOpen(open);
                  if (open) setAddError(null);
                },
                onSwitch: switchTab,
                onAdd: (model) => void addChallenger(model),
              }}
            />
          </div>

          {selection && !popover && canWrite && (
            <AnnotateSelectionButton selection={selection} onOpen={openNew} />
          )}

          {popover && (
            <AnnotationPopover
              popover={popover}
              panelRef={popoverRef}
              multiTurn={multiTurn}
              canWrite={canWrite}
              currentUserId={currentUserId}
              signInHref={signInHref}
              activeAnnotation={activeAnnotation}
              activeAnnotationTurn={activeAnnotationTurn}
              newAnnotationTurn={newAnnotationTurn}
              annotationPeople={annotationPeople}
              saving={saving}
              newKind={newKind}
              newBody={newBody}
              newError={newError}
              onNewKind={setNewKind}
              onNewBody={setNewBody}
              onSave={() => void saveAnnotation()}
              replyDraft={replyDraft}
              onReplyDraft={setReplyDraft}
              onSendReply={() => void sendReply()}
              onVote={(annotation) => void voteAnnotation(annotation)}
              onChangeKind={changeAnnotationKind}
              onDeleteAnnotation={deleteAnnotationAction}
              messageEdit={messageEdit}
              onStartMessageEdit={startMessageEdit}
              onMessageBody={(body) =>
                setMessageEdit((current) => (current ? { ...current, body } : current))
              }
              onSaveMessage={(annotation, message) =>
                void saveMessageEdit(annotation, message)
              }
              onCancelMessageEdit={() => setMessageEdit(null)}
              onDeleteMessage={deleteMessageAction}
              onClose={closePopover}
            />
          )}
        </div>

        <section className="flex max-w-[860px] flex-col gap-3.5 pt-[18px]">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="m-0 font-heading text-[16px] font-medium">Discussion</h2>
            <span data-comment-count className="text-[12px] text-neutral-500">
              {totalComments}
            </span>
            <div className="flex-1" />
            <SegmentedControl
              label="Filter discussion"
              className="flex-wrap"
              value={commentFilter}
              options={[
                { value: 'All', label: 'All' },
                ...commentModels.map((model) => ({ value: model.slug, label: model.name })),
                { value: 'General', label: 'General' },
              ]}
              onChange={setCommentFilter}
            />
          </div>

          {canWrite ? (
            <div className="flex flex-col gap-2 rounded-[2px] bg-surface p-2.5">
              <textarea
                ref={composerRef}
                aria-label="Write a comment"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Share what you noticed across the outputs…"
                rows={2}
                className="resize-y border-0 bg-transparent px-0.5 py-1 text-[12px] leading-[1.5] text-text"
              />
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-neutral-500">About</span>
                {[{ slug: null, name: 'General' }, ...commentModels].map((option) => {
                  const activeAbout = about === option.slug;
                  return (
                    <button
                      key={option.slug ?? 'general'}
                      type="button"
                      aria-pressed={activeAbout}
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
                        <span data-relative-time>{relativeTime(comment.createdAt)}</span>
                        {comment.aboutModel && (
                          <span className="flex h-[18px] items-center rounded-[2px] border border-neutral-700 px-1.5 text-[10.5px] font-medium text-neutral-200">
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
                              comment.voted
                                ? `Remove comment vote · ${comment.votes} votes`
                                : `Vote on comment · ${comment.votes} votes`
                            }
                            aria-pressed={comment.voted}
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
                                  · <span data-relative-time>{relativeTime(reply.createdAt)}</span>
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
                                      reply.voted
                                        ? `Remove reply vote · ${reply.votes} votes`
                                        : `Vote on reply · ${reply.votes} votes`
                                    }
                                    aria-pressed={reply.voted}
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
