import 'server-only';

import { eq } from 'drizzle-orm';

import { db as defaultDb } from '@/lib/db/client';
import { users } from '@/db/schema';
import { hashPassword } from '@/lib/auth/password';

// Type alias for the drizzle DB instance, inferred from the module-level singleton.
type Db = typeof defaultDb;

// ---------------------------------------------------------------------------
// Typed error classes — used by scripts/users.ts to map handler failures to
// the correct exit codes (1 = user-facing error, not a usage error).
// ---------------------------------------------------------------------------

export class UserAlreadyExistsError extends Error {
  constructor(public username: string) {
    super(`user "${username}" already exists`);
    this.name = 'UserAlreadyExistsError';
  }
}

export class UserNotFoundError extends Error {
  constructor(public username: string) {
    super(`user "${username}" not found`);
    this.name = 'UserNotFoundError';
  }
}

// ---------------------------------------------------------------------------
// Handler functions — each accepts an optional `db` for test injection.
// None of these functions write to stdout/stderr; printing is the caller's job.
// ---------------------------------------------------------------------------

/**
 * Create a new user with an Argon2id-hashed password. Throws
 * `UserAlreadyExistsError` if `username` is already taken.
 */
export async function addUser(
  username: string,
  password: string,
  db: Db = defaultDb,
): Promise<void> {
  const existing = db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username))
    .limit(1)
    .all();

  if (existing.length > 0) {
    throw new UserAlreadyExistsError(username);
  }

  const passwordHash = await hashPassword(password);
  db.insert(users).values({ username, passwordHash }).run();
}

/**
 * Delete a user by username. Throws `UserNotFoundError` if no such user exists.
 *
 * Sessions are cleaned up automatically by the `sessions.user_id ON DELETE CASCADE`
 * foreign-key constraint (step 04). This function does NOT issue a separate
 * `DELETE FROM sessions` — the FK cascade is the canonical single source of truth,
 * and duplicating the delete would be error-prone. The cascade requires
 * `PRAGMA foreign_keys = ON`, which `lib/db/client.ts` establishes at
 * module-load time (step 02).
 */
export async function removeUser(username: string, db: Db = defaultDb): Promise<void> {
  const result = db
    .delete(users)
    .where(eq(users.username, username))
    .returning({ id: users.id })
    .all();

  if (result.length === 0) {
    throw new UserNotFoundError(username);
  }
}

/**
 * Return all usernames, sorted alphabetically. Returns an empty array when the
 * table is empty — not an error.
 */
export async function listUsers(db: Db = defaultDb): Promise<string[]> {
  const rows = db.select({ username: users.username }).from(users).orderBy(users.username).all();

  return rows.map((r) => r.username);
}

/**
 * Update a user's password. Throws `UserNotFoundError` if no such user exists.
 *
 * The new password is hashed before the DB write; a hashing failure surfaces
 * before any mutation occurs. The explicit `updatedAt: new Date()` is
 * belt-and-suspenders in case the drizzle `$onUpdateFn` hook does not fire on
 * the test-injected in-memory client.
 */
export async function changePassword(
  username: string,
  newPassword: string,
  db: Db = defaultDb,
): Promise<void> {
  const passwordHash = await hashPassword(newPassword);

  const result = db
    .update(users)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(users.username, username))
    .returning({ id: users.id })
    .all();

  if (result.length === 0) {
    throw new UserNotFoundError(username);
  }
}
