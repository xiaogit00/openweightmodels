import { execFileSync } from 'node:child_process';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { annotatedComparison, createComparison, signInAs } from './support';

/**
 * Ticket 17: the four main screens at 1440px stay within an agreed visual
 * tolerance of the v2 references. The references themselves are HTML design
 * files, so the agreed tolerance is enforced as committed Playwright
 * baselines at 1440x900 (reviewed side by side against `design_handoff_.../`)
 * plus the concrete layout measurements the v2 handoff specifies.
 *
 * Other suites mutate the Board (publishing, comments, votes, takedowns), so
 * reseed first. Playwright runs one worker at a time, so this cannot race a
 * live test.
 */
test.beforeAll(() => {
  execFileSync('pnpm', ['exec', 'tsx', 'e2e/prepare.ts'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
});

// Screenshots pin a colour scheme: the app follows the OS until a visitor
// chooses, so an ambient light preference would otherwise silently rewrite the
// baselines. Every screen has a baseline in both themes.
test.use({ viewport: { width: 1440, height: 900 } });

const PIXEL_TOLERANCE = 0.01;
const THEMES = ['dark', 'light'] as const;
const MASK_COLOR = { dark: '#0a0c0b', light: '#ffffff' } as const;

function masks(page: Page): Locator[] {
  return [
    page.locator('[data-relative-time]'),
    page.locator('[data-ticker]'),
    page.getByRole('button', { name: /Notifications/ }),
    page.locator('nextjs-portal'),
    page.locator('[data-next-badge-root]'),
  ];
}

async function screenshot(page: Page, name: string, maskColor = '#0a0c0b') {
  // The Next.js dev indicator lives in a fixed shadow root that a screenshot
  // mask cannot reach. It is not part of the app, so hide it for the capture.
  await page.addStyleTag({
    content: 'nextjs-portal { display: none !important; }',
  });
  await expect(page).toHaveScreenshot(name, {
    animations: 'disabled',
    maxDiffPixelRatio: PIXEL_TOLERANCE,
    maskColor,
    mask: masks(page),
  });
}

for (const theme of THEMES) {
  test.describe(`${theme} theme`, () => {
    test.use({ colorScheme: theme });

    // The dark baselines keep their original names; the light set sits beside
    // them with a suffix so both palettes are reviewed as pixels, not by eye.
    const suffix = theme === 'light' ? '-light' : '';
    const maskColor = MASK_COLOR[theme];

    test('Board at 1440px', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await signInAs(page, 'mira');
      await page.goto('/');
      await expect(page.locator('main a.card').first()).toBeVisible();

      // Redesign: 53px header row, 38px ticker, 248px sidebar, 32px main
      // gutter, 16px card gap, in a 1440px-wide centred shell.
      const metrics = await page.evaluate(() => {
        const header = document.querySelector('header')!;
        const ticker = document.querySelector('[data-ticker]')!.parentElement!
          .parentElement!;
        const aside = document.querySelector('aside')!;
        const main = document.querySelector('main')!;
        const grid = main.querySelector('div.grid') as HTMLElement;
        const styles = getComputedStyle(main);
        const shell = getComputedStyle(main.parentElement!);
        return {
          header: header.getBoundingClientRect().height,
          ticker: ticker.getBoundingClientRect().height,
          sidebar: aside.getBoundingClientRect().width,
          paddingLeft: styles.paddingLeft,
          gap: getComputedStyle(grid).gap,
          maxWidth: shell.maxWidth,
        };
      });
      expect(Math.abs(metrics.header - 53)).toBeLessThanOrEqual(1);
      expect(Math.abs(metrics.ticker - 38)).toBeLessThanOrEqual(1);
      expect(Math.abs(metrics.sidebar - 248)).toBeLessThanOrEqual(1);
      expect(metrics.paddingLeft).toBe('32px');
      expect(metrics.gap).toBe('16px');
      expect(metrics.maxWidth).toBe('1440px');

      await screenshot(page, `board-1440${suffix}.png`, maskColor);
    });

    test('Comparison at 1440px', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await signInAs(page, 'mira');
      const comparison = await annotatedComparison(page);
      await page.goto(`/comparisons/${comparison.id}?annotations=1`);
      await expect(page.getByRole('heading', { name: comparison.title })).toBeVisible();
      await expect(page.locator('[data-annotation-span]').first()).toBeVisible();

      const metrics = await page.evaluate(() => {
        const main = document.querySelector('main')!;
        const styles = getComputedStyle(main);
        return {
          maxWidth: styles.maxWidth,
          paddingLeft: styles.paddingLeft,
        };
      });
      expect(metrics.maxWidth).toBe('1280px');
      expect(metrics.paddingLeft).toBe('32px');

      await screenshot(page, `comparison-1440${suffix}.png`, maskColor);
    });

    test('New Comparison at 1440px', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await signInAs(page, 'mira');
      await page.goto('/new');
      await expect(page.getByRole('heading', { name: 'New comparison' })).toBeVisible();

      const metrics = await page.evaluate(() => {
        const form = document.querySelector('form')!;
        const main = form.parentElement!;
        const aside = main.querySelector('aside')!;
        const styles = getComputedStyle(main);
        const formBox = form.getBoundingClientRect();
        const asideBox = aside.getBoundingClientRect();
        return {
          maxWidth: styles.maxWidth,
          display: styles.display,
          flexWrap: styles.flexWrap,
          columnGap: styles.columnGap,
          padding: styles.padding,
          formWidth: formBox.width,
          asideWidth: asideBox.width,
          sideBySide:
            Math.abs(formBox.top - asideBox.top) < 2 && asideBox.left > formBox.left,
        };
      });
      expect(metrics.maxWidth).toBe('1200px');
      // A wrapping flex row: the form grows, the live preview caps at 360px and
      // drops under the form on narrow screens.
      expect(metrics.display).toBe('flex');
      expect(metrics.flexWrap).toBe('wrap');
      expect(metrics.columnGap).toBe('48px');
      expect(metrics.padding).toBe('40px 32px 80px');
      expect(metrics.sideBySide).toBe(true);
      expect(metrics.asideWidth).toBeLessThanOrEqual(360);
      expect(metrics.formWidth).toBeGreaterThan(metrics.asideWidth);

      await screenshot(page, `new-comparison-1440${suffix}.png`, maskColor);
    });

    test('Job at 1440px', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await signInAs(page, 'ana');
      const comparisonId = await createComparison(page, 'Visual fidelity job');
      await page.goto(`/comparisons/${comparisonId}/job`);
      await expect(page.getByText('Your comparison is ready')).toBeVisible({
        timeout: 90_000,
      });

      const metrics = await page.evaluate(() => {
        const main = document.querySelector('main')!;
        const styles = getComputedStyle(main);
        return { maxWidth: styles.maxWidth, paddingLeft: styles.paddingLeft };
      });
      expect(metrics.maxWidth).toBe('1200px');
      expect(metrics.paddingLeft).toBe('32px');

      await screenshot(page, `job-1440${suffix}.png`, maskColor);
    });
  });
}
