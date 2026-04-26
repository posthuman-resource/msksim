// Authenticated route group layout.
// This layout is the security checkpoint AND the app shell for every page
// inside app/(auth)/. It calls verifySession() once; children inherit the gate.
//
// Header: msksim wordmark (left) | username + logout (right)
// Nav:    Playground | Experiments | Runs | Guide  with active-route accent
// Main:   {children} on muted bg, container width is per-page (see design-system §5).
//
// The logout form uses a Server Action — no client boundary needed.
// See CLAUDE.md 'Authentication patterns' and docs/design-system.md §6/§7.

import Link from 'next/link';

import { getCurrentUser } from '@/lib/auth/dal';
import { logoutAction } from './actions';
import { NavLink } from './components/nav-link';

// Prevent static pre-rendering of auth routes during `next build`. The DB and
// session secret are unavailable on build machines (e.g. Render.com).
export const dynamic = 'force-dynamic';

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  // verifySession() is called inside getCurrentUser(). Both are wrapped in
  // React's cache() so if a child page also calls verifySession(), there is
  // only one DB round-trip per render pass.
  const user = await getCurrentUser();

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <header className="flex items-center justify-between border-b border-border bg-surface px-6 py-3">
        <Link
          href="/"
          className="font-serif text-xl font-semibold tracking-tight text-fg hover:text-accent"
        >
          msksim
        </Link>
        <div className="flex items-center gap-4">
          <span className="text-sm text-fg-muted">{user.username}</span>
          <form action={logoutAction}>
            <button
              type="submit"
              className="inline-flex items-center rounded-md border border-border-strong bg-surface px-3 py-1 text-sm text-fg hover:bg-surface-muted"
            >
              Log out
            </button>
          </form>
        </div>
      </header>

      <nav aria-label="primary" className="flex gap-6 border-b border-border bg-surface px-6">
        <NavLink href="/playground">Playground</NavLink>
        <NavLink href="/experiments">Experiments</NavLink>
        <NavLink href="/runs">Runs</NavLink>
        <NavLink href="/guide">Guide</NavLink>
      </nav>

      <main className="flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
