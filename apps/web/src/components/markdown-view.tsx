'use client';

import type { AnnotationView, Block, Run } from '@owm/core/client';
import { ANNOTATION_KIND_META } from '@owm/core/client';
import { cn } from '@/lib/utils';

type Props = {
  responseId: string;
  blocks: Block[];
  annotations: AnnotationView[];
  annOn: boolean;
  kindFilter: string;
  openId: string | null;
  onOpen: (annotationId: string, trigger: HTMLElement) => void;
};

function runStyle(run: Run) {
  return {
    fontWeight: run.marks.bold ? 600 : undefined,
    fontStyle: run.marks.italic ? 'italic' : undefined,
    textDecoration: run.marks.href ? 'underline' : undefined,
    color: run.marks.href ? 'var(--color-accent-300)' : undefined,
  } as React.CSSProperties;
}

function RunText({
  run,
  responseId,
  annotations,
  annOn,
  kindFilter,
  openId,
  onOpen,
  code = false,
}: Props & { run: Run; code?: boolean }) {
  const marks = run.marks;
  const visible = annOn && run.annotatable
    ? annotations
        .filter(
          (annotation) =>
            annotation.responseId === responseId &&
            (kindFilter === 'All' || annotation.kind === kindFilter) &&
            annotation.endOffset > run.start &&
            annotation.startOffset < run.start + run.text.length,
        )
        .sort((a, b) => a.startOffset - b.startOffset)
    : [];

  const parts: React.ReactNode[] = [];
  let cursor = 0;

  for (const annotation of visible) {
    const start = Math.max(0, annotation.startOffset - run.start);
    const end = Math.min(run.text.length, annotation.endOffset - run.start);
    if (end <= start) continue;
    if (start > cursor) {
      parts.push(
        <span key={`${run.start}-${cursor}-plain`}>{run.text.slice(cursor, start)}</span>,
      );
    }
    const open = openId === annotation.id;
    const kindLabel =
      ANNOTATION_KIND_META[annotation.kind as keyof typeof ANNOTATION_KIND_META]?.label ??
      'Annotation';
    parts.push(
      <span
        key={annotation.id}
        id={`annotation-${annotation.id}`}
        data-annotation-span="1"
        data-annotation-id={annotation.id}
        role="button"
        tabIndex={0}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Open ${kindLabel} annotation: ${annotation.quote}`}
        onClick={(event) => onOpen(annotation.id, event.currentTarget)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          onOpen(annotation.id, event.currentTarget);
        }}
        style={{
          background: code
            ? `color-mix(in oklab, var(--color-accent) ${open ? 48 : 30}%, transparent)`
            : open
              ? 'var(--color-accent-800)'
              : 'var(--color-accent-900)',
          boxShadow: 'inset 0 -1.5px 0 var(--color-accent)',
          cursor: 'pointer',
          borderRadius: 2,
        }}
      >
        {run.text.slice(start, end)}
      </span>,
    );
    cursor = end;
  }

  if (cursor < run.text.length) {
    parts.push(<span key={`${run.start}-${cursor}-tail`}>{run.text.slice(cursor)}</span>);
  }

  return (
    <span
      data-run="1"
      data-response={responseId}
      data-start={run.start}
      data-annotatable={run.annotatable ? '1' : '0'}
      style={runStyle(run)}
      className={cn(
        marks.code &&
          !code &&
          'rounded-[var(--r)] bg-neutral-800 px-1 py-px text-[12.5px] text-neutral-200',
        marks.code && code && 'text-neutral-200',
      )}
    >
      {parts.length ? parts : run.text}
    </span>
  );
}

function Inline({ runs, ...rest }: Props & { runs: Run[] }) {
  return (
    <>
      {runs.map((run, index) => (
        <RunText key={`${run.start}-${index}`} run={run} {...rest} />
      ))}
    </>
  );
}

const paragraph =
  'm-0 break-words text-[14.5px] font-normal leading-[1.7] text-neutral-100 [text-wrap:pretty]';

export function MarkdownView(props: Props) {
  const { blocks } = props;

  return (
    <div className="flex flex-col gap-3.5">
      {blocks.map((block, index) => {
        if (block.type === 'paragraph') {
          return (
            <p key={index} className={paragraph}>
              <Inline runs={block.runs} {...props} />
            </p>
          );
        }
        if (block.type === 'heading') {
          return (
            <p
              key={index}
              className={cn(
                'm-0 font-heading font-medium text-text',
                block.depth <= 2 ? 'text-[17px]' : 'text-[15px]',
              )}
            >
              <Inline runs={block.runs} {...props} />
            </p>
          );
        }
        if (block.type === 'code') {
          return (
            <pre
              key={index}
              className="code-block px-4 py-3.5"
              tabIndex={0}
            >
              {block.annotatable ? (
                <RunText
                  run={{
                    text: block.text,
                    start: block.start,
                    annotatable: true,
                    marks: {},
                  }}
                  {...props}
                  code
                />
              ) : (
                block.text
              )}
            </pre>
          );
        }
        if (block.type === 'list') {
          const Tag = block.ordered ? 'ol' : 'ul';
          return (
            <Tag
              key={index}
              className="m-0 flex list-none flex-col gap-1.5 text-[14.5px] leading-[1.7] text-neutral-100"
            >
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex} className="flex gap-2.5 pl-1">
                  <span
                    aria-hidden
                    className="min-w-4 shrink-0 text-[14px] leading-[1.7] text-neutral-400"
                  >
                    {block.ordered ? `${itemIndex + 1}.` : '•'}
                  </span>
                  <span className="min-w-0 flex-1 [text-wrap:pretty]">
                    <Inline runs={item} {...props} />
                  </span>
                </li>
              ))}
            </Tag>
          );
        }
        if (block.type === 'blockquote') {
          return (
            <blockquote
              key={index}
              className="m-0 border-l-2 border-neutral-700 pl-3 text-neutral-300"
            >
              <div className="flex flex-col gap-2">
                {block.blocks.map((inner, innerIndex) =>
                  inner.type === 'paragraph' ? (
                    <p key={innerIndex} className="m-0 text-[14.5px] leading-[1.7]">
                      <Inline runs={inner.runs} {...props} />
                    </p>
                  ) : null,
                )}
              </div>
            </blockquote>
          );
        }
        return <hr key={index} className="m-0 border-neutral-700" />;
      })}
    </div>
  );
}
