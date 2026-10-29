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
  const { base, challenger } = await fixtureModels(page);

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
  form.set('base_model_id', base.id);
  form.set('prompt', 'Write a thread-safe sliding-window rate limiter in Go.');
  form.set('title', title);
  form.set('effort', '2');
  form.append('categories', 'Coding');
  form.append('model_ids', challenger.id);

  return postComparison(page, form);
}

/** A published multi-Turn Comparison for the reading and accessibility suites. */
export async function createConversation(
  page: Page,
  title = `Conversation fixture ${Date.now()}`,
  turns = 3,
): Promise<string> {
  const { base, challenger } = await fixtureModels(page);

  const form = new FormData();
  form.set(
    'turns',
    JSON.stringify(
      Array.from({ length: turns }, (_, index) => ({
        prompt: `Fixture question ${index + 1} about backpressure`,
        baseOutput: `Fixture base output ${index + 1}: reject early and keep the queue bounded.`,
      })),
    ),
  );
  form.set('base_model_id', base.id);
  form.set('title', title);
  form.set('effort', '1');
  form.append('categories', 'Coding');
  form.append('model_ids', challenger.id);

  return postComparison(page, form);
}

type FixtureModel = { id: string; slug: string };

async function fixtureModels(
  page: Page,
): Promise<{ base: FixtureModel; challenger: FixtureModel }> {
  const response = await page.request.get('/api/models');
  expect(response.ok()).toBeTruthy();
  const { models } = (await response.json()) as { models: FixtureModel[] };
  const base = models.find((model) => model.slug === 'llama-3-3-70b');
  const challenger = models.find((model) => model.slug === 'qwen-2-5-72b');
  expect(base).toBeTruthy();
  expect(challenger).toBeTruthy();
  return { base: base!, challenger: challenger! };
}

async function postComparison(page: Page, form: FormData): Promise<string> {
  const response = await page.request.post('/api/comparisons', { multipart: form });
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { id: string };
  return payload.id;
}

export async function publishConversation(page: Page, id: string) {
  await page.goto(`/comparisons/${id}/job`);
  await expect(page.getByText('Your comparison is ready')).toBeVisible({
    timeout: 90_000,
  });
  await page.getByRole('button', { name: 'Publish to board' }).click();
  await expect(page).toHaveURL(`/comparisons/${id}`);
}
