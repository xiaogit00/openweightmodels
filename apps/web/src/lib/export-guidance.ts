import {
  MAX_CONVERSATION_BYTES,
  MAX_CONVERSATION_CHARS,
  MAX_CONVERSATION_TURNS,
} from '@owm/core/client';

/**
 * The AI Exporter extension is a third-party dependency (ADR 0009), so every
 * place that points at it reads its URL from here rather than repeating it.
 */
export const AI_EXPORTER_CHROME_STORE_URL =
  'https://chromewebstore.google.com/detail/ai-exporter-save-chatgpt/kagjkiiecagemklhmhkabbalfpbianbe';

export const EXPORT_GUIDE_PATH = '/help/exporting';

export const SAMPLE_EXPORT_PATH = '/samples/deepseek-export.md';
export const SAMPLE_EXPORT_NAME = 'DeepSeek_export.md';

/** The limits the importer enforces, shown before and after upload. */
export const CONVERSATION_LIMITS = {
  turns: MAX_CONVERSATION_TURNS,
  megabytes: (MAX_CONVERSATION_BYTES / (1024 * 1024)).toFixed(1),
  characters: MAX_CONVERSATION_CHARS.toLocaleString('en-US'),
};

export const LIMITS_LABEL = `Up to ${CONVERSATION_LIMITS.turns} turns · ${CONVERSATION_LIMITS.megabytes} MB file · ${CONVERSATION_LIMITS.characters} characters`;
