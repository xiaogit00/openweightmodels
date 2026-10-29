import { headers } from 'next/headers';
import {
  consumeRateLimit,
  intFromEnv,
  rateLimitKey,
  tooMany,
  type RateLimitRule,
} from '@owm/core';

/**
 * The ALB *appends* the peer it accepted the connection from to
 * `x-forwarded-for`; anything to the left is client-supplied and spoofable, so
 * take the right-most entry. Local Next.js has no proxy, so fall back to the
 * direct header and finally a shared bucket.
 */
export function clientIp(headerList: Pick<Headers, 'get'>): string {
  const forwarded = headerList
    .get('x-forwarded-for')
    ?.split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .at(-1);
  return (
    forwarded ||
    headerList.get('x-real-ip')?.trim() ||
    'unknown'
  );
}

function writeRule(): RateLimitRule {
  return {
    window: intFromEnv(process.env.WRITE_RATE_LIMIT_WINDOW_SECONDS, 60),
    max: intFromEnv(process.env.WRITE_RATE_LIMIT_PER_USER, 60),
  };
}

function writeIpRule(): RateLimitRule {
  return {
    window: intFromEnv(process.env.WRITE_RATE_LIMIT_WINDOW_SECONDS, 60),
    max: intFromEnv(process.env.WRITE_RATE_LIMIT_PER_IP, 120),
  };
}

function runRule(): RateLimitRule {
  return {
    window: intFromEnv(process.env.RUN_RATE_LIMIT_WINDOW_SECONDS, 60),
    max: intFromEnv(process.env.RUN_RATE_LIMIT_PER_USER, 6),
  };
}

function runIpRule(): RateLimitRule {
  return {
    window: intFromEnv(process.env.RUN_RATE_LIMIT_WINDOW_SECONDS, 60),
    max: intFromEnv(process.env.RUN_RATE_LIMIT_PER_IP, 12),
  };
}

async function enforce(
  userKey: string,
  ipKey: string,
  userRule: RateLimitRule,
  ipRule: RateLimitRule,
  messages: { user: string; ip: string },
) {
  const [byUser, byIp] = await Promise.all([
    consumeRateLimit(userKey, userRule),
    consumeRateLimit(ipKey, ipRule),
  ]);

  if (!byUser.allowed) {
    throw tooMany(messages.user, byUser.retryAfterSeconds);
  }
  if (!byIp.allowed) {
    throw tooMany(messages.ip, byIp.retryAfterSeconds);
  }
}

/**
 * Every authenticated write passes through `requireUser()`, which calls this
 * with both the account and the request address. Rate limiting here rather
 * than per route means a new write endpoint cannot forget it.
 */
export async function enforceWriteLimit(userId: string) {
  const ip = clientIp(await headers());
  await enforce(
    rateLimitKey('write:user', userId),
    rateLimitKey('write:ip', ip),
    writeRule(),
    writeIpRule(),
    {
      user: 'You are writing too quickly.',
      ip: 'Too many writes are coming from this network.',
    },
  );
}

/**
 * Generation also costs provider money. This is stricter than a normal write
 * and sits on top of the per-user hourly/daily quotas in the Comparison service.
 */
export async function enforceRunLimit(userId: string) {
  const ip = clientIp(await headers());
  await enforce(
    rateLimitKey('generate:user', userId),
    rateLimitKey('generate:ip', ip),
    runRule(),
    runIpRule(),
    {
      user: 'You are starting Runs too quickly.',
      ip: 'Too many Runs are starting from this network.',
    },
  );
}

/** Magic-link mail is limited per address as well as per IP (plugin rule). */
export async function enforceMagicLinkEmailLimit(email: string) {
  const rule: RateLimitRule = {
    window: intFromEnv(process.env.MAGIC_LINK_EMAIL_WINDOW_SECONDS, 900),
    max: intFromEnv(process.env.MAGIC_LINK_EMAIL_MAX, 3),
  };
  const decision = await consumeRateLimit(
    rateLimitKey('magic-link:email', email.trim().toLowerCase()),
    rule,
  );
  if (!decision.allowed) {
    throw tooMany('Too many sign-in links were requested for this address.', decision.retryAfterSeconds);
  }
}
