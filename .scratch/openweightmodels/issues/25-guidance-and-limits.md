# 25: Guidance, sample export and limits in the form

**What to build:** An author always knows where the file comes from and what it should contain. The base-output step explains the AI Exporter extension, links to it, offers a real sample download, and a help page walks through exporting. The confirmation shows the estimate, and every parser refusal names the problem and the fix.

**Blocked by:** 21 — Import an AI Exporter conversation.

**Status:** done

- [x] The base-output step has a "How to get this file" card with three steps and the Chrome Web Store link.
- [x] "Download a sample export" serves a complete real export (the DeepSeek conversation), not a hand-written stub.
- [x] A help page documents exporting and is linked from the card and from upload errors.
- [x] The confirmation shows estimated calls and input tokens and the applied limits (6 Turns, 0.5 MB, 100,000 characters).
- [x] Every parser error has specific copy: missing reply at Turn n, no recognisable sections, raw chat paste, empty file, too large, too many Turns, too long.
- [x] All copy says "turn" and never "Run" or "Replay".

## Comments

- 2026-10-29 — Implemented. The upload tab renders `HowToGetThisFile` (`apps/web/src/components/how-to-get-this-file.tsx`) with the three steps, the AI Exporter Chrome Web Store link, a sample download and a guide link; the old hand-written `SAMPLE_TEXT` stub is gone. `apps/web/public/samples/deepseek-export.md` is the complete real DeepSeek fixture with its private chat URL redacted, pinned by `apps/web/test/sample-export.test.ts` so it cannot drift into a stub.
- `/help/exporting` is a public guide: install and export steps, the file shape, the 6-turn / 0.5 MB / 100,000-character limits, troubleshooting rows for the parser and upload refusals named in the ticket, and the sample download. It is linked from the upload card, the footer, and every upload refusal in the form (including server-side scheduling errors).
- The confirmation now shows the call/token estimate and `Up to 6 turns · 0.5 MB file · 100,000 characters`. Parser and upload refusals name both the problem and the fix: missing reply with the Turn and vendor, missing sections, raw chat paste, empty/binary/invalid files, file size, Turn count and character count.
- UI copy that previously said “Run”, “Replay” or “replays” now says turn/generate/compare: the New Comparison intro and submit hint, the Add model menu and confirmation, the transcript tab and stopped labels, the admin registry note and the privacy page. Tests that asserted “replays 3 turns” were updated.
- Verification: `pnpm typecheck`; `pnpm test` (244 core, 81 web, 9 worker, 24 infra); full `pnpm test:e2e` (42 browser tests, including the new guidance suite and the export guide in axe/responsive checks). The New Comparison 1440px visual baseline was regenerated for the new card.
