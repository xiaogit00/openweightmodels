# 01: Add theme tokens, fonts and theme infrastructure

**What to build:** Replace the dark-only token block in `apps/web/src/app/globals.css` with the two-theme token layer from `design_handoff_redesign/tokens.css`, load Geist / Space Mono / Space Grotesk through `next/font`, move the base type scale to the redesign, and add cookie-backed theme resolution plus a reusable `ThemeControl`. This is the foundation every other ticket builds on.

**Blocked by:** none.

**Status:** done.

- [x] `globals.css` defines semantic variables on `:root` (dark) and `[data-theme="light"]`, mapped into Tailwind with `@theme inline`, so `bg-bg`, `text-neutral-*`, `border-neutral-*`, `bg-accent-*`, `shadow-md`, `shadow-lg` and the radius utilities follow the active theme.
- [x] Every token from `design_handoff_redesign/tokens.css` is ported: `--color-bg`, `--color-surface`, `--color-text`, `--color-accent`, accent 100–900, neutral 100–900, `--code-bg`, `--code-fg`, `--on-accent`, `--r`, `--r-lg`, `--r-bubble`, `--shadow-md`, `--shadow-lg`.
- [x] `--color-danger` and `--color-danger-surface` exist in both themes. Use `#f87171` dark and a light red that clears 4.5:1 on `bg` and `surface` (for example `#b42318` on `#fdecea`). Existing `text-danger` / `border-danger` usages resolve to the new tokens.
- [x] `apps/web/src/app/layout.tsx` loads Geist (400/500/600), Space Mono (400) and Space Grotesk (500). `--font-body` is Geist, `--font-heading` Space Grotesk, and the mono face is Space Mono. JetBrains Mono is removed once no file references it.
- [x] Base body type is 14.5px / 1.55; headings use Space Grotesk 500; micro-labels are 10.5–11px, 0.08em, uppercase; code is 12px / 1.65. No informational text falls below 10.5px; initials badges may use 9px because they are decorative and always sit next to the name.
- [x] The root layout reads the `owm-theme` cookie. Explicit `light` or `dark` sets `data-theme` on `<html>` and the matching `color-scheme`; `system` or no cookie leaves `data-theme` unset, with a `prefers-color-scheme: light` media query supplying the light values. There is no flash on first paint and no inline script.
- [x] A `ThemeControl` client component exists in `apps/web/src/components/`: ghost 32px icon button, accessible name `Theme`, popover with **System / Light / Dark**, active option marked, writes the `owm-theme` cookie and updates the root attribute immediately. It is not mounted yet; ticket 02 mounts it.
- [x] A small pure helper resolves the cookie value (`system`/`light`/`dark`, invalid values fall back to `system`) and is unit tested.
- [x] `apps/web/test/contrast.test.ts` parses both theme blocks and asserts 4.5:1 for every text token on `bg`, `surface`, `neutral-800` and `accent-900` in each theme, plus `accent-200/300` on `accent-900` and `neutral-300` on `neutral-700`.
- [x] `pnpm typecheck` and `pnpm test` pass. No screen layout in this ticket is reworked.

**Key files:** `apps/web/src/app/globals.css`, `apps/web/src/app/layout.tsx`, `apps/web/test/contrast.test.ts`, new `apps/web/src/components/theme-control.tsx`, new theme helper + test.

**Implementation notes:** Tailwind v4's `@theme` emits static values. Use `@theme inline` (or equivalent) so utilities reference the theme-scoped custom properties rather than copying hex values. The dark palette stays the default on `:root`; light overrides everything, including geometry. `color-scheme` must be set on `<html>` or native scrollbars and file inputs will mismatch the page.

**Out of scope:** mounting the control in the header, restyling buttons/cards, and fixing the other screens — tickets 02 and 09.

## Comments

- Ported both palettes into `globals.css` with the dark values on `:root`, an OS-driven light block under `prefers-color-scheme`, and the explicit `[data-theme="light"]` override. Both light blocks are kept identical by a test, so the system default cannot drift from the toggle.
- `--color-danger` / `--color-danger-surface` are new semantic tokens (`#f87171` / `#2b1412` dark, `#b42318` / `#fdecea` light).
- The handoff's light `neutral-400` (`#6b757b`) and `neutral-500` (`#8a9297`) fail 4.5:1 on `neutral-800` and `accent-900` at the new small-text sizes. They are darkened to `#5e676c` / `#636c71`; dark `neutral-500` becomes `#848985`, the darkest value that clears the floor while staying below `neutral-400`, so the ramp keeps its direction. This matches the existing precedent of lifting a muted token for contrast.
- `@theme inline` maps colours, geometry, shadows and the three font families to theme-scoped vars. Verified in the compiled CSS that `bg-bg`, `text-danger`, `rounded-lg`, `rounded-bubble`, `shadow-md`, `font-body` and `font-mono` all emit `var(...)`.
- `layout.tsx` reads `owm-theme` and sets `data-theme`; no cookie or `system` leaves it unset so the media query wins on first paint. All routes become dynamic as a result, which is the cost of server-resolved themes and is expected.
- `ThemeControl` is written but deliberately not mounted; ticket 02 owns that. It exposes the existing Radix popover with `aria-pressed` options and no new dependency.
- Raised every existing `text-[10px]` label to `10.5px` (and the informational 9px "Previous" badge); the only 9px left is the decorative initials badge. The inline micro-labels touched by that sweep also move to 0.08em tracking and `neutral-400`. `pnpm typecheck`, `pnpm test` and `pnpm --filter @owm/web build` pass.
