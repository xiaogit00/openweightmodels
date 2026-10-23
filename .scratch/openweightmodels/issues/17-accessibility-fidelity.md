# 17: Accessibility and fidelity audit

**What to build:** The complete product is usable with a keyboard and assistive technology, honours reduced motion, keeps the agreed 10px type floor and contrast, and still matches the v2 designs at 1440px. Narrow screens stack deliberately without horizontal overflow. New affordances from add-model, edit/delete and admin are included.

**Blocked by:** 09 — Add a Challenger to a published Comparison; 10 — Edit and delete your Discussion and Annotations; 11 — Minimal admin for Models and takedowns.

**Status:** done

- [x] Annotation toggling, popover opening, thread replies, voting and closing work keyboard-only, with focus returning to the trigger.
- [x] Discussion compose/reply/edit/delete, add-model and admin flows are keyboard-operable with visible focus and no traps.
- [x] Escape closes popovers, menus and dialogs without losing unsaved text unexpectedly.
- [x] Reduced motion makes the ticker static and removes arrival, shimmer and pop animations without layout jumps.
- [x] Text is at least 10px, focus rings meet the accent specification, and critical text/error contrast is verified.
- [x] Screenshot comparison at 1440px for Board, Comparison, New Comparison and Job is within an agreed tolerance of the v2 references.
- [x] At 768px and 360px the layout stacks without horizontal overflow or hidden controls.
- [x] An automated accessibility scan reports no critical or serious issues on the four main screens.

## Comments

Implemented as an audit plus fixes, with the browser suite as the verification seam.

- **Keyboard and focus.** Annotation spans are now `role="button"` with Tab/Enter/Space, `aria-haspopup`, `aria-expanded` and a label that includes the visible quote. The thread is a labelled dialog that takes focus on open; Escape or the close button returns focus to the span. Reopening after a close keeps the opener for focus return. The annotation toggle, kind filters, About filters and votes expose `aria-pressed`; reply and send controls have labels. A keyboard text selection (caret browsing) surfaces an "Annotate selection" button in the stable toolbar as well as the floating affordance.
- **Draft safety.** Escape inside an Annotation or inline editor with unsent text first leaves the field (the draft stays), and a second Escape closes. Nested Radix menus and the report form handle their own Escape before the annotation popover sees it. Outside clicks close without stealing focus back from what the reader clicked.
- **Add model and admin.** The Add model menu keeps Radix focus return. Admin takedown and moderation panels move focus to their reason textarea, expose `aria-controls`, close on Escape back to the trigger, support arrow keys between report tabs, and make scrollable tables keyboard-focusable. Kebab menus move focus to the delete confirmation and back to Delete on cancel.
- **Motion and type.** Repeated motion moved to `.anim-*` / `.arrive-*` classes; `prefers-reduced-motion` turns the ticker into one static pass and disables arrival, shimmer, pulse and spin without layout change. All 9px text, the 8px monogram and the 8px avatar initials were raised to 10px; the monogram box grew from 14px to 16px.
- **Contrast.** `neutral-500` was lifted from `#646966` to `#8b908c` so 10px muted text clears 4.5:1 on every shipped surface. `apps/web/test/contrast.test.ts` parses the real tokens and locks the pairs, including selected-control sub-labels on `neutral-700`. The new-comparison effort sub-label moved to `neutral-300`, and the account trigger label includes its visible initials. All `outline-0` overrides were removed so the global 2px accent outline with a 2px offset is the focus ring.
- **Responsive.** The Board stacks its sidebar above the cards at <1024px, with Category and Model lists in two columns; the header wraps; the Comparison grid uses `minmax(min(380px, 100%), 1fr)` and the annotation filter group wraps. Document-level horizontal overflow is zero at 768px and 360px across all four screens.
- **Tests.** `e2e/a11y.spec.ts` (axe-core, critical/serious), `e2e/keyboard.spec.ts` (keyboard-only flows, Escape/draft, reduced motion), `e2e/responsive.spec.ts` (768/360 overflow) and `e2e/visual.spec.ts` (1440×900 baselines at 1% pixel tolerance plus the v2 layout measurements). The visual spec reseeds the E2E database first so other suites cannot leak into the images. New unit coverage: `apps/web/test/contrast.test.ts`.
- Verified with `pnpm typecheck`, `pnpm test` (195 core, 50 web, 9 worker), `pnpm build` and `pnpm test:e2e` (34 passing). Baselines are committed under `e2e/visual.spec.ts-snapshots/`; update them deliberately with `pnpm test:e2e e2e/visual.spec.ts --update-snapshots`.
