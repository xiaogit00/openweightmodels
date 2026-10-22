/**
 * Handles are the public identity (GLOSSARY.md). They are lowercase, URL-safe
 * and deliberately human-readable. Reserved words are blocked so a handle can
 * never shadow a route or impersonate the platform.
 */

export const HANDLE_MIN_LENGTH = 3;
export const HANDLE_MAX_LENGTH = 30;

export const RESERVED_HANDLES = new Set([
  'about',
  'account',
  'admin',
  'administrator',
  'api',
  'auth',
  'board',
  'compare',
  'comparisons',
  'contact',
  'deleted',
  'help',
  'home',
  'job',
  'jobs',
  'login',
  'logout',
  'me',
  'moderator',
  'new',
  'notifications',
  'onboarding',
  'openweightmodels',
  'privacy',
  'root',
  'settings',
  'signin',
  'sign-in',
  'signout',
  'sign-out',
  'support',
  'system',
  'terms',
  'user',
]);

export type HandleCheck = { ok: true; handle: string } | { ok: false; message: string };

/**
 * Normalises and validates a proposed handle. Callers must still check
 * uniqueness against `users.handle`.
 */
export function checkHandle(input: string): HandleCheck {
  const handle = input.trim().toLowerCase();

  if (!handle) return { ok: false, message: 'Choose a handle.' };
  if (handle.length < HANDLE_MIN_LENGTH) {
    return { ok: false, message: `Handles need at least ${HANDLE_MIN_LENGTH} characters.` };
  }
  if (handle.length > HANDLE_MAX_LENGTH) {
    return { ok: false, message: `Handles can be at most ${HANDLE_MAX_LENGTH} characters.` };
  }
  if (!/^[a-z0-9][a-z0-9_-]*[a-z0-9]$/.test(handle)) {
    return {
      ok: false,
      message: 'Use lowercase letters, numbers, hyphens or underscores, starting and ending with a letter or number.',
    };
  }
  if (RESERVED_HANDLES.has(handle)) {
    return { ok: false, message: 'That handle is reserved. Choose another.' };
  }
  return { ok: true, handle };
}
