# Auth is email magic link

Users sign in with a single-use email link via Better Auth, with Amazon SES in production and Mailpit locally; sessions are cookie-based. A unique handle is chosen on first sign-in. We chose this over GitHub OAuth because the product should not require a developer account, and over a hosted auth provider because keeping auth in-process fits the local-first Docker deployment.

**Considered options**: GitHub OAuth (natural for a developer audience, but excludes everyone else); Auth.js email provider (viable, but Better Auth keeps the magic-link and handle flow in one TypeScript surface); Clerk/Supabase hosted auth (fast, but an external dependency and a second source of user identity); hand-rolled tokens (more security surface for no benefit). Email notifications were rejected separately — magic-link mail is transactional, not a notification system.

**Consequences**: email deliverability becomes an operational dependency, and users without a working email address cannot participate. SES starts in the sandbox, so production access must be requested before launch. There are no passwords to reset. Handles, not email addresses, are the public identity; email addresses stay private. Magic-link request rate limiting and abuse controls remain an open question.
