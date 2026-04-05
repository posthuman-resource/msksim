'use server';
import 'server-only';

// Login Server Action.
// File-level 'use server' marks all exports as Server Actions. This allows
// LoginForm.tsx (a Client Component) to import `loginAction` without bundling
// the server-side modules. Pure helpers (validateLoginInput, sanitizeNext) live
// in ./helpers.ts which has no server directives and is importable everywhere.
//
// See CLAUDE.md 'Authentication patterns' for the layering contract.
// See docs/plan/07-login-and-app-shell.md §7 (Slice 1) for design rationale.
// See: node_modules/next/dist/docs/01-app/02-guides/authentication.md
//      § Validate form fields on the server

import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import { users } from '@/db/schema';
import { db } from '@/lib/db/client';
import { verifyPassword } from '@/lib/auth/password';
import {
  createSession,
  setSessionCookie,
} from '@/lib/auth/sessions';

import { validateLoginInput, sanitizeNext } from './helpers';
import type { LoginState } from './helpers';

// Every failure path returns this constant so the response does not leak
// whether the username or the password was wrong (timing-attack partial
// mitigation). This makes the invariant a grep-able fact.
const GENERIC_AUTH_ERROR: LoginState = { message: 'invalid credentials' };

/**
 * Login Server Action.
 *
 * Called by LoginForm via `useActionState(loginAction, undefined)`.
 * Returns `LoginState` on failure; calls `redirect()` on success (never returns).
 *
 * `redirect()` is called OUTSIDE any try/catch because it throws a special
 * NEXT_REDIRECT error that must propagate to the Next.js runtime.
 * See: node_modules/next/dist/docs/01-app/03-api-reference/04-functions/redirect.md
 */
export async function loginAction(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  // Step 1 — validate form data. Treat any validation failure as an auth
  // failure so the response does not leak whether a field was malformed vs wrong.
  const parsed = validateLoginInput(formData);
  if (!parsed.ok) return GENERIC_AUTH_ERROR;

  const { username, password, next } = parsed.data;

  // Steps 2-6 — look up user and check password.
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.username, username))
    .limit(1);
  const user = rows[0];

  if (!user) {
    // TODO: constant-time user-not-found path; see CLAUDE.md 'Authentication patterns'.
    // For now, returning early leaks a timing signal that the username is unknown.
    // Threat model: two researchers on a local machine — acceptable for v1.
    return GENERIC_AUTH_ERROR;
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return GENERIC_AUTH_ERROR;

  // Step 7 — create session and set cookie.
  const { token, expiresAt } = await createSession(user.id);
  await setSessionCookie(token, expiresAt);

  // Step 8 — redirect OUTSIDE try/catch so NEXT_REDIRECT propagates correctly.
  redirect(sanitizeNext(next) ?? '/');
}
