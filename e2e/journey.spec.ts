import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';

test('upload → schedule → live Job → publish → Board → annotate → thread → comment → vote', async ({
  page,
}) => {
  const title = `E2E rate limiter ${Date.now()}`;
  const annotationBody = 'E2E: this line deserves an annotation.';
  const replyBody = 'E2E: and a reply in the thread.';
  const commentBody = 'E2E: the trade-off is memory, not throughput.';

  const baseOutput = test.info().outputPath('e2e-base-output.md');
  writeFileSync(
    baseOutput,
    [
      '---',
      'prompt: Write a thread-safe sliding-window rate limiter in Go and explain the trade-off.',
      'model: llama-3-3-70b',
      '---',
      '',
      'This is the uploaded base output for the end-to-end journey. It tracks timestamps per key and trims the window on every request.',
      '',
      '```go',
      'const window = 60',
      '```',
    ].join('\n'),
  );

  // A real account is required to write. Use the development switcher.
  const signedIn = await page.request.post('/api/dev/user', {
    data: { handle: 'mira' },
  });
  expect(signedIn.ok()).toBeTruthy();

  // 1. Upload a Base output and schedule a Comparison.
  await page.goto('/new');
  await page.locator('input[type="file"]').setInputFiles(baseOutput);

  await expect(page.getByText('e2e-base-output.md')).toBeVisible();
  await expect(page.locator('select option:checked')).toHaveText('Llama 3.3 70B');
  await expect(page.locator('textarea').first()).toHaveValue(/sliding-window rate limiter/);

  await page.getByPlaceholder("What's being compared?").fill(title);
  await page.getByRole('button', { name: /Qwen2\.5 72B/ }).click();
  await page.getByRole('button', { name: 'Coding', exact: true }).click();
  await page.getByRole('button', { name: 'Schedule comparison' }).click();

  await expect(page).toHaveURL(/\/comparisons\/[^/]+\/job$/, { timeout: 30_000 });
  const jobUrl = page.url();
  const comparisonUrl = jobUrl.replace(/\/job$/, '');

  // 2. The mock worker settles the Job; the page shows the ready banner.
  await expect(page.getByText('Your comparison is ready')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(/Done · \d+ tok/).first()).toBeVisible();

  // Open the Board first so the published card arrives over SSE.
  const board = await page.context().newPage();
  await board.goto('/');
  await expect(board.getByText(title)).toHaveCount(0);

  // 3. Publish and land on the Comparison.
  await page.getByRole('button', { name: 'Publish to board' }).click();
  await expect(page).toHaveURL(comparisonUrl);
  await expect(page.getByRole('heading', { name: title })).toBeVisible();

  // The finished Job left exactly one unread notification for its author.
  const bell = page.getByRole('button', { name: /Notifications/ });
  await expect(bell).toHaveAccessibleName(/1 unread/);
  await bell.click();
  const notificationPanel = page.locator('[data-notification-panel]');
  await expect(notificationPanel.getByText('Your comparison is ready')).toBeVisible();
  await expect(notificationPanel.getByText(title)).toBeVisible();

  // Opening it marks it read, and the read state survives a reload.
  await notificationPanel.locator('[data-notification-item]').click();
  await expect(page).toHaveURL(comparisonUrl);
  await expect(bell).toHaveAccessibleName('Notifications');
  await page.reload();
  await bell.click();
  await expect(notificationPanel.locator('[data-notification-item]')).toHaveAttribute(
    'data-unread',
    'false',
  );
  await expect(notificationPanel.getByRole('button', { name: 'Mark all read' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(bell).toHaveAccessibleName('Notifications');

  // The live Board receives the published card, and the card opens the Comparison.
  await expect(board.getByText(title)).toBeVisible({ timeout: 20_000 });
  await board.getByText(title).click();
  await expect(board.getByRole('heading', { name: title })).toBeVisible();
  await board.close();

  // 4. Annotate a run and reply in its thread.
  await page.getByRole('button', { name: /Annotations/ }).click();
  const run = page.locator('[data-run][data-annotatable="1"]').first();
  await run.evaluate((node) => {
    const textNode = document
      .createTreeWalker(node, NodeFilter.SHOW_TEXT)
      .nextNode();
    if (!textNode) throw new Error('annotatable run has no text node');
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 4);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await run.dispatchEvent('mouseup');

  await page.getByRole('button', { name: 'Annotate', exact: true }).click();
  const popover = page.locator('[data-popover]');
  await popover.getByPlaceholder('What stands out here?').fill(annotationBody);
  await popover.getByRole('button', { name: 'Add annotation' }).click();

  await expect(popover.getByText(annotationBody)).toBeVisible();
  await popover.getByPlaceholder('Reply…').fill(replyBody);
  await popover.getByPlaceholder('Reply…').press('Enter');
  await expect(popover.getByText(replyBody)).toBeVisible();
  await page.keyboard.press('Escape');

  // 5. Post a Discussion comment.
  await page
    .getByPlaceholder('Share what you noticed across the outputs…')
    .fill(commentBody);
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(page.getByText(commentBody)).toBeVisible();

  // 6. A second signed-in reader votes on the Annotation and the comment.
  const switched = await page.request.post('/api/dev/user', {
    data: { handle: 'kev' },
  });
  expect(switched.ok()).toBeTruthy();
  await page.reload();

  await page.getByRole('button', { name: /Annotations/ }).click();
  await page.locator('[data-annotation-span]').first().click();
  const readerPopover = page.locator('[data-popover]');
  await readerPopover.getByRole('button', { name: 'Vote on annotation' }).click();
  await expect(
    readerPopover.getByRole('button', { name: 'Remove annotation vote' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Vote on comment' }).click();
  await expect(page.getByRole('button', { name: 'Remove comment vote' })).toBeVisible();

  // The thread and both votes persist across a reload.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Remove comment vote' })).toBeVisible();

  await page.getByRole('button', { name: /Annotations/ }).click();
  await page.locator('[data-annotation-span]').first().click();
  const persisted = page.locator('[data-popover]');
  await expect(persisted.getByText(replyBody)).toBeVisible();
  await expect(
    persisted.getByRole('button', { name: 'Remove annotation vote' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');

  // 7. Another reader sees an empty bell, never the author's notification.
  await page.getByRole('button', { name: 'Notifications' }).click();
  await expect(page.getByText(/caught up/)).toBeVisible();
  await expect(page.getByText('Your comparison is ready')).toHaveCount(0);
});
