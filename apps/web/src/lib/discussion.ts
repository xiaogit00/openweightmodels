import type { CommentView } from '@owm/core/client';

/**
 * Mirrors the server's comment rules in the browser so an edit updates the
 * Discussion without refetching the page.
 */
export function editCommentInTree(
  comments: CommentView[],
  id: string,
  body: string,
): CommentView[] {
  return comments.map((comment) => {
    if (comment.id === id) return { ...comment, body };
    if (!comment.replies.some((reply) => reply.id === id)) return comment;
    return {
      ...comment,
      replies: comment.replies.map((reply) =>
        reply.id === id ? { ...reply, body } : reply,
      ),
    };
  });
}

export function countLiveComments(comments: CommentView[]): number {
  return comments.reduce(
    (total, comment) =>
      total +
      (comment.deletedAt ? 0 : 1) +
      comment.replies.filter((reply) => !reply.deletedAt).length,
    0,
  );
}
