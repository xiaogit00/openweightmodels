import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseConversationUpload } from '@owm/core/client';

const sample = readFileSync(
  new URL('../public/samples/deepseek-export.md', import.meta.url),
  'utf8',
);
const fixture = readFileSync(
  new URL('../../../test_md/DeepSeek_OpenRouter-key-secret-variable_20261028-1310.md', import.meta.url),
  'utf8',
);

describe('downloadable sample export', () => {
  it('serves the complete real DeepSeek export, not a hand-written stub', () => {
    expect(sample).toBe(
      fixture.replace(
        /^> From: .*$/m,
        '> From: https://chat.deepseek.com/a/chat/s/sample-export',
      ),
    );
    expect(sample).toContain('> From:');
    expect(sample).toContain('# you asked');
    expect(sample).toContain('# deepseek response');
    expect(sample).toContain('Powered by [AI Exporter]');
    expect(sample).not.toContain('ef389a96');
  });

  it('imports as the four clean Turns the parser fixture expects', () => {
    const imported = parseConversationUpload(sample, 'DeepSeek_export.md');

    expect(imported.format).toBe('ai-exporter');
    expect(imported.vendor).toBe('deepseek');
    expect(imported.turns).toHaveLength(4);
    expect(imported.warnings).toEqual([]);
  });
});
