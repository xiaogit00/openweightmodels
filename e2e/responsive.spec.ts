import { expect, test, type Page } from '@playwright/test';
import {
  annotatedComparison,
  createComparison,
  createConversation,
  publishConversation,
  signInAs,
} from './support';

/** Ticket 17: narrow screens stack on purpose and never scroll sideways. */

async function expectNoHorizontalOverflow(page: Page, screen: string) {
  const widths = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
    offenders: [...document.querySelectorAll<HTMLElement>('body *')]
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        cls: element.className?.toString().slice(0, 120),
        right: Math.round(element.getBoundingClientRect().right),
        width: Math.round(element.getBoundingClientRect().width),
      }))
      .filter((entry) => entry.right > document.documentElement.clientWidth + 1)
      .slice(0, 8),
  }));
  expect(
    widths.scroll,
    `${screen} overflows horizontally: ${widths.scroll}px content in ${widths.client}px\n${JSON.stringify(widths.offenders, null, 2)}`,
  ).toBeLessThanOrEqual(widths.client + 1);
}

async function screens(page: Page) {
  const comparison = await annotatedComparison(page);
  const jobId = await createComparison(
    page,
    `Responsive fixture ${test.info().project.name}-${test.info().title}`,
  );
  const conversationId = await createConversation(
    page,
    `Responsive conversation ${test.info().project.name}-${test.info().title}`,
  );
  await publishConversation(page, conversationId);

  return [
    {
      name: 'Board',
      path: '/',
      assert: async () => {
        await expect(page.getByRole('link', { name: 'New comparison' })).toBeVisible();
        await expect(page.locator('aside').getByRole('button', { name: /^All/ })).toBeVisible();
      },
    },
    {
      name: 'Comparison',
      path: `/comparisons/${comparison.id}?annotations=1`,
      assert: async () => {
        await expect(page.getByRole('button', { name: /Annotations/ })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Discussion' })).toBeVisible();
      },
    },
    {
      name: 'Multi-turn Comparison',
      path: `/comparisons/${conversationId}`,
      assert: async () => {
        await expect(page.locator('[data-turn-rail]')).toBeVisible();
        await expect(page.locator('[data-turn-section]')).toHaveCount(3);
        await expect(page.getByRole('group', { name: 'Jump to turn' })).toBeVisible();
      },
    },
    {
      name: 'New Comparison',
      path: '/new',
      assert: async () => {
        await expect(page.getByRole('button', { name: /Drop a \.md file/ })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Schedule comparison' })).toBeVisible();
        // Exercise the new picker controls at this width: search, filters,
        // disclosure, previous tiles and the pinned Selected strip.
        await page.getByRole('button', { name: /Show previous releases/ }).click();
        await page
          .locator('[data-model-section="previous"] button')
          .first()
          .click();
        await expect(page.locator('[data-selected-models]')).toBeVisible();
      },
    },
    {
      name: 'Job',
      path: `/comparisons/${jobId}/job`,
      assert: async () => {
        await expect(page.getByRole('heading', { name: /Responsive fixture/ })).toBeVisible();
        await expect(page.getByText('Calling hosted APIs', { exact: true }).first()).toBeVisible();
      },
    },
    {
      name: 'Export guide',
      path: '/help/exporting',
      assert: async () => {
        await expect(
          page.getByRole('heading', { name: 'How to export a chat' }),
        ).toBeVisible();
        await expect(page.getByRole('link', { name: /Download a sample export/ })).toBeVisible();
      },
    },
  ];
}

for (const [label, viewport] of [
  ['tablet', { width: 768, height: 1024 }],
  ['phone', { width: 360, height: 800 }],
] as const) {
  test.describe(`${label} ${viewport.width}px`, () => {
    test.use({ viewport });

    test('every main screen stacks without sideways scrolling', async ({ page }) => {
      await signInAs(page, 'ana');
      for (const screen of await screens(page)) {
        await page.goto(screen.path);
        await screen.assert();
        await expectNoHorizontalOverflow(page, screen.name);
      }
    });
  });
}
