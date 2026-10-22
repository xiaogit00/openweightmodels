import { and, eq, isNull, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import { users } from '../db/schema';
import { checkHandle } from '../domain/handle';
import { DomainError, conflict, notFound } from './errors';

function isUniqueViolation(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}

/**
 * Sets the public handle for a signed-in user. Used by first-time onboarding;
 * a user without a handle can read but not write.
 *
 * Only an account that has no handle can claim one: the update carries
 * `handle IS NULL`, so two concurrent onboarding requests cannot overwrite
 * each other after the route's initial check.
 */
export async function setHandle(userId: string, input: string) {
  const checked = checkHandle(input);
  if (!checked.ok) throw new DomainError('invalid_handle', checked.message, 400);

  const db = getDb();
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.handle}) = ${checked.handle}`)
    .limit(1);
  if (existing && existing.id !== userId) {
    throw conflict('handle_taken', 'That handle is already taken.');
  }

  try {
    const [updated] = await db
      .update(users)
      .set({ handle: checked.handle, updatedAt: new Date() })
      .where(and(eq(users.id, userId), isNull(users.handle)))
      .returning();
    if (!updated) {
      const [account] = await db
        .select({ handle: users.handle })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!account) throw notFound('Account not found.');
      throw conflict('handle_already_set', 'Your handle is already set.');
    }
    return updated;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw conflict('handle_taken', 'That handle is already taken.');
    }
    throw error;
  }
}
