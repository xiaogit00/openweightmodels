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
  await page.getByRole('button', { name: /Qwen3\.8 27B/ }).click();
  await page.getByRole('button', { name: 'Coding', exact: true }).click();
  await page.getByRole('button', { name: 'Schedule comparison' }).click();

  await expect(page).toHaveURL(/\/comparisons\/[^/]+\/job$/, { timeout: 30_000 });
  const comparisonUrl = page.url().replace(/\/job$/, '');
  await expect(page.getByText('Your comparison is ready')).toBeVisible({ timeout: 90_000 });
  await page.getByRole('button', { name: 'Publish to board' }).click();
  await expect(page).toHaveURL(comparisonUrl);
  await expect(page.getByRole('heading', { name: title })).toBeVisible();

  // An anonymous reader sees neither the add control nor the new response row yet.
  const readerContext = await browser.newContext();
  const reader = await readerContext.newPage();
  await reader.goto(comparisonUrl);
  await expect(reader.getByRole('heading', { name: title })).toBeVisible();
  await expect(reader.locator('[data-add-button]')).toHaveCount(0);
  await reader.locator('[data-model-picker]').click();
  await expect(reader.locator('[data-add-menu]')).toBeVisible();
  await expect(reader.locator('[data-challenger-tab="deepseek-v4-1-flash"]')).toHaveCount(0);
  await reader.keyboard.press('Escape');

  // The menu offers enabled models only, skips the Base and existing Challenger,
  // and advertises an ETA.
  await page.locator('[data-add-button]').click();
  const menu = page.locator('[data-add-menu]');
  await expect(menu).toBeVisible();
  await expect(menu.locator('[data-model-weight="open"]').first()).toContainText('Open');
  await expect(menu.locator('[data-model-weight="frontier"]').first()).toContainText(
    'Frontier',
  );
  const addList = menu.locator('[data-add-model-list]');
  await expect(addList.getByText('Llama 3.3 70B')).toHaveCount(0);
  await expect(addList.getByText('Qwen3.8 27B')).toHaveCount(0);
  const deepseek = menu.getByRole('button', { name: /DeepSeek V4.1 Flash/ });
  await expect(deepseek).toContainText(/~\d+s/);
  await deepseek.click();
  await expect(menu).toBeHidden();

  // The author sees the new response immediately; the reader only after it is done.
  await page.locator('[data-model-picker]').click();
  await expect(page.locator('[data-challenger-tab="deepseek-v4-1-flash"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect
    .poll(
      async () => {
        await reader.reload();
        await reader.locator('[data-model-picker]').click();
        await reader.locator('[data-add-menu]').waitFor({ state: 'visible' });
        return reader.locator('[data-challenger-tab="deepseek-v4-1-flash"]').count();
      },
      { timeout: 60_000 },
    )
    .toBe(1);

  // Completion is a publication: the reader still cannot add a model.
  await expect(reader.locator('[data-add-button]')).toHaveCount(0);
  await readerContext.close();

  // Leave the shared seed user's bell as clean as this test found it.
  await page.request.patch('/api/notifications', { data: { all: true } });
});
