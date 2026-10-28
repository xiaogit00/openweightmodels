# 22: Read a multi-Turn Comparison

**What to build:** A multi-Turn Comparison reads as a transcript. Each Turn shows its user message, then the Base output and the active Challenger side by side; a sticky rail moves between Turns; queued, streaming, failed, skipped and stopped states appear in place; annotations say which Turn they belong to. One-Turn Comparisons keep today's layout.

**Blocked by:** 21 — Import an AI Exporter conversation.

**Status:** ready-for-agent

- [ ] Each Turn groups the user message, the Base output and the active Challenger's reply; challenger tabs still select the model.
- [ ] A sticky "Turn n of m" control with previous, next and jump works from the keyboard with visible focus.
- [ ] Per-Turn queued, streaming, failed and skipped states render in place, and a stopped Replay is labelled at its last Turn.
- [ ] Annotations attach to a Turn's reply and display their Turn.
- [ ] A one-Turn Comparison is visually unchanged; the committed visual baselines pass.
- [ ] Reduced motion, keyboard navigation, contrast and the 10px floor still hold; automated accessibility scans stay clean.
- [ ] At 768px and 360px the transcript stacks without horizontal overflow.
