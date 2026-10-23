export type AppUrlEnv = Record<string, string | undefined>;

/**
 * Reads the public app URL at runtime. `NEXT_PUBLIC_` is accepted for older
 * local `.env` files, but production uses `APP_URL` because Next inlines
 * `NEXT_PUBLIC_*` values into the bundle at build time — fatal for a standalone
 * image built once and deployed to more than one hostname.
 */
export function configuredAppUrl(env: AppUrlEnv = process.env): string | undefined {
  return env.APP_URL?.trim() || env.NEXT_PUBLIC_APP_URL?.trim() || undefined;
}
