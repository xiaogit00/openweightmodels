export const CATEGORIES = [
  'Coding',
  'Reasoning',
  'Creative',
  'Math',
  'Long-context',
  'Language',
] as const;

export type Category = (typeof CATEGORIES)[number];

/** The slot a Model occupies within its family in the curated registry. */
export type ModelRelease = 'current' | 'previous';

export const EFFORT_LEVELS = [
  { value: 1, label: 'Low', sub: 'Quick prompt' },
  { value: 2, label: 'Med', sub: 'Multi-step' },
  { value: 3, label: 'High', sub: 'Hard / long' },
] as const;

export const ANNOTATION_KINDS = ['bug', 'hallucination', 'good', 'question'] as const;

export type AnnotationKind = (typeof ANNOTATION_KINDS)[number];

export const ANNOTATION_KIND_META: Record<
  AnnotationKind,
  { label: string; icon: string }
> = {
  bug: { label: 'Bug', icon: 'ph-bug' },
  hallucination: { label: 'Hallucination', icon: 'ph-ghost' },
  good: { label: 'Good', icon: 'ph-thumbs-up' },
  question: { label: 'Question', icon: 'ph-question' },
};

export const SORTS = ['live', 'top', 'new'] as const;
export type Sort = (typeof SORTS)[number];

export const COMPARISON_STATUSES = [
  'draft',
  'generating',
  'ready',
  'published',
  'failed',
] as const;
export type ComparisonStatus = (typeof COMPARISON_STATUSES)[number];

export const RESPONSE_STATUSES = [
  'queued',
  'calling',
  'streaming',
  'done',
  'failed',
  'skipped',
] as const;
export type ResponseStatus = (typeof RESPONSE_STATUSES)[number];

export const JOB_STATUSES = [
  'scheduled',
  'resolving',
  'running',
  'ready',
  'failed',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Append-only audit actions on the minimal Admin surface. */
export const ADMIN_ACTION_KINDS = [
  'model.enabled',
  'model.disabled',
  'comparison.takedown',
  'comparison.restored',
  'comment.hidden',
  'comment.restored',
  'annotation.hidden',
  'annotation.restored',
  'user.suspended',
  'user.reinstated',
  'report.resolved',
  'report.dismissed',
] as const;
export type AdminActionKind = (typeof ADMIN_ACTION_KINDS)[number];

/** What an audit row points at. Report and content targets share this column. */
export const ADMIN_TARGET_TYPES = [
  'model',
  'comparison',
  'comment',
  'annotation',
  'user',
  'report',
] as const;
export type AdminTargetType = (typeof ADMIN_TARGET_TYPES)[number];

/** Why a reader asked an Admin to look at content. */
export const REPORT_REASONS = [
  'spam',
  'harassment',
  'hate',
  'sexual',
  'misinformation',
  'other',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_REASON_META: Record<ReportReason, string> = {
  spam: 'Spam or advertising',
  harassment: 'Harassment or bullying',
  hate: 'Hate speech',
  sexual: 'Sexual content',
  misinformation: 'Misinformation',
  other: 'Something else',
};

export const REPORT_TARGETS = ['comparison', 'comment', 'annotation'] as const;
export type ReportTarget = (typeof REPORT_TARGETS)[number];

export const REPORT_STATUSES = ['open', 'resolved', 'dismissed'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export type VoteTarget = 'comment' | 'annotation';

export type CardModel = {
  id: string;
  slug: string;
  name: string;
  monogram: string;
};

export type ComparisonCard = {
  id: string;
  /** The Author's editable title, used for the Comparison page heading. */
  title: string;
  /** The first Turn's Prompt. The Board headlines a Conversation with it. */
  headline: string;
  /** Number of Turns in the Conversation. A one-Turn Comparison is `1`. */
  turnCount: number;
  categories: string[];
  effort: number;
  models: CardModel[];
  baseSnippet: string;
  challengerSnippet: string;
  commentCount: number;
  annotationCount: number;
  author: { handle: string; avatarUrl: string | null };
  publishedAt: string;
  createdAt: string;
};

export type BoardFilters = {
  cat: string;
  models: string[];
  effort: number | null;
  q: string;
  sort: Sort;
};

/** One page of the Board, keyset-paginated by `nextCursor`. */
export type BoardPage = {
  items: ComparisonCard[];
  total: number;
  nextCursor: string | null;
};

/**
 * Sidebar counts for the whole published Board, deliberately ignoring the
 * reader's active filters. `total` is the number of published Comparisons.
 */
export type BoardFacets = {
  categories: Record<string, number>;
  models: Record<string, number>;
  total: number;
};

export type JobRunState = {
  id: string;
  modelId: string;
  modelName: string;
  monogram: string;
  status: ResponseStatus;
  tokens: number;
  latencyMs: number | null;
  error: string | null;
  attempt: number;
  progress: number;
  turnId: string;
  /** One-based Turn number this Response answers. */
  turnNumber: number;
  /** Number of Turns in the whole Conversation. */
  turnCount: number;
};

/**
 * Progress shown on the Job page. Shared by the server snapshot and the live
 * SSE updates so a reconnecting client never jumps backwards.
 */
export function runProgress(status: ResponseStatus, tokens: number): number {
  if (status === 'done' || status === 'skipped') return 100;
  if (status === 'streaming') return Math.min(95, Math.max(6, Math.round((tokens / 900) * 100)));
  if (status === 'failed') return 45;
  if (status === 'calling') return 6;
  return 0;
}

/** A Run the Author is still waiting on, whether queued, calling or streaming. */
export function isPendingResponse(status: ResponseStatus): boolean {
  return status === 'queued' || status === 'calling' || status === 'streaming';
}

export type PublicUser = {
  id: string;
  handle: string;
  avatarUrl: string | null;
  image: string | null;
};

/**
 * The public handle used for content whose author deleted their account. It is
 * not a claimable handle and is rendered as `[deleted]`, never as `@deleted`.
 */
export const DELETED_AUTHOR_HANDLE = 'deleted';

/** `@handle`, or the unlinked `[deleted]` marker once the account is gone. */
export function formatHandle(handle: string): string {
  return handle === DELETED_AUTHOR_HANDLE ? '[deleted]' : `@${handle}`;
}

export type AnnotationThreadMessage = {
  id: string;
  body: string;
  createdAt: string;
  deletedAt: string | null;
  author: PublicUser;
};

export type AnnotationView = {
  id: string;
  responseId: string;
  kind: string;
  startOffset: number;
  endOffset: number;
  quote: string;
  createdAt: string;
  author: PublicUser;
  votes: number;
  voted: boolean;
  thread: AnnotationThreadMessage[];
};

export type CommentView = {
  id: string;
  body: string;
  createdAt: string;
  deletedAt: string | null;
  author: PublicUser;
  aboutModel: { slug: string; name: string } | null;
  votes: number;
  voted: boolean;
  replies: CommentView[];
};
