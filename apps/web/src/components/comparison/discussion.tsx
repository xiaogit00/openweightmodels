'use client';

import Link from 'next/link';
import { ArrowBendUpLeft, ArrowFatUp } from '@phosphor-icons/react';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { CommentView } from '@owm/core/client';
import { formatHandle, relativeTime } from '@owm/core/client';
import { Avatar } from '../avatar';
import { ReportControl } from '../report-control';
import { SegmentedControl } from '../ui/segmented-control';
import { cn } from '@/lib/utils';
import { countLiveComments, editCommentInTree } from '@/lib/discussion';
import { responseErrorMessage } from '@/lib/run-events';
import { ActionsMenu, InlineEditor } from './content-actions';
import { ErrorLine } from './turn-state';
import type { ComparisonPageData, ComparisonResponseView } from './types';

type CommentModel = {
  id: string;
  slug: string;
  name: string;
  monogram: string;
};

type Props = {
  comparisonId: string;
  initialComments: CommentView[];
  baseModel: ComparisonPageData['baseModel'];
  /** Every Challenger the reader can see, ready or not. */
  challengers: ComparisonResponseView[];
  models: ComparisonPageData['models'];
  currentUserId: string | null;
  canWrite: boolean;
  viewerSignedIn: boolean;
  viewerSuspended: boolean;
  signInHref: string;
  /** Sends a signed-out reader to sign in; true when it did. */
  requireSignIn: () => boolean;
};

/**
 * The Comparison Discussion: filter, composer, comments, one level of replies,
 * votes, reports and owner-only edit/delete. Owns its comment state and
 * optimistic mutations; the page only supplies the initial tree and identity.
 */
export function Discussion({
  comparisonId,
  initialComments,
  baseModel,
  challengers,
  models,
  currentUserId,
  canWrite,
  viewerSignedIn,
  viewerSuspended,
  signInHref,
  requireSignIn,
}: Props) {
  const [comments, setComments] = useState(initialComments);
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
  const composerRef = useRef<HTMLTextAreaElement>(null);

  // The filter only offers models whose output a reader can actually read: the
  // Base model plus finished Challengers. "About" offers the same set.
  const commentModels = useMemo(() => {
    const seen = new Set<string>();
    const rows: CommentModel[] = [];
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

  const resyncComments = useCallback(async () => {
    try {
      const response = await fetch(`/api/comparisons/${comparisonId}`, {
        cache: 'no-store',
      });
      if (!response.ok) return;
      const payload = (await response.json()) as { comments?: CommentView[] };
      if (Array.isArray(payload.comments)) setComments(payload.comments);
    } catch {
      // The next reload repairs the view.
    }
  }, [comparisonId]);

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
          comparisonId,
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
      // A new comment may be on a model the current filter hides.
      setCommentFilter('All');
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

  const actionRowClass =
    'flex items-center gap-4 text-[12.5px] font-medium text-neutral-400';
  const voteClass = (voted: boolean, own: boolean) =>
    cn(
      'flex items-center gap-1.5 transition-colors',
      voted && 'text-accent-300',
      own && 'cursor-not-allowed opacity-50',
    );

  return (
    <section className="flex max-w-[800px] flex-col gap-[18px] pt-8">
      <div className="flex flex-wrap items-center gap-2.5">
        <h2 className="m-0 font-heading text-[20px] font-medium tracking-[-0.01em]">
          Discussion
        </h2>
        <span data-comment-count className="text-[13px] text-neutral-400">
          {totalComments}
        </span>
        <div className="flex-1" />
        <SegmentedControl
          label="Filter discussion"
          className="max-w-full flex-wrap"
          itemClassName="text-[12.5px]"
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
        <div className="flex flex-col gap-2.5 rounded-[var(--r-lg)] border border-neutral-700 bg-surface px-3.5 pb-3 pt-3.5">
          <textarea
            ref={composerRef}
            aria-label="Write a comment"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Share what you noticed across the outputs…"
            rows={2}
            className="resize-y border-0 bg-transparent p-0.5 text-[14px] leading-[1.55] text-text"
          />
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-0.5 text-[12px] text-neutral-400">About</span>
            {[{ slug: null, name: 'General' }, ...commentModels].map((option) => {
              const activeAbout = about === option.slug;
              return (
                <button
                  key={option.slug ?? 'general'}
                  type="button"
                  aria-pressed={activeAbout}
                  onClick={() => setAbout(option.slug)}
                  className={cn(
                    'h-[22px] whitespace-nowrap rounded-[var(--r)] border px-2.5 text-[12px] font-medium transition-colors',
                    activeAbout
                      ? 'border-accent bg-accent-900 text-accent-200'
                      : 'border-neutral-700 text-neutral-300 hover:text-text',
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
              className={cn(
                'btn-secondary',
                !posting && 'border-accent text-accent-200',
              )}
            >
              Post
            </button>
          </div>
        </div>
      ) : viewerSuspended ? (
        <div className="flex flex-wrap items-center gap-2 rounded-[var(--r-lg)] border border-dashed border-danger bg-surface px-3.5 py-3">
          <span className="text-[13px] text-neutral-300">
            Your account is suspended, so the Discussion is read-only.
          </span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 rounded-[var(--r-lg)] border border-dashed border-neutral-700 bg-surface px-3.5 py-3">
          <span className="text-[13px] text-neutral-300">
            Sign in to join the discussion.
          </span>
          <Link href={signInHref} className="btn-secondary h-8">
            Sign in
          </Link>
        </div>
      )}

      <div className="flex flex-col">
        {filteredComments.length === 0 ? (
          comments.length === 0 ? (
            <span className="py-7 text-[14px] text-neutral-400">
              No comments yet. Be the first to share what you noticed.
            </span>
          ) : (
            <span className="py-4 text-[14px] text-neutral-400">No comments yet.</span>
          )
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
                className="flex gap-3.5 border-b border-neutral-800 py-5"
              >
                <Avatar handle={comment.author.handle} size={28} />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2 text-[13px] text-neutral-400">
                    <span className="font-medium text-neutral-100">
                      {formatHandle(comment.author.handle)}
                    </span>
                    <span data-relative-time>{relativeTime(comment.createdAt)}</span>
                    {comment.aboutModel && (
                      <span className="flex h-[22px] items-center rounded-[var(--r)] bg-neutral-800 px-2 text-[11.5px] font-medium text-neutral-200">
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
                    <div className="text-[14.5px] leading-[1.65] text-neutral-100 [text-wrap:pretty]">
                      {comment.deletedAt ? (
                        <span className="italic text-neutral-500">[deleted]</span>
                      ) : (
                        comment.body
                      )}
                    </div>
                  )}
                  {!comment.deletedAt && (
                    <div className={actionRowClass}>
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
                        className={voteClass(
                          comment.voted,
                          comment.author.id === currentUserId,
                        )}
                      >
                        <ArrowFatUp
                          size={14}
                          weight={comment.voted ? 'fill' : 'regular'}
                          aria-hidden
                        />
                        {comment.votes}
                      </button>
                      {canWrite && (
                        <button
                          type="button"
                          onClick={() => replyTo(comment)}
                          className="flex items-center gap-1.5 transition-colors hover:text-text"
                        >
                          <ArrowBendUpLeft size={14} aria-hidden />
                          Reply
                        </button>
                      )}
                      {canWrite && comment.author.id !== currentUserId && (
                        <ReportControl
                          targetType="comment"
                          targetId={comment.id}
                          signedIn={viewerSignedIn}
                          signInHref={signInHref}
                          className="text-[12.5px]"
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
                        className="mt-1.5 flex gap-2.5 border-l border-neutral-700 py-0.5 pl-4"
                      >
                        <Avatar handle={reply.author.handle} size={22} />
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                          <div className="flex items-center gap-1.5 text-[12.5px] text-neutral-400">
                            <span className="font-medium text-neutral-100">
                              {formatHandle(reply.author.handle)}
                            </span>
                            <span aria-hidden>·</span>
                            <span data-relative-time>{relativeTime(reply.createdAt)}</span>
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
                            <span className="text-[14px] leading-[1.6] text-neutral-100">
                              {reply.deletedAt ? (
                                <span className="italic text-neutral-500">[deleted]</span>
                              ) : (
                                reply.body
                              )}
                            </span>
                          )}
                          {!reply.deletedAt && (
                            <div className="mt-0.5 flex items-center gap-4 text-[12.5px] font-medium text-neutral-400">
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
                                className={voteClass(
                                  reply.voted,
                                  reply.author.id === currentUserId,
                                )}
                              >
                                <ArrowFatUp
                                  size={13}
                                  weight={reply.voted ? 'fill' : 'regular'}
                                  aria-hidden
                                />
                                {reply.votes}
                              </button>
                              {canWrite && reply.author.id !== currentUserId && (
                                <ReportControl
                                  targetType="comment"
                                  targetId={reply.id}
                                  signedIn={viewerSignedIn}
                                  signInHref={signInHref}
                                  className="text-[12.5px]"
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
  );
}
