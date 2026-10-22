# 04: Harden and verify the M1 journey

**What to build:** Automated confidence in the Milestone 1 vertical slice, plus fixes for any defects the tests expose. The unit suite covers the decision-rich domain logic; an integration suite exercises the mock job pipeline; a browser suite proves the create → publish → read and annotate → thread journeys.

**Blocked by:** 03 — Watch a Job live, recover failures, and Publish.

**Status:** ready-for-agent

- [ ] Unit tests cover UTF-16 annotation range validation (emoji, CJK, escapes, cross-formatting, fenced vs indented code), upload parsing and limits, keyset cursors, Board filters and Top ordering.
- [ ] Integration tests with the mock provider cover queued → done, forced failure → retry/skip, Job readiness, publish visibility and the job-ready notification.
- [ ] A browser test covers upload → schedule → ready → publish → Board arrival → Comparison → annotate → thread → comment → vote.
- [ ] Tests prove non-authors cannot read drafts or jobs and cannot mutate another Author's content.
- [ ] `pnpm test`, `pnpm typecheck` and `pnpm build` pass from a clean install.
- [ ] Defects found by the suites are fixed or split into explicit blocked tickets; no silent skips.
