import {
  ANNOTATION_KINDS,
  CATEGORIES,
  HANDLE_MAX_LENGTH,
  REPORT_REASONS,
  REPORT_TARGETS,
} from '@owm/core';
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

export const notificationPatchSchema = z.union([
  z.object({ id: z.string().min(1) }),
  z.object({ all: z.literal(true) }),
]);

export const handleSchema = z.object({
  handle: z.string().min(1).max(HANDLE_MAX_LENGTH),
});

export const deleteAccountSchema = z.object({
  // The service checks the word; the limit just bounds the body.
  confirmation: z.string().max(40),
});

export const adminModelPatchSchema = z.object({
  enabled: z.boolean(),
});

export const reportCreateSchema = z.object({
  targetType: z.enum(REPORT_TARGETS),
  targetId: z.string().min(1),
  reason: z.enum(REPORT_REASONS),
  detail: z.string().trim().max(500).nullable().optional(),
});

export const adminReasonSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

export const adminRestoreSchema = z.object({
  targetType: z.enum(['comment', 'annotation']),
  targetId: z.string().min(1),
  reason: z.string().trim().max(500).nullable().optional(),
});

export const adminOptionalReasonSchema = z.object({
  reason: z.string().trim().max(500).nullable().optional(),
});

export const adminDismissSchema = z.object({
  note: z.string().trim().max(500).nullable().optional(),
});
