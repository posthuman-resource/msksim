// Login page — Server Component.
// This is the ONLY page in the app that must be reachable unauthenticated.
// It does NOT import from lib/db/, lib/auth/dal.ts, or call verifySession().
// The proxy.ts allowlist includes /login so no redirect loop occurs.
//
// Layout: single-card archetype per docs/design-system.md §7 (Auth single).

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
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="font-serif text-3xl font-semibold tracking-tight text-fg">msksim</h1>
          <p className="mt-2 text-sm text-fg-muted">Sign in to continue</p>
        </div>
        <div className="rounded-md border border-border bg-surface p-6">
          <LoginForm next={safeNext} />
        </div>
      </div>
    </div>
  );
}
