import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { magicLink } from 'better-auth/plugins';
import { nextCookies } from 'better-auth/next-js';
import { cookies, headers } from 'next/headers';
import { uuidv7 } from 'uuidv7';
import {
  DomainError,
  authAccounts,
  authSessions,
  authVerifications,
  getDb,
  getUserByHandle,
  getUserById,
  notFound,
  unauthorized,
  users,
  type UserRow,
} from '@owm/core';
import { MAGIC_LINK_TTL_SECONDS } from './auth-constants';
import { isDevelopmentIdentityAllowed } from './identity-policy';
import { sendMagicLinkEmail } from './mail';

const isProduction = process.env.NODE_ENV === 'production';
const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

function authSecret() {
  const configured = process.env.BETTER_AUTH_SECRET;
  if (configured) return configured;
  // Production must provide a real secret. `next build` evaluates this module
  // without runtime secrets, so allow a placeholder for that phase only.
  if (process.env.NEXT_PHASE === 'phase-production-build') {
    return 'openweightmodels-build-time-placeholder';
  }
  return isProduction ? undefined : 'openweightmodels-development-secret-change-me';
}

function magicLinkRateLimitMax() {
  const configured = Number(process.env.MAGIC_LINK_RATE_LIMIT_MAX);
  return Number.isFinite(configured) && configured > 0 ? configured : 5;
}

/**
 * Email magic-link auth (ADR 0005). Better Auth owns verification tokens,
 * sessions and their cookies; the application `users` row is the identity that
 * Comparisons, Annotations and Comments reference.
 */
export const auth = betterAuth({
  appName: 'OpenWeightModels',
  baseURL: appUrl,
  secret: authSecret(),
  trustedOrigins: [appUrl],
  database: drizzleAdapter(getDb(), {
    provider: 'pg',
    schema: {
      user: users,
      session: authSessions,
      account: authAccounts,
      verification: authVerifications,
    },
  }),
  advanced: {
    database: {
      // Content tables use UUIDv7 keys; auth rows must be UUIDs too.
      generateId: () => uuidv7(),
    },
  },
  user: {
    additionalFields: {
      // Set by our onboarding route, never by the sign-up request body.
      handle: { type: 'string', required: false, input: false },
      role: { type: 'string', required: false, input: false, defaultValue: 'user' },
      avatarUrl: { type: 'string', required: false, input: false },
    },
  },
  plugins: [
    magicLink({
      expiresIn: MAGIC_LINK_TTL_SECONDS,
      // Better Auth's default is 5 requests per 60 seconds per IP. Ticket 16
      // owns production abuse controls; the knob also keeps browser tests fast.
      rateLimit: {
        window: 60,
        max: magicLinkRateLimitMax(),
      },
      // Store only a hash of the token; the emailed URL keeps the raw token.
      storeToken: 'hashed',
      sendMagicLink: async ({ email, url }) => {
        await sendMagicLinkEmail({ email, url });
      },
    }),
    nextCookies(),
  ],
});

/**
 * The single identity seam (BACKEND.md §4). A verified Better Auth session
 * wins; otherwise, in development, the seeded user-switcher cookie provides an
 * identity. The switcher clears any live session when it is used, so it is not
 * masked. Production only ever accepts a session.
 */
export async function getCurrentUser(): Promise<UserRow | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session?.user?.id) {
    const signedIn = await getUserById(session.user.id);
    if (signedIn) return signedIn;
  }

  if (isDevelopmentIdentityAllowed()) {
    const handle = (await cookies()).get('owm_user')?.value;
    if (handle) {
      const switched = await getUserByHandle(handle);
      if (switched) return switched;
    }
  }

  return null;
}

export async function getViewerId() {
  const user = await getCurrentUser();
  return user?.id ?? null;
}

/**
 * Reads that belong to the signed-in user, but do not create content, only
 * require a session — a brand-new account may see its own notifications.
 */
export async function requireSession() {
  const user = await getCurrentUser();
  if (!user) throw unauthorized();
  return user;
}

/**
 * Every content write requires a session. A brand-new account must also pick a
 * handle before it can author content; the UI sends it to `/onboarding`.
 */
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw unauthorized();
  if (user.suspendedAt) {
    throw new DomainError(
      'account_suspended',
      'Your account is suspended, so you cannot post or change content. Contact an Admin if you think this is a mistake.',
      403,
    );
  }
  if (!user.handle) {
    throw new DomainError(
      'handle_required',
      'Choose a handle before you post. Sign in and pick one to continue.',
      403,
    );
  }
  return user;
}

/**
 * Admin surfaces and endpoints are invisible to everyone else: a missing or
 * non-admin actor gets the same 404 as a route that does not exist.
 */
export async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'admin') throw notFound('Not found.');
  return user;
}
