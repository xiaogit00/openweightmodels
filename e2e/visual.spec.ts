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
// baselines. Ticket 10 adds the light set beside these.
test.use({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });

const PIXEL_TOLERANCE = 0.01;

function masks(page: Page): Locator[] {
  return [
    page.locator('[data-relative-time]'),
    page.locator('[data-ticker]'),
    page.getByRole('button', { name: /Notifications/ }),
    page.locator('nextjs-portal'),
    page.locator('[data-next-badge-root]'),
  ];
}

async function screenshot(page: Page, name: string) {
  await expect(page).toHaveScreenshot(name, {
    animations: 'disabled',
    maxDiffPixelRatio: PIXEL_TOLERANCE,
    maskColor: '#0a0c0b',
    mask: masks(page),
  });
}

test('Board at 1440px', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signInAs(page, 'mira');
  await page.goto('/');
  await expect(page.locator('main a.card').first()).toBeVisible();

  // v2 handoff: 52px header row, 30px ticker, 216px sidebar, 20px gutters,
  // 8px card gap. Ticket 02 raises the shared header to 53px; the remaining
  // Board metrics belong to ticket 03.
  const metrics = await page.evaluate(() => {
    const header = document.querySelector('header')!;
    const ticker = document.querySelector('[data-ticker]')!.parentElement!.parentElement!;
    const aside = document.querySelector('aside')!;
    const main = document.querySelector('main')!;
    const grid = main.querySelector('div.grid') as HTMLElement;
    const styles = getComputedStyle(main);
    return {
      header: header.getBoundingClientRect().height,
      ticker: ticker.getBoundingClientRect().height,
      sidebar: aside.getBoundingClientRect().width,
      paddingLeft: styles.paddingLeft,
      gap: getComputedStyle(grid).gap,
    };
  });
  expect(Math.abs(metrics.header - 53)).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.ticker - 30)).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.sidebar - 216)).toBeLessThanOrEqual(1);
  expect(metrics.paddingLeft).toBe('20px');
  expect(metrics.gap).toBe('8px');

  await screenshot(page, 'board-1440.png');
});

test('Comparison at 1440px', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signInAs(page, 'mira');
  const comparison = await annotatedComparison(page);
  await page.goto(`/comparisons/${comparison.id}?annotations=1`);
  await expect(page.getByRole('heading', { name: comparison.title })).toBeVisible();

  const metrics = await page.evaluate(() => {
    const main = document.querySelector('main')!;
    const styles = getComputedStyle(main);
    return {
      maxWidth: styles.maxWidth,
      paddingLeft: styles.paddingLeft,
    };
  });
  expect(metrics.maxWidth).toBe('1480px');
  expect(metrics.paddingLeft).toBe('20px');

  await screenshot(page, 'comparison-1440.png');
});

test('New Comparison at 1440px', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signInAs(page, 'mira');
  await page.goto('/new');
  await expect(page.getByRole('heading', { name: 'New comparison' })).toBeVisible();

  const metrics = await page.evaluate(() => {
    const form = document.querySelector('form')!;
    const main = form.parentElement!;
    const styles = getComputedStyle(main);
    return {
      maxWidth: styles.maxWidth,
      columns: styles.gridTemplateColumns.split(' ').map((value) => Number.parseFloat(value)),
    };
  });
  expect(metrics.maxWidth).toBe('1120px');
  // Form column plus the 300px live preview.
  expect(metrics.columns.at(-1)).toBeCloseTo(300, 0);
  expect(metrics.columns.length).toBe(2);

  await screenshot(page, 'new-comparison-1440.png');
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

  await screenshot(page, 'job-1440.png');
});
