import { expect, test, type APIRequestContext } from '@playwright/test';

type PagePayload = {
  items: Array<{ id: string }>;
  total: number;
  nextCursor: string | null;
};

async function defaultPage(request: APIRequestContext) {
  const response = await request.get('/api/comparisons');
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as PagePayload;
}

const CARD = 'main a.card';

test('Load more appends the next page without duplicates', async ({ page }) => {
  // Deterministically exercise the accessible fallback, not the sentinel.
  await page.addInitScript(() => {
    (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver =
      undefined;
  });

  const first = await defaultPage(page.request);
  expect(first.items).toHaveLength(48);
  expect(first.total).toBeGreaterThan(48);
  expect(first.nextCursor).toBeTruthy();

  await page.goto('/');
  await expect(page.locator(CARD)).toHaveCount(48);
  await expect(page.getByRole('button', { name: 'Load more' })).toBeVisible();

  await page.getByRole('button', { name: 'Load more' }).click();
  await expect(page.locator(CARD)).toHaveCount(first.total);

  const hrefs = await page
    .locator(CARD)
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href')));
  expect(new Set(hrefs).size).toBe(hrefs.length);
});

test('the sentinel loads the next page when it scrolls into view', async ({ page }) => {
  const first = await defaultPage(page.request);
  expect(first.nextCursor).toBeTruthy();

  await page.goto('/');
  await expect(page.locator(CARD)).toHaveCount(48);

  await page.getByTestId('board-sentinel').scrollIntoViewIfNeeded();
  await expect(page.locator(CARD)).toHaveCount(first.total);
});

test('sidebar counts cover the whole Board, not the loaded page', async ({ page }) => {
  const response = await page.request.get('/api/comparisons/facets');
  expect(response.ok()).toBeTruthy();
  const facets = (await response.json()) as {
    categories: Record<string, number>;
    models: Record<string, number>;
    total: number;
  };

  await page.goto('/');
  await expect(page.locator('aside').getByRole('button', { name: /^All/ })).toContainText(
    String(facets.total),
  );
  expect(facets.total).toBeGreaterThan(48);

  await expect(
    page.locator('aside').getByRole('button', { name: /^Coding/ }),
  ).toContainText(String(facets.categories.Coding));

  await expect(
    page.locator('aside').getByRole('button', { name: /Llama 3\.3 70B/ }),
  ).toContainText(String(facets.models['llama-3-3-70b']));
});

test('the model list hides models with no comparisons behind Show all', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator(CARD).first()).toBeVisible();

  const toggle = page.locator('aside [data-model-toggle]');
  if (!(await toggle.isVisible())) {
    test.skip(true, 'every model has a comparison in this dataset');
  }

  const label = await toggle.innerText();
  const total = Number(label.match(/(\d+)/)?.[1]);
  expect(total).toBeGreaterThan(0);

  const options = page.locator('aside [data-model-option]');
  const visible = await options.count();
  expect(visible).toBeLessThan(total);

  await toggle.click();
  await expect(options).toHaveCount(total);

  const fewer = page.getByRole('button', { name: 'Show fewer' });
  await expect(fewer).toBeVisible();
  await fewer.click();
  await expect(options).toHaveCount(visible);
});

test('filters live in the URL, survive reload and back/forward, and keep one SSE', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const scope = window as unknown as {
      __eventSources: number;
      __eventSourceUrls: string[];
      EventSource: typeof EventSource;
    };
    scope.__eventSources = 0;
    scope.__eventSourceUrls = [];
    const Native = scope.EventSource;
    scope.EventSource = class extends Native {
      constructor(url: string | URL, init?: EventSourceInit) {
        super(url, init);
        scope.__eventSources += 1;
        scope.__eventSourceUrls.push(String(url));
      }
    } as typeof EventSource;
  });

  await page.goto('/');
  await expect(page.getByText('LIVE', { exact: true })).toBeVisible();

  await expect
    .poll(async () =>
      page.evaluate(
        () => (window as unknown as { __eventSources: number }).__eventSources,
      ),
    )
    .toBeGreaterThan(0);
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (window as unknown as { __eventSourceUrls: string[] }).__eventSourceUrls[0] ?? '',
      ),
    )
    .toContain('after=');

  const sourceCountAtMount = await page.evaluate(
    () => (window as unknown as { __eventSources: number }).__eventSources,
  );
  const search = page.getByLabel('Search comparisons');

  await page.getByRole('button', { name: 'Top' }).click();
  await expect(page).toHaveURL(/sort=top/);

  await page.locator('aside').getByRole('button', { name: /^Reasoning/ }).click();
  await expect(page).toHaveURL(/cat=Reasoning/);

  await page.locator('aside').getByRole('button', { name: /Llama 3\.3 70B/ }).click();
  await expect(page).toHaveURL(/models=llama-3-3-70b/);

  await page.locator('aside').getByRole('button', { name: 'High' }).click();
  await expect(page).toHaveURL(/effort=3/);

  await search.fill('Board fixture');
  await expect(page).toHaveURL(/q=Board\+fixture/);

  expect(
    await page.evaluate(
      () => (window as unknown as { __eventSources: number }).__eventSources,
    ),
  ).toBe(sourceCountAtMount);

  await page.reload();
  await expect(page.getByRole('button', { name: 'Top' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(
    page.locator('aside').getByRole('button', { name: /^Reasoning/ }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.locator('aside').getByRole('button', { name: /Llama 3\.3 70B/ }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('aside').getByRole('button', { name: 'High' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(search).toHaveValue('Board fixture');

  await page.goBack();
  await expect(search).toHaveValue('');
  await expect(page).toHaveURL(/effort=3/);

  await page.goForward();
  await expect(search).toHaveValue('Board fixture');
});

test('loading and error states are explicit and retryable', async ({ page }) => {
  let fail = true;
  await page.route('**/api/comparisons?*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (fail) await route.abort();
    else await route.continue();
  });

  await page.goto('/');
  await page.locator('aside').getByRole('button', { name: /^Creative/ }).click();

  await expect(page.getByText('Loading…')).toBeVisible();
  const errorBanner = page
    .getByRole('alert')
    .filter({ hasText: 'Could not load comparisons.' });
  await expect(errorBanner).toBeVisible();

  // Returning to the view that is already on screen must not keep the stale
  // error banner above a perfectly valid grid.
  await page.locator('aside').getByRole('button', { name: /^All/ }).click();
  await expect(errorBanner).toHaveCount(0);
  await expect(page.locator(CARD).first()).toBeVisible();

  await page.locator('aside').getByRole('button', { name: /^Creative/ }).click();
  await expect(errorBanner).toBeVisible();

  fail = false;
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(errorBanner).toHaveCount(0);
  await expect(
    page.locator('aside').getByRole('button', { name: /^Creative/ }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator(CARD).first()).toBeVisible();
});

test('reduced motion stops the ticker', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');

  // The track exists even when there are no events. Hydration removes the
  // marquee class for reduced motion; the CSS keeps animation off regardless.
  const ticker = page.locator('[data-ticker]');
  await expect(ticker).toBeVisible();
  await expect(ticker).not.toHaveClass(/marquee/);
  const animationName = await ticker.evaluate((node) => getComputedStyle(node).animationName);
  expect(animationName).toBe('none');
});
