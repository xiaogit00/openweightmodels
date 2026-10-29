# Spec: visual redesign of Board, New comparison, Comparison and Job

## Problem Statement

The current interface is deliberately dense: 12px monospace body text, 10px micro-labels, 2px radii, 8px card gaps and a single dark palette. It is hard to read, and there is no light theme. A complete visual redesign now exists in `design_handoff_redesign/` — roomier type, chat-style responses, one accent, dark and light themes — but it is only HTML prototypes. Nothing in `apps/web` consumes its tokens, fonts or layouts.

The handoff claims to keep every feature. It does not: pagination, signed-out states, per-Turn generation states, annotation actions, comment editing, upload warnings, the Job page and the author-supplied Base reply are all absent from the prototypes. Shipping the redesign literally would silently delete behaviour.

## Solution

Implement the redesign as a visual-only change across Board, New comparison, Comparison and the Job page, plus an app-wide token fallback for the remaining screens. Every current behaviour is preserved and restyled; the only deliberate removals or behaviour changes are recorded below. Light and dark themes become first-class, driven by CSS variables on `data-theme`, with a three-state theme control (System / Light / Dark) reachable by signed-in and signed-out visitors.

The design source of truth is `design_handoff_redesign/README.md` plus `design_handoff_redesign/tokens.css` and `design_handoff_redesign/designs/*.dc.html`. The HTML files are references, not production code. Sample content is placeholder data and must be wired to the real API.

## Locked decisions

These were settled in the grilling session and are not open for reinterpretation during implementation.

1. **Scope.** Three designed screens plus Job, plus an app-wide token fallback ticket. Account, Admin, Help, Sign-in, Onboarding, Legal and auth-complete are not redesigned; they only receive the new tokens, fonts and base typography, with breakage fixes.
2. **Strict parity.** The redesign is visual. No current functionality is removed or changed except where this spec says so explicitly. The parity ledger below is binding.
3. **Write mode keeps the author's Base reply.** New comparison's "Write a prompt" mode keeps the existing "Paste what the base model wrote…" field. The platform does not generate the Base output. The Base output remains author-supplied, per the glossary.
4. **Prompts appear twice.** In Comparison, each column shows the Turn's Prompt as a right-aligned bubble, matching the prototypes. The collapsible "Prompt" disclosure at the top of the page is removed so the Prompt is not shown a third time.
5. **Board keeps its behaviour.** Cursor pagination (48 per page) with a styled "Load more" button and the existing sentinel, loading/empty/error states, signed-out header and `Sign in` are all preserved. The count line shows the total number of matching comparisons, not the number loaded.
6. **Light theme is in scope.** Default follows the operating system until the visitor chooses. The choice is stored in the `owm-theme` cookie (`system`/`light`/`dark`), so the server renders the right theme. Geometry is per-theme as designed (`--r`/`--r-lg` change with theme). A semantic danger palette is added because the prototypes have no error colour.
7. **Theme control is reachable by everyone.** A 32px ghost icon button in the shared header, next to Notifications, opens a small popover with System / Light / Dark. It appears on every page that renders `SiteHeader`, signed in or not. Pages without the shared header follow the OS preference.
8. **Responsive Comparison stacks turn by turn.** Below ~800px, each Turn renders Prompt, Base reply, active Challenger reply in one column, with no sticky pane headers. The Turn rail still works. No Base/Compare toggle state is introduced.
9. **Board model list defaults to models with at least one comparison.** A "Show all N models" toggle reveals the rest. A selected model is always visible even when its count is zero.
10. **Job page is derived, not designed.** It reuses the new primitives and adds no new interactions or layout inventions. Before/after screenshots in both themes are reviewed in the ticket.
11. **Tests change deliberately.** Pixel metrics and screenshots are updated to the new design. `data-*` hooks and accessible names stay stable except for two corrections: the account trigger returns to `Account menu for @handle`, and segmented controls use `role="group"` + `aria-pressed` instead of `role="tablist"` + `aria-pressed` (invalid ARIA). Axe and contrast coverage extend to both themes.
12. **Report comparison stays.** A ghost "Report" control sits in the Comparison head actions row, hidden for the author and suspended viewers, icon-only on narrow screens with the same accessible name.
13. **Refactor while restyling.** `comparison-view.tsx` is split into sections as each section is restyled. No standalone big-bang refactor ticket. Shared primitives are extracted only when at least two screens need them.
14. **Theme tokens are recorded in an ADR.** See `docs/adr/0011-theme-tokens-drive-geometry-and-colour.md`.

## Ticket graph

`01 → 02 → {03, 04, 07, 08, 09}`, `04 → {05, 06}`, and `10` after everything else. `03`, `07` and `08` can run in parallel once `02` lands.

## Parity ledger

Each row names the ticket that keeps the behaviour.

| Behaviour | Current app | Redesign prototype | Kept by |
|---|---|---|---|
| Board pagination, sentinel, total count | Cursor pages of 48 | Absent | 03 |
| Board loading, error, empty, signed-out | Present | Partly | 03 |
| Board model list shows every model | Present | Defaults to models with comparisons | 03 (intentional change) |
| Shared header signed out | `Sign in` | Absent | 02 |
| Theme control | Absent | Prop only | 01 + 02 |
| Report comparison | Ghost control | Absent | 04 |
| Suspended / read-only banner | Present | Absent | 04 |
| Per-Turn queued/calling/streaming/failed/skipped/stopped | Present | Only generating | 04 |
| Author Retry / Skip on a failed Turn | Present | Absent | 04 |
| Add-model cost confirmation and replay-in-progress marker | Present | Absent | 04 |
| Sign-in-to-annotate and annotation read-only states | Present | Absent | 05 |
| Annotation retag, delete, report, edit/delete messages | Present | Vote + reply only | 05 |
| Discussion edit, report replies, signed-out/suspended composer | Present | Delete only | 06 |
| Upload truncated-tail warning, merge notes, parse errors | Present | Turn preview only | 07 |
| Write-mode Base reply paste | Present | Generated Base | 07 |
| Schedule → Job → publish | Present | Navigate to comparison | 08 |
| Job retry/skip/publish/progress | Present | No design | 08 |
| Account, Admin, Help, Sign-in, Onboarding, Legal, auth | Present, dark | No design | 09 |

## Screen requirements

The detailed measurements, states and interactions are in `design_handoff_redesign/README.md` and are repeated only where the implementation needs a decision the README does not make. Each screen ticket carries its own acceptance criteria.

- **Board** — ticker, sidebar (categories, models, effort), title/count, sort, filter chips, card grid, empty state, pagination, signed-out header.
- **New comparison** — three step cards, upload (dropzone, how-to panel, file row, generated-by, Turn review with warnings), write (Base model, Prompt, Base reply), challenger picker (search, weights, max 4, previous releases), details (title, categories, effort), validation and estimate, live Board-card preview, submit → Job.
- **Comparison** — head (meta, report, annotations, copy link), Turn rail, two continuous response cards with sticky headers, model picker (switch + add), markdown/code/sources, per-Turn states, annotations (select-to-annotate, new/thread popovers, actions), Discussion (filter, composer, comments/replies, actions, gating).
- **Job** — summary, one row per Replay with Turn progress, Retry / Skip remaining, publish, review/view comparison, live stream, errors.
- **App-wide fallback** — every remaining route renders correctly with the new tokens and fonts at 1440, 768 and 360, in both themes.

## Implementation decisions

- **Token layer.** Keep Tailwind v4. Define semantic values on `:root` (dark) and `[data-theme="light"]`, and map them into Tailwind with `@theme inline` so utilities such as `bg-bg` and `text-neutral-300` follow the active theme. Port `tokens.css` faithfully, including `--code-bg`, `--code-fg`, `--on-accent`, shadows, radii and `--r-bubble`. Add `--color-danger` and `--color-danger-surface` in both themes.
- **Fonts.** `next/font/google` for Geist (400/500/600), Space Mono (400) and the existing Space Grotesk (500). Geist becomes the body face; Space Mono takes code, initials and keyboard hints. Remove JetBrains Mono once nothing references it. Next self-hosts fonts at build time, so there is no runtime font request.
- **Base type.** Body 14.5px / 1.55; response paragraphs 14.5px / 1.7; code 12px / 1.65; micro-labels 10.5–11px with 0.08em uppercase tracking. The current 12px base and 10px floor tests are replaced by the new scale: no informational text falls below 10.5px. Initials badges are the one exception at 9px, because they are decorative and always sit next to the name.
- **Theme resolution.** The server reads the `owm-theme` cookie in the root layout and sets `data-theme="light|dark"` on `<html>` when the choice is explicit. With `system` (or no cookie), dark is the CSS default and a `prefers-color-scheme: light` media query supplies the light values, so there is no flash and no inline script. `color-scheme` is set per theme so native controls match.
- **Theme control.** Client component in the header: ghost 32px icon button, accessible name "Theme", popover with three options and the active one marked. Writes the cookie and updates the root attribute immediately. Uses the existing Radix Popover dependency.
- **Primitives.** Extend the existing global component classes for buttons and inputs. Add small React primitives only where at least two screens share them: segmented control, chip, initials badge, effort glyph, popover surface, micro-label. Icons come from `@phosphor-icons/react`. No new UI dependency.
- **Motion.** `pop`, `spin`, `shimmer`, `owmTick`, `owmPulse` as specified, all suppressed or simplified under `prefers-reduced-motion`.
- **Markdown.** `MarkdownView` keeps producing the same blocks and annotation hooks. Only its typography, code block, list and sources presentation change. Annotation offsets are not affected by visual changes.
- **Data and APIs.** No schema, API or ranking changes. Board filters stay URL-backed. Existing optimistic mutations, streaming and polling stay as they are.
- **Design files.** Do not ship the `.dc.html` files or `support.js`. Do not add Google Fonts or Phosphor CDN links; use the local font pipeline and the React icon package.

## Testing decisions

- **Parity first.** Every ticket walks its rows of the parity ledger. A missing behaviour is a test failure, not a follow-up.
- **Behavioural tests.** Existing core, web and worker Vitest suites must pass unchanged. Playwright suites for board, model pickers, import, replay, add-challenger, edit-delete, keyboard, responsive and journey must pass with only selector/metric updates where the visual structure genuinely changed.
- **Contract stability.** Keep the `data-*` hooks listed in `e2e/*.spec.ts`. Keep accessible names stable except the two corrections in decision 11. If a hook must change, update every spec in the same ticket.
- **Visual.** Update `e2e/visual.spec.ts` metrics to the new values. At 1440: header 53px, ticker 38px, Board sidebar 248px, Board `main` padding-left 32px, card gap 16px, Board max-width 1440px, Comparison max-width 1280px, New comparison and Job max-width 1200px. Replace the New comparison grid-column assertion with the new two-column flex measurement. Refresh all four desktop baselines and add light-theme baselines for the same states.
- **Accessibility.** `e2e/a11y.spec.ts` runs in dark and light, on Board, Comparison (including an open annotation thread), multi-Turn Comparison, New comparison (including an expanded picker), Job and the export guide. No critical or serious violations.
- **Contrast.** Extend `apps/web/test/contrast.test.ts` to parse both theme blocks and assert 4.5:1 for every text token on `bg`, `surface`, `neutral-800` and `accent-900` in each theme, plus `accent-200/300` on `accent-900` and `neutral-300` on `neutral-700`.
- **Responsive.** 768px and 360px: no horizontal overflow; Board, Comparison, New comparison and Job remain usable; Comparison stacks turn by turn.
- **Commands.** `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` from the repo root.

## Out of scope

- Generating Base outputs, or any change to the upload/parse/Replay domain model.
- New product features not already present: comment pagination, richer voting, model comparison beyond the current picker, theme sync across devices.
- Full visual redesigns of Account, Admin, Help, Sign-in, Onboarding, Legal and auth pages.
- Changing the Model registry, category list or effort scale.
- Emails, Open Graph images or other non-screen surfaces.
- Keeping the old dark-only palette behind a flag. The redesign replaces it.

## Further notes

- The prototypes use inline styles and a fake clock (for example a 3.6s "generating" timeout). Recreate the look with Tailwind and the real API; do not copy the state shape literally.
- The design's `aria-label` for the account trigger and its `role="tablist"` + `aria-pressed` sort control are both wrong for this app. Follow decision 11.
- The light palette inverts the ramps: 100 is the strongest ink and 900 the faintest fill. Use ramps by role, not by index, and never use base accent as text in light mode.
- `design_handoff_current/` remains the parity reference when a prototype is ambiguous.
- ADR 0011 records why geometry changes with theme, so a future reader does not "fix" the radii.
