import 'server-only';

// cookies() is async in Next.js v16; forgetting `await` yields a Promise
// whose .get/.set/.delete are undefined and blows up downstream with an opaque
// error. See CLAUDE.md 'Next.js 16 deltas' and 'Known gotchas'. See also:
// node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md
// § Async Request APIs (Breaking change).
import { randomBytes } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { cookies } from 'next/headers';

import { sessions } from '@/db/schema/sessions';
import { db } from '@/lib/db/client';

export const SESSION_COOKIE_NAME = 'msksim_session';
export const DEFAULT_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days = 604_800 s

/**
 * Creates a new server-side session for the given user.
 *
 * Generates a 256-bit (32-byte) CSPRNG token, hex-encoded to 64 characters
 * (well above OWASP's 64-bit entropy floor), inserts a row, and returns the
 * token and expiry. The caller is responsible for calling setSessionCookie.
 */
export async function createSession(
  userId: string,
  ttlSeconds: number = DEFAULT_SESSION_TTL_SECONDS,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  await db.insert(sessions).values({ id: token, userId, expiresAt });

  return { token, expiresAt };
}

/**
 * Validates a session token by primary-key lookup and expiration check.
 *
 * Returns null if the token is unknown or expired. Does NOT delete expired
 * rows — a future sweeper step handles GC. Callers must not rely on
 * post-validation cleanup.
 */
export async function validateSession(
  token: string,
): Promise<{ userId: string; expiresAt: Date } | null> {
  if (!token) return null;

  const [row] = await db.select().from(sessions).where(eq(sessions.id, token)).limit(1);

  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;

  return { userId: row.userId, expiresAt: row.expiresAt };
}

/**
 * Destroys a session row. Idempotent — silently a no-op if token is absent.
 */
export async function destroySession(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, token));
}

/**
 * Sets the session cookie on the response.
 *
 * @remarks Must be called from a Server Action or Route Handler; calling
 * during Server Component render will throw.
 */
export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  (await cookies()).set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

/**
 * Clears the session cookie from the response.
 *
 * @remarks Must be called from a Server Action or Route Handler; calling
 * during Server Component render will throw.
 */
export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE_NAME);
}

/**
 * Reads the session token from the incoming request cookie. Returns null
 * if the cookie is absent.
 */
export async function getSessionTokenFromCookie(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE_NAME)?.value ?? null;
}
