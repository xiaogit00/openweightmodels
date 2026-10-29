# 10: Verify the redesign end to end

**What to build:** The final cross-cutting pass. Walk the parity ledger, run every suite, check both themes and all breakpoints, refresh the snapshot set, and remove the leftovers. This ticket is a verification gate, not a feature.

**Blocked by:** 03, 04, 05, 06, 07, 08, 09.

**Status:** done.

- [x] Walk every row of the parity ledger in `.scratch/ui-redesign/spec.md` against the running app. No current behaviour is missing, and the two deliberate changes (prompt disclosure removed; Board model-list default) are the only ones.
- [x] **Desktop, both themes:** Board (unfiltered, filtered, empty, signed out), New comparison (empty, filled upload, filled write, expanded picker, submitting), Comparison (single-turn, multi-turn, annotations on, open thread, generating, failed/skipped), Job (generating, ready, published), Account, Admin, Help, Sign-in, Onboarding, Legal. Compare against the prototypes and flag any unexplained divergence.
- [x] Review the light theme specifically: accent text uses `accent-200/300`, annotated code stays legible, danger is distinguishable from primary, native controls match `color-scheme`, and no component still assumes dark.
- [x] **Responsive:** 768px and 360px on all four redesigned screens. No horizontal overflow; Comparison stacks turn by turn; Board filters remain reachable; New comparison aside drops below; Job preview stacks; theme control reachable.
- [x] **Accessibility:** `e2e/a11y.spec.ts` runs in both themes on Board, Comparison (including an open annotation thread), multi-Turn Comparison, New comparison (expanded picker), Job and the export guide. No critical or serious violations. Keyboard-only runs for the Board, Comparison annotations, Discussion, New comparison and Job.
- [x] **Contrast:** `apps/web/test/contrast.test.ts` passes for both palettes; no informational text below 10.5px (initials badges at 9px are the documented exception).
- [x] **Visual:** `e2e/visual.spec.ts` metrics match the spec (header 53, ticker 38, Board sidebar 248, padding 32, card gap 16, max widths 1440/1280/1200/1200). Dark and light baselines are committed for Board, Comparison, New comparison and Job; the annotated Comparison has a light baseline too.
- [x] **Suites:** `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` all pass. Any updated selector is justified in the ticket comment, not just silenced.
- [x] **Hygiene:** no `.dc.html`, `support.js`, Google Fonts or Phosphor CDN links are shipped; no JetBrains Mono references; no dead token names; `tokens.css` values are represented in `globals.css`; ADR 0011 is the only new decision record.
- [x] The final screenshot set (both themes, 1440 and 360) is attached to the ticket for human review.
- [x] Update `.scratch/ui-redesign/spec.md` only if an implementation detail genuinely changed; do not rewrite decisions after the fact.

**Key files:** `e2e/visual.spec.ts`, its snapshot directory, `e2e/a11y.spec.ts`, `e2e/responsive.spec.ts`, `apps/web/test/contrast.test.ts`, `apps/web/src/app/globals.css`.

**Implementation notes:** Run the a11y and visual suites with animations disabled (`reducedMotion: 'reduce'`) so shimmer and pulse do not produce flaky diffs. Mask relative times, the ticker and notification portals as the current spec does. If a prototype and the current app disagree and the parity ledger is silent, the current app wins.

**Out of scope:** New features, performance work, backend changes.

## Comments

- 2026-10-29 — Final gate passed. `pnpm typecheck`, `pnpm test` (443 passed, 1 skipped) and `pnpm test:e2e` (58 passed, 1 intentionally skipped) are green. The skip is the existing "every model has a comparison in this dataset" branch in `e2e/board.spec.ts`, not a regression.
- **Parity ledger:** walked every row against the running app in both themes. Pagination/sentinel/total, loading/error/empty/signed-out states, the header sign-in link, Report, the suspended banner, per-Turn states, Retry/Skip, add-model confirmation, annotation read-only and reporting, Discussion gating, upload warnings/merge notes, write-mode Base reply, Job retry/skip/publish and the legacy account/admin/help/legal/auth pages are all still present. Only the two deliberate changes remain: the Prompt disclosure is gone (Prompt shows per column) and the Board model list defaults to models with comparisons behind "Show all N models".
- **Axe now runs in both themes** (`e2e/a11y.spec.ts`: 12 test runs, 16 scans including the open thread and expanded picker). It caught a real dark-theme failure the earlier single-theme pass missed: opening a code-block Annotation used a 48% lime fill, leaving `--code-fg` at 3.39:1. Code spans now keep the 30% translucent fill in both states and mark the open span with a 1px accent ring, so the text clears 4.5:1 in both palettes. No other critical or serious findings.
- **Visual baselines:** Board, Comparison, New comparison and Job now have `-light` baselines beside the dark ones, and the Comparison baseline exercises annotations in both themes. The ticket-05 `comparison-annotations-light` capture was the same state and is replaced by `comparison-1440-light`, so the light annotations are still reviewed as pixels without a duplicate file. Dark baselines were refreshed for the 10.5px label change.
- **Type floor:** three informational labels were still below 10.5px — the notification count (10px) and the "BASE"/"Previous" model badges (9px). All three are now 10.5px; the initials badge remains the only documented 9px exception.
- **Responsive/theme:** 1440 and 360 screenshots in both themes have no horizontal overflow; Comparison stacks turn by turn at 360 and the Board filters stay reachable. The explicit `owm-theme=light` cookie and the OS-driven light palette were both exercised (the cookie path by the screenshots, the media-query path by the visual baselines; the palette-equality unit test keeps them in step).
- **Review set:** 96 viewport captures committed as JPEGs in `.scratch/ui-redesign/screenshots/` for human review: both themes at 1440 and 360 for the listed screens and their stable states, plus 1440 captures of the states the mock provider races past (Comparison failed/skipped/generating, Job failed/generating, New comparison submitting). Job captures wait for the live stream to connect so the status label is not a transient "Connecting…".
- **Keyboard runs** now cover all five required surfaces in `e2e/keyboard.spec.ts`: Board search/filter/sort/card navigation, New comparison fill-and-schedule, ready-Job publish, plus the existing Comparison annotation, Discussion and Add-model runs. The Comparison annotation run opens the code-block thread, so the 30% fill contrast is asserted on every run rather than once by hand.
- **Light theme:** accent text uses `accent-200/300` everywhere; annotated code keeps `--code-fg` legible; native controls inherit `color-scheme`; primary is a filled accent while danger is text/border on `danger-surface` with a warning icon, so the two roles do not read as the same control.
- **Hygiene:** no `.dc.html`, `support.js`, Google Fonts or Phosphor CDN references ship, no JetBrains Mono references remain, `globals.css` is the only stylesheet, and ADR 0011 is the only new decision record. The only token deviations from `tokens.css` are the three neutral steps darkened for 4.5:1, already documented in ticket 01.
