# 22: Read a multi-Turn Comparison

**What to build:** A multi-Turn Comparison reads as a transcript. Each Turn shows its user message, then the Base output and the active Challenger side by side; a sticky rail moves between Turns; queued, streaming, failed, skipped and stopped states appear in place; annotations say which Turn they belong to. One-Turn Comparisons keep today's layout.

**Blocked by:** 21 — Import an AI Exporter conversation.

**Status:** done

- [x] Each Turn groups the user message, the Base output and the active Challenger's reply; challenger tabs still select the model.
- [x] A sticky "Turn n of m" control with previous, next and jump works from the keyboard with visible focus.
- [x] Per-Turn queued, streaming, failed and skipped states render in place, and a stopped Replay is labelled at its last Turn.
- [x] Annotations attach to a Turn's reply and display their Turn.
- [x] A one-Turn Comparison is visually unchanged; the committed visual baselines pass.
- [x] Reduced motion, keyboard navigation, contrast and the 10px floor still hold; automated accessibility scans stay clean.
- [x] At 768px and 360px the transcript stacks without horizontal overflow.

## Comments

- 2026-10-29 — Implemented the multi-Turn reading view in `apps/web/src/components/comparison-view.tsx`. Each Turn is a stacked section (Prompt full width, Base and the active Challenger side by side); challenger tabs still select the model. The sticky toolbar gained a Turn rail with previous/next, a `Turn n of m` indicator and a native jump `<select>`; a scroll spy keeps the indicator honest, and navigation uses explicit scroll offsets so the sticky chrome never covers the Turn heading. Previous/next use `aria-disabled` (not `disabled`) so keyboard focus is never dropped at the ends.
- Per-Turn states now share `TurnStateLine`: queued, calling, streaming (token count outside the live region), failed with Author Retry / Skip remaining, and skipped. A stopped Replay names the Turn where it stopped, later skipped Turns say where the Replay stopped, and the challenger tab carries an accessible stop/failure label. Annotations use the same selection and popover host as one-Turn Comparisons; the thread and new-annotation headers show `Turn n of m` beside the annotation kind.
- One-Turn markup and spacing are unchanged behind a plain relative wrapper, so the committed `comparison-1440` baseline still passes. Coverage was added for keyboard rail navigation, jump, per-Turn annotation attachment, a multi-Turn accessibility scan, and 768px/360px overflow.
- Verification: `pnpm typecheck`, `pnpm test` (236 core, 74 web, 9 worker, 24 infra) and the full `pnpm test:e2e` suite (38 browser tests, including the updated import → replay → read flow) pass.

