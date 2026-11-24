import { expect, test, type Locator } from '@playwright/test';
import { annotatedComparison, signInAs } from './support';

const CLASS_LABEL: Record<string, string> = {
  fly: 'Fly',
  feather: 'Feather',
  light: 'Light',
  middle: 'Middle',
  heavy: 'Heavy',
  'super-heavy': 'Super Heavy',
  frontier: 'Frontier API',
};

const THEMES = ['dark', 'light'] as const;

for (const theme of THEMES) {
  test.describe(`${theme} theme`, () => {
    test.use({ colorScheme: theme });

    test('Comparison headers and picker rows show each Model’s Weight class', async ({
      page,
    }) => {
      await signInAs(page, 'mira');
      const comparison = await annotatedComparison(page);
      await page.goto(`/comparisons/${comparison.id}`);

      // Both column headers carry a chip. The Base is Llama 3.3 70B: Middle, 64 GB.
      const chips = page.locator('[data-weight-chip]');
      await expect(chips).toHaveCount(2);
      const baseChip = chips.first();
      await expect(baseChip).toBeVisible();
      await expect(baseChip).toHaveAttribute('data-weight-class', 'middle');
      await expect(baseChip).toContainText('Middle');
      await expect(baseChip).toContainText('64 GB');
      await expect(baseChip).toHaveAttribute(
        'title',
        'Middle weight · 64 GB to run at 4-bit',
      );

      // The Challenger chip mirrors the active Response.
      const activeChip = chips.nth(1);
      await expect(activeChip).toBeVisible();
      const initialClass = await activeChip.getAttribute('data-weight-class');
      expect(initialClass).not.toBeNull();
      await expect(activeChip).toContainText(CLASS_LABEL[initialClass!]!);

      // Open the switcher and Add-a-model menu.
      await page.locator('[data-model-picker]').click();
      const menu = page.locator('[data-add-menu]');
      await expect(menu).toBeVisible();

      // Every Responses row prints its class beside the name.
      const responseRows = menu.locator('[data-challenger-tab]');
      await expect(responseRows.first()).toBeVisible();
      const responseLabels = await responseRows.evaluateAll((rows) =>
        rows.map((row) => {
          const label = row.querySelector('[data-weight-row-label]');
          return {
            slug: row.getAttribute('data-challenger-tab') ?? '',
            cls: label?.getAttribute('data-weight-class') ?? '',
            text: label?.textContent?.trim() ?? '',
          };
        }),
      );
      expect(responseLabels.length).toBeGreaterThan(0);
      for (const row of responseLabels) {
        expect(row.cls).not.toBe('');
        expect(row.text).toBe(CLASS_LABEL[row.cls]);
      }

      // Every Add-a-model row prints its class too, and a Frontier row never
      // shows a Run size.
      const addRows = menu.locator('[data-add-model-list] button');
      await expect(addRows.first()).toBeVisible();
      const addRowLabels = await addRows.evaluateAll((rows) =>
        rows.map((row) => {
          const label = row.querySelector('[data-weight-row-label]');
          return {
            cls: label?.getAttribute('data-weight-class') ?? '',
            text: label?.textContent?.trim() ?? '',
          };
        }),
      );
      expect(addRowLabels.length).toBeGreaterThan(0);
      for (const row of addRowLabels) {
        expect(row.cls).not.toBe('');
        expect(row.text).toBe(CLASS_LABEL[row.cls]);
      }
      const frontierRow: Locator = menu
        .locator('[data-add-model-list] button:has([data-weight-row-label][data-weight-class="frontier"])')
        .first();
      await expect(frontierRow.locator('[data-weight-row-label]')).toHaveText(
        'Frontier API',
      );
      await expect(frontierRow.locator('[data-weight-row-label]')).not.toContainText(
        /GB/,
      );

      // Switch to a Challenger in a different class; the chip follows it.
      const target =
        responseLabels.find((row) => row.cls !== initialClass) ?? responseLabels[0]!;
      const targetRow = menu.locator(`[data-challenger-tab="${target.slug}"]`);
      const targetLabel = targetRow.locator('[data-weight-row-label]');
      const targetTitle = await targetLabel.getAttribute('title');
      await targetRow.click();
      await expect(menu).toBeHidden();
      await expect(activeChip).toHaveAttribute('data-weight-class', target.cls);
      await expect(activeChip).toHaveAttribute('title', targetTitle!);
      await expect(activeChip).toContainText(target.text);
      if (responseLabels.some((row) => row.cls !== initialClass)) {
        expect(target.cls).not.toBe(initialClass);
      }

      // Reopening the menu marks the switched Response as active.
      await page.locator('[data-model-picker]').click();
      await expect(menu).toBeVisible();
      await expect(
        menu.locator(`[data-challenger-tab="${target.slug}"]`),
      ).toHaveAttribute('aria-current', 'true');
    });
  });
}
