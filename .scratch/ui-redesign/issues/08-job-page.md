# 08: Restyle the Job page

**What to build:** A derived design for the Job page using the new primitives and tokens: stage pipeline, per-Replay rows, errors, Retry / Skip remaining, publish, live status, and the live preview aside. No new interactions and no layout invention beyond the primitives.

**Blocked by:** 02.

**Status:** ready-for-agent.

**Design source:** none. Derive it from `design_handoff_redesign/README.md` and the primitives built in ticket 02. Use the Comparison and New comparison patterns for spacing, card surfaces and type. The before/after screenshots in both themes are the review artefact.

- [ ] Page: `main` max-width 1200px, 32px side padding, 32px gap, two columns `minmax(0,1fr) 320px` on wide screens and one column below ~1024px. Header stays the shared header with `showNew={false}`.
- [ ] Title block: job id/scheduled meta at 12–13px, live/reconnecting status with pulse dot, H1 at 30px / Space Grotesk.
- [ ] Stage pipeline: keep the four existing stages and their complete/current/upcoming states, restyled as the design's 3px bars + labels; reduced-motion safe.
- [ ] Summary card: "Base" tag, Base model name, **Uploaded** state. One row per Replay with 22px initials, model name, `turn n of m` chip, status label + icon, and a 3px progress bar with the current `role="progressbar"` semantics.
- [ ] **Keep every action**: Retry / Skip remaining on the failed Replay, their pending and error states, and the retry/skip API calls. Keep `data-run` and the current error copy.
- [ ] Settled card: ready vs published copy, `N challengers generated`, **Review first** / **View comparison**, **Publish to board**, publish disabled until one Challenger finishes, publishing state, publish error. Keep the "leave this page" notification line while generating.
- [ ] Live preview aside: reuse `ComparisonPreview` restyled to the new Board card, with the current Ready / Generating status, snippet, and visibility note. Sticky on wide screens, below the card on narrow.
- [ ] Keep the SSE connection states and every existing label (`Publish to board`, `Retry`, `Skip remaining`, `Review first`, `View comparison`).
- [ ] Both themes, 768px and 360px with no horizontal overflow. Update `e2e/visual.spec.ts` Job metrics to max-width 1200px and padding-left 32px; refresh the dark baseline and add a light baseline.
- [ ] `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` pass, including `job-replays.test.ts`, `journey.spec.ts`, `visual.spec.ts` and `a11y.spec.ts`.

**Key files:** `apps/web/src/app/comparisons/[id]/job/page.tsx`, `apps/web/src/components/job-summary.tsx`, `comparison-preview.tsx`, `e2e/visual.spec.ts`.

**Implementation notes:** The page must look finished, not like an untouched leftover: it is the screen every Author sees immediately after scheduling. Do not add a publish confirmation that does not exist today. Status colours use accent for progress, `neutral-500` for failed bars and `--color-danger` for error text.

**Out of scope:** New job states, batch controls, changing the retry/skip API.
