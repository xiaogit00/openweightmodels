import { describe, expect, it } from 'vitest';
import type { CommentView } from '@owm/core/client';
import {
  countLiveComments,
  editCommentInTree,
} from '../src/lib/discussion';

const author = { id: 'user-1', handle: 'mira', avatarUrl: null, image: null };
const reader = { id: 'user-2', handle: 'kev', avatarUrl: null, image: null };

function comment(overrides: Partial<CommentView> & Pick<CommentView, 'id'>): CommentView {
  return {
    body: `Body ${overrides.id}`,
    createdAt: '2026-10-22T10:00:00.000Z',
    deletedAt: null,
    author,
    aboutModel: null,
    votes: 0,
    voted: false,
    replies: [],
    ...overrides,
  };
}

function tree(): CommentView[] {
  return [
    comment({
      id: 'root',
      replies: [
        comment({ id: 'reply-1', author: reader }),
        comment({ id: 'reply-2', author: reader, deletedAt: '2026-10-22T11:00:00.000Z' }),
      ],
    }),
    comment({ id: 'other' }),
  ];
}

describe('editCommentInTree', () => {
  it('edits a root comment without disturbing replies', () => {
    const next = editCommentInTree(tree(), 'root', 'Corrected body');
    expect(next[0]).toMatchObject({ id: 'root', body: 'Corrected body' });
    expect(next[0]?.replies).toHaveLength(2);
  });

  it('edits a nested reply in place', () => {
    const next = editCommentInTree(tree(), 'reply-1', 'Corrected reply');
    expect(next[0]?.replies[0]).toMatchObject({ id: 'reply-1', body: 'Corrected reply' });
    expect(next[1]).toMatchObject({ id: 'other' });
  });
});

describe('countLiveComments', () => {
  it('counts roots and replies but not tombstones', () => {
    expect(countLiveComments(tree())).toBe(3);
  });
});
