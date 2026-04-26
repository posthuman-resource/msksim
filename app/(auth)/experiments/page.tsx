import 'server-only';

// Experiment configs list page.
// Replaces the step-07 stub with a Server Component list of all saved configs.
// verifySession() is called directly per CLAUDE.md 'Authentication patterns'.
// Layout follows docs/design-system.md §6 (page header, table) and §7 (List archetype).

import Link from 'next/link';

import { verifySession } from '@/lib/auth/dal';
import { listConfigs } from '@/lib/db/configs';
import { ExperimentConfig } from '@/lib/schema/experiment';
import { ConfigListItem } from './ConfigListItem';
import { BatchRunButton } from './batch/batch-run-button';

export default async function ExperimentsPage() {
  await verifySession();

  const rows = await listConfigs({ limit: 100 });

  // Parse configs for the batch run button
  const batchConfigs = rows.map((row) => ({
    id: row.id,
    name: row.name,
    config: ExperimentConfig.parse(JSON.parse(row.contentJson)),
  }));

  return (
    <div className="mx-auto max-w-6xl">
      <header className="flex items-end justify-between border-b border-border pb-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold text-fg">Experiments</h1>
          {rows.length > 0 && (
            <p className="mt-1 text-sm text-fg-muted">
              {rows.length} configuration{rows.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {rows.length > 0 && <BatchRunButton configs={batchConfigs} />}
          {rows.length > 0 && (
            <Link
              data-testid="sweep-new-link"
              href="/experiments/sweep/new"
              className="inline-flex items-center rounded-md border border-border-strong bg-surface px-3.5 py-1.5 text-sm font-medium text-fg hover:bg-surface-muted"
            >
              New sweep
            </Link>
          )}
          <Link
            href="/experiments/new"
            className="inline-flex items-center rounded-md bg-accent px-3.5 py-1.5 text-sm font-medium text-accent-fg hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            New config
          </Link>
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="mt-6 rounded-md border border-dashed border-border bg-surface p-12 text-center">
          <p className="text-sm font-medium text-fg-muted">No configurations yet</p>
          <p className="mt-1 text-sm text-fg-subtle">
            Create your first experiment configuration to get started.
          </p>
          <Link
            href="/experiments/new"
            className="mt-4 inline-flex items-center rounded-md bg-accent px-3.5 py-1.5 text-sm font-medium text-accent-fg hover:bg-accent-hover"
          >
            New config
          </Link>
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-md border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-fg-muted">
                  Name
                </th>
                <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-fg-muted">
                  Last updated
                </th>
                <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-fg-muted">
                  Hash
                </th>
                <th className="px-4 py-2.5 text-right text-xs font-medium uppercase tracking-wide text-fg-muted">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <ConfigListItem key={row.id} config={row} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
