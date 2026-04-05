// Pure, side-effect-free helpers for the login flow.
// No 'use server', no 'import server-only' — intentionally importable by
// both client components and unit tests.

import { z } from 'zod';

// ----- Types ----------------------------------------------------------------

export type LoginState = { message: string } | undefined;

// ----- Validation -----------------------------------------------------------

const LoginInputSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  next: z.string().optional(),
});

export type LoginInput = z.infer<typeof LoginInputSchema>;

/**
 * Parses and validates the raw FormData from the login form.
 * Returns `{ ok: true, data }` on success or `{ ok: false }` on any failure.
 */
export function validateLoginInput(
  formData: FormData,
): { ok: true; data: LoginInput } | { ok: false } {
  const raw = {
    username: formData.get('username'),
    password: formData.get('password'),
    next: formData.get('next') ?? undefined,
  };
  const result = LoginInputSchema.safeParse(raw);
  if (!result.success) return { ok: false };
  return { ok: true, data: result.data };
}

// ----- Redirect safety -------------------------------------------------------

/**
 * Accepts a `next` redirect target and returns it only if it is a safe
 * relative path. Rejects:
 *   - absolute URLs (http://, https://, //)
 *   - protocol-relative URLs (//...)
 *   - javascript: and data: schemes
 *   - strings containing CRLF characters (header injection)
 *   - empty / null / undefined inputs
 *
 * Pattern: must start with a single `/` followed by a non-slash character.
 * This is the classic open-redirect guard.
 */
export function sanitizeNext(next: string | undefined | null): string | null {
  if (next == null || next === '') return null;
  // Reject CRLF (header injection)
  if (/[\r\n]/.test(next)) return null;
  // Reject protocol-relative (//evil.example) and absolute URLs
  if (/^\/\//.test(next)) return null;
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(next)) return null;
  // Must start with exactly one slash followed by a non-slash
  if (!/^\/[^/]/.test(next)) return null;
  return next;
}
