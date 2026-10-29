import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  annotatedComparison,
  createComparison,
  createConversation,
  publishConversation,
  signInAs,
} from './support';

/**
 * Ticket 17: the four main screens must have no critical or serious automated
 * accessibility findings. Warnings and best-practice suggestions are allowed;
 * anything a reader would be blocked by is not.
 */
async function expectNoSeriousViolations(page: Page, screen: string) {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations
    .filter((violation) => violation.impact === 'critical' || violation.impact === 'serious')
    .map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.slice(0, 5).map((node) => ({
        target: node.target.join(' '),
        summary: node.failureSummary,
      })),
    }));

  expect(serious, `${screen}: ${JSON.stringify(serious, null, 2)}`).toEqual([]);
}

test.describe('automated accessibility scan', () => {
  // Scan settled, static content: in-flight opacity animations would make the
  // contrast check flaky rather than revealing a real colour problem.
  test.use({ reducedMotion: 'reduce' });

  test('Board', async ({ page }) => {
    await signInAs(page, 'mira');
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Board' })).toBeAttached();
    await expect(page.locator('main a.card').first()).toBeVisible();
    await expectNoSeriousViolations(page, 'Board');
  });

  test('Comparison', async ({ page }) => {
    await signInAs(page, 'mira');
    const comparison = await annotatedComparison(page);
    await page.goto(`/comparisons/${comparison.id}?annotations=1`);
    await expect(page.getByRole('heading', { name: comparison.title })).toBeVisible();
    await expectNoSeriousViolations(page, 'Comparison');

    // The thread dialog is part of the screen too.
    await page.locator('[data-annotation-span]').first().click();
    await expect(page.locator('[data-annotation-popover]')).toBeVisible();
    await expectNoSeriousViolations(page, 'Comparison annotation thread');
  });

  test('Multi-turn Comparison', async ({ page }) => {
    await signInAs(page, 'ana');
    const comparisonId = await createConversation(page, 'Accessibility conversation fixture');
    await publishConversation(page, comparisonId);
    await expect(page.getByLabel('Jump to turn')).toBeVisible();
    await expectNoSeriousViolations(page, 'Multi-turn Comparison');
  });

  test('New Comparison', async ({ page }) => {
    await signInAs(page, 'mira');
    await page.goto('/new');
    await expect(page.getByRole('heading', { name: 'New comparison' })).toBeVisible();
    await expectNoSeriousViolations(page, 'New Comparison');
  });

  test('Job', async ({ page }) => {
    await signInAs(page, 'ana');
    const comparisonId = await createComparison(page, 'Accessibility Job fixture');
    await page.goto(`/comparisons/${comparisonId}/job`);
    await expect(page.getByText('Your comparison is ready')).toBeVisible({
      timeout: 90_000,
    });
    await expectNoSeriousViolations(page, 'Job');
  });
});
