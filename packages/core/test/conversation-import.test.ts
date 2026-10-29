import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  defaultTitleForImport,
  estimateConversationCalls,
  estimateConversationInputTokens,
  looksTruncated,
  parseConversationUpload,
  vendorLabel,
} from '../src/domain/conversation-import';
import { UploadValidationError } from '../src/domain/upload';

function fixture(name: string) {
  return readFileSync(new URL(`../../../test_md/${name}`, import.meta.url), 'utf8');
}

function errorCode(action: () => unknown) {
  try {
    action();
    return null;
  } catch (error) {
    if (error instanceof UploadValidationError) return { code: error.code, message: error.message };
    throw error;
  }
}

const deepseek = fixture(
  'DeepSeek_OpenRouter-key-secret-variable_20261028-1310.md',
);
const claude = fixture(
  'Claude_Public-certificates-from-eMudhra-or-emSign_20261028-1309.md',
);

describe('AI Exporter import', () => {
  it('reads every Turn from a complete export and strips exporter metadata', () => {
    const imported = parseConversationUpload(deepseek, 'DeepSeek_export.md');

    expect(imported.format).toBe('ai-exporter');
    expect(imported.vendor).toBe('deepseek');
    expect(imported.vendors).toEqual(['deepseek', 'deepseek', 'deepseek', 'deepseek']);
    expect(vendorLabel(imported.vendor)).toBe('DeepSeek');
    expect(imported.turns).toHaveLength(4);
    expect(imported.warnings).toEqual([]);
    expect(imported.turns.map((turn) => turn.prompt)).toEqual([
      'Im adding my OpenRouter API key to aws secret manager. Which variable should I replace for the secret value?\n\nread -rsp "OpenRouter key: " OR_KEY; echo\naws secretsmanager put-secret-value \\\n  --secret-id owm-staging/openrouter-api-key \\\n  --region ap-southeast-1 \\\n  --secret-string "$OR_KEY"\nunset OR_KEY',
      'Which line do I run first?',
      'The whole command gave:',
      'read: -p: no coprocess\n\n\naws: [ERROR]: An error occurred (ParamValidation): Parameter validation failed:\nInvalid length for parameter SecretString, value: 0, valid min length: 1',
    ]);

    for (const turn of imported.turns) {
      expect(turn.prompt).not.toContain('message time:');
      expect(turn.baseOutput).not.toContain('message time:');
      expect(turn.prompt).not.toContain('From:');
      expect(turn.baseOutput).not.toContain('From:');
      expect(turn.baseOutput).not.toContain('Powered by [AI Exporter]');
    }
    expect(imported.turns[0]!.baseOutput).toContain(
      "You don't need to replace anything — the command is already correct as written.",
    );
  });

  it('warns on the truncated Claude export without blocking the import', () => {
    const imported = parseConversationUpload(claude, 'Claude_export.md');

    expect(imported.format).toBe('ai-exporter');
    expect(imported.vendor).toBe('claude');
    expect(imported.turns).toHaveLength(6);
    expect(imported.warnings).toEqual([
      {
        code: 'truncated_final_reply',
        message:
          'The final reply looks cut off, so Turn 6 may end mid-thought. You can still schedule it.',
      },
    ]);
    expect(imported.turns[5]!.baseOutput).toContain(
      'Check whether any node-to-node or node-to-service connections rely on emSign certificates.',
    );
    expect(JSON.stringify(imported)).not.toContain('Powered by [AI Exporter]');
    expect(JSON.stringify(imported)).not.toContain('claude.ai/chat');
  });

  it('only recognises section headers outside fenced code and keeps body separators', () => {
    const text = [
      '> From: https://chat.example/abc',
      '',
      '# you asked',
      '',
      'message time: 2026-10-25 07:52:59',
      '',
      'Show me this snippet:',
      '',
      '```md',
      '# claude response',
      'message time: this is part of the quoted code',
      '---',
      '# you asked',
      '```',
      '',
      '---',
      '',
      '# llama response',
      '',
      'message time: 2026-10-25 07:53:00',
      '',
      'First paragraph.',
      '',
      '---',
      '',
      'Second paragraph keeps the rule above.',
      '',
      '---',
      'Powered by [AI Exporter](https://saveai.net)',
    ].join('\n');

    const imported = parseConversationUpload(text, 'fenced.md');

    expect(imported.turns).toHaveLength(1);
    expect(imported.vendor).toBe('llama');
    expect(imported.turns[0]!.prompt).toContain('# claude response');
    expect(imported.turns[0]!.prompt).toContain('# you asked');
    expect(imported.turns[0]!.prompt).toContain(
      'message time: this is part of the quoted code',
    );
    expect(imported.turns[0]!.baseOutput).toBe(
      'First paragraph.\n\n---\n\nSecond paragraph keeps the rule above.',
    );
    expect(imported.turns[0]!.baseOutput).not.toContain('Powered by');
  });

  it('merges adjacent user messages into one Turn and says so', () => {
    const text = [
      '# you asked',
      'First half of my question.',
      '',
      '# you asked',
      'Second half, sent by mistake.',
      '',
      '# deepseek response',
      'One answer.',
    ].join('\n');

    const imported = parseConversationUpload(text, 'merge.md');

    expect(imported.turns).toEqual([
      {
        prompt: 'First half of my question.\n\nSecond half, sent by mistake.',
        baseOutput: 'One answer.',
      },
    ]);
    expect(imported.warnings).toEqual([
      {
        code: 'merged_user_messages',
        message: '2 user messages in a row were merged into Turn 1.',
      },
    ]);
  });

  it('names the Turn when its response is empty or missing', () => {
    const empty = [
      '# you asked',
      'First question',
      '# claude response',
      'message time: 2026-10-25 07:52:59',
      '',
      '# you asked',
      'Second question',
      '# claude response',
      'An answer.',
    ].join('\n');
    expect(errorCode(() => parseConversationUpload(empty, 'empty.md'))).toEqual({
      code: 'empty_reply',
      message: 'Turn 1 has no reply from Claude.',
    });

    const missing = [
      '# you asked',
      'First question',
      '# claude response',
      'An answer.',
      '# you asked',
      'Second question',
    ].join('\n');
    expect(errorCode(() => parseConversationUpload(missing, 'missing.md'))).toEqual({
      code: 'missing_reply',
      message: 'Turn 2 has no reply from Claude.',
    });
  });

  it('recognises a raw chat paste and points at the exporter', () => {
    const pasted = ['You: Summarise this article.', 'ChatGPT: Here is a summary.'].join(
      '\n',
    );

    const result = errorCode(() => parseConversationUpload(pasted, 'paste.md'));
    expect(result?.code).toBe('raw_chat_paste');
    expect(result?.message).toContain('AI Exporter');
  });

  it('rejects exporter metadata with no sections', () => {
    const result = errorCode(() =>
      parseConversationUpload(
        '> From: https://chat.example/abc\n\nPowered by [AI Exporter](https://saveai.net)',
        'chrome.md',
      ),
    );
    expect(result?.code).toBe('no_sections');
  });

  it('treats legacy front matter and bare markdown as one Turn', () => {
    const legacy = parseConversationUpload(
      ['---', 'prompt: Write a rate limiter.', 'model: llama-3-3-70b', '---', '', 'Body.'].join(
        '\n',
      ),
      'legacy.md',
    );
    expect(legacy).toMatchObject({
      format: 'front-matter',
      prompt: 'Write a rate limiter.',
      model: 'llama-3-3-70b',
      turns: [{ prompt: 'Write a rate limiter.', baseOutput: 'Body.' }],
      warnings: [],
    });

    const bare = parseConversationUpload('Just an answer.\n', 'bare.md');
    expect(bare).toMatchObject({
      format: 'markdown',
      prompt: null,
      model: null,
      turns: [{ prompt: '', baseOutput: 'Just an answer.' }],
    });
  });

  it('defaults the title from the first Prompt, not the filename', () => {
    const title = defaultTitleForImport(
      parseConversationUpload(claude, 'Claude_export.md'),
    );
    expect(title).toMatch(/^Can you describe what exactly happens/);
    expect(title.endsWith('…')).toBe(true);
    expect(title).not.toBe('Claude export');

    expect(defaultTitleForImport(parseConversationUpload('Body', 'My file.md'))).toBe(
      'My file',
    );
  });

  it('estimates calls per Challenger and growing input tokens per Turn', () => {
    const imported = parseConversationUpload(deepseek, 'DeepSeek_export.md');
    const tokens = estimateConversationInputTokens(imported.turns);

    expect(estimateConversationCalls(imported.turns.length, 3)).toBe(12);
    expect(tokens).toBeGreaterThan(
      estimateConversationInputTokens(imported.turns.slice(0, 1)),
    );
  });
});

describe('truncation heuristic', () => {
  it('flags an unclosed fence, a dangling marker, a heading and a list tail', () => {
    expect(looksTruncated('Answer:\n\n```js\nconst x = 1;')).toBe(true);
    expect(looksTruncated('Answer:\n\n-')).toBe(true);
    expect(looksTruncated('Answer:\n\n## Next steps')).toBe(true);
    expect(looksTruncated('Answer:\n\n- one\n- two')).toBe(true);
    expect(looksTruncated('Answer:\n\n**What to do**')).toBe(true);
    expect(looksTruncated('The next step is')).toBe(true);
  });

  it('accepts a complete reply', () => {
    expect(looksTruncated('A complete answer.')).toBe(false);
    expect(looksTruncated('A list:\n\n- one\n- two\n\nThen a closing thought.')).toBe(
      false,
    );
    expect(looksTruncated('```js\nconst x = 1;\n```')).toBe(false);
  });
});
