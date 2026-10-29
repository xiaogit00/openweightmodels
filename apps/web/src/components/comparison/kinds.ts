import { Bug, Ghost, Question, Stack, ThumbsUp } from '@phosphor-icons/react';
import type { AnnotationKind } from '@owm/core/client';
import { ANNOTATION_KIND_META, ANNOTATION_KINDS } from '@owm/core/client';

export const KIND_ICONS: Record<AnnotationKind, typeof Bug> = {
  bug: Bug,
  hallucination: Ghost,
  good: ThumbsUp,
  question: Question,
};

export const KIND_FILTERS: Array<{
  value: 'All' | AnnotationKind;
  label: string;
  Icon: typeof Bug;
}> = [
  { value: 'All', label: 'All', Icon: Stack },
  ...ANNOTATION_KINDS.map((kind) => ({
    value: kind,
    label: ANNOTATION_KIND_META[kind].label,
    Icon: KIND_ICONS[kind],
  })),
];
