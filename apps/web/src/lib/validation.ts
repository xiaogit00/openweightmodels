import { ANNOTATION_KINDS, CATEGORIES } from '@owm/core';
import { z } from 'zod';

export const annotationCreateSchema = z.object({
  responseId: z.string().min(1),
  kind: z.enum(ANNOTATION_KINDS),
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().positive(),
  body: z.string().min(1).max(5000),
});

export const annotationPatchSchema = z.object({
  kind: z.enum(ANNOTATION_KINDS),
});

export const messageCreateSchema = z.object({
  body: z.string().min(1).max(5000),
});

export const commentCreateSchema = z.object({
  comparisonId: z.string().min(1),
  parentId: z.string().min(1).nullable().optional(),
  aboutModelId: z.string().min(1).nullable().optional(),
  body: z.string().min(1).max(5000),
});

export const commentPatchSchema = z.object({
  body: z.string().min(1).max(5000),
});

export const voteSchema = z.object({
  targetType: z.enum(['comment', 'annotation']),
  targetId: z.string().min(1),
});

export const comparisonPatchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  categories: z.array(z.enum(CATEGORIES)).optional(),
  effort: z.number().int().min(1).max(3).optional(),
});

export const responseCreateSchema = z.object({
  modelId: z.string().min(1),
});

export const notificationPatchSchema = z.object({
  id: z.string().min(1).optional(),
  all: z.boolean().optional(),
});
