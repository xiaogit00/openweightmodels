import { expect, test, type Page } from '@playwright/test';

async function switchTo(page: Page, handle: string) {
  const response = await page.request.post('/api/dev/user', { data: { handle } });
  expect(response.ok()).toBeTruthy();
}

async function firstComparisonId(page: Page) {
  const response = await page.request.get('/api/comparisons?q=Rate%20limiter&limit=1');
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { items: Array<{ id: string }> };
  const id = payload.items[0]?.id;
  expect(id).toBeTruthy();
  return id as string;
}

async function cardCommentCount(page: Page) {
  const response = await page.request.get('/api/comparisons?q=Rate%20limiter&limit=1');
  const payload = (await response.json()) as {
    items: Array<{ commentCount: number }>;
  };
  return payload.items[0]?.commentCount;
}

test('report, hide, restore and suspend through the admin queue', async ({ page }) => {
  const stamp = Date.now();
  const hiddenBody = `E2E moderated comment ${stamp}`;
  const suspendedBody = `E2E suspension trigger ${stamp}`;
  const hideDetail = `E2E hide detail ${stamp}`;
  const suspendDetail = `E2E suspend detail ${stamp}`;
  const comparisonId = await firstComparisonId(page);

  // A reader without a session cannot report.
  await page.request.delete('/api/dev/user');
  const anonymous = await page.request.post('/api/reports', {
    data: {
      targetType: 'comparison',
      targetId: comparisonId,
      reason: 'spam',
    },
  });
  expect(anonymous.status()).toBe(401);

  // kev writes two comments; ana reports both.
  await switchTo(page, 'kev');
  const first = await page.request.post('/api/comments', {
    data: { comparisonId, body: hiddenBody },
  });
  expect(first.status()).toBe(201);
  const firstComment = ((await first.json()) as { comment: { id: string } }).comment;

  const second = await page.request.post('/api/comments', {
    data: { comparisonId, body: suspendedBody },
  });
  expect(second.status()).toBe(201);
  const secondComment = ((await second.json()) as { comment: { id: string } }).comment;

  await switchTo(page, 'ana');
  const hideReport = await page.request.post('/api/reports', {
    data: {
      targetType: 'comment',
      targetId: firstComment.id,
      reason: 'harassment',
      detail: hideDetail,
    },
  });
  expect(hideReport.status()).toBe(201);
  const hideReportId = ((await hideReport.json()) as { report: { id: string } }).report.id;

  const duplicate = await page.request.post('/api/reports', {
    data: {
      targetType: 'comment',
      targetId: firstComment.id,
      reason: 'spam',
    },
  });
  expect(duplicate.status()).toBe(200);
  expect(((await duplicate.json()) as { report: { duplicate: boolean } }).report.duplicate).toBe(
    true,
  );

  const suspendReport = await page.request.post('/api/reports', {
    data: {
      targetType: 'comment',
      targetId: secondComment.id,
      reason: 'harassment',
      detail: suspendDetail,
    },
  });
  expect(suspendReport.status()).toBe(201);

  // Members cannot see the queue or call moderation actions.
  expect((await page.goto('/admin'))?.status()).toBe(404);
  const denied = await page.request.post(`/api/admin/reports/${hideReportId}/hide`, {
    data: { reason: 'Nope' },
  });
  expect(denied.status()).toBe(404);

  // The Admin hides the reported comment from the queue.
  await switchTo(page, 'mira');
  expect((await page.goto('/admin'))?.status()).toBe(200);

  const hideRow = page.locator('[data-report]').filter({ hasText: hideDetail });
  await expect(hideRow).toBeVisible();
  const beforeHide = await cardCommentCount(page);

  await hideRow.getByRole('button', { name: 'Hide comment' }).click();
  await hideRow
    .getByLabel(/Why is this content being hidden/)
    .fill('E2E: targets another reader');
  await hideRow.getByRole('button', { name: 'Confirm hide' }).click();

  await expect(page.getByRole('tab', { name: /Resolved/ })).toContainText('1');
  expect(await cardCommentCount(page)).toBe((beforeHide ?? 1) - 1);

  await page.request.delete('/api/dev/user');
  const publicComparison = await page.request.get(`/api/comparisons/${comparisonId}`);
  expect(publicComparison.ok()).toBeTruthy();
  const publicPayload = (await publicComparison.json()) as {
    comments: Array<{ body: string }>;
  };
  expect(publicPayload.comments.some((comment) => comment.body === hiddenBody)).toBe(false);

  // Restore brings it back to readers.
  await switchTo(page, 'mira');
  await page.goto('/admin');
  await page.getByRole('tab', { name: /Resolved/ }).click();
  const resolvedRow = page.locator('[data-report]').filter({ hasText: hideDetail });
  await expect(resolvedRow).toBeVisible();
  await resolvedRow.getByRole('button', { name: 'Restore comment' }).click();
  await expect(page.getByRole('cell', { name: 'Restored comment' }).first()).toBeVisible();
  expect(await cardCommentCount(page)).toBe(beforeHide);

  // Suspend the author from the other open report.
  await page.getByRole('tab', { name: /Open/ }).click();
  const suspendRow = page.locator('[data-report]').filter({ hasText: suspendDetail });
  await suspendRow.getByRole('button', { name: 'Suspend @kev' }).click();
  await suspendRow
    .getByLabel(/Why is @kev being suspended/)
    .fill('E2E: repeated harassment');
  await suspendRow.getByRole('button', { name: 'Confirm suspension' }).click();

  await expect(page.locator('[data-suspended-user="kev"]')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Suspended member' }).first()).toBeVisible();
  await expect(
    page.locator('[data-suspended-user="kev"]').getByText('E2E: repeated harassment'),
  ).toBeVisible();

  // The suspended member keeps read access but every write is rejected clearly.
  await switchTo(page, 'kev');
  expect((await page.request.get(`/api/comparisons/${comparisonId}`)).ok()).toBeTruthy();
  const blocked = await page.request.post('/api/comments', {
    data: { comparisonId, body: 'Blocked while suspended' },
  });
  expect(blocked.status()).toBe(403);
  expect(((await blocked.json()) as { error: { code: string; message: string } }).error).toMatchObject(
    { code: 'account_suspended' },
  );

  await page.goto(`/comparisons/${comparisonId}`);
  await expect(page.getByText('Your account is suspended.')).toBeVisible();

  // Reinstate and confirm writes work again.
  await switchTo(page, 'mira');
  await page.goto('/admin');
  await page
    .locator('[data-suspended-user="kev"]')
    .getByRole('button', { name: 'Reinstate' })
    .click();
  await expect(page.locator('[data-suspended-user="kev"]')).toHaveCount(0);

  await switchTo(page, 'kev');
  const allowed = await page.request.post('/api/comments', {
    data: { comparisonId, body: 'Allowed after reinstatement' },
  });
  expect(allowed.status()).toBe(201);
});
