import { expect, test, type Page } from '@playwright/test';

async function switchTo(page: Page, handle: string) {
  const response = await page.request.post('/api/dev/user', { data: { handle } });
  expect(response.ok()).toBeTruthy();
}

test('only admins reach the admin surface; model toggles and takedowns are recorded', async ({
  page,
}) => {
  // Anonymous and ordinary members get the same 404 as a route that does not exist.
  expect((await page.goto('/admin'))?.status()).toBe(404);

  await switchTo(page, 'kev');
  expect((await page.goto('/admin'))?.status()).toBe(404);

  const modelsResponse = await page.request.get('/api/models');
  const { models } = (await modelsResponse.json()) as {
    models: Array<{ id: string; name: string }>;
  };
  const phi = models.find((model) => model.name === 'Phi 4');
  expect(phi).toBeTruthy();

  const denied = await page.request.patch(`/api/admin/models/${phi!.id}`, {
    data: { enabled: false },
  });
  expect(denied.status()).toBe(404);

  await switchTo(page, 'mira');
  expect((await page.goto('/admin'))?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Admin', exact: true })).toBeVisible();

  // Disabling removes a Model from the registry pickers immediately.
  await page.getByRole('button', { name: 'Disable Phi 4' }).click();
  await expect(page.getByRole('button', { name: 'Enable Phi 4' })).toBeVisible();

  const picker = await page.request.get('/api/models');
  expect(
    ((await picker.json()) as { models: Array<{ name: string }> }).models.some(
      (model) => model.name === 'Phi 4',
    ),
  ).toBe(false);

  await page.goto('/new');
  await expect(page.getByText('Phi 4', { exact: true })).toHaveCount(0);

  await page.goto('/admin');
  await page.getByRole('button', { name: 'Enable Phi 4' }).click();
  await expect(page.getByRole('button', { name: 'Disable Phi 4' })).toBeVisible();

  // Pick a fixture to take down, then find and hide it from the admin surface.
  const target = 'Board fixture 56';
  const search = await page.request.get(
    `/api/comparisons?q=${encodeURIComponent(target)}&limit=10`,
  );
  const { items } = (await search.json()) as { items: Array<{ id: string; title: string }> };
  const comparison = items.find((item) => item.title === target);
  expect(comparison).toBeTruthy();
  const comparisonId = comparison!.id;

  await page.getByPlaceholder('Find by title or @handle').fill(target);
  await page.getByRole('button', { name: `Take down ${target}` }).click();
  await page.getByLabel(/Why is this being hidden/).fill('E2E takedown reason');
  await page.getByRole('button', { name: 'Confirm takedown' }).click();

  await expect(page.getByText('E2E takedown reason').first()).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Took down comparison' })).toBeVisible();
  await expect(page.getByRole('button', { name: `Restore ${target}` })).toBeVisible();

  // The record survives for the admin, but the public route and Board drop it.
  await page.request.delete('/api/dev/user');
  expect((await page.request.get(`/api/comparisons/${comparisonId}`)).status()).toBe(404);
  const board = await page.request.get(
    `/api/comparisons?q=${encodeURIComponent(target)}&limit=10`,
  );
  expect(((await board.json()) as { total: number }).total).toBe(0);

  await switchTo(page, 'mira');
  await page.goto('/admin');
  await expect(page.getByText(target).first()).toBeVisible();
  await page.getByRole('button', { name: `Restore ${target}` }).click();
  await expect(page.getByRole('button', { name: `Take down ${target}` })).toBeVisible();
  await expect(page.getByText('Nothing is hidden.')).toBeVisible();

  await page.request.delete('/api/dev/user');
  expect((await page.request.get(`/api/comparisons/${comparisonId}`)).status()).toBe(200);
});
