import 'server-only';

// New experiment config page.
// Renders an empty ConfigEditor seeded from ExperimentConfig.parse({}) defaults.
// verifySession() is called directly per CLAUDE.md 'Authentication patterns'.

import type { Metadata } from 'next';

import { verifySession } from '@/lib/auth/dal';
import { ExperimentConfig } from '@/lib/schema/experiment';
import { ConfigEditor } from '../ConfigEditor';

export const metadata: Metadata = { title: 'msksim — new config' };

export default async function NewConfigPage() {
  await verifySession();

  const defaults = ExperimentConfig.parse({});

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-zinc-900">New configuration</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Fill in the fields below and click Save to create a new experiment configuration.
        </p>
      </div>
      <div className="rounded-lg bg-white p-6 shadow-sm">
        <ConfigEditor mode="new" initialValues={defaults} />
      </div>
    </div>
  );
}
