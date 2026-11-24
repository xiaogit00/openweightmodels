import { expect, test, type Locator, type Page } from '@playwright/test';

const CARD = 'main a.card';

/** The Board at `lg`, where the weight-class groups start open. */
async function openBoard(page: Page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await expect(page.locator(CARD).first()).toBeVisible();

  const groups = page.locator('aside [data-model-group]');
  await expect(groups.first()).toBeVisible();
  // At `lg` the matchMedia effect opens every group; rows appearing proves it.
  await expect(page.locator('aside [data-model-option]').first()).toBeVisible();
  return groups;
}

/**
 * A group with at least `minimum` rows. Classes vary with the fixture data, so
 * a caller skips its row-count assertions instead of assuming one exists.
 */
async function groupWithRows(
  groups: Locator,
  minimum: number,
): Promise<Locator | null> {
  const count = await groups.count();
  for (let index = 0; index < count; index += 1) {
    const group = groups.nth(index);
    if ((await group.locator('[data-model-option]').count()) >= minimum) {
      return group;
    }
  }
  return null;
}

/** The `wide` effect can land just after hydration; open the group if needed. */
async function ensureOpen(group: Locator) {
  const collapse = group.locator('[data-model-collapse]');
  if ((await collapse.getAttribute('aria-expanded')) === 'false') {
    await collapse.click();
  }
  await expect(collapse).toHaveAttribute('aria-expanded', 'true');
}

const THEMES = ['dark', 'light'] as const;

for (const theme of THEMES) {
  test.describe(`${theme} theme`, () => {
    test.use({ colorScheme: theme });

    test('selecting a group header selects every visible model in it', async ({ page }) => {
      const groups = await openBoard(page);
      const group = await groupWithRows(groups, 1);
      if (!group) {
        test.skip(true, 'no visible model group in the fixture');
        return;
      }
      await ensureOpen(group);

      const selectAll = group.locator('[data-model-select-all]');
      const rows = group.locator('[data-model-option]');
      const total = await rows.count();

      await expect(selectAll).toHaveAttribute('aria-checked', 'false');
      await selectAll.click();

      await expect(selectAll).toHaveAttribute('aria-checked', 'true');
      for (let index = 0; index < total; index += 1) {
        await expect(rows.nth(index)).toHaveAttribute('aria-pressed', 'true');
      }
      await expect(page).toHaveURL(/models=/);
    });

    test('unchecking one model shows the mixed state and its visible count', async ({
      page,
    }) => {
      const groups = await openBoard(page);
      const group = await groupWithRows(groups, 2);
      if (!group) {
        test.skip(true, 'no visible group has at least two models in the fixture');
        return;
      }
      await ensureOpen(group);

      const selectAll = group.locator('[data-model-select-all]');
      const rows = group.locator('[data-model-option]');
      const total = await rows.count();

      await selectAll.click();
      await expect(selectAll).toHaveAttribute('aria-checked', 'true');

      await rows.first().click();

      await expect(selectAll).toHaveAttribute('aria-checked', 'mixed');
      await expect(selectAll).toContainText(`${total - 1}/${total}`);
      await expect(rows.first()).toHaveAttribute('aria-pressed', 'false');
    });

    test('collapsing keeps the selection and the card filter', async ({ page }) => {
      const groups = await openBoard(page);
      const group = await groupWithRows(groups, 1);
      if (!group) {
        test.skip(true, 'no visible model group in the fixture');
        return;
      }
      await ensureOpen(group);

      const selectAll = group.locator('[data-model-select-all]');
      const collapse = group.locator('[data-model-collapse]');

      const filtered = page.waitForResponse(
        (response) =>
          response.request().method() === 'GET' &&
          response.url().includes('/api/comparisons?'),
      );
      await selectAll.click();
      await expect(page).toHaveURL(/models=/);
      await filtered;
      await expect(page.getByText(/\d+ of \d+ comparisons/)).toBeVisible();
      await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');

      const filteredUrl = page.url();
      const filteredCards = await page.locator(CARD).count();

      await collapse.click();

      await expect(collapse).toHaveAttribute('aria-expanded', 'false');
      await expect(group.locator('[data-model-option]')).toHaveCount(0);
      await expect(selectAll).toHaveAttribute('aria-checked', 'true');
      await expect(page).toHaveURL(filteredUrl);
      await expect(page.locator(CARD)).toHaveCount(filteredCards);

      // Re-opening reveals the same selection rather than a cleared one.
      await collapse.click();
      await expect(collapse).toHaveAttribute('aria-expanded', 'true');
      const rows = group.locator('[data-model-option]');
      const total = await rows.count();
      for (let index = 0; index < total; index += 1) {
        await expect(rows.nth(index)).toHaveAttribute('aria-pressed', 'true');
      }
    });

    test('a fully selected class collapses into one chip that clears every slug', async ({
      page,
    }) => {
      await openBoard(page);
      // Frontier is not a class and never gets a class chip.
      const group = await groupWithRows(
        page.locator('aside [data-model-group]:not([data-model-group="frontier"])'),
        2,
      );
      if (!group) {
        test.skip(true, 'no non-frontier group has two visible models in the fixture');
        return;
      }
      await ensureOpen(group);

      await group.locator('[data-model-select-all]').click();

      const chip = page.getByRole('button', { name: /· \d+ models/ });
      await expect(chip).toBeVisible();

      await chip.click();

      await expect(chip).toHaveCount(0);
      await expect(group.locator('[data-model-select-all]')).toHaveAttribute(
        'aria-checked',
        'false',
      );
      await expect(page).not.toHaveURL(/models=/);
    });

    test('below lg every group starts collapsed and can be opened', async ({ page }) => {
      await page.setViewportSize({ width: 768, height: 900 });
      await page.goto('/');

      const group = page.locator('aside [data-model-group]').first();
      await expect(group).toBeVisible();
      const collapse = group.locator('[data-model-collapse]');
      await expect(collapse).toHaveAttribute('aria-expanded', 'false');
      await expect(page.locator('aside [data-model-option]')).toHaveCount(0);

      await collapse.click();
      await expect(collapse).toHaveAttribute('aria-expanded', 'true');
      await expect(group.locator('[data-model-option]').first()).toBeVisible();
    });
  });
}
