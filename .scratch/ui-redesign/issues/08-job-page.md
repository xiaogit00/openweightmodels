# 08: Restyle the Job page

**What to build:** A derived design for the Job page using the new primitives and tokens: stage pipeline, per-Replay rows, errors, Retry / Skip remaining, publish, live status, and the live preview aside. No new interactions and no layout invention beyond the primitives.

**Blocked by:** 02.

**Status:** done.

**Design source:** none. Derive it from `design_handoff_redesign/README.md` and the primitives built in ticket 02. Use the Comparison and New comparison patterns for spacing, card surfaces and type. The before/after screenshots in both themes are the review artefact.

- [x] Page: `main` max-width 1200px, 32px side padding, 32px gap, two columns `minmax(0,1fr) 320px` on wide screens and one column below ~1024px. Header stays the shared header with `showNew={false}`.
- [x] Title block: job id/scheduled meta at 12–13px, live/reconnecting status with pulse dot, H1 at 30px / Space Grotesk.
- [x] Stage pipeline: keep the four existing stages and their complete/current/upcoming states, restyled as the design's 3px bars + labels; reduced-motion safe.
- [x] Summary card: "Base" tag, Base model name, **Uploaded** state. One row per Replay with 22px initials, model name, `turn n of m` chip, status label + icon, and a 3px progress bar with the current `role="progressbar"` semantics.
- [x] **Keep every action**: Retry / Skip remaining on the failed Replay, their pending and error states, and the retry/skip API calls. Keep `data-run` and the current error copy.
- [x] Settled card: ready vs published copy, `N challengers generated`, **Review first** / **View comparison**, **Publish to board**, publish disabled until one Challenger finishes, publishing state, publish error. Keep the "leave this page" notification line while generating.
- [x] Live preview aside: reuse `ComparisonPreview` restyled to the new Board card, with the current Ready / Generating status, snippet, and visibility note. Sticky on wide screens, below the card on narrow.
- [x] Keep the SSE connection states and every existing label (`Publish to board`, `Retry`, `Skip remaining`, `Review first`, `View comparison`).
- [x] Both themes, 768px and 360px with no horizontal overflow. Update `e2e/visual.spec.ts` Job metrics to max-width 1200px and padding-left 32px; refresh the dark baseline and add a light baseline. Metrics are updated; the PNG baselines (dark refresh and light set) are captured centrally by the orchestrator.
- [ ] `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` pass, including `job-replays.test.ts`, `journey.spec.ts`, `visual.spec.ts` and `a11y.spec.ts`. `pnpm typecheck` and `pnpm test` pass in this worktree; the Playwright suites and snapshot refresh are run centrally by the orchestrator.

**Key files:** `apps/web/src/app/comparisons/[id]/job/page.tsx`, `apps/web/src/components/job-summary.tsx`, `comparison-preview.tsx`, `e2e/visual.spec.ts`.

**Implementation notes:** The page must look finished, not like an untouched leftover: it is the screen every Author sees immediately after scheduling. Do not add a publish confirmation that does not exist today. Status colours use accent for progress, `neutral-500` for failed bars and `--color-danger` for error text.

**Out of scope:** New job states, batch controls, changing the retry/skip API.

## Comments

Before: the Job page was a leftover of the dense dark-only UI. A 1120px,
20px-padded `main` held a compact 18px H1, 11px uppercase meta, 12px body
text, 2px corners and 14px card padding. The four stage bars, Replay rows and
readiness card were crowded onto `--color-surface` panels with hairline
separators; the failure label and error copy were styled like ordinary meta
text, and the whole screen had a single dark treatment.

After: the same behaviour, restyled with the redesign tokens and primitives.
The page is a 1200px, 32px-padded two-column layout (`minmax(0,1fr) 320px`)
with a 32px gutter, stacking below 1024px. The metadata line is 12.5px, the H1
is 30px Space Grotesk, and the live dot pulses in accent. The pipeline keeps
its four 3px bars and labels; complete bars are accent, the current bar is
accent-700, and upcoming bars are neutral-700. The Replay card uses the new
card surface (`bg-bg`, 1px neutral-700, `--r-lg`) with a Base tag, 22px
initials, a chip for `turn n of m`, a 12.5px status line and a 3px progressbar
(accent fill, neutral-500 when failed, danger text for errors). Retry and Skip
remaining are 28px outlined buttons. The settled card uses accent-900 with an
accent-700 border; Publish to board is the single accent fill and disables
until a Challenger finishes, while errors render in danger. The generating
"you can leave this page" line and every SSE state and label are unchanged.

In dark the card keeps the sharp 2px/4px radii with the lime accent and neutral
surfaces; in light it softens to 6px/12px on white, the accent becomes red and
danger text uses the darker light-mode red. The row, action and pipeline groups
all wrap, so the same markup collapses to one column below 1024px and to
wrapped rows at 360px without horizontal overflow. The route was smoke-tested
through the dev server on port 3108 (signed in, ready Job), and the responsive
classes were checked against the 1440/768/360 targets. The full browser and
theme sweep, plus the before/after screenshots, run centrally with the
refreshed baseline.
