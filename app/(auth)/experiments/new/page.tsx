import 'server-only';

// New experiment config page.
// Renders an empty ConfigEditor seeded from ExperimentConfig.parse({}) defaults.
// verifySession() is called directly per CLAUDE.md 'Authentication patterns'.
// Page archetype: Form (docs/design-system.md §7).

import type { Metadata } from 'next';

import { verifySession } from '@/lib/auth/dal';
import { ExperimentConfig } from '@/lib/schema/experiment';
import { ConfigEditor } from '../ConfigEditor';

export const metadata: Metadata = { title: 'msksim — new config' };

export default async function NewConfigPage() {
  await verifySession();

  const defaults = ExperimentConfig.parse({});

  return (
    <div className="mx-auto max-w-6xl">
      <header className="border-b border-border pb-4">
        <h1 className="font-serif text-2xl font-semibold text-fg">New configuration</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Fill in the fields below and click Save to create a new experiment configuration.
        </p>
      </header>
      <div className="mt-6 rounded-md border border-border bg-surface p-6">
        <ConfigEditor mode="new" initialValues={defaults} />
      </div>
    </div>
  );
}
