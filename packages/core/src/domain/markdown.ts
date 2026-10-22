import { unified } from 'unified';
import remarkParse from 'remark-parse';

export type InlineMarks = {
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  href?: string;
};

export type Run = {
  text: string;
  start: number;
  annotatable: boolean;
  marks: InlineMarks;
};

export type Block =
  | { type: 'paragraph'; runs: Run[] }
  | { type: 'heading'; depth: number; runs: Run[] }
  | { type: 'code'; text: string; start: number; annotatable: boolean; lang?: string }
  | { type: 'list'; ordered: boolean; items: Run[][] }
  | { type: 'blockquote'; blocks: Block[] }
  | { type: 'hr' };

type Positioned = {
  position?: {
    start?: { offset?: number | null };
    end?: { offset?: number | null };
  };
};

type InlineNode = Positioned & {
  type: string;
  value?: string;
  url?: string;
  alt?: string | null;
  children?: InlineNode[];
};

type BlockNode = Positioned & {
  type: string;
  depth?: number;
  value?: string;
  lang?: string | null;
  ordered?: boolean | null;
  children?: BlockNode[];
  data?: unknown;
};

const parser = unified().use(remarkParse);

function parseTree(markdown: string) {
  return parser.parse(markdown) as unknown as { children: BlockNode[] };
}

function startOf(node: Positioned): number | null {
  const offset = node.position?.start?.offset;
  return typeof offset === 'number' ? offset : null;
}

function endOf(node: Positioned): number | null {
  const offset = node.position?.end?.offset;
  return typeof offset === 'number' ? offset : null;
}

function mergeMarks(base: InlineMarks, extra: InlineMarks): InlineMarks {
  return { ...base, ...extra };
}

function inlineCodeRun(node: InlineNode, content: string, marks: InlineMarks): Run | null {
  const start = startOf(node);
  const end = endOf(node);
  const value = node.value ?? '';
  if (start === null || end === null || !value) return null;

  const raw = content.slice(start, end);
  const index = raw.indexOf(value);
  if (index < 0) return null;

  return {
    text: value,
    start: start + index,
    annotatable: true,
    marks: mergeMarks(marks, { code: true }),
  };
}

function inlineRuns(
  nodes: InlineNode[] | undefined,
  content: string,
  marks: InlineMarks = {},
): Run[] {
  const runs: Run[] = [];

  for (const node of nodes ?? []) {
    switch (node.type) {
      case 'text': {
        const start = startOf(node);
        const end = endOf(node);
        const value = node.value ?? '';
        if (start === null || end === null || !value) break;
        const raw = content.slice(start, end);
        runs.push({
          text: value,
          start,
          annotatable: raw === value,
          marks,
        });
        break;
      }
      case 'inlineCode': {
        const run = inlineCodeRun(node, content, marks);
        if (run) runs.push(run);
        break;
      }
      case 'strong':
        runs.push(...inlineRuns(node.children, content, mergeMarks(marks, { bold: true })));
        break;
      case 'emphasis':
        runs.push(...inlineRuns(node.children, content, mergeMarks(marks, { italic: true })));
        break;
      case 'delete':
        runs.push(...inlineRuns(node.children, content, marks));
        break;
      case 'link':
        runs.push(
          ...inlineRuns(
            node.children,
            content,
            mergeMarks(marks, { href: node.url ?? undefined }),
          ),
        );
        break;
      case 'break':
        runs.push({ text: '\n', start: startOf(node) ?? 0, annotatable: false, marks });
        break;
      case 'image': {
        const start = startOf(node);
        if (start !== null && node.alt) {
          runs.push({ text: node.alt, start, annotatable: false, marks });
        }
        break;
      }
      case 'html': {
        const start = startOf(node);
        const end = endOf(node);
        if (start !== null && end !== null) {
          runs.push({
            text: content.slice(start, end),
            start,
            annotatable: false,
            marks,
          });
        }
        break;
      }
      default:
        if (node.children) {
          runs.push(...inlineRuns(node.children, content, marks));
        }
        break;
    }
  }

  return runs;
}

function codeBlock(node: BlockNode, content: string): Block | null {
  const start = startOf(node);
  const end = endOf(node);
  const value = node.value ?? '';
  if (start === null || end === null) return null;

  const raw = content.slice(start, end);
  let valueStart: number | null = null;

  const fenced = raw.startsWith('```') || raw.startsWith('~~~');
  if (fenced) {
    const firstNewline = raw.indexOf('\n');
    if (firstNewline >= 0) valueStart = start + firstNewline + 1;
  }

  if (valueStart === null || content.slice(valueStart, valueStart + value.length) !== value) {
    const index = raw.indexOf(value);
    valueStart = index >= 0 ? start + index : null;
  }

  // Only fenced blocks are annotatable. An indented block's raw slice starts
  // with its indentation, so an offset into the decoded value would drift.
  const annotatable =
    fenced &&
    valueStart !== null &&
    content.slice(valueStart, valueStart + value.length) === value;

  return {
    type: 'code',
    text: value,
    start: valueStart ?? start,
    annotatable,
    lang: node.lang ?? undefined,
  };
}

function listItemRuns(node: BlockNode, content: string): Run[] {
  const runs: Run[] = [];
  for (const child of node.children ?? []) {
    if (child.type === 'paragraph' || child.type === 'heading') {
      runs.push(...inlineRuns(child.children as InlineNode[], content));
    } else if (child.type === 'list') {
      for (const item of child.children ?? []) {
        runs.push(...listItemRuns(item, content));
      }
    }
  }
  return runs;
}

function blockNodes(nodes: BlockNode[], content: string): Block[] {
  const blocks: Block[] = [];

  for (const node of nodes) {
    switch (node.type) {
      case 'paragraph': {
        const runs = inlineRuns(node.children as InlineNode[], content);
        if (runs.length) blocks.push({ type: 'paragraph', runs });
        break;
      }
      case 'heading': {
        const runs = inlineRuns(node.children as InlineNode[], content);
        blocks.push({ type: 'heading', depth: node.depth ?? 1, runs });
        break;
      }
      case 'code': {
        const block = codeBlock(node, content);
        if (block) blocks.push(block);
        break;
      }
      case 'list': {
        blocks.push({
          type: 'list',
          ordered: Boolean(node.ordered),
          items: (node.children ?? []).map((item) => listItemRuns(item, content)),
        });
        break;
      }
      case 'blockquote': {
        blocks.push({ type: 'blockquote', blocks: blockNodes(node.children ?? [], content) });
        break;
      }
      case 'thematicBreak':
        blocks.push({ type: 'hr' });
        break;
      case 'html': {
        const start = startOf(node);
        const end = endOf(node);
        if (start !== null && end !== null) {
          blocks.push({
            type: 'paragraph',
            runs: [
              {
                text: content.slice(start, end),
                start,
                annotatable: false,
                marks: {},
              },
            ],
          });
        }
        break;
      }
      case 'table': {
        const start = startOf(node);
        const end = endOf(node);
        if (start !== null && end !== null) {
          blocks.push({
            type: 'paragraph',
            runs: [
              {
                text: content.slice(start, end),
                start,
                annotatable: false,
                marks: {},
              },
            ],
          });
        }
        break;
      }
      default:
        break;
    }
  }

  return blocks;
}

export function buildBlocks(markdown: string): Block[] {
  try {
    return blockNodes(parseTree(markdown).children, markdown);
  } catch {
    return [
      {
        type: 'paragraph',
        runs: [{ text: markdown, start: 0, annotatable: false, marks: {} }],
      },
    ];
  }
}

export type AnnotatableRun = {
  start: number;
  end: number;
  text: string;
};

export function collectAnnotatableRuns(blocks: Block[], out: AnnotatableRun[] = []) {
  for (const block of blocks) {
    if (block.type === 'paragraph' || block.type === 'heading') {
      for (const run of block.runs) {
        if (run.annotatable) {
          out.push({ start: run.start, end: run.start + run.text.length, text: run.text });
        }
      }
    } else if (block.type === 'code') {
      if (block.annotatable) {
        out.push({ start: block.start, end: block.start + block.text.length, text: block.text });
      }
    } else if (block.type === 'list') {
      for (const item of block.items) {
        for (const run of item) {
          if (run.annotatable) {
            out.push({ start: run.start, end: run.start + run.text.length, text: run.text });
          }
        }
      }
    } else if (block.type === 'blockquote') {
      collectAnnotatableRuns(block.blocks, out);
    }
  }
  return out;
}

export function annotatableRanges(markdown: string) {
  return collectAnnotatableRuns(buildBlocks(markdown));
}

export type AnnotationRange = {
  quote: string;
  start: number;
  end: number;
};

export class AnnotationRangeError extends Error {
  readonly code: string;
  readonly status = 400;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'AnnotationRangeError';
    this.code = code;
  }
}

export function validateAnnotationRange(
  markdown: string,
  start: number,
  end: number,
): AnnotationRange {
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    throw new AnnotationRangeError('invalid_range', 'Annotation offsets must be integers.');
  }
  if (start < 0 || end <= start || end > markdown.length) {
    throw new AnnotationRangeError('invalid_range', 'That selection is out of range.');
  }

  const run = annotatableRanges(markdown).find(
    (candidate) => start >= candidate.start && end <= candidate.end,
  );

  if (!run) {
    throw new AnnotationRangeError(
      'unannotatable_range',
      'Select text inside a single run — not across formatting or code boundaries.',
    );
  }

  const quote = run.text.slice(start - run.start, end - run.start);
  if (!quote.trim()) {
    throw new AnnotationRangeError('empty_quote', 'Select some text to annotate.');
  }

  return { quote, start, end };
}
