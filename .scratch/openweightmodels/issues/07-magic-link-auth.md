# 07: Sign in with email magic links

**What to build:** Real accounts replace the seeded identity. A visitor signs in with a single-use email link, chooses a unique handle on first sign-in, and gets a session. Public pages stay readable anonymously; every write requires sign-in. The development user switcher remains available locally and is impossible to use in production.

**Blocked by:** 05 — One-command local environment.

**Status:** done

- [x] Requesting a magic link sends mail through Mailpit locally and the configured production sender; expired or reused links are rejected.
- [x] First sign-in requires a unique handle; reserved names are blocked; email addresses stay private.
- [x] Sessions persist across reloads and can be signed out.
- [x] Creating, annotating, commenting, voting and publishing require a session and return a clear sign-in affordance when absent.
- [x] Anonymous visitors can still read the Board, published Comparisons, Discussion, Annotations and vote counts.
- [x] Drafts and Jobs remain author-only and return 404 to everyone else.
- [x] The development identity switcher works only outside production and is disabled when production starts.
- [x] Existing seeded Comparisons, Annotations, Comments and Votes remain valid after the transition.

## Comments

- Better Auth 1.7 with the Drizzle adapter owns magic-link tokens, sessions and cookies. The application `users` row remains the identity referenced by content; `auth_sessions`, `auth_accounts` and `auth_verifications` were added in migration `0002_modern_lucky_pierre.sql`.
- `users.handle` is nullable until onboarding. `requireUser()` rejects a session without a handle (`403 handle_required`), and every write already routes through it.
- Magic-link mail uses `SMTP_URL` (Mailpit in Compose, SES in production) and `EMAIL_FROM`. In development without Mailpit the link is logged and kept in an in-memory outbox; production raises the SMTP error instead of dropping mail.
- `POST /api/dev/user` (and the new `DELETE`) plus `/api/dev/magic-link` return `404` whenever `NODE_ENV=production`, irrespective of `ALLOW_DEV_USER_SWITCH`.
- Verification: `pnpm typecheck`, `pnpm test` (149 core + 4 web + 6 worker), `pnpm build`, and `pnpm test:e2e` (11 tests, including a dedicated auth suite for single use, expiry, reserved/taken handles, anonymous read, 401 writes, session reload, sign-out, and seeded authors signing in without losing content).
- `BETTER_AUTH_SECRET` is now required at runtime in production and documented in `.env.example`; `next build` uses a build-only placeholder when it is absent.
- Deferred: changing a handle after onboarding (open question 4) and broader magic-link/write abuse controls (ticket 16).
