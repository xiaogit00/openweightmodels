import { describe, expect, it } from 'vitest';
import {
  AnnotationRangeError,
  annotatableRanges,
  buildBlocks,
  validateAnnotationRange,
} from '../src/domain/markdown';

function rangeError(action: () => unknown) {
  try {
    action();
    return null;
  } catch (error) {
    return error instanceof AnnotationRangeError ? error.code : 'unexpected';
  }
}

function runTexts(markdown: string) {
  return annotatableRanges(markdown).map((range) => range.text);
}

describe('annotatable runs', () => {
  it('records UTF-16 offsets into the raw markdown', () => {
    const markdown = 'Hello world';
    expect(annotatableRanges(markdown)).toEqual([
      { start: 0, end: 11, text: 'Hello world' },
    ]);

    expect(validateAnnotationRange(markdown, 0, 5)).toEqual({
      quote: 'Hello',
      start: 0,
      end: 5,
    });
  });

  it('counts an emoji as two UTF-16 code units so browser selection offsets match', () => {
    const markdown = 'Hello 😀 world';
    expect(annotatableRanges(markdown)).toEqual([
      { start: 0, end: 14, text: markdown },
    ]);

    expect(validateAnnotationRange(markdown, 6, 8)).toEqual({
      quote: '😀',
      start: 6,
      end: 8,
    });
  });

  it('counts CJK characters as one code unit each', () => {
    const markdown = 'A模型B';
    expect(validateAnnotationRange(markdown, 1, 3)).toEqual({
      quote: '模型',
      start: 1,
      end: 3,
    });
  });

  it('refuses raw markdown escapes because the decoded value drifts from the source', () => {
    expect(runTexts('\\*not italic\\*')).toEqual([]);
    expect(rangeError(() => validateAnnotationRange('\\*not italic\\*', 2, 6))).toBe(
      'unannotatable_range',
    );
  });

  it('refuses HTML entities for the same reason', () => {
    expect(runTexts('AT&amp;T')).toEqual([]);
  });

  it('keeps each formatting run separate so a selection cannot cross it', () => {
    const markdown = 'plain **bold** end';
    expect(annotatableRanges(markdown)).toEqual([
      { start: 0, end: 6, text: 'plain ' },
      { start: 8, end: 12, text: 'bold' },
      { start: 14, end: 18, text: ' end' },
    ]);

    expect(validateAnnotationRange(markdown, 8, 12).quote).toBe('bold');
    expect(rangeError(() => validateAnnotationRange(markdown, 0, 12))).toBe(
      'unannotatable_range',
    );
    expect(rangeError(() => validateAnnotationRange(markdown, 4, 9))).toBe(
      'unannotatable_range',
    );
  });

  it('refuses a selection that crosses inline code boundaries', () => {
    const markdown = 'run `go test` now';
    expect(validateAnnotationRange(markdown, 5, 12).quote).toBe('go test');
    expect(rangeError(() => validateAnnotationRange(markdown, 0, 12))).toBe(
      'unannotatable_range',
    );
  });

  it('refuses a selection that crosses a paragraph boundary', () => {
    const markdown = 'First para.\n\nSecond para.';
    expect(rangeError(() => validateAnnotationRange(markdown, 4, 16))).toBe(
      'unannotatable_range',
    );
  });
});

describe('code blocks', () => {
  it('annotates the contents of a fenced code block, not its fence', () => {
    const markdown = 'Intro.\n\n```go\nconst x = 1\n```\n';
    const start = markdown.indexOf('const x = 1');

    expect(annotatableRanges(markdown)).toContainEqual({
      start,
      end: start + 'const x = 1'.length,
      text: 'const x = 1',
    });
    expect(validateAnnotationRange(markdown, start, start + 5).quote).toBe('const');
    expect(rangeError(() => validateAnnotationRange(markdown, start - 1, start + 5))).toBe(
      'unannotatable_range',
    );
  });

  it('counts emoji inside a fenced code block as code units', () => {
    const markdown = '```\n🚀 go\n```\n';
    const start = markdown.indexOf('🚀');

    expect(validateAnnotationRange(markdown, start, start + 2)).toEqual({
      quote: '🚀',
      start,
      end: start + 2,
    });
  });

  it('renders an indented code block but leaves it unannotatable', () => {
    const markdown = 'Intro.\n\n    const x = 1\n';
    const code = buildBlocks(markdown).find((block) => block.type === 'code');

    expect(code).toMatchObject({ type: 'code', text: 'const x = 1', annotatable: false });
    expect(runTexts(markdown)).not.toContain('const x = 1');
  });
});

describe('range validation', () => {
  const markdown = 'Hello world';

  it('rejects non-integer offsets', () => {
    expect(rangeError(() => validateAnnotationRange(markdown, 0.5, 3))).toBe('invalid_range');
    expect(rangeError(() => validateAnnotationRange(markdown, Number.NaN, 3))).toBe(
      'invalid_range',
    );
  });

  it('rejects empty and reversed ranges', () => {
    expect(rangeError(() => validateAnnotationRange(markdown, 3, 3))).toBe('invalid_range');
    expect(rangeError(() => validateAnnotationRange(markdown, 5, 3))).toBe('invalid_range');
  });

  it('rejects negative offsets and offsets past the end', () => {
    expect(rangeError(() => validateAnnotationRange(markdown, -1, 3))).toBe('invalid_range');
    expect(rangeError(() => validateAnnotationRange(markdown, 0, 12))).toBe('invalid_range');
  });

  it('rejects a whitespace-only quote', () => {
    expect(rangeError(() => validateAnnotationRange(markdown, 5, 6))).toBe('empty_quote');
  });

  it('allows adjacent ranges', () => {
    expect(validateAnnotationRange(markdown, 0, 5).quote).toBe('Hello');
    expect(validateAnnotationRange(markdown, 5, 11).quote).toBe(' world');
  });

  it('derives the quote from the run rather than trusting a client copy', () => {
    expect(validateAnnotationRange(markdown, 6, 11)).toEqual({
      quote: 'world',
      start: 6,
      end: 11,
    });
  });
});
