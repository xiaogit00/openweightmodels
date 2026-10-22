import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { databaseUrl } from './config';

async function requestMagicLink(page: Page, email: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(page.getByText('Check your inbox')).toBeVisible();

  const response = await page.request.get(
    `/api/dev/magic-link?email=${encodeURIComponent(email)}`,
  );
  expect(response.ok()).toBeTruthy();
  const { url } = (await response.json()) as { url: string };
  return url;
}

async function firstPublishedComparisonId(page: Page) {
  const response = await page.request.get('/api/comparisons?limit=1');
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { items: Array<{ id: string }> };
  expect(payload.items[0]?.id).toBeTruthy();
  return payload.items[0]!.id;
}

test('sign in with a single-use link, choose a handle, persist and sign out', async ({
  page,
}) => {
  const tag = Date.now().toString(36);
  const email = `e2e-auth-${tag}@example.test`;
  const handle = `e2e-${tag}`;
  const link = await requestMagicLink(page, email);

  // The link creates the account, then onboarding collects a handle.
  await page.goto(link);
  await expect(page).toHaveURL(/\/onboarding/);
  await expect(page.getByRole('heading', { name: 'Choose your handle' })).toBeVisible();

  // Reserved names and existing handles are rejected with clear messages.
  await page.getByLabel('Your handle').fill('admin');
  await page.getByRole('button', { name: /Claim handle/ }).click();
  await expect(page.getByText(/reserved/i)).toBeVisible();

  await page.getByLabel('Your handle').fill('mira');
  await page.getByRole('button', { name: /Claim handle/ }).click();
  await expect(page.getByText(/already taken/i)).toBeVisible();

  await page.getByLabel('Your handle').fill(handle);
  await page.getByRole('button', { name: /Claim handle/ }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('button', { name: `Account menu for @${handle}` })).toBeVisible();

  // The session survives a reload.
  await page.reload();
  await expect(page.getByRole('button', { name: `Account menu for @${handle}` })).toBeVisible();

  // Sign out from the account menu.
  await page.getByRole('button', { name: `Account menu for @${handle}` }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
  // No bell state implies an account to an anonymous visitor.
  await expect(page.getByRole('button', { name: /Notifications/ })).toHaveCount(0);

  // Anonymous readers see the published Comparison but no writing controls.
  const comparisonId = await firstPublishedComparisonId(page);
  await page.goto(`/comparisons/${comparisonId}?annotations=1`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in to annotate' })).toBeVisible();
  await expect(page.getByText('Sign in to join the discussion.')).toBeVisible();

  // Every write rejects an anonymous request instead of quietly succeeding.
  const rejected = await page.request.post('/api/comments', {
    data: { comparisonId, body: 'Anonymous write must fail.' },
  });
  expect(rejected.status()).toBe(401);

  // The consumed link cannot be replayed.
  await page.goto(link);
  await expect(page).toHaveURL(/\/sign-in\?.*error=INVALID_TOKEN/);
  await expect(page.getByText(/invalid, expired or already used/i)).toBeVisible();

  // A fresh link for the same account signs in without onboarding again.
  const secondLink = await requestMagicLink(page, email);
  await page.goto(secondLink);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('button', { name: `Account menu for @${handle}` })).toBeVisible();
});

test('an expired link is rejected and grants no session', async ({ page }) => {
  const tag = Date.now().toString(36);
  const email = `e2e-expired-${tag}@example.test`;
  const link = await requestMagicLink(page, email);

  // Expire the pending verification exactly as the 15-minute window would.
  execFileSync('psql', [
    databaseUrl,
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    `update auth_verifications set expires_at = now() - interval '1 minute' where value::jsonb->>'email' = '${email}'`,
  ]);

  await page.goto(link);
  await expect(page).toHaveURL(/\/sign-in\?.*error=INVALID_TOKEN/);
  await expect(page.getByText(/invalid, expired or already used/i)).toBeVisible();

  // The attempted sign-in did not create a usable session.
  await page.goto('/new');
  await expect(page).toHaveURL(/\/sign-in/);
});

test('seeded authors sign in with a link and keep their published Comparisons', async ({
  page,
}) => {
  const before = await page.request.get('/api/comparisons?limit=1');
  expect(before.ok()).toBeTruthy();
  const beforePayload = (await before.json()) as { total: number };

  const link = await requestMagicLink(page, 'mira@openweightmodels.test');
  await page.goto(link);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('button', { name: 'Account menu for @mira' })).toBeVisible();

  const me = await page.request.get('/api/me');
  expect(me.ok()).toBeTruthy();
  expect((await me.json()) as { user: { handle: string } }).toMatchObject({
    user: { handle: 'mira' },
  });

  const after = await page.request.get('/api/comparisons?limit=1');
  expect(after.ok()).toBeTruthy();
  expect(((await after.json()) as { total: number }).total).toBe(beforePayload.total);

  // The development switcher clears the live session and takes over.
  const switched = await page.request.post('/api/dev/user', { data: { handle: 'kev' } });
  expect(switched.ok()).toBeTruthy();
  const switchedMe = await page.request.get('/api/me');
  expect((await switchedMe.json()) as { user: { handle: string } }).toMatchObject({
    user: { handle: 'kev' },
  });
});

test('the development outbox only returns links that were requested', async ({
  request,
}) => {
  const missing = await request.get('/api/dev/magic-link?email=nobody@example.test');
  expect(missing.status()).toBe(404);
});
