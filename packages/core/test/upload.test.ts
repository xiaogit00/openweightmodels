import { describe, expect, it } from 'vitest';
import {
  MAX_PROMPT_CHARS,
  MAX_BASE_OUTPUT_CHARS,
  MAX_TITLE_CHARS,
  MAX_UPLOAD_BYTES,
  UploadValidationError,
  decodeUtf8,
  estimateTokens,
  parseMarkdownUpload,
  summariseMarkdown,
  validateBaseOutput,
  validateFileName,
  validateFileSize,
  validatePrompt,
  validateTitle,
} from '../src/domain/upload';

function errorCode(action: () => unknown) {
  try {
    action();
    return null;
  } catch (error) {
    return error instanceof UploadValidationError ? error.code : 'unexpected';
  }
}

describe('file validation', () => {
  it('accepts markdown and text extensions case-insensitively', () => {
    for (const name of ['answer.md', 'answer.MD', 'answer.markdown', 'answer.txt']) {
      expect(() => validateFileName(name)).not.toThrow();
    }
  });

  it('rejects any other extension with a specific message', () => {
    const error = (() => {
      try {
        validateFileName('answer.pdf');
        return null;
      } catch (caught) {
        return caught as UploadValidationError;
      }
    })();

    expect(error?.code).toBe('unsupported_file_type');
    expect(error?.message).toBe('Use a .md, .markdown or .txt file.');
  });

  it('accepts a file exactly at the 0.5 MB limit and rejects one byte more', () => {
    expect(() => validateFileSize(MAX_UPLOAD_BYTES)).not.toThrow();
    expect(errorCode(() => validateFileSize(MAX_UPLOAD_BYTES + 1))).toBe('file_too_large');
  });

  it('rejects an empty file', () => {
    expect(errorCode(() => validateFileSize(0))).toBe('empty_file');
  });

  it('decodes valid UTF-8, including multi-byte characters', () => {
    const bytes = new TextEncoder().encode('héllo 模型 🚀');
    expect(decodeUtf8(bytes)).toBe('héllo 模型 🚀');
  });

  it('rejects NUL bytes as binary', () => {
    expect(errorCode(() => decodeUtf8(new Uint8Array([0x61, 0x00, 0x62])))).toBe(
      'binary_file',
    );
  });

  it('rejects invalid UTF-8 instead of silently replacing bytes', () => {
    expect(errorCode(() => decodeUtf8(new Uint8Array([0xff, 0xfe])))).toBe('invalid_utf8');
  });
});

describe('markdown upload parsing', () => {
  it('uses the body and derives a title from the filename when there is no front matter', () => {
    const parsed = parseMarkdownUpload('Just an answer.\n', 'my_answer-file.md');

    expect(parsed).toEqual({
      body: 'Just an answer.',
      prompt: null,
      model: null,
      titleFromFile: 'My answer file',
      fileName: 'my_answer-file.md',
    });
  });

  it('falls back to Untitled comparison when the stem is only separators', () => {
    expect(parseMarkdownUpload('Body', '---.md').titleFromFile).toBe('Untitled comparison');
  });

  it('reads prompt and model from front matter and keeps them out of the body', () => {
    const text = [
      '---',
      'prompt: "Write a rate limiter."',
      'model: llama-3-3-70b',
      'title: ignored',
      '---',
      '',
      'The base answer.',
    ].join('\n');

    expect(parseMarkdownUpload(text, 'answer.md')).toMatchObject({
      body: 'The base answer.',
      prompt: 'Write a rate limiter.',
      model: 'llama-3-3-70b',
      titleFromFile: 'Answer',
    });
  });

  it('normalises CRLF and strips a leading BOM before reading front matter', () => {
    const text = '\uFEFF---\r\nprompt: Hello\r\n---\r\n\r\nBody line.';
    expect(parseMarkdownUpload(text, 'answer.txt')).toMatchObject({
      prompt: 'Hello',
      body: 'Body line.',
    });
  });

  it('rejects an unclosed front-matter block', () => {
    expect(errorCode(() => parseMarkdownUpload('---\nprompt: hi\nBody', 'a.md'))).toBe(
      'invalid_front_matter',
    );
  });

  it('rejects malformed YAML', () => {
    expect(
      errorCode(() => parseMarkdownUpload('---\nprompt: [unclosed\n---\nBody', 'a.md')),
    ).toBe('invalid_front_matter');
  });

  it('rejects YAML aliases', () => {
    const text = '---\nprompt: &p hello\nmodel: *p\n---\nBody';
    expect(errorCode(() => parseMarkdownUpload(text, 'a.md'))).toBe('invalid_front_matter');
  });

  it('rejects a front matter document that is not a mapping', () => {
    expect(errorCode(() => parseMarkdownUpload('---\n- one\n- two\n---\nBody', 'a.md'))).toBe(
      'invalid_front_matter',
    );
  });

  it('rejects non-string prompt and model values', () => {
    expect(errorCode(() => parseMarkdownUpload('---\nprompt: 42\n---\nBody', 'a.md'))).toBe(
      'invalid_prompt',
    );
    expect(errorCode(() => parseMarkdownUpload('---\nmodel: 42\n---\nBody', 'a.md'))).toBe(
      'invalid_model',
    );
  });

  it('rejects a prompt above the upload limit', () => {
    const text = `---\nprompt: ${'x'.repeat(MAX_PROMPT_CHARS + 1)}\n---\nBody`;
    expect(errorCode(() => parseMarkdownUpload(text, 'a.md'))).toBe('prompt_too_long');
  });

  it('treats a blank prompt or model as absent', () => {
    expect(parseMarkdownUpload('---\nprompt: "   "\nmodel: ""\n---\nBody', 'a.md')).toMatchObject(
      { prompt: null, model: null },
    );
  });

  it('rejects a file with no body after front matter', () => {
    expect(errorCode(() => parseMarkdownUpload('---\nprompt: hi\n---\n \n', 'a.md'))).toBe(
      'empty_body',
    );
  });

  it('rejects an unsupported filename before parsing', () => {
    expect(errorCode(() => parseMarkdownUpload('Body', 'answer.docx'))).toBe(
      'unsupported_file_type',
    );
  });
});

describe('prompt and title validation', () => {
  it('trims and returns a valid prompt', () => {
    expect(validatePrompt('  Explain it.  ')).toBe('Explain it.');
  });

  it('rejects a blank prompt', () => {
    expect(errorCode(() => validatePrompt('   '))).toBe('prompt_required');
  });

  it('rejects a prompt past the limit', () => {
    expect(errorCode(() => validatePrompt('x'.repeat(MAX_PROMPT_CHARS + 1)))).toBe(
      'prompt_too_long',
    );
  });

  it('trims and returns a valid title', () => {
    expect(validateTitle('  A title  ')).toBe('A title');
  });

  it('rejects a blank or over-long title', () => {
    expect(errorCode(() => validateTitle('  '))).toBe('title_required');
    expect(errorCode(() => validateTitle('x'.repeat(MAX_TITLE_CHARS + 1)))).toBe(
      'title_too_long',
    );
  });

  it('accepts a pasted Base output and trims its edges', () => {
    expect(validateBaseOutput('\n  A pasted answer.  \n')).toBe('A pasted answer.');
  });

  it('rejects a blank, oversized or binary pasted Base output', () => {
    expect(errorCode(() => validateBaseOutput('  \n '))).toBe('empty_body');
    expect(errorCode(() => validateBaseOutput('x'.repeat(MAX_BASE_OUTPUT_CHARS + 1)))).toBe(
      'output_too_long',
    );
    expect(errorCode(() => validateBaseOutput('answer\u0000rest'))).toBe('invalid_text');
  });
});

describe('markdown helpers', () => {
  it('summarises markdown as plain text', () => {
    const markdown = [
      '# Heading',
      '',
      'Some **bold** text with `code` and a [link](https://example.com).',
      '',
      '```js',
      'const x = 1;',
      '```',
    ].join('\n');

    expect(summariseMarkdown(markdown)).toBe(
      'Heading Some bold text with code and a link. const x = 1;',
    );
  });

  it('truncates on a word boundary with an ellipsis', () => {
    expect(summariseMarkdown('one two three four', 9)).toBe('one two…');
  });

  it('estimates at least one token for every input', () => {
    expect(estimateTokens('')).toBe(1);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });
});
