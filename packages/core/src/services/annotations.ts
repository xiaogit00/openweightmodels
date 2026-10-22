import { and, eq, isNull, lt, gt, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { getDb } from '../db/client';
import {
  annotationMessages,
  annotations,
  comparisons,
  models,
  responses,
  users,
} from '../db/schema';
import {
  ANNOTATION_KINDS,
  type AnnotationKind,
} from '../domain/types';
import { validateAnnotationRange, AnnotationRangeError } from '../domain/markdown';
import { logActivity, retractActivity } from '../events';
import { conflict, forbidden, notFound } from './errors';

async function responseContext(responseId: string) {
  const db = getDb();
  const [response] = await db
    .select()
    .from(responses)
    .where(eq(responses.id, responseId))
    .limit(1);
  if (!response) throw notFound('Response not found.');

  const [comparison] = await db
    .select()
    .from(comparisons)
    .where(eq(comparisons.id, response.comparisonId))
    .limit(1);
  if (!comparison || comparison.deletedAt) throw notFound('Comparison not found.');
  if (comparison.takedownAt) throw notFound('Comparison not found.');

  const [model] = await db
    .select()
    .from(models)
    .where(eq(models.id, response.modelId))
    .limit(1);

  return { response, comparison, model };
}

function assertCanView(
  comparison: { status: string; authorId: string },
  userId: string,
) {
  if (comparison.status !== 'published' && comparison.authorId !== userId) {
    throw notFound('Comparison not found.');
  }
}

function assertKind(kind: string): AnnotationKind {
  if (!ANNOTATION_KINDS.includes(kind as AnnotationKind)) {
    throw conflict('invalid_kind', 'Unknown annotation kind.');
  }
  return kind as AnnotationKind;
}

function assertBody(body: string) {
  const trimmed = body.trim();
  if (!trimmed) throw conflict('body_required', 'Write something first.');
  if (trimmed.length > 5000) throw conflict('body_too_long', 'That message is too long.');
  return trimmed;
}

export type CreateAnnotationInput = {
  userId: string;
  responseId: string;
  kind: string;
  startOffset: number;
  endOffset: number;
  body: string;
};

export async function createAnnotation(input: CreateAnnotationInput) {
  const db = getDb();
  const { response, comparison, model } = await responseContext(input.responseId);
  assertCanView(comparison, input.userId);
  const kind = assertKind(input.kind);
  const body = assertBody(input.body);

  let quote: string;
  try {
    const range = validateAnnotationRange(
      response.contentMd,
      input.startOffset,
      input.endOffset,
    );
    quote = range.quote;
  } catch (error) {
    if (error instanceof AnnotationRangeError) {
      throw conflict(error.code, error.message);
    }
    throw error;
  }

  const [overlap] = await db
    .select({ id: annotations.id })
    .from(annotations)
    .where(
      and(
        eq(annotations.responseId, input.responseId),
        isNull(annotations.deletedAt),
        lt(annotations.startOffset, input.endOffset),
        gt(annotations.endOffset, input.startOffset),
      ),
    )
    .limit(1);
  if (overlap) {
    throw conflict('annotation_overlap', 'That text already has an annotation.');
  }

  const annotationId = uuidv7();
  const messageId = uuidv7();

  await db.transaction(async (tx) => {
    await tx.insert(annotations).values({
      id: annotationId,
      responseId: input.responseId,
      authorId: input.userId,
      kind,
      startOffset: input.startOffset,
      endOffset: input.endOffset,
      quote,
    });
    await tx.insert(annotationMessages).values({
      id: messageId,
      annotationId,
      authorId: input.userId,
      body,
    });
    await tx
      .update(comparisons)
      .set({ annotationCount: sql`${comparisons.annotationCount} + 1` })
      .where(eq(comparisons.id, comparison.id));
  });

  const [author] = await db
    .select()
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);

  await logActivity({
    kind: 'annotation.created',
    actorId: input.userId,
    comparisonId: comparison.id,
    modelId: response.modelId,
    summary: `${author?.handle ?? 'someone'} annotated ${model?.displayName ?? 'a response'}`,
    payload: { annotationId, responseId: input.responseId },
  });

  return {
    id: annotationId,
    responseId: input.responseId,
    kind,
    startOffset: input.startOffset,
    endOffset: input.endOffset,
    quote,
    createdAt: new Date().toISOString(),
    author: {
      id: input.userId,
      handle: author?.handle ?? 'unknown',
      avatarUrl: author?.avatarUrl ?? author?.image ?? null,
      image: author?.image ?? null,
    },
    votes: 0,
    voted: false,
    thread: [
      {
        id: messageId,
        body,
        createdAt: new Date().toISOString(),
        deletedAt: null,
        author: {
          id: input.userId,
          handle: author?.handle ?? 'unknown',
          avatarUrl: author?.avatarUrl ?? author?.image ?? null,
          image: author?.image ?? null,
        },
      },
    ],
  };
}

async function ownedAnnotation(id: string, userId: string) {
  const db = getDb();
  const [annotation] = await db
    .select()
    .from(annotations)
    .where(and(eq(annotations.id, id), isNull(annotations.deletedAt)))
    .limit(1);
  if (!annotation) throw notFound('Annotation not found.');
  if (annotation.authorId !== userId) throw forbidden('That annotation is not yours.');
  return annotation;
}

export async function updateAnnotation(
  id: string,
  userId: string,
  kind: string,
) {
  const db = getDb();
  await ownedAnnotation(id, userId);
  await db
    .update(annotations)
    .set({ kind: assertKind(kind) })
    .where(eq(annotations.id, id));
}

export async function deleteAnnotation(id: string, userId: string) {
  const db = getDb();
  const annotation = await ownedAnnotation(id, userId);
  const [response] = await db
    .select({ comparisonId: responses.comparisonId })
    .from(responses)
    .where(eq(responses.id, annotation.responseId))
    .limit(1);

  await db.transaction(async (tx) => {
    await tx
      .update(annotations)
      .set({ deletedAt: new Date() })
      .where(eq(annotations.id, id));
    if (response) {
      await tx
        .update(comparisons)
        .set({ annotationCount: sql`greatest(0, ${comparisons.annotationCount} - 1)` })
        .where(eq(comparisons.id, response.comparisonId));
    }
  });

  if (response) {
    await retractActivity({
      kind: 'annotation.deleted',
      comparisonId: response.comparisonId,
      payload: { annotationId: id },
      match: { annotationId: id },
    });
  }
}

export async function addAnnotationMessage(
  annotationId: string,
  userId: string,
  body: string,
) {
  const db = getDb();
  const [annotation] = await db
    .select()
    .from(annotations)
    .where(and(eq(annotations.id, annotationId), isNull(annotations.deletedAt)))
    .limit(1);
  if (!annotation) throw notFound('Annotation not found.');

  const { comparison, response, model } = await responseContext(annotation.responseId);
  assertCanView(comparison, userId);
  const trimmed = assertBody(body);
  const messageId = uuidv7();

  await db.insert(annotationMessages).values({
    id: messageId,
    annotationId,
    authorId: userId,
    body: trimmed,
  });

  const [author] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  await logActivity({
    kind: 'annotation.replied',
    actorId: userId,
    comparisonId: comparison.id,
    modelId: response.modelId,
    summary: `${author?.handle ?? 'someone'} replied on ${model?.displayName ?? 'a response'}`,
    payload: { annotationId, messageId },
  });

  return {
    id: messageId,
    body: trimmed,
    createdAt: new Date().toISOString(),
    deletedAt: null,
    author: {
      id: userId,
      handle: author?.handle ?? 'unknown',
      avatarUrl: author?.avatarUrl ?? author?.image ?? null,
      image: author?.image ?? null,
    },
  };
}

async function ownedMessage(annotationId: string, messageId: string, userId: string) {
  const db = getDb();
  const [message] = await db
    .select()
    .from(annotationMessages)
    .where(
      and(
        eq(annotationMessages.id, messageId),
        eq(annotationMessages.annotationId, annotationId),
        isNull(annotationMessages.deletedAt),
      ),
    )
    .limit(1);
  if (!message) throw notFound('Message not found.');
  if (message.authorId !== userId) throw forbidden('That message is not yours.');
  return message;
}

export async function updateAnnotationMessage(
  annotationId: string,
  messageId: string,
  userId: string,
  body: string,
) {
  const db = getDb();
  await ownedMessage(annotationId, messageId, userId);
  await db
    .update(annotationMessages)
    .set({ body: assertBody(body) })
    .where(eq(annotationMessages.id, messageId));
}

export async function deleteAnnotationMessage(
  annotationId: string,
  messageId: string,
  userId: string,
) {
  const db = getDb();
  await ownedMessage(annotationId, messageId, userId);
  await db
    .update(annotationMessages)
    .set({ deletedAt: new Date() })
    .where(eq(annotationMessages.id, messageId));

  const [annotation] = await db
    .select({ responseId: annotations.responseId })
    .from(annotations)
    .where(eq(annotations.id, annotationId))
    .limit(1);
  if (!annotation) return;

  const { comparison } = await responseContext(annotation.responseId);
  await retractActivity({
    kind: 'annotation.message.deleted',
    comparisonId: comparison.id,
    payload: { annotationId, messageId },
    match: { messageId },
  });
}
