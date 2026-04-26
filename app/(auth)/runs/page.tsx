import 'server-only';

// Runs list page.
// Page archetype: List (docs/design-system.md §7).

import Link from 'next/link';

import { verifySession } from '@/lib/auth/dal';
import { listRunsWithConfig, countRuns } from '@/lib/db/runs';
import { listConfigs } from '@/lib/db/configs';
import { RunsTable } from './runs-table';
import type { RunRow } from './runs-table';
import type { RunClassification } from '@/db/schema/runs';

function formatTimestamp(d: Date | null): string | null {
  if (!d) return null;
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

export default async function RunsPage({
  searchParams,
}: {
  searchParams: Promise<{
    classification?: string;
    configId?: string;
    orderBy?: string;
    page?: string;
  }>;
}) {
  await verifySession();
  const params = await searchParams;

  const classification =
    params.classification &&
    ['assimilated', 'segregated', 'mixed', 'inconclusive'].includes(params.classification)
      ? (params.classification as RunClassification)
      : undefined;
  const configId = typeof params.configId === 'string' ? params.configId : undefined;
  const orderBy: 'finishedAt' | 'tickCount' =
    params.orderBy === 'tickCount' ? 'tickCount' : 'finishedAt';
  const page = Math.max(0, Number(params.page) || 0);

  const [runsWithConfig, total, allConfigs] = await Promise.all([
    listRunsWithConfig({
      status: 'completed',
      classification,
      configId,
      orderBy,
      limit: 50,
      offset: page * 50,
    }),
    countRuns({ status: 'completed', classification, configId }),
    listConfigs({ limit: 200 }),
  ]);

  const rows: RunRow[] = runsWithConfig.map((r) => ({
    id: r.id,
    shortId: r.id.slice(0, 8),
    configName: r.configName,
    seed: r.seed,
    tickCount: r.tickCount,
    classification: r.classification as RunClassification | null,
    startedAt: formatTimestamp(r.startedAt) ?? '',
    finishedAt: formatTimestamp(r.finishedAt),
    durationSeconds:
      r.finishedAt && r.startedAt ? (r.finishedAt.getTime() - r.startedAt.getTime()) / 1000 : null,
  }));

  const configOptions = allConfigs.map((c) => ({ id: c.id, name: c.name }));

  return (
    <div className="mx-auto max-w-6xl">
      <header className="flex items-end justify-between border-b border-border pb-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold text-fg">Runs</h1>
          <p className="mt-1 text-sm text-fg-muted">
            {total} completed run{total !== 1 ? 's' : ''}
          </p>
        </div>
        <Link
          href="/playground"
          className="inline-flex items-center rounded-md bg-accent px-3.5 py-1.5 text-sm font-medium text-accent-fg hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          New run
        </Link>
      </header>
      <div className="mt-6">
        <RunsTable
          rows={rows}
          configs={configOptions}
          activeSort={orderBy}
          pagination={{ page, total }}
        />
      </div>
    </div>
  );
}
