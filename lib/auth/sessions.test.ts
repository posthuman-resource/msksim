import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Stub env before any module that reads process.env at load time.
vi.stubEnv('MSKSIM_DB_PATH', ':memory:');
vi.stubEnv('MSKSIM_SESSION_SECRET', 'a'.repeat(48));

// Hoist the cookie store so it is available inside the vi.mock factory.
// vi.hoisted() ensures the value is created before mock hoisting runs.
const cookieStore = vi.hoisted(() => new Map<string, string>());

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const val = cookieStore.get(name);
      return val !== undefined ? { value: val } : undefined;
    },
    set: (name: string, value: string) => {
      cookieStore.set(name, value);
    },
    delete: (name: string) => {
      cookieStore.delete(name);
    },
  }),
}));

const { db, sqlite } = await import('@/lib/db/client');

const { eq } = await import('drizzle-orm');
const { users } = await import('@/db/schema');
const { sessions } = await import('@/db/schema/sessions');
const {
  createSession,
  validateSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
  getSessionTokenFromCookie,
} = await import('./sessions');

describe('sessions service', () => {
  beforeAll(async () => {
    // Fake only Date so vi.setSystemTime controls Date.now() without breaking
    // setTimeout-based Promise internals.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));

    const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
    migrate(db, { migrationsFolder: './db/migrations' });
  });

  afterAll(() => {
    vi.useRealTimers();
    sqlite.close();
    vi.unstubAllEnvs();
  });

  beforeEach(async () => {
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
    cookieStore.clear();
    // Clear in FK-safe order: sessions first (referenced table), then users.
    await db.delete(sessions);
    await db.delete(users);
  });

  // ── Test 1: happy-path round-trip ──────────────────────────────────────────

  it('create → validate round-trip', async () => {
    const [user] = await db
      .insert(users)
      .values({ username: 'alice', passwordHash: 'hash' })
      .returning();

    const { token, expiresAt } = await createSession(user.id, 3600);

    // Token is a 64-character lowercase hex string (256-bit CSPRNG output).
    expect(token).toMatch(/^[0-9a-f]{64}$/);

    // expiresAt is exactly 1 hour after the fixed start time.
    const expectedMs = new Date('2025-01-01T00:00:00Z').getTime() + 3600 * 1000;
    expect(expiresAt.getTime()).toBe(expectedMs);

    const result = await validateSession(token);
    expect(result).not.toBeNull();
    expect(result!.userId).toBe(user.id);
    expect(result!.expiresAt.getTime()).toBe(expiresAt.getTime());
  });

  // ── Test 2: unknown / malformed tokens return null ─────────────────────────

  it('validate for an unknown token returns null', async () => {
    expect(await validateSession('0'.repeat(64))).toBeNull();
    expect(await validateSession('')).toBeNull();
    expect(await validateSession('not-hex')).toBeNull();
    expect(await validateSession('short')).toBeNull();
  });

  // ── Test 3: expired session returns null; row is NOT deleted ───────────────

  it('validate for an expired session returns null (row still present)', async () => {
    const [user] = await db
      .insert(users)
      .values({ username: 'bob', passwordHash: 'hash' })
      .returning();

    const { token } = await createSession(user.id, 60); // 1-minute TTL

    // Advance virtual time by 2 minutes — session is now past its expiry.
    vi.setSystemTime(new Date('2025-01-01T00:02:00Z'));

    expect(await validateSession(token)).toBeNull();

    // This step does NOT lazily delete expired rows. The row must still exist.
    const rows = await db.select().from(sessions).where(eq(sessions.id, token));
    expect(rows).toHaveLength(1);
  });

  // ── Test 4: destroySession removes the row ─────────────────────────────────

  it('destroy makes validate return null and removes the row', async () => {
    const [user] = await db
      .insert(users)
      .values({ username: 'carol', passwordHash: 'hash' })
      .returning();

    const { token } = await createSession(user.id);

    // Sanity: session is valid before destroy.
    expect(await validateSession(token)).not.toBeNull();

    const before = await db.select().from(sessions);
    await destroySession(token);
    const after = await db.select().from(sessions);

    expect(await validateSession(token)).toBeNull();
    expect(after).toHaveLength(before.length - 1);
  });

  // ── Test 5: two sessions produce distinct tokens ───────────────────────────

  it('two consecutive createSession calls produce distinct tokens', async () => {
    const [user] = await db
      .insert(users)
      .values({ username: 'dave', passwordHash: 'hash' })
      .returning();

    const { token: t1 } = await createSession(user.id);
    const { token: t2 } = await createSession(user.id);

    // Token uniqueness must come from the CSPRNG, not from any time component.
    expect(t1).not.toBe(t2);

    const rows = await db.select().from(sessions).where(eq(sessions.userId, user.id));
    expect(rows).toHaveLength(2);
  });

  // ── Test 6: FK cascade deletes sessions when user is deleted ───────────────

  it('deleting a user cascades to their sessions', async () => {
    // Note: better-sqlite3 defaults to PRAGMA foreign_keys = OFF.
    // lib/db/client.ts sets it ON explicitly after opening the connection.
    // Without that pragma, ON DELETE CASCADE is a silent no-op and this test
    // would fail — indicating client misconfiguration, not a schema bug.
    const [user] = await db
      .insert(users)
      .values({ username: 'eve', passwordHash: 'hash' })
      .returning();

    await createSession(user.id);
    await createSession(user.id);
    await createSession(user.id);

    const before = await db.select().from(sessions).where(eq(sessions.userId, user.id));
    expect(before).toHaveLength(3);

    await db.delete(users).where(eq(users.id, user.id));

    const after = await db.select().from(sessions).where(eq(sessions.userId, user.id));
    expect(after).toHaveLength(0);
  });

  // ── Test 7 (stretch): cookie helper round-trip ────────────────────────────

  it('setSessionCookie → getSessionTokenFromCookie round-trip', async () => {
    const token = 'a'.repeat(64);
    const expiresAt = new Date('2025-01-02T00:00:00Z');

    await setSessionCookie(token, expiresAt);
    expect(await getSessionTokenFromCookie()).toBe(token);

    await clearSessionCookie();
    expect(await getSessionTokenFromCookie()).toBeNull();
  });
});
