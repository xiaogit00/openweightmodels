import { expect, test } from '@playwright/test';

test('add a Challenger to a published multi-Turn Comparison replays every Turn', async ({ page, browser }) => {
  const title = `E2E conversation add ${Date.now()}`;
  const script = [
    { prompt: 'First question about queues', baseOutput: 'BASE ONE: a queue bounds memory.' },
    { prompt: 'Second question about backpressure', baseOutput: 'BASE TWO: reject early.' },
    { prompt: 'Third question about fairness', baseOutput: 'BASE THREE: use FIFO.' },
  ];

  const signedIn = await page.request.post('/api/dev/user', { data: { handle: 'ana' } });
  expect(signedIn.ok()).toBeTruthy();

  const modelsResponse = await page.request.get('/api/models');
  expect(modelsResponse.ok()).toBeTruthy();
  const { models } = (await modelsResponse.json()) as {
    models: Array<{ id: string; slug: string }>;
  };
  const base = models.find((model) => model.slug === 'llama-3-3-70b');
  const challenger = models.find((model) => model.slug === 'qwen-3-8-27b');
  const added = models.find((model) => model.slug === 'deepseek-v4-1-flash');
  expect(base).toBeTruthy();
  expect(challenger).toBeTruthy();
  expect(added).toBeTruthy();

  const form = new FormData();
  form.set('turns', JSON.stringify(script));
  form.set('base_model_id', base!.id);
  form.set('title', title);
  form.set('effort', '1');
  form.append('categories', 'Coding');
  form.append('model_ids', challenger!.id);

  const created = await page.request.post('/api/comparisons', { multipart: form });
  expect(created.ok()).toBeTruthy();
  const { id } = (await created.json()) as { id: string };

  await page.goto(`/comparisons/${id}/job`);
  await expect(page.getByText('Your comparison is ready')).toBeVisible({ timeout: 90_000 });
  await page.getByRole('button', { name: 'Publish to board' }).click();
  await expect(page).toHaveURL(`/comparisons/${id}`);
  await expect(page.getByRole('heading', { name: title })).toBeVisible();

  // Adding a model to a multi-Turn Comparison asks first: the Author sees the
  // Turn count and the call estimate before spending them.
  await page.getByRole('button', { name: 'Add model' }).click();
  const menu = page.locator('[data-add-menu]');
  await expect(menu).toBeVisible();
  await menu.getByRole('button', { name: /DeepSeek V4.1 Flash/ }).click();

  const confirmation = menu.locator('[data-add-replay-confirmation]');
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText('answers 3 turns');
  await expect(confirmation).toContainText('3 hosted API calls');

  // Cancelling keeps the comparison untouched.
  await menu.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(page.locator('[data-challenger-tab="deepseek-v4-1-flash"]')).toHaveCount(0);

  await menu.getByRole('button', { name: /DeepSeek V4.1 Flash/ }).click();
  await menu.getByRole('button', { name: 'Add model' }).click();

  // The Replay streams in: the new model appears immediately for the Author
  // with a marker while its later Turns are still pending.
  const authorTab = page.locator('[data-challenger-tab="deepseek-v4-1-flash"]');
  await expect(authorTab).toBeVisible();
  await expect(authorTab.locator('[data-replay-in-progress]')).toBeVisible();

  // A reader sees the model once its first Turn is done, and the finished
  // transcript after the whole Replay settles.
  const readerContext = await browser.newContext();
  const reader = await readerContext.newPage();
  await expect
    .poll(
      async () => {
        await reader.goto(`/comparisons/${id}`);
        return reader.locator('[data-challenger-tab="deepseek-v4-1-flash"]').count();
      },
      { timeout: 60_000 },
    )
    .toBe(1);

  await expect
    .poll(
      async () => {
        await reader.goto(`/comparisons/${id}?model=deepseek-v4-1-flash`);
        return reader
          .locator('[data-turn-section="2"]')
          .getByText(/DeepSeek V4.1 Flash 1017 reads the task as/)
          .count();
      },
      { timeout: 60_000 },
    )
    .toBeGreaterThan(0);

  await expect(page.locator('[data-replay-in-progress]')).toHaveCount(0);
  await expect(authorTab.locator('[data-replay-in-progress]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add model' })).toBeVisible();

  await readerContext.close();
  await page.request.patch('/api/notifications', { data: { all: true } });
});
