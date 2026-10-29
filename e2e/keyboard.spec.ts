import { expect, test } from '@playwright/test';
import { annotatedComparison, createComparison, signInAs } from './support';

/** Ticket 17: the authoring, discussion and admin flows work keyboard-only. */

test.describe('keyboard operation', () => {
  test('annotation threads open, reply, vote and close with focus returning to the span', async ({
    page,
  }) => {
    await signInAs(page, 'mira');
    const comparison = await annotatedComparison(page);
    await page.goto(`/comparisons/${comparison.id}?annotations=1`);

    const toggle = page.getByRole('button', { name: /Annotations/ });
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');

    const span = page.locator('[data-annotation-span]').first();
    await span.focus();
    await page.keyboard.press('Enter');

    const dialog = page.locator('[data-annotation-popover]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toBeFocused();

    const reply = dialog.getByLabel('Reply to annotation');
    await reply.focus();
    const replyBody = `Keyboard reply ${Date.now()}`;
    await reply.fill(replyBody);
    await page.keyboard.press('Enter');
    await expect(dialog.getByText(replyBody)).toBeVisible();

    // Escape in a field with an unsent draft keeps the dialog open and just
    // leaves the field; a second Escape closes and restores focus.
    const draft = 'Draft that must not be discarded';
    await reply.fill(draft);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await expect(reply).not.toBeFocused();
    await expect(reply).toHaveValue(draft);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(span).toBeFocused();

    // Voting toggles with the keyboard.
    await span.focus();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeFocused();
    const vote = dialog.getByRole('button', { name: /vote/i });
    const before = await vote.getAttribute('aria-pressed');
    await vote.focus();
    await expect(vote).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(vote).toHaveAttribute('aria-pressed', before === 'true' ? 'false' : 'true');
  });

  test('a keyboard text selection creates an annotation and returns focus to the toolbar', async ({
    page,
  }) => {
    await signInAs(page, 'mira');
    const comparison = await annotatedComparison(page);
    await page.goto(`/comparisons/${comparison.id}?annotations=1`);

    // Select the opening words of a challenger response with a Shift+Arrow
    // selection, then release Shift. Caret browsing does this for real. Retry
    // until hydration has attached the selection handler; a cold Next compile
    // can finish after `load`.
    const run = page.locator('[data-run][data-annotatable="1"]').last();
    const annotate = page.getByRole('button', { name: 'Annotate selection' }).first();
    await expect(async () => {
      await run.evaluate((node) => {
        const textNode = document.createTreeWalker(node, NodeFilter.SHOW_TEXT).nextNode();
        if (!textNode) throw new Error('annotatable run has no text node');
        const range = document.createRange();
        range.setStart(textNode, 0);
        range.setEnd(textNode, 12);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      });
      await run.dispatchEvent('keyup', { key: 'Shift', shiftKey: false });
      await expect(annotate).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 10_000 });

    await annotate.focus();
    await page.keyboard.press('Enter');

    const dialog = page.locator('[data-annotation-popover]');
    await expect(dialog).toBeVisible();
    const note = dialog.getByLabel('Annotation note');
    await expect(note).toBeFocused();
    await note.fill('Keyboard draft');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await expect(note).toHaveValue('Keyboard draft');
    await expect(note).not.toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(annotate).toBeFocused();
  });

  test('Discussion compose, edit and delete work from the keyboard', async ({ page }) => {
    await signInAs(page, 'mira');
    const comparison = await annotatedComparison(page);
    await page.goto(`/comparisons/${comparison.id}`);

    const body = `Keyboard comment ${Date.now()}`;
    const composer = page.getByLabel('Write a comment');

    // Reply to the first Discussion comment without touching the mouse.
    const replyButton = page
      .locator('[data-comment]')
      .first()
      .getByRole('button', { name: 'Reply', exact: true });
    await replyButton.focus();
    await page.keyboard.press('Enter');
    await expect(composer).toBeFocused();
    await expect(composer).toHaveValue(/^@\w+/);
    const replyBody = `Keyboard discussion reply ${Date.now()}`;
    await page.keyboard.type(replyBody);
    const post = page.getByRole('button', { name: 'Post', exact: true });
    await expect(post).toBeEnabled();
    await post.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText(replyBody)).toBeVisible();

    await expect(post).toBeEnabled();
    await composer.focus();
    await page.keyboard.type(body);
    await expect(post).toBeEnabled();
    await post.focus();
    await page.keyboard.press('Enter');

    const comment = page.locator('[data-comment]').filter({ hasText: body }).first();
    await expect(comment).toBeVisible();

    // Edit: open the kebab with Enter, Enter again on Edit, then Escape cancels
    // without saving. The draft stays out of the way and the body is unchanged.
    const menuButton = comment.getByRole('button', { name: 'Comment actions' });
    await menuButton.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-actions-menu]')).toBeVisible();
    await page.keyboard.press('Enter');
    const editor = page.getByLabel('Edit comment');
    await expect(editor).toBeFocused();
    await editor.fill('Discarded edit');
    await page.keyboard.press('Escape');
    await expect(editor).toHaveValue('Discarded edit');
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByLabel('Edit comment')).toHaveCount(0);
    await expect(comment.getByText(body)).toBeVisible();

    // Edit and save with Tab plus Enter.
    const saved = `${body} (edited)`;
    await menuButton.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.getByLabel('Edit comment').fill(saved);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Save' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByText(saved)).toBeVisible();

    // Delete: kebab → Tab to Delete → Enter → Enter on the confirmation.
    await menuButton.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Delete', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByText(saved)).toHaveCount(0);
  });

  test('the Add model menu opens and closes with focus returning to its trigger', async ({
    page,
  }) => {
    await signInAs(page, 'mira');
    const comparison = await annotatedComparison(page);
    await page.goto(`/comparisons/${comparison.id}`);

    const trigger = page.locator('[data-add-button]');
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-add-menu]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-add-menu]')).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('admin takedown panels take focus and Escape returns it to the trigger', async ({
    page,
  }) => {
    await signInAs(page, 'mira');
    await page.goto('/admin');

    const trigger = page.locator('button[aria-label^="Take down"]').first();
    await trigger.focus();
    await page.keyboard.press('Enter');
    const panel = page.locator('[id^="takedown-panel-"]').first();
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('textbox')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(trigger).toBeFocused();

    // Report tabs move with the arrow keys.
    const openTab = page.getByRole('tab', { name: /Open/ });
    await openTab.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: /Resolved/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('tab', { name: /Resolved/ })).toBeFocused();
  });

  test('search, filter, sort and open a Board card with the keyboard', async ({
    page,
  }) => {
    await signInAs(page, 'mira');
    await page.goto('/');
    await expect(page.locator('main a.card').first()).toBeVisible();

    const search = page.getByRole('textbox', { name: 'Search comparisons' });
    // Hydration attaches the `/` shortcut after the server-rendered card shows.
    await expect(async () => {
      await page.keyboard.press('/');
      await expect(search).toBeFocused({ timeout: 1000 });
    }).toPass({ timeout: 10_000 });
    await page.keyboard.type('rate limiter');
    await expect(page).toHaveURL(/[?&]q=rate/);

    // Escape clears the query and leaves the field, as the header hint says.
    await page.keyboard.press('Escape');
    await expect(search).not.toBeFocused();
    await expect(search).toHaveValue('');
    await expect(page).not.toHaveURL(/[?&]q=/);

    const coding = page
      .getByRole('complementary', { name: 'Board filters' })
      .getByRole('button', { name: /^Coding/ });
    await coding.focus();
    await page.keyboard.press('Enter');
    await expect(coding).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL(/[?&]cat=Coding/);

    const top = page
      .getByRole('group', { name: 'Sort' })
      .getByRole('button', { name: /Top/ });
    await top.focus();
    await page.keyboard.press('Enter');
    await expect(top).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL(/[?&]sort=top/);

    const card = page.locator('main a.card').first();
    await card.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/comparisons\/[^/]+$/);
  });

  test('the New comparison form can be filled and scheduled with the keyboard', async ({
    page,
  }) => {
    await signInAs(page, 'mira');
    await page.goto('/new');
    await expect(page.getByRole('heading', { name: 'New comparison' })).toBeVisible();

    const write = page.getByRole('button', { name: 'Write a prompt' });
    await write.focus();
    await page.keyboard.press('Enter');
    await expect(write).toHaveAttribute('aria-pressed', 'true');

    const generatedBy = page.getByRole('button', { name: 'Generated by' });
    await generatedBy.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('listbox', { name: 'Generated by' })).toBeVisible();
    // The effect focuses the first option; the second is the first Model.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(generatedBy).not.toContainText('Select model…');

    await page.getByRole('textbox', { name: 'Prompt' }).focus();
    await page.keyboard.type('Explain backpressure with one queue example.');
    await page
      .getByRole('textbox', { name: 'Base output', exact: true })
      .focus();
    await page.keyboard.type('A bounded queue makes producers wait.');

    const challenger = page.getByRole('button', {
      name: /Qwen3\.8 27B Open weights/,
    });
    await challenger.focus();
    await page.keyboard.press('Enter');
    await expect(challenger).toHaveAttribute('aria-pressed', 'true');

    const coding = page.getByRole('button', { name: 'Coding', exact: true });
    await coding.focus();
    await page.keyboard.press('Enter');
    await expect(coding).toHaveAttribute('aria-pressed', 'true');

    const med = page
      .getByRole('group', { name: 'Effort level' })
      .getByRole('button', { name: /Med/ });
    await med.focus();
    await page.keyboard.press('Enter');
    await expect(med).toHaveAttribute('aria-pressed', 'true');

    const schedule = page.getByRole('button', { name: 'Schedule comparison' });
    await schedule.focus();
    await expect(schedule).toBeEnabled();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/comparisons\/[^/]+\/job$/);
  });

  test('the ready Job can be published from the keyboard', async ({ page }) => {
    await signInAs(page, 'ana');
    const comparisonId = await createComparison(page, 'Keyboard Job fixture');
    await page.goto(`/comparisons/${comparisonId}/job`);
    await expect(page.getByText('Your comparison is ready')).toBeVisible({
      timeout: 90_000,
    });

    const publish = page.getByRole('button', { name: 'Publish to board' });
    await publish.focus();
    await expect(publish).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(`/comparisons/${comparisonId}`);
    await expect(page.getByRole('button', { name: /Annotations/ })).toBeVisible();
  });

  test('reduced motion keeps the ticker static and suppresses every motion utility', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await signInAs(page, 'mira');
    await page.goto('/');
    await expect(page.locator('main a.card').first()).toBeVisible();

    await expect(page.locator('[data-ticker]')).toHaveCSS('animation-name', 'none');
    const motion = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.innerHTML =
        '<div class="anim-tick"></div><div class="anim-pop"></div><div class="anim-pop-sm"></div><div class="popover-surface"></div><div class="anim-shimmer"></div><div class="anim-pulse"></div><div class="anim-pulse-fast"></div><div class="anim-spin"></div><div class="anim-rise"></div><div class="anim-rise-slow"></div><div class="arrive-a"></div><div class="arrive-b"></div>';
      document.body.append(probe);
      const names = [...probe.children].map(
        (node) => getComputedStyle(node).animationName,
      );
      probe.remove();
      return {
        names,
        running: document.getAnimations().filter((animation) => animation.playState === 'running')
          .length,
      };
    });

    expect(motion.names).toEqual(Array<string>(12).fill('none'));
    expect(motion.running).toBe(0);
  });
});
