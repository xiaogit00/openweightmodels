# 07: Sign in with email magic links

**What to build:** Real accounts replace the seeded identity. A visitor signs in with a single-use email link, chooses a unique handle on first sign-in, and gets a session. Public pages stay readable anonymously; every write requires sign-in. The development user switcher remains available locally and is impossible to use in production.

**Blocked by:** 05 — One-command local environment.

**Status:** ready-for-agent

- [ ] Requesting a magic link sends mail through Mailpit locally and the configured production sender; expired or reused links are rejected.
- [ ] First sign-in requires a unique handle; reserved names are blocked; email addresses stay private.
- [ ] Sessions persist across reloads and can be signed out.
- [ ] Creating, annotating, commenting, voting and publishing require a session and return a clear sign-in affordance when absent.
- [ ] Anonymous visitors can still read the Board, published Comparisons, Discussion, Annotations and vote counts.
- [ ] Drafts and Jobs remain author-only and return 404 to everyone else.
- [ ] The development identity switcher works only outside production and is disabled when production starts.
- [ ] Existing seeded Comparisons, Annotations, Comments and Votes remain valid after the transition.
