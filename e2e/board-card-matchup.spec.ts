import { expect, test } from '@playwright/test';

const CARD = 'main a.card';

const THEMES = ['dark', 'light'] as const;

for (const theme of THEMES) {
  test.describe(`${theme} theme`, () => {
    test.use({ colorScheme: theme });

    test('a Board card marks both models and states the weight matchup', async ({ page }) => {
      const response = await page.request.get('/api/comparisons?q=Rate%20limiter%20in%20Go');
      expect(response.ok()).toBeTruthy();
      const { items } = (await response.json()) as {
        items: Array<{ id: string; title: string }>;
      };
      const comparison = items.find(
        (item) => item.title === 'Rate limiter in Go with sliding windows',
      );
      expect(comparison, 'expected the seeded rate-limiter Comparison').toBeTruthy();

      await page.goto('/?q=Rate+limiter+in+Go');
      const card = page.locator(`${CARD}[href="/comparisons/${comparison!.id}"]`);
      await expect(card).toBeVisible();

      // Base: Llama 3.3 70B (Middle); Challenger: Qwen3.8 27B (Light).
      const marks = card.locator('[data-size-glyph]');
      await expect(marks).toHaveCount(2);
      await expect(marks.nth(0)).toHaveAttribute('data-size-glyph', 'middle');
      await expect(marks.nth(1)).toHaveAttribute('data-size-glyph', 'light');
      await expect(
        card.locator('[title="Middle weight · 64 GB to run at 4-bit"]'),
      ).toBeVisible();
      await expect(
        card.locator('[title="Light weight · 32 GB to run at 4-bit"]'),
      ).toBeVisible();

      // Base + two extra Challengers cross from Middle to Light.
      const matchup = card.locator('[data-matchup="across"]');
      await expect(matchup).toContainText('Across weight class · Middle vs Light + 2 more');
      await expect(matchup).toHaveAttribute(
        'title',
        'Across weight classes: Middle weight vs Light weight + 2 more',
      );

      // A same-class card stays quiet: both Models are Fly weight.
      const fixtures = (await (
        await page.request.get('/api/comparisons?q=Board%20fixture%2001')
      ).json()) as { items: Array<{ id: string; title: string }> };
      const fixture = fixtures.items.find((item) => item.title === 'Board fixture 01');
      expect(fixture, 'expected the seeded Board fixture').toBeTruthy();

      await page.goto('/?q=Board+fixture+01');
      const sameCard = page.locator(`${CARD}[href="/comparisons/${fixture!.id}"]`);
      await expect(sameCard).toBeVisible();
      const sameTag = sameCard.locator('[data-matchup="same"]');
      await expect(sameTag).toContainText('Same weight · Fly');
      await expect(sameTag).toHaveAttribute(
        'title',
        'Same weight class: both models are Fly weight',
      );
      await expect(sameCard.locator('[data-size-glyph]')).toHaveCount(2);
    });
  });
}
