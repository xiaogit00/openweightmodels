import { parseDocument } from 'yaml';

export const MAX_UPLOAD_BYTES = 1024 * 1024;
export const MAX_PROMPT_CHARS = 10_000;
export const MAX_TITLE_CHARS = 200;
/**
 * A pasted Base output is bounded like the replayed text a whole Conversation
 * may hold, so one request cannot carry an unbounded body.
 */
export const MAX_BASE_OUTPUT_CHARS = 100_000;
export const ALLOWED_EXTENSIONS = ['.md', '.markdown', '.txt'] as const;

export class UploadValidationError extends Error {
  readonly code: string;
  readonly status = 400;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'UploadValidationError';
    this.code = code;
  }
}

export type ParsedUpload = {
  body: string;
  prompt: string | null;
  model: string | null;
  titleFromFile: string;
  fileName: string;
};

export function validateFileName(name: string) {
  const lower = name.toLowerCase();
  if (!ALLOWED_EXTENSIONS.some((extension) => lower.endsWith(extension))) {
    throw new UploadValidationError(
      'unsupported_file_type',
      'Use a .md, .markdown or .txt file.',
    );
  }
}

export function validateFileSize(size: number) {
  if (size > MAX_UPLOAD_BYTES) {
    throw new UploadValidationError('file_too_large', 'Files must be 1 MB or smaller.');
  }
  if (size === 0) {
    throw new UploadValidationError('empty_file', 'That file is empty.');
  }
}

export function decodeUtf8(bytes: Uint8Array) {
  if (bytes.includes(0)) {
    throw new UploadValidationError('binary_file', 'That file does not look like text.');
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new UploadValidationError('invalid_utf8', 'That file is not valid UTF-8.');
  }
}

function fileNameTitle(name: string) {
  const stem = name.replace(/\.(md|markdown|txt)$/i, '').replace(/[-_]+/g, ' ').trim();
  if (!stem) return 'Untitled comparison';
  return stem.charAt(0).toUpperCase() + stem.slice(1);
}

function extractFrontMatter(text: string) {
  if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) {
    return { frontMatter: null, body: text };
  }

  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!match) {
    throw new UploadValidationError(
      'invalid_front_matter',
      'The YAML front-matter is missing its closing --- line.',
    );
  }

  return {
    frontMatter: match[1] ?? '',
    body: text.slice(match[0].length),
  };
}

export function parseMarkdownUpload(text: string, fileName: string): ParsedUpload {
  validateFileName(fileName);
  const normalised = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const { frontMatter, body } = extractFrontMatter(normalised);

  let prompt: string | null = null;
  let model: string | null = null;

  if (frontMatter !== null) {
    let value: unknown;
    try {
      const document = parseDocument(frontMatter, { schema: 'core' });
      if (document.errors.length) {
        throw new Error(document.errors[0]?.message ?? 'Invalid YAML');
      }
      value = document.toJS({ maxAliasCount: 0 });
    } catch (error) {
      throw new UploadValidationError(
        'invalid_front_matter',
        `Could not parse the YAML front-matter: ${(error as Error).message}`,
      );
    }

    if (value !== null && value !== undefined) {
      if (typeof value !== 'object' || Array.isArray(value)) {
        throw new UploadValidationError(
          'invalid_front_matter',
          'Front-matter must be a mapping of keys to values.',
        );
      }
      const record = value as Record<string, unknown>;
      if (record.prompt !== undefined) {
        if (typeof record.prompt !== 'string') {
          throw new UploadValidationError('invalid_prompt', '`prompt:` must be a string.');
        }
        prompt = record.prompt.trim();
        if (prompt.length > MAX_PROMPT_CHARS) {
          throw new UploadValidationError(
            'prompt_too_long',
            `Prompts are limited to ${MAX_PROMPT_CHARS.toLocaleString()} characters.`,
          );
        }
      }
      if (record.model !== undefined) {
        if (typeof record.model !== 'string') {
          throw new UploadValidationError('invalid_model', '`model:` must be a string.');
        }
        model = record.model.trim() || null;
      }
    }
  }

  const trimmedBody = body.replace(/^\n+/, '').trimEnd();
  if (!trimmedBody.trim()) {
    throw new UploadValidationError('empty_body', 'The file has no response body.');
  }

  return {
    body: trimmedBody,
    prompt: prompt || null,
    model,
    titleFromFile: fileNameTitle(fileName),
    fileName,
  };
}

export function validatePrompt(prompt: string) {
  const trimmed = prompt.trim();
  if (!trimmed) {
    throw new UploadValidationError('prompt_required', 'A prompt is required.');
  }
  if (trimmed.length > MAX_PROMPT_CHARS) {
    throw new UploadValidationError(
      'prompt_too_long',
      `Prompts are limited to ${MAX_PROMPT_CHARS.toLocaleString()} characters.`,
    );
  }
  return trimmed;
}

/**
 * The "Write a prompt" path pastes the Base output instead of uploading a file.
 */
export function validateBaseOutput(output: string) {
  const trimmed = output.trim();
  if (!trimmed) {
    throw new UploadValidationError('empty_body', 'Paste the base output.');
  }
  // Postgres text cannot store NUL, and a pasted output with one is not text.
  if (trimmed.includes('\u0000')) {
    throw new UploadValidationError('invalid_text', 'That base output does not look like text.');
  }
  if (trimmed.length > MAX_BASE_OUTPUT_CHARS) {
    throw new UploadValidationError(
      'output_too_long',
      `Base outputs are limited to ${MAX_BASE_OUTPUT_CHARS.toLocaleString()} characters.`,
    );
  }
  return trimmed;
}

export function validateTitle(title: string) {
  const trimmed = title.trim();
  if (!trimmed) {
    throw new UploadValidationError('title_required', 'A title is required.');
  }
  if (trimmed.length > MAX_TITLE_CHARS) {
    throw new UploadValidationError(
      'title_too_long',
      `Titles are limited to ${MAX_TITLE_CHARS} characters.`,
    );
  }
  return trimmed;
}

export function summariseMarkdown(markdown: string, max = 240) {
  const text = markdown
    .replace(/```[^\n]*\n([\s\S]*?)```/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[*_~]/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/<\/?[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max).replace(/\s+\S*$/, '')}…`;
}

export function estimateTokens(markdown: string) {
  return Math.max(1, Math.ceil(markdown.length / 4));
}
