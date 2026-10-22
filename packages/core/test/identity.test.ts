import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import {
  DomainError,
  closeDb,
  closeRedis,
  getDb,
  getUserById,
  setHandle,
  users,
} from '../src/index';
import { servicesAvailable } from './index';

const available = await servicesAvailable();
if (!available) {
  console.warn('[tests] Postgres or Redis is unavailable; identity tests skipped');
}

afterAll(async () => {
  await closeRedis();
  await closeDb();
});

async function createAccount(handle: string | null = null) {
  const db = getDb();
  const tag = uuidv7().replace(/-/g, '').slice(-10);
  const [row] = await db
    .insert(users)
    .values({ handle, email: `identity-${tag}@example.test` })
    .returning();
  if (!row) throw new Error('identity fixture was not inserted');
  return {
    id: row.id,
    handle: row.handle,
    async cleanup() {
      await db.delete(users).where(eq(users.id, row.id));
    },
  };
}

async function errorCode(action: () => Promise<unknown>) {
  try {
    await action();
    return null;
  } catch (error) {
    return error instanceof DomainError ? error.code : 'unexpected';
  }
}

describe.skipIf(!available)('handle onboarding', () => {
  it('sets a normalised handle on a first-time account', async () => {
    const account = await createAccount(null);
    try {
      const updated = await setHandle(account.id, 'Onboard-Me ');
      expect(updated.handle).toBe('onboard-me');
      expect((await getUserById(account.id))?.handle).toBe('onboard-me');

      // A second claim is refused even for the same account.
      expect(await errorCode(() => setHandle(account.id, 'onboard-me'))).toBe(
        'handle_already_set',
      );
    } finally {
      await account.cleanup();
    }
  });

  it('rejects reserved and malformed handles with a specific code', async () => {
    const account = await createAccount(null);
    try {
      expect(await errorCode(() => setHandle(account.id, 'admin'))).toBe('invalid_handle');
      expect(await errorCode(() => setHandle(account.id, 'no spaces'))).toBe('invalid_handle');
      expect((await getUserById(account.id))?.handle).toBeNull();
    } finally {
      await account.cleanup();
    }
  });

  it('rejects a handle another account already owns, regardless of case', async () => {
    const owner = await createAccount(`owner-${uuidv7().slice(-8)}`);
    const other = await createAccount(null);
    try {
      expect(await errorCode(() => setHandle(other.id, owner.handle!.toUpperCase()))).toBe(
        'handle_taken',
      );
      expect((await getUserById(other.id))?.handle).toBeNull();
    } finally {
      await other.cleanup();
      await owner.cleanup();
    }
  });

  it('allows exactly one of two concurrent first claims', async () => {
    const account = await createAccount(null);
    const tag = uuidv7().replace(/-/g, '').slice(-8);
    try {
      const results = await Promise.allSettled([
        setHandle(account.id, `race-a-${tag}`),
        setHandle(account.id, `race-b-${tag}`),
      ]);
      const fulfilled = results.filter((result) => result.status === 'fulfilled');
      const rejected = results.filter(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]!.reason).toBeInstanceOf(DomainError);
      expect((rejected[0]!.reason as DomainError).code).toBe('handle_already_set');

      const handle = (await getUserById(account.id))?.handle;
      expect([`race-a-${tag}`, `race-b-${tag}`]).toContain(handle);
    } finally {
      await account.cleanup();
    }
  });

  it('treats underscores literally when checking availability', async () => {    const tag = uuidv7().replace(/-/g, '').slice(-8);
    const owner = await createAccount(`a_b-${tag}`);
    const other = await createAccount(null);
    try {
      // `_` is an ILIKE wildcard; it must not match an arbitrary character.
      const updated = await setHandle(other.id, `axb-${tag}`);
      expect(updated.handle).toBe(`axb-${tag}`);
    } finally {
      await other.cleanup();
      await owner.cleanup();
    }
  });
});
