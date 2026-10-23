import { expect, type Page } from '@playwright/test';

/** Shared setup for the accessibility, responsive and fidelity suites. */

export async function signInAs(page: Page, handle = 'mira') {
  const response = await page.request.post('/api/dev/user', { data: { handle } });
  expect(response.ok()).toBeTruthy();
}

type ComparisonSummary = { id: string; title: string };

/** The seeded Comparison with the Annotation threads and Discussion. */
export async function annotatedComparison(page: Page): Promise<ComparisonSummary> {
  const response = await page.request.get('/api/comparisons?q=Rate%20limiter%20in%20Go');
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { items: ComparisonSummary[] };
  const annotated = payload.items.find(
    (item) => item.title === 'Rate limiter in Go with sliding windows',
  );
  expect(annotated, 'expected the seeded annotated Comparison').toBeTruthy();
  return annotated!;
}

export async function createComparison(
  page: Page,
  title = `Accessibility fixture ${Date.now()}`,
): Promise<string> {
  const modelsResponse = await page.request.get('/api/models');
  expect(modelsResponse.ok()).toBeTruthy();
  const { models } = (await modelsResponse.json()) as {
    models: Array<{ id: string; slug: string; name: string }>;
  };
  const base = models.find((model) => model.slug === 'llama-3-3-70b');
  const challenger = models.find((model) => model.slug === 'qwen-2-5-72b');
  expect(base).toBeTruthy();
  expect(challenger).toBeTruthy();

  const form = new FormData();
  form.set(
    'file',
    new File(
      [
        [
          '---',
          'prompt: Write a thread-safe sliding-window rate limiter in Go.',
          'model: llama-3-3-70b',
          '---',
          '',
          'This is the uploaded base output used by the accessibility fixture. It tracks timestamps per key and trims the window on every request.',
        ].join('\n'),
      ],
      'accessibility-base.md',
      { type: 'text/markdown' },
    ),
  );
  form.set('base_model_id', base!.id);
  form.set('prompt', 'Write a thread-safe sliding-window rate limiter in Go.');
  form.set('title', title);
  form.set('effort', '2');
  form.append('categories', 'Coding');
  form.append('model_ids', challenger!.id);

  const response = await page.request.post('/api/comparisons', { multipart: form });
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { id: string };
  return payload.id;
}
