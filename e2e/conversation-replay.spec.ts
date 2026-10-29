import { expect, test } from '@playwright/test';

test('replay a three-Turn Conversation and publish the stacked transcript', async ({ page }) => {
  const title = `E2E conversation ${Date.now()}`;
  const script = [
    { prompt: 'First question about queues', baseOutput: 'BASE ONE: a queue bounds memory.' },
    { prompt: 'Second question about backpressure', baseOutput: 'BASE TWO: reject early.' },
    { prompt: 'Third question about fairness', baseOutput: 'BASE THREE: use FIFO.' },
  ];

  // Ana keeps this job notification away from the journey's Mira mailbox.
  const signedIn = await page.request.post('/api/dev/user', { data: { handle: 'ana' } });
  expect(signedIn.ok()).toBeTruthy();

  const modelsResponse = await page.request.get('/api/models');
  expect(modelsResponse.ok()).toBeTruthy();
  const { models } = (await modelsResponse.json()) as {
    models: Array<{ id: string; slug: string }>;
  };
  const base = models.find((model) => model.slug === 'llama-3-3-70b');
  const challenger = models.find((model) => model.slug === 'qwen-2-5-72b');
  expect(base).toBeTruthy();
  expect(challenger).toBeTruthy();

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
  await expect(page.getByText('turn 3 of 3').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Your comparison is ready')).toBeVisible({ timeout: 90_000 });

  await page.getByRole('button', { name: 'Publish to board' }).click();
  await expect(page).toHaveURL(`/comparisons/${id}`);
  await expect(page.getByRole('heading', { name: title })).toBeVisible();

  await expect(page.getByText('Turn 1 of 3')).toBeVisible();
  await expect(page.getByText('Turn 3 of 3')).toBeVisible();
  for (const turn of script) {
    await expect(page.getByText(turn.prompt).first()).toBeVisible();
    await expect(page.getByText(turn.baseOutput).first()).toBeVisible();
  }

  // Leave the shared seed user's bell as clean as this test found it.
  await page.request.patch('/api/notifications', { data: { all: true } });
});
