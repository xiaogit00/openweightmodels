# 21: Import an AI Exporter conversation

**What to build:** Uploading an export from the AI Exporter extension produces a confirmed multi-Turn Comparison. The parser reads the alternating sections, strips exporter metadata, merges double-sent user messages, refuses a Turn with no reply, and warns when the final reply looks cut off. The confirmation shows every Turn before spending calls. Legacy front-matter and bare markdown still work as a one-Turn Conversation, and a raw chat paste gets a pointed error.

**Blocked by:** 20 — Replay every Turn of a Conversation.

**Status:** ready-for-agent

- [ ] `# you asked` and `# <vendor> response` sections are recognised only outside fenced code; bodies containing `---` or heading-like lines are preserved.
- [ ] The `> From:` line, every `message time:` line and the exporter footer are stripped and never stored.
- [ ] Adjacent user messages with no reply between them merge into one Turn, and the confirmation says so.
- [ ] A Turn whose response section is empty or missing blocks creation with a message naming the Turn.
- [ ] A truncated final reply shows a warning and can still be scheduled.
- [ ] The confirmation shows per-Turn previews, the Turn count, warnings and the call/token estimate before scheduling.
- [ ] The Base model is required; the export's vendor pre-selects only when exactly one registry Model matches it, and otherwise hints without guessing.
- [ ] The title defaults to a summary of the first Prompt and remains editable.
- [ ] Legacy YAML front-matter and plain markdown become a one-Turn Conversation, and a raw chat paste is recognised with guidance.
- [ ] Uploading an export and scheduling replays every Turn against every selected Challenger.
