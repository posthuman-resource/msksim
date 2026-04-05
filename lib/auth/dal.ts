import 'server-only';

// Data Access Layer — authorization lives here, not in proxy.ts.
// See CLAUDE.md 'Authentication patterns' and 'Next.js 16 deltas from training data'.
// See also:
//   node_modules/next/dist/docs/01-app/02-guides/authentication.md § Creating a Data Access Layer (DAL)
//   node_modules/next/dist/docs/01-app/02-guides/data-security.md § Data Access Layer

import { cache } from 'react'; // NOTE: 'react', NOT 'react/cache' — different ESM entry point

import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import { users } from '@/db/schema';
import { db } from '@/lib/db/client';
import {
  getSessionTokenFromCookie,
  validateSession,
} from '@/lib/auth/sessions';

export type Session = { userId: string; expiresAt: Date };

/**
 * Verifies the current request's session and returns the session data.
 *
 * Wrapped in React's `cache()` so multiple components calling `verifySession()`
 * in the same render tree resolve to a single DB lookup. The cache is
 * per-request — each new server request starts fresh. Zero-argument calls all
 * collapse to the same cache key by identity (Object.is).
 *
 * Note: React's `cache()` re-throws errors from every call site that shares the
 * same key. If the first call throws `NEXT_REDIRECT`, every subsequent call in
 * the same render pass re-throws it — that is the intended propagation behavior.
 *
 * @throws NEXT_REDIRECT to /login if the session is missing or invalid.
 */
export const verifySession = cache(async (): Promise<Session> => {
  const token = await getSessionTokenFromCookie();

  if (token == null) {
    redirect('/login');
  }

  const session = await validateSession(token);

  if (session == null) {
    redirect('/login');
  }

  return { userId: session.userId, expiresAt: session.expiresAt };
});

/**
 * Returns the current user's id, username, and session expiry.
 *
 * Calls `verifySession()` internally (which is itself cached), so calling both
 * `verifySession()` and `getCurrentUser()` in the same render tree results in
 * exactly one `validateSession` DB call.
 *
 * Useful for header components that need the username without re-verifying the
 * session independently.
 *
 * @throws NEXT_REDIRECT to /login if the session is missing, invalid, or the
 *   user row has been deleted since the session was created.
 */
export const getCurrentUser = cache(
  async (): Promise<{ userId: string; username: string; expiresAt: Date }> => {
    const session = await verifySession();

    const [row] = await db
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1);

    // Belt-and-braces: the FK cascade from step 04 makes this unreachable under
    // normal operation, but a deleted-user race or a manual DB edit could land here.
    if (!row) {
      redirect('/login');
    }

    return { userId: row.id, username: row.username, expiresAt: session.expiresAt };
  },
);
