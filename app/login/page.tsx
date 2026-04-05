// Login page — Server Component.
// This is the ONLY page in the app that must be reachable unauthenticated.
// It does NOT import from lib/db/, lib/auth/dal.ts, or call verifySession().
// The proxy.ts allowlist includes /login so no redirect loop occurs.
//
// searchParams is async in Next.js v16 — ALWAYS await it.
// Forgetting the await yields a Promise-shaped object whose .next is undefined,
// silently losing the post-login redirect target.
// See CLAUDE.md 'Next.js 16 deltas' and 'Known gotchas'.
// See: node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md
//      § Async Request APIs (Breaking change)

import type { Metadata } from 'next';

import { sanitizeNext } from './helpers';
import LoginForm from './LoginForm';

export const metadata: Metadata = {
  title: 'msksim — sign in',
};

export default async function LoginPage(props: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // Next 16: searchParams is a Promise — await is required.
  const sp = await props.searchParams;

  // Coerce array (e.g. ?next=a&next=b) to the first value only.
  const nextRaw = sp.next;
  const nextValue = Array.isArray(nextRaw) ? nextRaw[0] : nextRaw;

  // Sanitize before passing to the form: reject absolute URLs, protocol-relative
  // URLs, javascript: schemes, and CRLF sequences (open-redirect guard).
  const safeNext = sanitizeNext(nextValue) ?? '/';

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4">
      <div className="w-full max-w-md rounded-lg bg-white p-8 shadow">
        <h1 className="mb-6 text-xl font-bold text-zinc-900">
          msksim — sign in
        </h1>
        <LoginForm next={safeNext} />
      </div>
    </div>
  );
}
