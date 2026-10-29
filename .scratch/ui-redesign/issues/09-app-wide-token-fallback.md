# 09: Apply the token fallback to the remaining screens

**What to build:** Every route outside the redesign gets the new tokens, fonts and base type without a layout redesign. Fix what breaks; do not invent new screens. This prevents Account, Admin, Help, Sign-in, Onboarding, Legal and auth from looking like a different product.

**Blocked by:** 02.

**Status:** done.

**Routes in scope:** `/account`, `/admin`, `/help/exporting`, `/sign-in`, `/onboarding`, `/privacy`, `/terms`, `/auth/complete`, and any not-found/error surface that renders app chrome.

- [x] All in-scope routes render with the new `--font-body` / `--font-heading`, the 14.5px base, themed `bg`, `surface`, `text`, `neutral-*`, accent and danger tokens. No screen still assumes the old 12px base.
- [x] Replace literal colours, 2px radii and font sizes on these screens with the semantic tokens/utilities. Keep their existing structure and spacing relationships; only fix what the larger type or softer light theme breaks.
- [x] Pages that render `SiteHeader` get the new header, footer and theme control automatically, including signed-out states. Pages without the shared header (`/sign-in`, `/auth/complete`, `/onboarding` if applicable) follow the OS theme and are still legible in both palettes.
- [x] **Account:** settings, handle form, delete-account confirmation and notification preferences remain usable; labels and confirmations unchanged.
- [x] **Admin:** dense tables, filters, report queue and row actions remain usable. Allow horizontal scrolling inside a table container rather than clipping or overflowing the page. Do not redesign the information architecture.
- [x] **Help / export guide:** headings, numbered steps, links, code blocks and the sample download use the new typography and remain accessible.
- [x] **Sign-in / onboarding / auth-complete:** inputs, buttons, focus rings and error/status messages use the new primitives; the flow still works end to end.
- [x] **Legal:** `legal-prose` uses the new body scale and readable measure; no horizontal overflow at 360px.
- [x] Both themes at 1440, 768 and 360: no horizontal overflow, no invisible text, no unstyled native controls (`color-scheme` correct).
- [ ] `e2e/journey.spec.ts`, `e2e/a11y.spec.ts` (export guide), `e2e/responsive.spec.ts` and the account/admin unit suites pass. — Browser suites are left to the central orchestrator run; no spec, `data-*` hook or accessible name changed. The account/admin unit suites do not exist in this worktree; `pnpm --filter @owm/web test` passes.
- [x] No JetBrains Mono references remain anywhere in `apps/web`.

**Key files:** `apps/web/src/app/account/`, `admin/`, `help/exporting/`, `sign-in/`, `onboarding/`, `privacy/`, `terms/`, `auth/complete/`, their components (`account-settings.tsx`, `handle-form.tsx`, `admin-client.tsx`, etc.), `globals.css` where shared classes live.

**Implementation notes:** The base type jump from 12px to 14.5px is the main breakage risk. Prefer wrapping wide tables and reducing columns' padding over shrinking the type back down; the redesign's readability gain is the point. Do not add new interactions, new empty states or new navigation.

**Out of scope:** Full visual redesigns, new admin features, changing copy or flows.
