# 05: Redesign Comparison annotations

**What to build:** The annotation layer on the Comparison: kind filter, annotated spans, select-to-annotate, the new-annotation popover, the thread popover, and the full set of annotation actions. Ticket 04 already owns the Annotations toggle and count.

**Blocked by:** 04.

**Status:** ready-for-agent.

**Design source:** the "Annotations" subsection of "Screen 3 — Comparison" in `design_handoff_redesign/README.md` and `Comparison.dc.html`.

- [ ] When annotations are on, show the kind filter segmented control **All / Bug / Hallucination / Good / Question** with stack / bug / ghost / thumbs-up / question icons and per-kind counts. Filtering hides non-matching spans and nothing else.
- [ ] Hint text "Select any text in a response to annotate it" when the viewer can write; "Annotations are read-only while your account is suspended." when suspended; a **Sign in to annotate** link when signed out. Never show the Annotate affordance to signed-out or suspended viewers.
- [ ] **Annotated spans (prose):** `accent-900` background, `inset 0 -1.5px 0 var(--color-accent)` underline, pointer cursor. The span whose thread is open uses `accent-800`.
- [ ] **Annotated spans (code):** translucent accent via `color-mix(in oklab, var(--color-accent) 30%, transparent)` so `--code-fg` stays legible in light mode; 48% for the open span. Verify both themes.
- [ ] **Select to annotate:** selecting text inside a single un-annotated segment shows a floating **Annotate** button 38px above the selection, 30px tall, accent border, `--color-bg`, `accent-200` text, `--shadow-md`. Use `mousedown` + `preventDefault` so the selection survives. Keyboard text selection (F7 / Shift) surfaces the same affordance, as today.
- [ ] **New-annotation popover:** 320px, 6px below the selection, clamped to the grid. Title "New annotation", quote, kind chips (Bug / Hallucination / Good / Question; selected accent border + `accent-900`), textarea placeholder "What stands out here?", outlined **Add annotation**. Saving splits the segment around the selection, creates the annotation and opens its thread.
- [ ] **Thread popover:** 320px below the clicked span. Kind badge (icon + kind), participant count, close button. Quote with 2px accent left rule, Space Mono 11.5px, max 54px tall. Messages: 22px avatar, author · time, 13.5px body. Footer: upvote toggle (+1 when voted, `accent-900`), reply input with **Enter** to send, outlined send button.
- [ ] **Keep every existing annotation action**, restyled: retag the annotation kind, delete the annotation and its thread, report the annotation, edit and delete your own thread messages, vote, reply, and the multi-Turn label on the popover header. Confirmation copy and errors stay as they are.
- [ ] Keep `data-annotation-span`, `data-annotation-id`, `data-annotation-popover`, `data-annotation-turn`, `data-actions-trigger`, `data-actions-menu`, `data-popover`, and the labels `Annotate selection`, `Add annotation`, `Close annotation`, `Annotation actions`, `Message actions`, `Retry`, `Dismiss`.
- [ ] Popovers animate with `pop` (120–150ms), are dismissed on outside click and Escape, and return focus sensibly. No keyboard trap and no axe violations.
- [ ] Both themes: refreshed dark annotated baseline plus a light annotated baseline.
- [ ] `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` pass, including `keyboard.spec.ts`, `a11y.spec.ts` (open annotation thread) and annotation unit suites.

**Key files:** `apps/web/src/components/comparison-view.tsx` (annotation section: `AnnotationActions`, `InlineEditor`, `AddModelMenu` neighbours), `markdown-view.tsx` (span rendering only), `apps/web/src/lib/annotations.ts`, `e2e/keyboard.spec.ts`, `e2e/a11y.spec.ts`.

**Implementation notes:** Visual changes must not alter annotation offsets. `MarkdownView` continues to receive the same blocks and to emit the same span hooks; only classes and inline styles change. Code-block highlighting needs the `color-mix` fallback so dark text remains readable in light mode. Do not fold the kind filter into the head actions; the design puts it on its own row below the head.

**Out of scope:** Discussion comments (06), annotation data model or API changes.
