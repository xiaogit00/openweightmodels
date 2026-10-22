/**
 * The development identity switcher and the development magic-link outbox are
 * both local affordances. They are impossible to use when NODE_ENV is
 * production, regardless of ALLOW_DEV_USER_SWITCH.
 */
export function isDevelopmentIdentityAllowed() {
  return (
    process.env.NODE_ENV !== 'production' &&
    process.env.ALLOW_DEV_USER_SWITCH !== 'false'
  );
}
