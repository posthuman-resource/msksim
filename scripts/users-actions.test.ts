// @vitest-environment node

// IMPORTANT: env stubs must be set BEFORE any import of @/lib/db/client.
// The client is a module-level singleton that reads MSKSIM_DB_PATH at import
// time. Dynamic imports below ensure the stub is in place first.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubEnv('MSKSIM_DB_PATH', ':memory:');
vi.stubEnv('MSKSIM_SESSION_SECRET', 'a'.repeat(48));

// All imports below this line are safe to static-import because vitest
// processes vi.stubEnv before running module-level code in the same file.
// However, the server modules we import re-export from @/lib/db/client, which
// is a singleton that caches its connection at module-load time. vitest shares
// the module registry across tests in a file, so one `:memory:` db is shared
// across all cases in this suite — that is fine; we truncate between tests.

const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
const { db } = await import('@/lib/db/client');
const { users } = await import('@/db/schema');
const { sessions } = await import('@/db/schema');
const { verifyPassword } = await import('@/lib/auth/password');
const {
  addUser,
  removeUser,
  listUsers,
  changePassword,
  UserAlreadyExistsError,
  UserNotFoundError,
} = await import('./users-actions');
const { eq } = await import('drizzle-orm');

// Apply all migrations once before any tests run.
migrate(db, { migrationsFolder: './db/migrations' });

beforeEach(() => {
  // Truncate both tables between tests for a clean slate.
  // Delete sessions first (FK child), then users (FK parent).
  db.delete(sessions).run();
  db.delete(users).run();
});

describe('addUser', () => {
  it('inserts a row with a correctly formatted Argon2id hash', async () => {
    await addUser('alice', 'correct horse', db);

    const rows = db.select().from(users).where(eq(users.username, 'alice')).all();
    expect(rows).toHaveLength(1);

    const row = rows[0];
    expect(row.username).toBe('alice');
    expect(row.passwordHash).toMatch(/^\$argon2(id|i|d)\$/);
    expect(row.id).toBeTruthy();
    // createdAt is stored as a Date (integer timestamp_ms mode in schema)
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(Math.abs(Date.now() - row.createdAt.getTime())).toBeLessThan(5000);
  });

  it('throws UserAlreadyExistsError for a duplicate username', async () => {
    await addUser('alice', 'foo', db);

    const originalRows = db.select().from(users).where(eq(users.username, 'alice')).all();
    const originalHash = originalRows[0].passwordHash;

    await expect(addUser('alice', 'bar', db)).rejects.toThrow(UserAlreadyExistsError);

    // Row count must still be 1 and hash must be unchanged
    const afterRows = db.select().from(users).where(eq(users.username, 'alice')).all();
    expect(afterRows).toHaveLength(1);
    expect(afterRows[0].passwordHash).toBe(originalHash);

    // Error message must name the user and include "exists"
    await expect(addUser('alice', 'bar', db)).rejects.toThrow(/alice/);
    await expect(addUser('alice', 'bar', db)).rejects.toThrow(/exists/);
  });
});

describe('listUsers', () => {
  it('returns usernames sorted alphabetically and does not leak hashes', async () => {
    await addUser('charlie', 'pass', db);
    await addUser('alice', 'pass', db);
    await addUser('bob', 'pass', db);

    const out = await listUsers(db);
    expect(out).toEqual(['alice', 'bob', 'charlie']);
    expect(out.some((s) => s.includes('$argon2'))).toBe(false);

    // Idempotent: calling again returns the same result
    expect(await listUsers(db)).toEqual(['alice', 'bob', 'charlie']);
  });

  it('returns an empty array on an empty table', async () => {
    expect(await listUsers(db)).toEqual([]);
  });
});

describe('removeUser', () => {
  it('deletes the row and returns without throwing', async () => {
    await addUser('alice', 'pass', db);
    await removeUser('alice', db);

    const rows = db.select().from(users).where(eq(users.username, 'alice')).all();
    expect(rows).toHaveLength(0);
    expect(await listUsers(db)).toHaveLength(0);
  });

  it('throws UserNotFoundError for a nonexistent user', async () => {
    await expect(removeUser('ghost', db)).rejects.toThrow(UserNotFoundError);
    await expect(removeUser('ghost', db)).rejects.toThrow(/ghost/);
    await expect(removeUser('ghost', db)).rejects.toThrow(/not found/);
  });
});

describe('changePassword', () => {
  it('updates the hash; new password verifies, old does not', async () => {
    await addUser('alice', 'old-pass', db);

    const beforeRows = db.select().from(users).where(eq(users.username, 'alice')).all();
    const oldHash = beforeRows[0].passwordHash;

    await changePassword('alice', 'new-pass', db);

    const afterRows = db.select().from(users).where(eq(users.username, 'alice')).all();
    const newHash = afterRows[0].passwordHash;

    expect(newHash).not.toBe(oldHash);
    expect(await verifyPassword('new-pass', newHash)).toBe(true);
    expect(await verifyPassword('old-pass', newHash)).toBe(false);
  });

  it('throws UserNotFoundError for a nonexistent user', async () => {
    await expect(changePassword('ghost', 'whatever', db)).rejects.toThrow(UserNotFoundError);
    await expect(changePassword('ghost', 'whatever', db)).rejects.toThrow(/ghost/);
  });
});

describe('removeUser cascade', () => {
  it('deletes associated sessions when a user is removed (FK cascade)', async () => {
    await addUser('alice', 'pass', db);
    const userRows = db.select({ id: users.id }).from(users).where(eq(users.username, 'alice')).all();
    const userId = userRows[0].id;

    // Insert a session row directly
    const fakeToken = 't'.repeat(64);
    db.insert(sessions).values({
      id: fakeToken,
      userId,
      expiresAt: new Date(Date.now() + 86400_000),
    }).run();

    const sessionsBefore = db.select().from(sessions).where(eq(sessions.userId, userId)).all();
    expect(sessionsBefore).toHaveLength(1);

    await removeUser('alice', db);

    const sessionsAfter = db.select().from(sessions).all();
    expect(sessionsAfter).toHaveLength(0);
  });
});
