# 21: Import an AI Exporter conversation

**What to build:** Uploading an export from the AI Exporter extension produces a confirmed multi-Turn Comparison. The parser reads the alternating sections, strips exporter metadata, merges double-sent user messages, refuses a Turn with no reply, and warns when the final reply looks cut off. The confirmation shows every Turn before spending calls. Legacy front-matter and bare markdown still work as a one-Turn Conversation, and a raw chat paste gets a pointed error.

**Blocked by:** 20 — Replay every Turn of a Conversation.

**Status:** done

- [x] `# you asked` and `# <vendor> response` sections are recognised only outside fenced code; bodies containing `---` or heading-like lines are preserved.
- [x] The `> From:` line, every `message time:` line and the exporter footer are stripped and never stored.
- [x] Adjacent user messages with no reply between them merge into one Turn, and the confirmation says so.
- [x] A Turn whose response section is empty or missing blocks creation with a message naming the Turn.
- [x] A truncated final reply shows a warning and can still be scheduled.
- [x] The confirmation shows per-Turn previews, the Turn count, warnings and the call/token estimate before scheduling.
- [x] The Base model is required; the export's vendor pre-selects only when exactly one registry Model matches it, and otherwise hints without guessing.
- [x] The title defaults to a summary of the first Prompt and remains editable.
- [x] Legacy YAML front-matter and plain markdown become a one-Turn Conversation, and a raw chat paste is recognised with guidance.
- [x] Uploading an export and scheduling replays every Turn against every selected Challenger.


## Comments

- 2026-10-29 — Implemented. `parseConversationUpload` (core/domain/conversation-import.ts) is the pure parser seam: it reads AI Exporter sections fence-aware, strips `> From:`, `message time:` and the footer, keeps body `---` and headings, merges adjacent user messages, and refuses an empty/missing reply with a Turn-specific message. The final reply is accepted but warned on when it ends in an unclosed fence, a dangling marker, a heading or a list. Legacy front-matter and bare markdown stay one Turn; raw `You:`/`ChatGPT:` pastes and exporter metadata without sections get their own errors. The Claude fixture now warns on Turn 6 and the DeepSeek fixture imports four clean Turns, as the spec expected.
- Creation parses the uploaded file server-side, so a multi-Turn export creates every Turn, Base Response and Replay. The default title is the first Prompt summary. The Base model is still required; `matchVendorModels` pre-selects only a single registry match (for example `llama`) and otherwise states how many candidates exist (or that none do). The New Comparison confirmation lists every Turn with its reply preview, merge/truncation warnings, and `Turns × Challengers` call plus per-model input-token estimates.
- Verification: `pnpm typecheck`, `pnpm test` (236 core, 74 web, 9 worker, 24 infra) and the full `pnpm test:e2e` suite (37 browser tests, including the new import → confirm → replay → publish flow) pass. BACKEND.md section 6 and the implementation-status snapshot describe the importer. Guidance copy, the Chrome Web Store link, the downloadable real sample and the help page remain ticket 25.
