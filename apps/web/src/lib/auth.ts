import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { magicLink } from 'better-auth/plugins';
import { nextCookies } from 'better-auth/next-js';
import { APIError } from 'better-auth/api';
import { cookies, headers } from 'next/headers';
import { uuidv7 } from 'uuidv7';
import {
  DomainError,
  authAccounts,
  authSessions,
  authVerifications,
  configuredAppUrl,
  createBetterAuthRateLimitStorage,
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
import { deliverMagicLink } from './magic-link';
import { enforceMagicLinkEmailLimit, enforceWriteLimit } from './rate-limit';

const isProduction = process.env.NODE_ENV === 'production';

function appUrl() {
  const configured = configuredAppUrl();
  if (configured) return configured;
  // `next build` evaluates this module in production mode without runtime
  // configuration; the standalone server always has the value injected.
  if (isProduction && process.env.NEXT_PHASE !== 'phase-production-build') {
    throw new Error('APP_URL is not set');
  }
  return 'http://localhost:3000';
}

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
  baseURL: appUrl(),
  secret: authSecret(),
  trustedOrigins: [appUrl()],
  database: drizzleAdapter(getDb(), {
    provider: 'pg',
    schema: {
      user: users,
      session: authSessions,
      account: authAccounts,
      verification: authVerifications,
    },
  }),
  // Better Auth's built-in buckets are per IP. A Redis-backed custom storage
  // shares them across both web tasks; the magic-link callback adds the
  // per-email bucket the plugin cannot express.
  rateLimit: {
    enabled: isProduction,
    customStorage: createBetterAuthRateLimitStorage(),
    customRules: {
      // Verification is a guessable-token endpoint; allow fewer attempts than
      // a normal sign-in request, and for longer, per IP.
      '/magic-link/verify': { window: 300, max: 10 },
    },
  },
  advanced: {
    database: {
      // Content tables use UUIDv7 keys; auth rows must be UUIDs too.
      generateId: () => uuidv7(),
    },
    ipAddress: {
      // The ALB is the only hop between the internet and the app, and its
      // nodes live in the VPC's private ranges. Treating private peers as
      // trusted proxies makes Better Auth resolve the right-most public
      // `x-forwarded-for` entry instead of a client-supplied spoof.
      trustedProxies: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'],
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
      // Per-IP bucket from Better Auth (5 requests per 60 seconds). Ticket 16
      // adds the per-email bucket in `sendMagicLink` below; `/magic-link/verify`
      // has its own stricter rule in `rateLimit.customRules`.
      rateLimit: {
        window: 60,
        max: magicLinkRateLimitMax(),
      },
      // Store only a hash of the token; the emailed URL keeps the raw token.
      storeToken: 'hashed',
      sendMagicLink: async ({ email, url }) => {
        try {
          await enforceMagicLinkEmailLimit(email);
        } catch (error) {
          if (error instanceof DomainError && error.status === 429) {
            throw new APIError(
              'TOO_MANY_REQUESTS',
              { message: error.message },
              {
                'Retry-After': String(error.retryAfterSeconds ?? 60),
                'X-Retry-After': String(error.retryAfterSeconds ?? 60),
              },
            );
          }
          throw error;
        }
        await deliverMagicLink({ email, url });
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
  // Every authenticated write funnels through here, so one call covers the
  // per-user and per-IP write limit without each route remembering it.
  await enforceWriteLimit(user.id);
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
