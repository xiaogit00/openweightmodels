/** Only same-origin, absolute paths are valid post-auth destinations. */
export function safeNextPath(value: string | null | undefined) {
  if (!value) return '/';
  // `//host` and `/\host` are protocol-relative or browser-normalised
  // off-site; control characters are stripped by URL parsing and can do the
  // same (`/\t/evil.test`), so reject them too.
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return '/';
  return value;
}

export function signInPath(next?: string | null) {
  const target = safeNextPath(next);
  return target === '/' ? '/sign-in' : `/sign-in?next=${encodeURIComponent(target)}`;
}
