# 17: Accessibility and fidelity audit

**What to build:** The complete product is usable with a keyboard and assistive technology, honours reduced motion, keeps the agreed 10px type floor and contrast, and still matches the v2 designs at 1440px. Narrow screens stack deliberately without horizontal overflow. New affordances from add-model, edit/delete and admin are included.

**Blocked by:** 09 — Add a Challenger to a published Comparison; 10 — Edit and delete your Discussion and Annotations; 11 — Minimal admin for Models and takedowns.

**Status:** ready-for-agent

- [ ] Annotation toggling, popover opening, thread replies, voting and closing work keyboard-only, with focus returning to the trigger.
- [ ] Discussion compose/reply/edit/delete, add-model and admin flows are keyboard-operable with visible focus and no traps.
- [ ] Escape closes popovers, menus and dialogs without losing unsaved text unexpectedly.
- [ ] Reduced motion makes the ticker static and removes arrival, shimmer and pop animations without layout jumps.
- [ ] Text is at least 10px, focus rings meet the accent specification, and critical text/error contrast is verified.
- [ ] Screenshot comparison at 1440px for Board, Comparison, New Comparison and Job is within an agreed tolerance of the v2 references.
- [ ] At 768px and 360px the layout stacks without horizontal overflow or hidden controls.
- [ ] An automated accessibility scan reports no critical or serious issues on the four main screens.
