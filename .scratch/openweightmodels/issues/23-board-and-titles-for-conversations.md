# 23: Board, search and titles for conversations

**What to build:** The Board treats a Conversation by its first Prompt. Cards show that headline, a Turn count and the first Base reply as the preview; the default title comes from the first Prompt; search, filters, pagination and ordering keep working without a new concept.

**Blocked by:** 21 — Import an AI Exporter conversation.

**Status:** done

- [x] A card's headline is the first Turn's Prompt, with a visible Turn count badge.
- [x] A card's preview uses the first Base Response.
- [x] The default title is derived from the first Prompt and remains editable.
- [x] Board search, category and model filters, pagination and ordering behave as before.
- [x] No new Board concept is introduced for multi-Turn Comparisons.

## Comments

- 2026-10-29 — Implemented. `ComparisonCard` now carries `headline` (the first Turn's Prompt, read from the denormalised `comparisons.prompt`) and `turnCount`; `cardFromRows` dedupes the Model list, which previously repeated a Model once per Turn. `baseSnippet` and `challengerSnippet` are pinned to Turn 1, so a later Turn never stands in for the opening. The Board page and the live `comparison.published`/`run.finished` payload share `loadCardData`/`cardFromRows`, so the projection cannot drift.
- The Board card renders the headline and a `N turn(s)` badge beside it. The editable title still drives the Comparison page heading, notifications and the default from creation. Search matches the headline Prompt, the editable title and Model names in both SQL (`listComparisons`) and the client-side live-arrival filter (`matchesFilters`).
- Coverage: `board.test.ts` asserts the first-Prompt headline, Turn count, Turn-1 Base preview, deduped Models, the published card payload and headline search after a title edit; `filters.test.ts` covers client search by headline; the import e2e flow now checks the published Board card's headline, `2 turns` badge and first Base preview. Pagination, filter and ordering tests are unchanged and still pass.
- Two browser tests located cards by the editable title, which cards no longer display; they now locate by Comparison id, and the edit/delete fixture asks for the seed title's full phrase because search also matches prompts.
- Verification: `pnpm typecheck`, `pnpm test` (238 core, 74 web, 9 worker, 24 infra) and the full `pnpm test:e2e` suite (38 browser tests) pass. The `board-1440` baseline was regenerated for the headline and badge.
