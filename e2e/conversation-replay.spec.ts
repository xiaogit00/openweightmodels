import { expect, test } from '@playwright/test';

test('replay a three-Turn Conversation and read it as a transcript', async ({ page }) => {
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
  const challenger = models.find((model) => model.slug === 'qwen-3-8-27b');
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

  // Every Turn groups the user message, the Base output and the active
  // Challenger's reply.
  const turns = page.locator('[data-turn-section]');
  await expect(turns).toHaveCount(3);
  for (const turn of script) {
    await expect(page.getByText(turn.prompt).first()).toBeVisible();
    await expect(page.getByText(turn.baseOutput).first()).toBeVisible();
  }

  // The sticky rail moves with previous, next and the jump control, using the
  // keyboard and keeping focus where the reader put it.
  const indicator = page.locator('[data-turn-indicator]');
  await expect(indicator).toHaveText('Turn 1 of 3');

  const previous = page.getByRole('button', { name: 'Previous turn' });
  const next = page.getByRole('button', { name: 'Next turn' });
  await expect(previous).toHaveAttribute('aria-disabled', 'true');

  await next.focus();
  await expect(next).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(indicator).toHaveText('Turn 2 of 3');
  await expect(next).toBeFocused();

  const jump = page.getByLabel('Jump to turn');
  await jump.focus();
  await expect(jump).toBeFocused();
  await jump.selectOption({ label: 'Turn 3' });
  await expect(indicator).toHaveText('Turn 3 of 3');
  await expect(next).toHaveAttribute('aria-disabled', 'true');

  await previous.focus();
  await page.keyboard.press('Enter');
  await expect(indicator).toHaveText('Turn 2 of 3');
  await expect(previous).toBeFocused();
  await expect(previous).toHaveAttribute('aria-disabled', 'false');

  // An Annotation attaches to the reply of the Turn it was selected from, and
  // its thread names that Turn.
  await page.goto(`/comparisons/${id}?annotations=1`);
  const secondTurnRun = page
    .locator('[data-turn-section="1"] [data-run][data-annotatable="1"]')
    .first();
  await secondTurnRun.evaluate((node) => {
    const textNode = document.createTreeWalker(node, NodeFilter.SHOW_TEXT).nextNode();
    if (!textNode) throw new Error('annotatable run has no text node');
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 12);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await secondTurnRun.dispatchEvent('keyup', { key: 'Shift', shiftKey: false });

  const annotate = page.getByRole('button', { name: 'Annotate selection' }).first();
  await expect(annotate).toBeVisible();
  await annotate.click();

  const popover = page.locator('[data-annotation-popover]');
  await expect(popover).toBeVisible();
  await expect(popover.locator('[data-annotation-turn]')).toHaveText('Turn 2 of 3');
  await popover.getByLabel('Annotation note').fill(`Turn two note ${Date.now()}`);
  await popover.getByRole('button', { name: 'Add annotation' }).click();
  await expect(popover.locator('[data-annotation-turn]')).toHaveText('Turn 2 of 3');

  // Leave the shared seed user's bell as clean as this test found it.
  await page.request.patch('/api/notifications', { data: { all: true } });
});
