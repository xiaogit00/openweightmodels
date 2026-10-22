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
  AnnotationKind,
  ComparisonStatus,
  JobStatus,
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
    handle: text('handle').notNull(),
    email: text('email'),
    emailVerified: boolean('email_verified').notNull().default(false),
    name: text('name'),
    image: text('image'),
    avatarUrl: text('avatar_url'),
    role: text('role').$type<'user' | 'admin'>().notNull().default('user'),
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
    commentCount: integer('comment_count').notNull().default(0),
    annotationCount: integer('annotation_count').notNull().default(0),
  },
  (t) => [
    index('comparisons_published_at_idx').on(t.publishedAt),
    index('comparisons_created_at_idx').on(t.createdAt),
    index('comparisons_status_idx').on(t.status),
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
    uniqueIndex('responses_comparison_model_unique').on(t.comparisonId, t.modelId),
    uniqueIndex('responses_one_base_unique')
      .on(t.comparisonId)
      .where(sql`${t.isBase} = true`),
    index('responses_job_idx').on(t.jobId),
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
  },
  (t) => [index('annotations_response_idx').on(t.responseId)],
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
  },
  (t) => [
    index('comments_comparison_idx').on(t.comparisonId),
    index('comments_parent_idx').on(t.parentId),
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

export const schema = {
  users,
  models,
  comparisons,
  jobs,
  responses,
  annotations,
  annotationMessages,
  comments,
  votes,
  activityEvents,
  jobEvents,
  notifications,
};
