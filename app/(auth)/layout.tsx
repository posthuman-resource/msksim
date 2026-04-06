// Authenticated route group layout.
// This layout is the security checkpoint AND the app shell for every page
// inside app/(auth)/. It calls verifySession() once; children inherit the gate.
//
// Header: msksim brand (left) | username + logout button (right)
// Nav: Playground | Experiments | Runs
// Main: {children}
//
// The logout form uses a Server Action — no client boundary needed.
// See CLAUDE.md 'Authentication patterns'.

import Link from 'next/link';

import { getCurrentUser } from '@/lib/auth/dal';
import { logoutAction } from './actions';

// Prevent static pre-rendering of auth routes during `next build`. The DB and
// session secret are unavailable on build machines (e.g. Render.com).
export const dynamic = 'force-dynamic';

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  // verifySession() is called inside getCurrentUser(). Both are wrapped in
  // React's cache() so if a child page also calls verifySession(), there is
  // only one DB round-trip per render pass.
  const user = await getCurrentUser();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-3">
        <Link href="/" className="text-lg font-bold text-zinc-900 hover:text-zinc-600">
          msksim
        </Link>
        <div className="flex items-center gap-4">
          <span className="text-sm text-zinc-600">{user.username}</span>
          <form action={logoutAction}>
            <button
              type="submit"
              className="rounded-md border border-zinc-300 px-3 py-1 text-sm text-zinc-700 hover:bg-zinc-50"
            >
              Log out
            </button>
          </form>
        </div>
      </header>

      <nav aria-label="primary" className="flex gap-6 border-b border-zinc-100 bg-white px-6 py-2">
        <Link
          href="/playground"
          className="text-sm text-zinc-600 hover:text-zinc-900 hover:underline"
        >
          Playground
        </Link>
        <Link
          href="/experiments"
          className="text-sm text-zinc-600 hover:text-zinc-900 hover:underline"
        >
          Experiments
        </Link>
        <Link href="/runs" className="text-sm text-zinc-600 hover:text-zinc-900 hover:underline">
          Runs
        </Link>
      </nav>

      <main className="flex-1 bg-zinc-50 p-6">{children}</main>
    </div>
  );
}
