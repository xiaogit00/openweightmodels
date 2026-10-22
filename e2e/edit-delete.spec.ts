import { expect, test, type Page } from '@playwright/test';

type CreatedComment = { id: string; body: string };

async function firstComparisonId(page: Page) {
  // The deterministic seed owns this published Comparison, so its author is mira
  // and it already has a seeded Discussion and Annotation thread.
  const response = await page.request.get('/api/comparisons?q=Rate%20limiter&limit=1');
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { items: Array<{ id: string }> };
  const id = payload.items[0]?.id;
  expect(id).toBeTruthy();
  return id as string;
}

async function createComment(
  page: Page,
  data: { comparisonId: string; body: string; parentId?: string },
) {
  const response = await page.request.post('/api/comments', { data });
  expect(response.status()).toBe(201);
  const payload = (await response.json()) as { comment: CreatedComment };
  return payload.comment;
}

test('owner edits and deletes Discussion comments', async ({ page }) => {
  const stamp = Date.now();
  const commentBody = `E2E editable comment ${stamp}`;
  const editedBody = `E2E edited comment ${stamp}`;
  const replyBody = `E2E reply that survives a tombstone ${stamp}`;
  const childlessBody = `E2E childless comment ${stamp}`;

  const signedIn = await page.request.post('/api/dev/user', { data: { handle: 'mira' } });
  expect(signedIn.ok()).toBeTruthy();

  const comparisonId = await firstComparisonId(page);
  const root = await createComment(page, { comparisonId, body: commentBody });
  const reply = await createComment(page, {
    comparisonId,
    body: replyBody,
    parentId: root.id,
  });
  const childless = await createComment(page, { comparisonId, body: childlessBody });

  await page.goto(`/comparisons/${comparisonId}`);
  const count = page.locator('[data-comment-count]');
  const initialCount = Number(await count.textContent());

  // Keep a filtered Board open so deletion can be seen lowering its card count
  // and retracting the matching ticker line without a reload.
  const board = await page.context().newPage();
  await board.goto('/?q=Rate%20limiter');
  const boardCard = board
    .locator('a.card')
    .filter({ hasText: 'Rate limiter in Go with sliding windows' });
  const boardComments = boardCard.locator('[data-card-comment-count]');
  await expect(boardComments).toHaveText(String(initialCount));
  const tickerLine = 'mira commented on Rate limiter in Go with sliding windows';
  const ticker = board.locator('[data-ticker]').getByText(tickerLine);
  await expect(ticker).toHaveCount(4);

  const rootCard = page.locator(`[data-comment="${root.id}"]`);
  await expect(rootCard.getByText(commentBody)).toBeVisible();

  // Edit inline: the kebab opens an editor, Save persists, Cancel leaves no trace.
  await rootCard.getByRole('button', { name: 'Comment actions' }).click();
  await page.locator('[data-actions-menu]').getByRole('button', { name: 'Edit' }).click();
  await rootCard.getByRole('textbox', { name: 'Edit comment' }).fill(editedBody);
  await rootCard.getByRole('button', { name: 'Save' }).click();
  await expect(rootCard.getByRole('textbox', { name: 'Edit comment' })).toHaveCount(0);
  await expect(rootCard.getByText(editedBody)).toBeVisible();
  await expect(rootCard.getByText(commentBody)).toHaveCount(0);

  await page.reload();
  await expect(
    page.locator(`[data-comment="${root.id}"]`).getByText(editedBody),
  ).toBeVisible();

  // A childless comment is hard-deleted, its votes go with it, and the count drops.
  const childlessCard = page.locator(`[data-comment="${childless.id}"]`);
  await childlessCard.getByRole('button', { name: 'Comment actions' }).click();
  const menu = page.locator('[data-actions-menu]');
  await menu.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(menu.getByText('Delete this comment?')).toBeVisible();
  await menu.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(childlessCard).toHaveCount(0);
  await expect(count).toHaveText(String(initialCount - 1));
  await expect(boardComments).toHaveText(String(initialCount - 1));
  await expect(ticker).toHaveCount(2);

  // Deleting a parent with replies leaves a tombstone; the reply and its author stay.
  await rootCard.getByRole('button', { name: 'Comment actions' }).click();
  await menu.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(menu.getByText('Delete this comment?')).toBeVisible();
  await menu.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(rootCard.getByText('[deleted]')).toBeVisible();
  await expect(rootCard.getByText(replyBody)).toBeVisible();
  await expect(count).toHaveText(String(initialCount - 2));
  await expect(boardComments).toHaveText(String(initialCount - 2));
  await expect(ticker).toHaveCount(0);
  await board.close();

  await page.reload();
  const persistedRoot = page.locator(`[data-comment="${root.id}"]`);
  await expect(persistedRoot.getByText('[deleted]')).toBeVisible();
  await expect(persistedRoot.getByText(replyBody)).toBeVisible();
  await expect(count).toHaveText(String(initialCount - 2));

  // A non-owner sees no controls and cannot call the API directly.
  const switched = await page.request.post('/api/dev/user', { data: { handle: 'kev' } });
  expect(switched.ok()).toBeTruthy();
  await page.reload();

  const replyCard = page.locator(`[data-comment="${reply.id}"]`);
  await expect(replyCard.getByText(replyBody)).toBeVisible();
  await expect(
    replyCard.getByRole('button', { name: 'Reply actions' }),
  ).toHaveCount(0);
  await expect(
    persistedRoot.getByRole('button', { name: 'Comment actions' }),
  ).toHaveCount(0);

  const forbidden = await page.request.patch(`/api/comments/${reply.id}`, {
    data: { body: 'Hijacked by a reader' },
  });
  expect(forbidden.status()).toBe(403);
});

test('owner retags and deletes an Annotation and tombstones a thread message', async ({
  page,
  browser,
}) => {
  const stamp = Date.now();
  const annotationBody = `E2E annotation ${stamp}`;
  const editedMessage = `E2E edited message ${stamp}`;

  const signedIn = await page.request.post('/api/dev/user', { data: { handle: 'mira' } });
  expect(signedIn.ok()).toBeTruthy();

  const comparisonId = await firstComparisonId(page);
  const bundleResponse = await page.request.get(`/api/comparisons/${comparisonId}`);
  expect(bundleResponse.ok()).toBeTruthy();
  const bundle = (await bundleResponse.json()) as {
    responses: Array<{ response: { id: string; isBase: boolean } }>;
  };
  const baseResponseId = bundle.responses.find((entry) => entry.response.isBase)?.response.id;
  expect(baseResponseId).toBeTruthy();

  const created = await page.request.post('/api/annotations', {
    data: {
      responseId: baseResponseId,
      kind: 'bug',
      startOffset: 0,
      endOffset: 4,
      body: annotationBody,
    },
  });
  expect(created.status()).toBe(201);
  const annotation = (await created.json()) as { annotation: { id: string } };

  await page.goto(`/comparisons/${comparisonId}?annotations=1`);
  const span = page.locator(`[data-annotation-id="${annotation.annotation.id}"]`);
  await expect(span).toBeVisible();
  await span.click();

  const popover = page.locator('[data-annotation-popover]');
  await expect(popover.getByText(annotationBody)).toBeVisible();
  await expect(popover.getByRole('button', { name: 'Annotation actions' })).toBeVisible();

  // An anonymous reader can open the thread but gets no controls.
  const readerContext = await browser.newContext();
  const reader = await readerContext.newPage();
  await reader.goto(`/comparisons/${comparisonId}?annotations=1`);
  await reader.locator(`[data-annotation-id="${annotation.annotation.id}"]`).click();
  const readerPopover = reader.locator('[data-annotation-popover]');
  await expect(readerPopover.getByText(annotationBody)).toBeVisible();
  await expect(
    readerPopover.getByRole('button', { name: 'Annotation actions' }),
  ).toHaveCount(0);
  await expect(readerPopover.getByRole('button', { name: 'Message actions' })).toHaveCount(0);
  await readerContext.close();

  // Edit the first thread message in place.
  await popover.getByRole('button', { name: 'Message actions' }).first().click();
  const menu = page.locator('[data-actions-menu]');
  await menu.getByRole('button', { name: 'Edit' }).click();
  await popover.getByRole('textbox', { name: 'Edit message' }).fill(editedMessage);
  await popover.getByRole('button', { name: 'Save' }).click();
  await expect(popover.getByRole('textbox', { name: 'Edit message' })).toHaveCount(0);
  await expect(popover.getByText(editedMessage)).toBeVisible();
  await expect(popover.getByText(annotationBody)).toHaveCount(0);

  // Delete it: the message is tombstoned rather than removed.
  await popover.getByRole('button', { name: 'Message actions' }).first().click();
  await menu.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(menu.getByText('Delete this message?')).toBeVisible();
  await menu.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(popover.getByText('[deleted]')).toBeVisible();
  await expect(popover.getByText(editedMessage)).toHaveCount(0);

  // Retag the Annotation from the same menu.
  await popover.getByRole('button', { name: 'Annotation actions' }).click();
  await menu.getByRole('button', { name: 'Good' }).click();
  await expect(popover.getByText('Good', { exact: true })).toBeVisible();

  const retagged = await page.request.get(`/api/comparisons/${comparisonId}`);
  const retaggedPayload = (await retagged.json()) as {
    annotations: Array<{ id: string; kind: string }>;
  };
  expect(
    retaggedPayload.annotations.find((item) => item.id === annotation.annotation.id)?.kind,
  ).toBe('good');

  // Deleting the Annotation removes its highlight and the whole thread.
  await popover.getByRole('button', { name: 'Annotation actions' }).click();
  await menu.getByRole('button', { name: 'Delete annotation' }).click();
  await expect(
    menu.getByText('Delete this annotation and its whole thread?'),
  ).toBeVisible();
  await menu.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(span).toHaveCount(0);

  const after = await page.request.get(`/api/comparisons/${comparisonId}`);
  const afterPayload = (await after.json()) as {
    annotations: Array<{ id: string }>;
  };
  expect(
    afterPayload.annotations.some((item) => item.id === annotation.annotation.id),
  ).toBe(false);
});
