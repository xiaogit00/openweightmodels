# 02: Build the shared primitives and restyle the shared shell

**What to build:** The visual vocabulary every screen uses: button variants, segmented control, chips, initials badges, the effort glyph, micro-labels, popover surfaces, and the shared header and footer. Restyle the notifications and account popovers. Mount the theme control. No screen-specific layout yet.

**Blocked by:** 01.

**Status:** ready-for-agent.

- [ ] **Buttons.** Primary: accent fill, `--on-accent` text, 32px high, 13px/500, 14px horizontal padding, hover `accent-300`. Outlined: 1px `neutral-700`, transparent, hover `accent-900` + `accent-200`. Ghost: transparent, hover `--color-surface` + text colour. Large inputs and primary submit: 40–42px. Disabled: `neutral-800` fill, `neutral-400` text, `not-allowed`. Focus: 2px accent, 2px offset. One solid accent fill per screen.
- [ ] **Segmented control.** A reusable React primitive: 3px padded track (`--color-surface`, 1px `neutral-800`, radius `--r-lg`), 28–30px inner buttons, active `neutral-800` + text, inactive `neutral-400`, hover text. `role="group"` with `aria-pressed` on each button. This replaces every hand-rolled `bg-surface p-[2px]` recipe in `board-client.tsx`, `new-comparison-client.tsx` and `comparison-view.tsx`.
- [ ] **Chip, initials badge, effort glyph, micro-label, popover surface.** Chip 22–32px per context. Initials badge at 20/22/24/28px with mono initials. Effort glyph: three 3px bars, 4/7/10px tall, 2px gap, 1px radius, active `--color-accent`, inactive `neutral-700`. Micro-label 10.5–11px / 500 / 0.08em uppercase / `neutral-400`. Popover surface: `--color-bg`, 1px `neutral-700`, radius `--r-lg`, `--shadow-lg`, `pop` animation.
- [ ] **Header.** Sticky, 53px, 24px side padding, 1px `neutral-800` bottom border, `--color-bg`. Logo square + wordmark at 14px. Board variant keeps the search slot; page variant keeps the `← Board` link. Right side: primary **New comparison**, theme control, notifications, account; signed-out visitors see **Sign in** instead of notifications/account. Wraps without overflow on narrow screens.
- [ ] **Theme control.** Mount the component from ticket 01 in the header next to Notifications, visible to signed-in and signed-out visitors on every page that renders `SiteHeader`.
- [ ] **Notifications and account popovers.** Keep the Radix behaviour and all labels (`Notifications`, `Notifications, N unread`, `Account menu for @handle`). Restyle the panel as the popover surface. Do not change the accessible name to the prototype's `MI — account menu for @mira`.
- [ ] **Footer.** 24px padding, 1px `neutral-800` top border, 12px `neutral-400`, left brand + Terms + Privacy, right tagline. Links `neutral-300` with hover to text.
- [ ] **Motion.** Add `pop`, `spin`, `shimmer`, `owmTick`, `owmPulse`; every animation is suppressed or reduced under `prefers-reduced-motion`.
- [ ] Existing e2e labels, roles and `data-*` hooks remain valid. The only intentional accessibility change is replacing invalid `role="tablist"` + `aria-pressed` combinations with `role="group"` + `aria-pressed`.
- [ ] `pnpm typecheck`, `pnpm test` and the existing e2e suite pass.

**Key files:** `apps/web/src/app/globals.css`, `apps/web/src/components/site-header.tsx`, `site-footer.tsx`, `logo.tsx`, `notification-bell.tsx`, `account-menu.tsx`, `avatar.tsx`, new primitives under `apps/web/src/components/ui/`.

**Out of scope:** Board, Comparison, New comparison and Job layouts; Account and Admin screens.
