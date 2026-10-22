import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';

test('author adds a Challenger to a published Comparison', async ({ page, browser }) => {
  const title = `E2E add challenger ${Date.now()}`;
  const baseOutput = test.info().outputPath('e2e-add-challenger-base.md');

  writeFileSync(
    baseOutput,
    [
      '---',
      'prompt: Write a thread-safe sliding-window rate limiter in Go.',
      'model: llama-3-3-70b',
      '---',
      '',
      'The base output tracks timestamps per key and trims the window on every request.',
    ].join('\n'),
  );

  const signedIn = await page.request.post('/api/dev/user', {
    data: { handle: 'ana' },
  });
  expect(signedIn.ok()).toBeTruthy();

  // Schedule and publish a one-Challenger Comparison to have something to add to.
  await page.goto('/new');
  await page.locator('input[type="file"]').setInputFiles(baseOutput);
  await expect(page.getByText('e2e-add-challenger-base.md')).toBeVisible();
  await page.getByPlaceholder("What's being compared?").fill(title);
  await page.getByRole('button', { name: /Qwen2\.5 72B/ }).click();
  await page.getByRole('button', { name: 'Coding', exact: true }).click();
  await page.getByRole('button', { name: 'Schedule comparison' }).click();

  await expect(page).toHaveURL(/\/comparisons\/[^/]+\/job$/, { timeout: 30_000 });
  const comparisonUrl = page.url().replace(/\/job$/, '');
  await expect(page.getByText('Your comparison is ready')).toBeVisible({ timeout: 90_000 });
  await page.getByRole('button', { name: 'Publish to board' }).click();
  await expect(page).toHaveURL(comparisonUrl);
  await expect(page.getByRole('heading', { name: title })).toBeVisible();

  // An anonymous reader sees neither the add control nor the new tab yet.
  const readerContext = await browser.newContext();
  const reader = await readerContext.newPage();
  await reader.goto(comparisonUrl);
  await expect(reader.getByRole('heading', { name: title })).toBeVisible();
  await expect(reader.getByRole('button', { name: 'Add model' })).toHaveCount(0);
  await expect(reader.locator('[data-challenger-tab="deepseek-v3"]')).toHaveCount(0);

  // The menu offers enabled models only, skips the Base and existing Challenger,
  // and advertises an ETA.
  await page.getByRole('button', { name: 'Add model' }).click();
  const menu = page.locator('[data-add-menu]');
  await expect(menu).toBeVisible();
  await expect(menu.getByText('Llama 3.3 70B')).toHaveCount(0);
  await expect(menu.getByText('Qwen2.5 72B')).toHaveCount(0);
  const deepseek = menu.getByRole('button', { name: /DeepSeek V3/ });
  await expect(deepseek).toContainText(/~\d+s/);
  await deepseek.click();

  // The author sees the new tab immediately; the reader only after it is done.
  await expect(page.locator('[data-challenger-tab="deepseek-v3"]')).toBeVisible();
  await expect
    .poll(
      async () => {
        await reader.reload();
        return reader.locator('[data-challenger-tab="deepseek-v3"]').count();
      },
      { timeout: 60_000 },
    )
    .toBe(1);

  // Completion is a publication: the reader still cannot add a model.
  await expect(reader.getByRole('button', { name: 'Add model' })).toHaveCount(0);
  await readerContext.close();

  // Leave the shared seed user's bell as clean as this test found it.
  await page.request.patch('/api/notifications', { data: { all: true } });
});
