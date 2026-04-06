import 'server-only';

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
      r.finishedAt && r.startedAt
        ? (r.finishedAt.getTime() - r.startedAt.getTime()) / 1000
        : null,
  }));

  const configOptions = allConfigs.map((c) => ({ id: c.id, name: c.name }));

  return (
    <div className="rounded-lg bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-zinc-900">Runs</h1>
        <Link
          href="/playground"
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          New run
        </Link>
      </div>
      <RunsTable
        rows={rows}
        configs={configOptions}
        activeSort={orderBy}
        pagination={{ page, total }}
      />
    </div>
  );
}
