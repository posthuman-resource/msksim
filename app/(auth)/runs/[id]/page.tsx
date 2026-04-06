import 'server-only';

import Link from 'next/link';
import { notFound } from 'next/navigation';

import { verifySession } from '@/lib/auth/dal';
import { getRun } from '@/lib/db/runs';
import { loadConfig } from '@/lib/db/configs';
import { loadTickMetrics } from '@/lib/db/tick-metrics';
import { materializeTickReports, formatClassificationLabel } from '@/lib/sim/metrics/serialize';
import type { RunSummary } from '@/lib/sim/metrics/types';
import { RunSummaryCard } from '../run-summary-card';
import { RunDetailCharts } from './run-detail-charts';

function formatTimestamp(d: Date | null): string {
  if (!d) return '-';
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await verifySession();
  const { id } = await params;

  const run = await getRun(id);
  if (!run) notFound();

  const configResult = await loadConfig(run.configId);
  const configName = configResult?.row.name ?? '(deleted config)';

  const metricRows = await loadTickMetrics(run.id);
  const reports = materializeTickReports(metricRows);

  const summary: RunSummary | null = run.summaryJson
    ? (JSON.parse(run.summaryJson) as RunSummary)
    : null;

  const cls = formatClassificationLabel(
    run.classification as Parameters<typeof formatClassificationLabel>[0],
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Header card */}
      <div className="rounded-lg bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div>
            <h1 className="text-xl font-bold text-zinc-900">{configName}</h1>
            <p className="text-sm text-zinc-500 mt-1">
              Run {run.id.slice(0, 8)} &middot; Seed {run.seed} &middot; {run.tickCount} ticks
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span
              className="inline-block rounded px-2 py-0.5 text-xs font-semibold text-white"
              style={{ backgroundColor: cls.color }}
            >
              {cls.label}
            </span>
            <Link
              href={`/playground?configId=${run.configId}&seed=${run.seed}`}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              Reopen in playground
            </Link>
            <Link
              href="/runs"
              className="rounded border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              Back to runs
            </Link>
          </div>
        </div>

        <div className="flex flex-wrap gap-6 text-sm text-zinc-500">
          <div>
            <span className="font-medium text-zinc-700">Started:</span>{' '}
            {formatTimestamp(run.startedAt)}
          </div>
          <div>
            <span className="font-medium text-zinc-700">Finished:</span>{' '}
            {formatTimestamp(run.finishedAt)}
          </div>
          {run.finishedAt && run.startedAt && (
            <div>
              <span className="font-medium text-zinc-700">Duration:</span>{' '}
              {((run.finishedAt.getTime() - run.startedAt.getTime()) / 1000).toFixed(1)}s
            </div>
          )}
        </div>
      </div>

      {/* Summary card */}
      <RunSummaryCard
        summary={summary}
        classification={run.classification as Parameters<typeof formatClassificationLabel>[0]}
      />

      {/* Metrics dashboard — reused from playground */}
      <div className="rounded-lg bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-zinc-900 mb-4">Metrics</h2>
        <RunDetailCharts reports={reports} />
      </div>
    </div>
  );
}
