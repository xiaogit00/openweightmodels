# 04: Harden and verify the M1 journey

**What to build:** Automated confidence in the Milestone 1 vertical slice, plus fixes for any defects the tests expose. The unit suite covers the decision-rich domain logic; an integration suite exercises the mock job pipeline; a browser suite proves the create → publish → read and annotate → thread journeys.

**Blocked by:** 03 — Watch a Job live, recover failures, and Publish.

**Status:** done

- [x] Unit tests cover UTF-16 annotation range validation (emoji, CJK, escapes, cross-formatting, fenced vs indented code), upload parsing and limits, keyset cursors, Board filters and Top ordering.
- [x] Integration tests with the mock provider cover queued → done, forced failure → retry/skip, Job readiness, publish visibility and the job-ready notification.
- [x] A browser test covers upload → schedule → ready → publish → Board arrival → Comparison → annotate → thread → comment → vote.
- [x] Tests prove non-authors cannot read drafts or jobs and cannot mutate another Author's content.
- [x] `pnpm test`, `pnpm typecheck` and `pnpm build` pass from a clean install.
- [x] Defects found by the suites are fixed or split into explicit blocked tickets; no silent skips.

## Comments

- `packages/core/test/markdown.test.ts`, `upload.test.ts`, `cursor.test.ts` and `filters.test.ts` cover the unit seams.
- `board.test.ts` covers SQL pagination, cursor sort mismatch and filters.
- `permissions.test.ts` covers author-only writes, draft visibility and self-votes.
- `pipeline.test.ts` covers create → generate → publish using `createComparison`.
- The worker suite adds a forced failure → Retry round trip over the real BullMQ queue.
- `e2e/journey.spec.ts` is the browser suite; `pnpm test:e2e` seeds an isolated database and Redis DB, then starts web and worker. The test also clicks the live Board arrival through to the Comparison.
- Fixed: indented code blocks were annotatable; `codeBlock` now requires a fenced block. Vote controls gained accessible names for the browser test.
