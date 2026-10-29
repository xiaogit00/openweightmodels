import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import type {
  AdminActionKind,
  AdminTargetType,
  AnnotationKind,
  ComparisonStatus,
  JobStatus,
  ReportReason,
  ReportStatus,
  ReportTarget,
  ResponseStatus,
  VoteTarget,
} from '../domain/types';

const id = () =>
  uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7());

const createdAt = () =>
  timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow();

export const users = pgTable(
  'users',
  {
    id: id(),
    // Null until a first-time magic-link user chooses a handle on onboarding.
    // Existing seeded and fixture users were created with one.
    handle: text('handle'),
    email: text('email'),
    emailVerified: boolean('email_verified').notNull().default(false),
    name: text('name'),
    image: text('image'),
    avatarUrl: text('avatar_url'),
    role: text('role').$type<'user' | 'admin'>().notNull().default('user'),
    // Suspension blocks writes but not reads. Existing content stays public
    // unless an Admin hides it separately, so every removal is attributable.
    suspendedAt: timestamp('suspended_at', { withTimezone: true, mode: 'date' }),
    suspendedById: uuid('suspended_by_id').references((): AnyPgColumn => users.id, {
      onDelete: 'set null',
    }),
    suspensionReason: text('suspension_reason'),
    // Account deletion keeps the row so published Comparisons and the replies
    // other people wrote under its comments do not disappear. Every personal
    // field (email, handle, name, avatar) is cleared at the same time.
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('users_handle_unique').on(t.handle),
    uniqueIndex('users_email_unique').on(t.email),
  ],
);

export const models = pgTable(
  'models',
  {
    id: id(),
    slug: text('slug').notNull(),
    displayName: text('display_name').notNull(),
    monogram: text('monogram').notNull(),
    provider: text('provider').notNull(),
    apiBase: text('api_base'),
    apiModelId: text('api_model_id'),
    etaSeconds: integer('eta_seconds').notNull().default(8),
    // Published weights versus a closed frontier API. Existing rows predate
    // the distinction and were all open-weight.
    openWeights: boolean('open_weights').notNull().default(true),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('models_slug_unique').on(t.slug)],
);

export const comparisons = pgTable(
  'comparisons',
  {
    id: id(),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    prompt: text('prompt').notNull(),
    categories: text('categories')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    effort: smallint('effort').notNull().default(1),
    baseModelId: uuid('base_model_id')
      .notNull()
      .references(() => models.id),
    status: text('status').$type<ComparisonStatus>().notNull().default('generating'),
    createdAt: createdAt(),
    publishedAt: timestamp('published_at', { withTimezone: true, mode: 'date' }),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
    takedownAt: timestamp('takedown_at', { withTimezone: true, mode: 'date' }),
    takedownById: uuid('takedown_by_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    takedownReason: text('takedown_reason'),
    commentCount: integer('comment_count').notNull().default(0),
    annotationCount: integer('annotation_count').notNull().default(0),
  },
  (t) => [
    index('comparisons_published_at_idx').on(t.publishedAt),
    index('comparisons_created_at_idx').on(t.createdAt),
    index('comparisons_status_idx').on(t.status),
    index('comparisons_takedown_idx').on(t.takedownAt),
  ],
);

/**
 * One user message in a Conversation. A Comparison with a single Prompt has
 * exactly one Turn; `comparisons.prompt` stays as the denormalised headline so
 * Board search and the Job page never need a join to find the first Prompt.
 */
export const turns = pgTable(
  'turns',
  {
    id: id(),
    comparisonId: uuid('comparison_id')
      .notNull()
      .references(() => comparisons.id, { onDelete: 'cascade' }),
    /** Zero-based position in reading order. */
    position: smallint('position').notNull(),
    prompt: text('prompt').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('turns_comparison_position_unique').on(t.comparisonId, t.position),
    index('turns_comparison_idx').on(t.comparisonId),
  ],
);

export const jobs = pgTable(
  'jobs',
  {
    id: id(),
    comparisonId: uuid('comparison_id')
      .notNull()
      .references(() => comparisons.id, { onDelete: 'cascade' }),
    status: text('status').$type<JobStatus>().notNull().default('scheduled'),
    createdAt: createdAt(),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
    finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [index('jobs_comparison_idx').on(t.comparisonId)],
);

export const responses = pgTable(
  'responses',
  {
    id: id(),
    comparisonId: uuid('comparison_id')
      .notNull()
      .references(() => comparisons.id, { onDelete: 'cascade' }),
    turnId: uuid('turn_id')
      .notNull()
      .references(() => turns.id, { onDelete: 'cascade' }),
    jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'set null' }),
    modelId: uuid('model_id')
      .notNull()
      .references(() => models.id),
    isBase: boolean('is_base').notNull().default(false),
    contentMd: text('content_md').notNull().default(''),
    tokens: integer('tokens').notNull().default(0),
    latencyMs: integer('latency_ms'),
    status: text('status').$type<ResponseStatus>().notNull().default('queued'),
    error: text('error'),
    attempt: integer('attempt').notNull().default(0),
    costUsd: numeric('cost_usd', { precision: 12, scale: 6 }),
    createdAt: createdAt(),
    finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    // One Model answers a Turn at most once; the script is never duplicated
    // per Model because the Turn stores the Prompt.
    uniqueIndex('responses_turn_model_unique').on(t.turnId, t.modelId),
    uniqueIndex('responses_one_base_per_turn_unique')
      .on(t.turnId)
      .where(sql`${t.isBase} = true`),
    index('responses_job_idx').on(t.jobId),
    index('responses_comparison_idx').on(t.comparisonId),
  ],
);

export const annotations = pgTable(
  'annotations',
  {
    id: id(),
    responseId: uuid('response_id')
      .notNull()
      .references(() => responses.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<AnnotationKind>().notNull(),
    startOffset: integer('start_offset').notNull(),
    endOffset: integer('end_offset').notNull(),
    quote: text('quote').notNull(),
    createdAt: createdAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
    // Set by moderation; unlike `deleted_at` the Author did not remove it.
    hiddenAt: timestamp('hidden_at', { withTimezone: true, mode: 'date' }),
    hiddenById: uuid('hidden_by_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    hiddenReason: text('hidden_reason'),
  },
  (t) => [
    index('annotations_response_idx').on(t.responseId),
    index('annotations_hidden_idx').on(t.hiddenAt),
  ],
);

export const annotationMessages = pgTable(
  'annotation_messages',
  {
    id: id(),
    annotationId: uuid('annotation_id')
      .notNull()
      .references(() => annotations.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    createdAt: createdAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [index('annotation_messages_annotation_idx').on(t.annotationId)],
);

export const comments = pgTable(
  'comments',
  {
    id: id(),
    comparisonId: uuid('comparison_id')
      .notNull()
      .references(() => comparisons.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id').references((): AnyPgColumn => comments.id, {
      onDelete: 'cascade',
    }),
    aboutModelId: uuid('about_model_id').references(() => models.id, {
      onDelete: 'set null',
    }),
    body: text('body').notNull(),
    createdAt: createdAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
    // Set by moderation; unlike `deleted_at` the Author did not remove it.
    hiddenAt: timestamp('hidden_at', { withTimezone: true, mode: 'date' }),
    hiddenById: uuid('hidden_by_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    hiddenReason: text('hidden_reason'),
  },
  (t) => [
    index('comments_comparison_idx').on(t.comparisonId),
    index('comments_parent_idx').on(t.parentId),
    index('comments_hidden_idx').on(t.hiddenAt),
  ],
);

export const votes = pgTable(
  'votes',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    targetType: text('target_type').$type<VoteTarget>().notNull(),
    targetId: uuid('target_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('votes_target_unique').on(t.userId, t.targetType, t.targetId),
    index('votes_target_idx').on(t.targetType, t.targetId),
  ],
);

export const activityEvents = pgTable(
  'activity_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    kind: text('kind').notNull(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    comparisonId: uuid('comparison_id').references(() => comparisons.id, {
      onDelete: 'cascade',
    }),
    modelId: uuid('model_id').references(() => models.id, { onDelete: 'set null' }),
    summary: text('summary').notNull().default(''),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index('activity_events_created_idx').on(t.createdAt)],
);

/**
 * Append-only audit trail for admin actions. Activity events are public ticker
 * content; this table is the attributable record an Admin surface reads back.
 */
export const adminActions = pgTable(
  'admin_actions',
  {
    id: id(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').$type<AdminActionKind>().notNull(),
    targetType: text('target_type').$type<AdminTargetType>().notNull(),
    targetId: uuid('target_id').notNull(),
    reason: text('reason'),
    createdAt: createdAt(),
  },
  (t) => [
    index('admin_actions_created_idx').on(t.createdAt),
    index('admin_actions_target_idx').on(t.targetType, t.targetId),
  ],
);

/**
 * A reader's request for an Admin to review content. One row per reporter per
 * target: repeating a report is idempotent instead of piling up duplicates.
 * Reports are never published to the Board.
 */
export const reports = pgTable(
  'reports',
  {
    id: id(),
    reporterId: uuid('reporter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    targetType: text('target_type').$type<ReportTarget>().notNull(),
    targetId: uuid('target_id').notNull(),
    reason: text('reason').$type<ReportReason>().notNull(),
    detail: text('detail'),
    status: text('status').$type<ReportStatus>().notNull().default('open'),
    resolvedById: uuid('resolved_by_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    resolution: text('resolution'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('reports_reporter_target_unique').on(
      t.reporterId,
      t.targetType,
      t.targetId,
    ),
    index('reports_status_idx').on(t.status, t.createdAt),
    index('reports_target_idx').on(t.targetType, t.targetId),
  ],
);

export const jobEvents = pgTable(
  'job_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    responseId: uuid('response_id').references(() => responses.id, {
      onDelete: 'cascade',
    }),
    kind: text('kind').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index('job_events_job_idx').on(t.jobId)],
);

export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    readAt: timestamp('read_at', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('notifications_user_idx').on(t.userId, t.readAt),
    // One job-ready notification per Author per Job, even if two workers
    // finalise the same Job at the same moment.
    uniqueIndex('notifications_job_ready_unique')
      .on(t.userId, t.kind, sql`(${t.payload}->>'jobId')`)
      .where(sql`${t.kind} = 'job.ready'`),
  ],
);

// --- Better Auth tables (ADR 0005) ----------------------------------------
// Better Auth owns their lifecycle; the application reads `users` only. Field
// and table names match Better Auth's core schema so the Drizzle adapter can
// be pointed at them directly.

export const authSessions = pgTable(
  'auth_sessions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('auth_sessions_token_unique').on(t.token),
    index('auth_sessions_user_idx').on(t.userId),
  ],
);

export const authAccounts = pgTable(
  'auth_accounts',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', {
      withTimezone: true,
      mode: 'date',
    }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', {
      withTimezone: true,
      mode: 'date',
    }),
    scope: text('scope'),
    password: text('password'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('auth_accounts_user_idx').on(t.userId)],
);

export const authVerifications = pgTable(
  'auth_verifications',
  {
    id: id(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('auth_verifications_identifier_idx').on(t.identifier)],
);

export const schema = {
  users,
  models,
  comparisons,
  turns,
  jobs,
  responses,
  annotations,
  annotationMessages,
  comments,
  votes,
  activityEvents,
  adminActions,
  reports,
  jobEvents,
  notifications,
  authSessions,
  authAccounts,
  authVerifications,
};
