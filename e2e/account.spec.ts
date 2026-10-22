import { expect, test, type Page } from '@playwright/test';

async function signUp(page: Page, email: string, handle: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(page.getByText('Check your inbox')).toBeVisible();

  const response = await page.request.get(
    `/api/dev/magic-link?email=${encodeURIComponent(email)}`,
  );
  expect(response.ok()).toBeTruthy();
  const { url } = (await response.json()) as { url: string };

  await page.goto(url);
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByLabel('Your handle').fill(handle);
  await page.getByRole('button', { name: /Claim handle/ }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function firstPublishedComparisonId(page: Page) {
  const response = await page.request.get('/api/comparisons?limit=1');
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { items: Array<{ id: string }> };
  expect(payload.items[0]?.id).toBeTruthy();
  return payload.items[0]!.id;
}

test('export data, then delete the account and leave published discussion behind as a tombstone', async ({
  page,
}) => {
  const tag = Date.now().toString(36);
  const email = `e2e-account-${tag}@example.test`;
  const handle = `account-${tag}`;
  await signUp(page, email, handle);

  const comparisonId = await firstPublishedComparisonId(page);
  const body = `E2E account comment ${tag}`;
  const posted = await page.request.post('/api/comments', {
    data: { comparisonId, body },
  });
  expect(posted.ok()).toBeTruthy();

  // The export is a download that contains the account's own data.
  await page.goto('/account');
  await expect(page.getByText(email)).toBeVisible();
  const exported = await page.request.get('/api/account/export');
  expect(exported.ok()).toBeTruthy();
  expect(exported.headers()['content-disposition']).toContain('attachment');
  const data = (await exported.json()) as {
    account: { email: string; handle: string };
    comments: Array<{ body: string }>;
  };
  expect(data.account).toMatchObject({ email, handle });
  expect(data.comments.some((comment) => comment.body === body)).toBeTruthy();

  // Deletion needs the typed word before the button unlocks.
  await page.goto('/account');
  const deleteButton = page.getByRole('button', { name: 'Delete my account' });
  await expect(deleteButton).toBeDisabled();
  await page.getByLabel('Type DELETE to confirm').fill('delete');
  await expect(deleteButton).toBeEnabled();
  await deleteButton.click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
  const me = await page.request.get('/api/me');
  expect((await me.json()) as { user: unknown }).toEqual({ user: null });

  // The comment survives only as a tombstone, and its wording is gone.
  await page.goto(`/comparisons/${comparisonId}`);
  await expect(page.getByText('[deleted]').first()).toBeVisible();
  await expect(page.getByText(body)).toHaveCount(0);

  // A deleted account cannot delete itself again without a session.
  const again = await page.request.post('/api/account/delete', {
    data: { confirmation: 'delete' },
  });
  expect(again.status()).toBe(401);
});

test('the public shell links to the legal pages', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Terms', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Terms of Service' })).toBeVisible();
  await expect(page.getByText(/Draft for owner and legal review/i)).toBeVisible();

  await page.getByRole('link', { name: 'Privacy', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Privacy Policy' })).toBeVisible();
  await expect(page.getByText(/Draft for owner and legal review/i)).toBeVisible();
});
