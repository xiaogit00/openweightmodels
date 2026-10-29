# 10: Verify the redesign end to end

**What to build:** The final cross-cutting pass. Walk the parity ledger, run every suite, check both themes and all breakpoints, refresh the snapshot set, and remove the leftovers. This ticket is a verification gate, not a feature.

**Blocked by:** 03, 04, 05, 06, 07, 08, 09.

**Status:** ready-for-agent.

- [ ] Walk every row of the parity ledger in `.scratch/ui-redesign/spec.md` against the running app. No current behaviour is missing, and the two deliberate changes (prompt disclosure removed; Board model-list default) are the only ones.
- [ ] **Desktop, both themes:** Board (unfiltered, filtered, empty, signed out), New comparison (empty, filled upload, filled write, expanded picker, submitting), Comparison (single-turn, multi-turn, annotations on, open thread, generating, failed/skipped), Job (generating, ready, published), Account, Admin, Help, Sign-in, Onboarding, Legal. Compare against the prototypes and flag any unexplained divergence.
- [ ] Review the light theme specifically: accent text uses `accent-200/300`, annotated code stays legible, danger is distinguishable from primary, native controls match `color-scheme`, and no component still assumes dark.
- [ ] **Responsive:** 768px and 360px on all four redesigned screens. No horizontal overflow; Comparison stacks turn by turn; Board filters remain reachable; New comparison aside drops below; Job preview stacks; theme control reachable.
- [ ] **Accessibility:** `e2e/a11y.spec.ts` runs in both themes on Board, Comparison (including an open annotation thread), multi-Turn Comparison, New comparison (expanded picker), Job and the export guide. No critical or serious violations. Keyboard-only runs for the Board, Comparison annotations, Discussion, New comparison and Job.
- [ ] **Contrast:** `apps/web/test/contrast.test.ts` passes for both palettes; no informational text below 10.5px (initials badges at 9px are the documented exception).
- [ ] **Visual:** `e2e/visual.spec.ts` metrics match the spec (header 53, ticker 38, Board sidebar 248, padding 32, card gap 16, max widths 1440/1280/1200/1200). Dark and light baselines are committed for Board, Comparison, New comparison and Job; the annotated Comparison has a light baseline too.
- [ ] **Suites:** `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` all pass. Any updated selector is justified in the ticket comment, not just silenced.
- [ ] **Hygiene:** no `.dc.html`, `support.js`, Google Fonts or Phosphor CDN links are shipped; no JetBrains Mono references; no dead token names; `tokens.css` values are represented in `globals.css`; ADR 0011 is the only new decision record.
- [ ] The final screenshot set (both themes, 1440 and 360) is attached to the ticket for human review.
- [ ] Update `.scratch/ui-redesign/spec.md` only if an implementation detail genuinely changed; do not rewrite decisions after the fact.

**Key files:** `e2e/visual.spec.ts`, its snapshot directory, `e2e/a11y.spec.ts`, `e2e/responsive.spec.ts`, `apps/web/test/contrast.test.ts`, `apps/web/src/app/globals.css`.

**Implementation notes:** Run the a11y and visual suites with animations disabled (`reducedMotion: 'reduce'`) so shimmer and pulse do not produce flaky diffs. Mask relative times, the ticker and notification portals as the current spec does. If a prototype and the current app disagree and the parity ledger is silent, the current app wins.

**Out of scope:** New features, performance work, backend changes.
