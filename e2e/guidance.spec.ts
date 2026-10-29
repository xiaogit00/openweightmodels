import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { signInAs } from './support';

const sample = readFileSync(
  'test_md/DeepSeek_OpenRouter-key-secret-variable_20261028-1310.md',
);

test('the upload step explains the exporter, offers the real sample and shows limits', async ({
  page,
}) => {
  await signInAs(page, 'mira');
  await page.goto('/new');

  const card = page.getByRole('region', { name: 'How to get this file' });
  await expect(card).toBeVisible();
  await expect(card.locator('ol > li')).toHaveCount(3);
  await expect(card.getByRole('link', { name: /Chrome Web Store/ })).toHaveAttribute(
    'href',
    /chromewebstore\.google\.com/,
  );

  const download = card.getByRole('link', { name: 'Download a sample export' });
  await expect(download).toHaveAttribute('href', /\/samples\/deepseek-export\.md$/);
  await expect(download).toHaveAttribute('download', 'DeepSeek_export.md');

  const response = await page.request.get('/samples/deepseek-export.md');
  expect(response.ok()).toBeTruthy();
  const body = await response.text();
  expect(body).toContain('# you asked');
  expect(body).toContain('# deepseek response');
  expect(body).toContain('Powered by [AI Exporter]');

  await page.locator('input[type=file]').setInputFiles({
    name: 'DeepSeek_export.md',
    mimeType: 'text/markdown',
    buffer: sample,
  });

  await expect(page.getByText('Turn 1', { exact: true })).toBeVisible();
  await expect(page.getByText('Turn 4', { exact: true })).toBeVisible();
  await expect(
    page.getByText(/Up to 6 turns · 0\.5 MB file · 100,000 characters/),
  ).toBeVisible();
  await expect(page.getByText(/input tokens per model/)).toBeVisible();
});

test('a parser refusal links to the export guide, which names the same limits', async ({
  page,
}) => {
  await signInAs(page, 'mira');
  await page.goto('/new');

  await page.locator('input[type=file]').setInputFiles({
    name: 'paste.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('You: Summarise this article.\nChatGPT: Here is a summary.'),
  });

  const error = page.getByRole('alert').filter({
    hasText: 'pasted straight from a chat window',
  });
  await expect(error).toBeVisible();
  await expect(error).toContainText('Export the conversation with the AI Exporter');

  await error.getByRole('link', { name: 'See how to fix an export' }).click();
  await expect(page).toHaveURL(/\/help\/exporting$/);
  await expect(
    page.getByRole('heading', { name: 'How to export a chat' }),
  ).toBeVisible();
  await expect(page.getByText('6 turns', { exact: true })).toBeVisible();
  await expect(page.getByText('0.5 MB', { exact: true })).toBeVisible();
  await expect(page.getByText('100,000 characters', { exact: true })).toBeVisible();
});
