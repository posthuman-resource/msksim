'use server';
import 'server-only';

// Logout Server Action.
// Called from the <form action={logoutAction}> in the authenticated layout header.
// Server Actions in forms do not require a client boundary — the Server Component
// layout can embed this directly.
//
// See CLAUDE.md 'Authentication patterns' §"Logout".
// See: node_modules/next/dist/docs/01-app/02-guides/authentication.md
//      § Deleting the session

import { redirect } from 'next/navigation';

import { clearSessionCookie, destroySession, getSessionTokenFromCookie } from '@/lib/auth/sessions';

/**
 * Destroys the current session and redirects to the login page.
 *
 * Steps:
 *   1. Read the session token from the HttpOnly cookie.
 *   2. Delete the session row (if a token exists).
 *   3. Clear the cookie.
 *   4. Redirect to /login (issues a 303 from a Server Action context).
 *
 * `redirect()` is called outside any try/catch so NEXT_REDIRECT propagates.
 */
export async function logoutAction(): Promise<void> {
  const token = await getSessionTokenFromCookie();
  if (token) {
    await destroySession(token);
  }
  await clearSessionCookie();
  redirect('/login');
}
