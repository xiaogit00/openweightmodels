# 02: Build the shared primitives and restyle the shared shell

**What to build:** The visual vocabulary every screen uses: button variants, segmented control, chips, initials badges, the effort glyph, micro-labels, popover surfaces, and the shared header and footer. Restyle the notifications and account popovers. Mount the theme control. No screen-specific layout yet.

**Blocked by:** 01.

**Status:** done.

- [x] **Buttons.** Primary: accent fill, `--on-accent` text, 32px high, 13px/500, 14px horizontal padding, hover `accent-300`. Outlined: 1px `neutral-700`, transparent, hover `accent-900` + `accent-200`. Ghost: transparent, hover `--color-surface` + text colour. Large inputs and primary submit: 40–42px. Disabled: `neutral-800` fill, `neutral-400` text, `not-allowed`. Focus: 2px accent, 2px offset. One solid accent fill per screen.
- [x] **Segmented control.** A reusable React primitive: 3px padded track (`--color-surface`, 1px `neutral-800`, radius `--r-lg`), 28–30px inner buttons, active `neutral-800` + text, inactive `neutral-400`, hover text. `role="group"` with `aria-pressed` on each button. This replaces every hand-rolled `bg-surface p-[2px]` recipe in `board-client.tsx`, `new-comparison-client.tsx` and `comparison-view.tsx`.
- [x] **Chip, initials badge, effort glyph, micro-label, popover surface.** Chip 22–32px per context. Initials badge at 20/22/24/28px with mono initials. Effort glyph: three 3px bars, 4/7/10px tall, 2px gap, 1px radius, active `--color-accent`, inactive `neutral-700`. Micro-label 10.5–11px / 500 / 0.08em uppercase / `neutral-400`. Popover surface: `--color-bg`, 1px `neutral-700`, radius `--r-lg`, `--shadow-lg`, `pop` animation.
- [x] **Header.** Sticky, 53px, 24px side padding, 1px `neutral-800` bottom border, `--color-bg`. Logo square + wordmark at 14px. Board variant keeps the search slot; page variant keeps the `← Board` link. Right side: primary **New comparison**, theme control, notifications, account; signed-out visitors see **Sign in** instead of notifications/account. Wraps without overflow on narrow screens.
- [x] **Theme control.** Mount the component from ticket 01 in the header next to Notifications, visible to signed-in and signed-out visitors on every page that renders `SiteHeader`.
- [x] **Notifications and account popovers.** Keep the Radix behaviour and all labels (`Notifications`, `Notifications, N unread`, `Account menu for @handle`). Restyle the panel as the popover surface. Do not change the accessible name to the prototype's `MI — account menu for @mira`.
- [x] **Footer.** 24px padding, 1px `neutral-800` top border, 12px `neutral-400`, left brand + Terms + Privacy, right tagline. Links `neutral-300` with hover to text.
- [x] **Motion.** Add `pop`, `spin`, `shimmer`, `owmTick`, `owmPulse`; every animation is suppressed or reduced under `prefers-reduced-motion`.
- [x] Existing e2e labels, roles and `data-*` hooks remain valid. The only intentional accessibility change is replacing invalid `role="tablist"` + `aria-pressed` combinations with `role="group"` + `aria-pressed`.
- [x] `pnpm typecheck`, `pnpm test` and the existing e2e suite pass.

**Key files:** `apps/web/src/app/globals.css`, `apps/web/src/components/site-header.tsx`, `site-footer.tsx`, `logo.tsx`, `notification-bell.tsx`, `account-menu.tsx`, `avatar.tsx`, new primitives under `apps/web/src/components/ui/`.

**Out of scope:** Board, Comparison, New comparison and Job layouts; Account and Admin screens.

## Comments

- 2026-10-29 — Implemented. `globals.css` now carries the button system (primary / outlined / ghost, 32px default, `btn-lg` at 42px), the `segmented` track, `chip`, `popover-surface`, and the `pop` / `spin` / `shimmer` / `owm-tick` / `owm-pulse` keyframes plus `.anim-*` classes; all are listed under `prefers-reduced-motion`, and the ticker moved from `.marquee` to `.anim-tick` (70s).
- React primitives live under `apps/web/src/components/ui/`: `SegmentedControl` (`role="group"` + `aria-pressed`, optional icons, numeric or string values, no pressed button when the filter is cleared), `Chip`, `InitialsBadge`, `EffortGlyph`, `MicroLabel` and the `POPOVER_SURFACE` class. `Avatar` now wraps `InitialsBadge`; `ComparisonCard` uses `Chip` + `InitialsBadge` + `EffortGlyph`.
- `SiteHeader` is 53px at roomy widths (`min-h` plus wrapping so 360px grows to 93px without overflow), 24px side padding, logo 22px with a 1.5×10px accent bar, a 32px search slot on the Board, and a right cluster of primary **New comparison**, `ThemeControl`, notifications and account (or **Sign in** signed out). `SiteFooter` is 24px padding at 12px. Notifications, account and theme panels share the popover surface, radius and `pop`; the account trigger's accessible name is now exactly `Account menu for @handle` (spec decision 11).
- Replaced every hand-rolled segmented recipe in `board-client.tsx`, `new-comparison-client.tsx` and `comparison-view.tsx`. No `role="tablist"` + `aria-pressed` combination existed to correct; Admin's report tabs use valid `tablist`/`tab` semantics and were left alone.
- Two findings that were already red under the redesign's new light theme were fixed to keep the suites honest: annotated code spans use `color-mix` (30% / 48% accent over `--code-bg`) so light-mode `--code-fg` stays legible (also matches ticket 05's rule), and the account trigger draws its decorative initials as generated content from `data-initials`, which satisfies axe's label-in-name check without renaming the control. `e2e/visual.spec.ts` now pins `colorScheme: 'dark'` so ambient OS settings cannot silently rewrite baselines (ticket 10 adds the light set), the Board header metric is 53px, and the journey fixture asserts the `Llama 3.3 70B (previous)` label ticket 26 introduced.
- Verification: `pnpm typecheck`, `pnpm test` (core 273, web 137, worker 9), `pnpm test:e2e` (45 passed). The four 1440px baselines were regenerated for the new header, chips and segmented tracks; the reduced-motion probe now covers all twelve motion utilities.
