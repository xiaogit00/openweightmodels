import {
  MAX_CONVERSATION_TURNS,
  UploadValidationError,
  estimateTokens,
  parseMarkdownUpload,
  summariseMarkdown,
  titleFromFileName,
  validateConversationBytes,
  validateFileName,
  validateTurnScript,
  type ConversationTurnInput,
} from './upload';

/**
 * Importing an AI Exporter markdown file. The header format is owned by the
 * extension (ADR 0009), so this parser is pinned by the two real exports in
 * `test_md/` and stays fence-aware: a message body may legitimately contain a
 * line that looks like a section header or a horizontal rule.
 */

export type ConversationImportFormat = 'ai-exporter' | 'front-matter' | 'markdown';

export type ConversationImportWarning = {
  code: 'merged_user_messages' | 'truncated_final_reply';
  message: string;
};

export type ConversationImport = {
  format: ConversationImportFormat;
  turns: ConversationTurnInput[];
  /** The vendor named by the response headers, if this was an exporter file. */
  vendor: string | null;
  /** The vendor per Turn, aligned with `turns`; null for legacy files. */
  vendors: Array<string | null>;
  /** The prompt a legacy front-matter file carried, if any. */
  prompt: string | null;
  /** The model a legacy front-matter file named, if any. */
  model: string | null;
  titleFromFile: string;
  fileName: string;
  warnings: ConversationImportWarning[];
};

type Section = {
  kind: 'user' | 'response';
  vendor: string | null;
  /** Index of the first line of the body. */
  start: number;
  /** Index one past the last line of the body. */
  end: number;
};

type Fence = { char: string; length: number };

const USER_HEADER = /^\s{0,3}#\s+you asked\s*#*\s*$/i;
const RESPONSE_HEADER = /^\s{0,3}#\s+(.+?)\s+response\s*#*\s*$/i;
const FENCE_START = /^\s{0,3}(`{3,}|~{3,})/;
const MESSAGE_TIME = /^\s*message time\s*:/i;
const FROM_LINE = /^\s*>\s*From\s*:/i;
const EXPORTER_FOOTER = /^\s*Powered by\s*\[AI Exporter\]/i;
const HORIZONTAL_RULE = /^\s*---\s*$/;

/** Which lines are fence delimiters or inside a fenced block. */
function scanFences(lines: readonly string[]) {
  const fenced = new Array<boolean>(lines.length).fill(false);
  let open: Fence | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const marker = FENCE_START.exec(lines[index]!);
    if (open) {
      fenced[index] = true;
      if (
        marker &&
        marker[1]![0] === open.char &&
        marker[1]!.length >= open.length
      ) {
        open = null;
      }
      continue;
    }
    if (marker) {
      open = { char: marker[1]![0]!, length: marker[1]!.length };
      fenced[index] = true;
    }
  }

  return { fenced, unclosed: open !== null };
}

function scanSections(lines: readonly string[], fenced: readonly boolean[]) {
  const sections: Section[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (fenced[index]) continue;
    const line = lines[index]!;

    if (USER_HEADER.test(line)) {
      if (sections.length) sections[sections.length - 1]!.end = index;
      sections.push({ kind: 'user', vendor: null, start: index + 1, end: lines.length });
      continue;
    }

    const response = RESPONSE_HEADER.exec(line);
    if (response) {
      if (sections.length) sections[sections.length - 1]!.end = index;
      sections.push({
        kind: 'response',
        vendor: response[1]!.trim(),
        start: index + 1,
        end: lines.length,
      });
    }
  }

  return sections;
}

function stripMessageTimes(lines: readonly string[], fenced: readonly boolean[]) {
  return lines.filter((line, index) => fenced[index] || !MESSAGE_TIME.test(line));
}

function cleanBody(lines: readonly string[], fenced: readonly boolean[]): string {
  const kept = stripMessageTimes(lines, fenced);

  const footer = kept.findIndex((line) => EXPORTER_FOOTER.test(line));
  if (footer !== -1) kept.length = footer;

  while (kept.length && !kept[0]!.trim()) kept.shift();
  if (kept.length && FROM_LINE.test(kept[0]!)) {
    kept.shift();
    while (kept.length && !kept[0]!.trim()) kept.shift();
  }
  while (
    kept.length &&
    (!kept[kept.length - 1]!.trim() || HORIZONTAL_RULE.test(kept[kept.length - 1]!))
  ) {
    kept.pop();
  }

  return kept.join('\n').trim();
}

function formatVendorName(vendor: string) {
  const known: Record<string, string> = {
    chatgpt: 'ChatGPT',
    claude: 'Claude',
    deepseek: 'DeepSeek',
    gemini: 'Gemini',
    grok: 'Grok',
    llama: 'Llama',
    mistral: 'Mistral',
    openai: 'OpenAI',
    qwen: 'Qwen',
  };
  const key = vendor.trim().toLowerCase();
  if (known[key]) return known[key]!;
  return key ? key.charAt(0).toUpperCase() + key.slice(1) : '';
}

export function vendorLabel(vendor: string | null) {
  return vendor ? formatVendorName(vendor) : '';
}

function hasUnclosedFence(text: string) {
  return scanFences(text.split('\n')).unclosed;
}

/**
 * A cut-off reply is accepted, but flagged so the author can check it. The
 * heuristic is deliberately about shape rather than vocabulary: an unclosed
 * fence, a dangling list marker, a heading at the very end, or a reply whose
 * last block is a list all look like a stopped export.
 */
export function looksTruncated(text: string) {
  const trimmed = text.trimEnd();
  if (!trimmed) return false;
  if (hasUnclosedFence(trimmed)) return true;

  const lines = trimmed.split('\n');
  const lastLine = lines[lines.length - 1]!.trim();
  if (!lastLine) return false;
  if (/^(?:[-*+]|\d+\.)\s*$/.test(lastLine)) return true;
  if (/^#{1,6}\s/.test(lastLine)) return true;
  if (/^\*\*[^*]+\*\*$/.test(lastLine)) return true;
  if (/^(?:[-*+]|\d+\.)\s+/.test(lastLine)) return true;

  return !/[.!?…)\]}'"`*_~]$/.test(lastLine);
}

function looksLikeRawChat(text: string) {
  const user = /^\s*(?:you said|you|user|human|me)\s*[:\-]/im.test(text);
  const assistant =
    /^\s*(?:chatgpt|claude|assistant|ai|gemini|grok|deepseek|qwen|copilot)\s*(?:said|replied)?\s*[:\-]/im.test(
      text,
    );
  return user && assistant;
}

function looksLikeExporterChrome(text: string) {
  return (
    /^\s*>\s*From\s*:/im.test(text) ||
    EXPORTER_FOOTER.test(text) ||
    /^\s*message time\s*:/im.test(text)
  );
}

function importExporter(lines: readonly string[], fileName: string): ConversationImport {
  validateFileName(fileName);
  const { fenced } = scanFences(lines);
  const sections = scanSections(lines, fenced);
  if (!sections.length) {
    if (looksLikeRawChat(lines.join('\n'))) {
      throw new UploadValidationError(
        'raw_chat_paste',
        'That looks like text pasted straight from a chat window. Export the conversation with the AI Exporter extension and upload the .md file instead.',
      );
    }
    if (looksLikeExporterChrome(lines.join('\n'))) {
      throw new UploadValidationError(
        'no_sections',
        'This file has AI Exporter metadata but no “# you asked” sections. Re-export the whole conversation and upload the new .md file.',
      );
    }
    return importLegacy(lines.join('\n'), fileName, 'markdown');
  }

  if (sections[0]!.kind !== 'user') {
    throw new UploadValidationError(
      'missing_user_message',
      'Turn 1 has a reply but no prompt. Re-export the conversation so every reply follows a “# you asked” section.',
    );
  }

  const turns: ConversationTurnInput[] = [];
  const vendors: Array<string | null> = [];
  const warnings: ConversationImportWarning[] = [];
  let pendingPrompt: string | null = null;
  let pendingPromptParts = 0;
  let vendor: string | null = null;

  for (const section of sections) {
    const body = cleanBody(
      lines.slice(section.start, section.end),
      fenced.slice(section.start, section.end),
    );
    const turnNumber = turns.length + 1;

    if (section.kind === 'user') {
      if (pendingPrompt === null) {
        if (!body) {
          throw new UploadValidationError(
            'empty_prompt',
            `Turn ${turnNumber} has an empty “# you asked” section. Re-export the conversation and make sure every prompt is included.`,
          );
        }
        pendingPrompt = body;
        pendingPromptParts = 1;
        continue;
      }
      if (!body) {
        throw new UploadValidationError(
          'empty_prompt',
          `Turn ${turnNumber} has an empty “# you asked” section. Re-export the conversation and make sure every prompt is included.`,
        );
      }
      pendingPrompt = `${pendingPrompt}\n\n${body}`;
      pendingPromptParts += 1;
      continue;
    }

    if (pendingPrompt === null) {
      throw new UploadValidationError(
        'missing_user_message',
        `Turn ${turnNumber} has a reply but no prompt. Re-export the conversation so every reply follows a “# you asked” section.`,
      );
    }

    if (!vendor) vendor = section.vendor;
    const name = vendorLabel(section.vendor) || 'the model';

    if (!body) {
      throw new UploadValidationError(
        'empty_reply',
        `Turn ${turnNumber} has no reply from ${name}. Make sure every prompt has a reply in the chat, re-export the conversation, and upload it again.`,
      );
    }

    if (pendingPromptParts > 1) {
      warnings.push({
        code: 'merged_user_messages',
        message: `${pendingPromptParts} user messages in a row were merged into Turn ${turnNumber}.`,
      });
    }

    turns.push({ prompt: pendingPrompt, baseOutput: body });
    vendors.push(section.vendor);
    pendingPrompt = null;
    pendingPromptParts = 0;
  }

  if (pendingPrompt !== null) {
    const turnNumber = turns.length + 1;
    const name = vendor ? vendorLabel(vendor) : 'the model';
    throw new UploadValidationError(
      'missing_reply',
      `Turn ${turnNumber} has no reply from ${name}. Make sure every prompt has a reply in the chat, re-export the conversation, and upload it again.`,
    );
  }

  if (!turns.length) {
    throw new UploadValidationError(
      'no_sections',
      'No conversation turns were found. Re-export the conversation with AI Exporter, or upload plain markdown as a one-turn comparison.',
    );
  }

  if (turns.length > MAX_CONVERSATION_TURNS) {
    throw new UploadValidationError(
      'too_many_turns',
      `A conversation can hold at most ${MAX_CONVERSATION_TURNS} turns, but this file has ${turns.length}. Export only the turns you want to compare and try again.`,
    );
  }

  const validated = validateTurnScript(turns);
  const last = validated[validated.length - 1]!;
  if (looksTruncated(last.baseOutput)) {
    warnings.push({
      code: 'truncated_final_reply',
      message: `The final reply looks cut off, so Turn ${validated.length} may end mid-thought. You can still schedule it.`,
    });
  }

  return {
    format: 'ai-exporter',
    turns: validated,
    vendor,
    vendors,
    prompt: null,
    model: null,
    titleFromFile: titleFromFileName(fileName),
    fileName,
    warnings,
  };
}

function importLegacy(
  text: string,
  fileName: string,
  format: ConversationImportFormat,
): ConversationImport {
  const parsed = parseMarkdownUpload(text, fileName);
  return {
    format,
    turns: [{ prompt: parsed.prompt ?? '', baseOutput: parsed.body }],
    vendor: null,
    vendors: [null],
    prompt: parsed.prompt,
    model: parsed.model,
    titleFromFile: parsed.titleFromFile,
    fileName,
    warnings: [],
  };
}

export function parseConversationUpload(
  text: string,
  fileName: string,
): ConversationImport {
  const normalised = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  validateConversationBytes(normalised);

  const lines = normalised.split('\n');
  if (/^---[ \t]*$/.test(lines[0] ?? '')) {
    return importLegacy(normalised, fileName, 'front-matter');
  }

  return importExporter(lines, fileName);
}

/** The default title is a summary of the first Prompt, as ticket 23 requires. */
export function defaultTitleForImport(imported: ConversationImport) {
  const prompt = imported.turns[0]?.prompt?.trim() ?? '';
  return summariseMarkdown(prompt, 80) || imported.titleFromFile;
}

/**
 * Every call replays the user messages up to its Turn, so the accumulated
 * prompt text grows with each Turn. It is an estimate, not a billing figure.
 */
export function estimateConversationInputTokens(
  turns: readonly ConversationTurnInput[],
) {
  let accumulated = '';
  let total = 0;
  for (const turn of turns) {
    accumulated = accumulated ? `${accumulated}\n\n${turn.prompt}` : turn.prompt;
    total += estimateTokens(accumulated);
  }
  return Math.max(1, total);
}

export function estimateConversationCalls(
  turnCount: number,
  challengerCount: number,
) {
  return Math.max(0, turnCount) * Math.max(0, challengerCount);
}
