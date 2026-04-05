import 'server-only';

// Authenticated home page.
// DAL contract: calls verifySession() at the top even though the layout already
// ran it. React's cache() collapses the two calls into one DB lookup per request.
// See CLAUDE.md 'Authentication patterns'.

import Link from 'next/link';

import { getCurrentUser } from '@/lib/auth/dal';

export default async function HomePage() {
  // getCurrentUser() calls verifySession() internally.
  const user = await getCurrentUser();

  return (
    <div className="rounded-lg bg-white p-6 shadow-sm">
      <h1 className="text-xl font-bold text-zinc-900">
        Welcome, {user.username}
      </h1>
      <p className="mt-2 text-sm text-zinc-600">
        An agent-based simulation of a Naming Game for studying how color-term
        communication success emerges under geographic and linguistic pressure.
      </p>
      <nav className="mt-6 flex gap-4" aria-label="home shortcuts">
        <Link
          href="/playground"
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
        >
          Playground
        </Link>
        <Link
          href="/experiments"
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
        >
          Experiments
        </Link>
        <Link
          href="/runs"
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
        >
          Runs
        </Link>
      </nav>
    </div>
  );
}
