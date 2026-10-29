# 04: Redesign the Comparison reading surface

**What to build:** The Comparison page from the head down to the response grid, excluding the annotation layer and Discussion: page head, report/copy actions, Turn rail, two continuous response cards with sticky headers, model picker (switch and add), markdown/code/sources, per-Turn states, and the generating state.

**Blocked by:** 02.

**Status:** ready-for-agent.

**Design source:** `design_handoff_redesign/designs/Comparison.dc.html` and the "Screen 3 — Comparison" section of `design_handoff_redesign/README.md`.

- [ ] Page: `main` max-width 1280px, padding 36px 32px 72px, 20px vertical gap.
- [ ] Head: 13px meta row with category chips, effort glyph + label, 18px author badge, handle, relative time. H1 at 30px / 1.15 / −0.02em, max 900px, `text-wrap: pretty`. Actions right-aligned and wrap under on narrow screens.
- [ ] Head actions: **Annotations** toggle (highlighter icon, count pill, outlined; active accent border, `accent-900`, `accent-200`), **Report** ghost control and **Copy link** ghost control. Report is hidden for the Author and suspended viewers, and is icon-only on narrow screens with the same accessible name and confirmation behaviour as today. Copy link shows **Copied** with a check for 1.5s.
- [ ] **Remove** the collapsible "Prompt" disclosure at the top. The Prompt is rendered only inside the response cells (decision 4).
- [ ] Suspended banner stays, restyled with `--color-danger` and `--color-danger-surface`.
- [ ] Multi-Turn **Turn rail**: surface bar, 1px `neutral-800`, `--r-lg`; previous/next ghost buttons disabled at the ends; `Turn n of m`; **Jump to** segmented control instead of the native `<select>`. Keep the accessible name `Jump to turn`, keyboard operation, scroll offsets (53 + 48 + 8px) and the "last Turn above 200px" scroll spy. Keep `data-turn-rail`, `data-turn-indicator`.
- [ ] **Response grid**: two columns, 16px gap, continuous cards. Sticky headers at `top: 53px`, 48px tall, surface background, 1px `neutral-700`; left header BASE tag + model + token meta (z 14); right header model-picker button + response count + active meta (z 15). Last row is a 16px footer closing both cards.
- [ ] **Model picker menu**: 290px, `--shadow-lg`, `pop` animation, positioned under the right header. RESPONSES rows: initials, name, active check, generating spinner; clicking switches the right column. ADD A MODEL rows: plus, name, ETA; hidden when none remain; footnote "Runs the same prompt through the model's hosted API." Keep `data-add-menu`, `data-add-model-list`, `data-add-button`, `data-add-replay-confirmation`.
- [ ] **Add model behaviour is unchanged.** A one-Turn Comparison adds on click. A multi-Turn Comparison opens the existing cost confirmation (Turn count + call estimate) before adding, and the new Replay renders with the existing "Replay in progress" marker. Failures keep the current error handling.
- [ ] Keep `data-challenger-tab="<slug>"` on the picker's response rows so existing model-switching specs continue to work; update the specs only where the interaction genuinely moved.
- [ ] **Turn cell**: prompt as a right-aligned bubble (`neutral-800`, `--r-bubble`, 14.5px / 1.55) **in each column**, avatar + model name above the reply, response paragraphs 14.5px / 1.7, list markers, Space Mono code blocks that never wrap, and Sources with accent links. Per-Turn copy button (28px ghost, check for 1.5s).
- [ ] **All per-Turn states stay**: queued, calling, streaming (with tokens so far), failed (with the current Author Retry / Skip remaining controls and error text), skipped, stopped-at-Turn, and "No response for this Turn". Style them with the new type scale and danger tokens. Keep `data-response`, `data-run`, `data-replay-in-progress`.
- [ ] Generating state: accent line with spinner, "Calling <model> hosted API…", shimmer skeleton bars/blocks, reduced-motion safe.
- [ ] Single-Turn Comparisons use the same structure (no TURN label) and no longer show a separate head Prompt.
- [ ] Below ~800px: stack each Turn as Prompt → Base → active Challenger, no sticky pane headers; Turn rail still works; no horizontal overflow.
- [ ] Preserve `data-conversation-transcript`, `data-turn-section`, `data-turn`, `data-annotatable`, `data-annotation-span`, `data-response`, `data-start`, `data-popover` and the existing accessible names. Annotation styling and popovers are ticket 05; leave their hooks intact.
- [ ] Update `e2e/visual.spec.ts` Comparison metrics at 1440: max-width 1280px, padding-left 32px. Refresh the dark baseline and add a light-theme baseline.
- [ ] `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` pass, including multi-Turn, add-challenger and keyboard suites.

**Key files:** `apps/web/src/components/comparison-view.tsx`, `markdown-view.tsx`, `comparison-view` helpers (`TurnStateLine`, `EffortMeter`, `AddModelMenu`), `e2e/conversation-replay.spec.ts`, `e2e/add-challenger*.spec.ts`, `e2e/keyboard.spec.ts`.

**Implementation notes:** Extract the head, response grid and picker into separate files as you restyle them (decision 13). The two prompt bubbles are deliberate: do not collapse them to one. The right header's z-index must stay above the left header, and the menu must not be clipped by the sticky header. Keep response ordering and the API's statuses; only presentation changes.

**Out of scope:** Annotation spans, kind filters, annotate-selection and annotation popovers (05); Discussion (06).
