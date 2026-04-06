import 'server-only';

// Experiment configs list page.
// Replaces the step-07 stub with a Server Component list of all saved configs.
// verifySession() is called directly per CLAUDE.md 'Authentication patterns'.

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
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-zinc-900">Experiments</h1>
          {rows.length > 0 && (
            <p className="mt-1 text-sm text-zinc-500">
              {rows.length} configuration{rows.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {rows.length > 0 && <BatchRunButton configs={batchConfigs} />}
          <Link
            href="/experiments/new"
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            New config
          </Link>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-zinc-200 bg-white p-12 text-center">
          <p className="text-sm font-medium text-zinc-500">No configurations yet</p>
          <p className="mt-1 text-sm text-zinc-400">
            Create your first experiment configuration to get started.
          </p>
          <Link
            href="/experiments/new"
            className="mt-4 inline-block rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            New config
          </Link>
        </div>
      ) : (
        <div className="rounded-lg bg-white shadow-sm">
          <table className="w-full">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs font-medium text-zinc-500">
                <th className="px-4 pb-3 pt-4">Name</th>
                <th className="pb-3 pr-4 pt-4">Last updated</th>
                <th className="pb-3 pr-4 pt-4">Hash</th>
                <th className="pb-3 pr-4 pt-4">Actions</th>
              </tr>
            </thead>
            <tbody>
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
