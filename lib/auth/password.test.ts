import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { hashPassword, verifyPassword } from './password';

// Stub env before importing the db client so lib/env.ts parses the right values.
vi.stubEnv('MSKSIM_DB_PATH', ':memory:');
vi.stubEnv('MSKSIM_SESSION_SECRET', 'a'.repeat(48));

const { db, sqlite } = await import('@/lib/db/client');

describe('password', () => {
  it('hash shape', async () => {
    const h = await hashPassword('foo');
    expect(h).toMatch(/^\$argon2(id|i|d)\$/);
  });

  it('roundtrip', async () => {
    expect(await verifyPassword('foo', await hashPassword('foo'))).toBe(true);
  });

  it('wrong password fails', async () => {
    expect(await verifyPassword('bar', await hashPassword('foo'))).toBe(false);
  });

  it('unique salts produce different hashes', async () => {
    const a = await hashPassword('foo');
    const b = await hashPassword('foo');
    expect(a).not.toBe(b);
  });
});

describe('users table insert roundtrip', () => {
  beforeAll(async () => {
    const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
    migrate(db, { migrationsFolder: './db/migrations' });
  });

  afterAll(() => {
    sqlite.close();
    vi.unstubAllEnvs();
  });

  it('inserts a user row and verifies the stored password hash', async () => {
    const { users } = await import('@/db/schema');
    const { eq } = await import('drizzle-orm');

    const plain = 'correct horse';
    const passwordHash = await hashPassword(plain);

    await db.insert(users).values({ username: 'alice', passwordHash });

    const [row] = await db.select().from(users).where(eq(users.username, 'alice'));

    expect(row).toBeDefined();
    expect(row.id).toBeTruthy();
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.updatedAt).toBeInstanceOf(Date);
    expect(await verifyPassword(plain, row.passwordHash)).toBe(true);
  });
});
