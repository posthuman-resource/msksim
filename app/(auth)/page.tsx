import 'server-only';

// Authenticated home page.
// DAL contract: calls verifySession() at the top even though the layout already
// ran it. React's cache() collapses the two calls into one DB lookup per request.
// See CLAUDE.md 'Authentication patterns' and docs/design-system.md §7 (Home archetype).

import Link from 'next/link';

import { getCurrentUser } from '@/lib/auth/dal';

const SHORTCUTS = [
  {
    href: '/playground',
    title: 'Playground',
    body: 'Run a single simulation interactively. Tune live-safe knobs, watch the lattice and graph update tick-by-tick, and explore the seven metrics.',
  },
  {
    href: '/experiments',
    title: 'Experiments',
    body: 'Save and edit reproducible configurations. Run batches and parameter sweeps; compare classification outcomes across seeds.',
  },
  {
    href: '/runs',
    title: 'Runs',
    body: 'Browse completed runs by classification, configuration, and finish time. Inspect convergence trajectories and export CSV/JSON.',
  },
  {
    href: '/guide',
    title: 'Guide',
    body: 'Read the model. Definitions, metrics, classification thresholds, and the full glossary that accompanies the thesis.',
  },
];

export default async function HomePage() {
  // getCurrentUser() calls verifySession() internally.
  const user = await getCurrentUser();

  return (
    <div className="mx-auto max-w-6xl">
      <header className="border-b border-border pb-4">
        <h1 className="font-serif text-3xl font-semibold tracking-tight text-fg">
          Welcome, {user.username}
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-fg-muted">
          An agent-based simulation of a Naming Game studying how color-term communication success
          emerges under geographic and linguistic pressure.
        </p>
      </header>

      <nav
        className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
        aria-label="home shortcuts"
      >
        {SHORTCUTS.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="group rounded-md border border-border bg-surface p-4 transition-colors hover:border-accent"
          >
            <h2 className="font-serif text-lg font-semibold text-fg group-hover:text-accent">
              {s.title}
            </h2>
            <p className="mt-2 text-sm text-fg-muted">{s.body}</p>
          </Link>
        ))}
      </nav>
    </div>
  );
}
