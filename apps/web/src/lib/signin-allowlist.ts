/**
 * Optional sign-in allowlist, set with `SIGNIN_ALLOWED_EMAILS`.
 *
 * Comma-separated. `alice@example.com` matches one address; `@example.com`
 * matches any address at that domain. Unset or blank means "no restriction",
 * which is the local-development and test default.
 *
 * Malformed entries are ignored rather than trusted, so a typo fails closed
 * (nobody can sign in) instead of silently opening the environment up. An entry
 * list that contains no valid entry therefore blocks every address.
 *
 * This is a deployment control, not a secret: it stops strangers signing in
 * before the account has SES production access, and keeps a public staging URL
 * to the people who are supposed to test it.
 */
export type SigninAllowlist = {
  emails: ReadonlySet<string>;
  domains: readonly string[];
};

const EMAIL_ENTRY = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN_ENTRY = /^@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export function parseSigninAllowlist(
  value: string | null | undefined,
): SigninAllowlist | null {
  const entries = (value ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (entries.length === 0) return null;

  const emails = new Set<string>();
  const domains: string[] = [];
  for (const entry of entries) {
    if (EMAIL_ENTRY.test(entry)) emails.add(entry);
    else if (DOMAIN_ENTRY.test(entry)) domains.push(entry.slice(1));
  }

  return { emails, domains };
}

export function isSigninAllowed(
  email: string,
  allowlist = parseSigninAllowlist(process.env.SIGNIN_ALLOWED_EMAILS),
): boolean {
  if (!allowlist) return true;

  const normalised = email.trim().toLowerCase();
  if (!normalised) return false;
  if (allowlist.emails.has(normalised)) return true;

  const at = normalised.lastIndexOf('@');
  if (at < 0) return false;
  return allowlist.domains.includes(normalised.slice(at + 1));
}
