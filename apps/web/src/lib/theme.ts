export const THEME_COOKIE = 'owm-theme';

export type Theme = 'system' | 'light' | 'dark';

/**
 * Resolves the persisted theme choice. Anything other than an explicit
 * "light" or "dark" means "follow the OS", including a missing or tampered
 * cookie.
 */
export function themeFromCookie(value: string | null | undefined): Theme {
  return value === 'light' || value === 'dark' ? value : 'system';
}
