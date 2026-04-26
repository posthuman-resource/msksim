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
  if (!d) return '—';
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
    <div className="mx-auto max-w-6xl">
      <header className="border-b border-border pb-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-serif text-2xl font-semibold text-fg">{configName}</h1>
            <p className="mt-1 font-mono text-xs text-fg-muted">
              {run.id.slice(0, 8)} · seed {run.seed} · {run.tickCount} ticks
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium"
              style={{ borderColor: cls.color, color: cls.color }}
            >
              {cls.label}
            </span>
            <Link
              href={`/playground?configId=${run.configId}&seed=${run.seed}`}
              className="inline-flex items-center rounded-md bg-accent px-3.5 py-1.5 text-sm font-medium text-accent-fg hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Reopen in playground
            </Link>
            <Link
              href="/runs"
              className="inline-flex items-center rounded-md border border-border-strong bg-surface px-3.5 py-1.5 text-sm font-medium text-fg hover:bg-surface-muted"
            >
              Back to runs
            </Link>
          </div>
        </div>

        <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-1 font-mono text-xs text-fg-muted">
          <div>
            <dt className="inline text-fg-subtle">started </dt>
            <dd className="inline">{formatTimestamp(run.startedAt)}</dd>
          </div>
          <div>
            <dt className="inline text-fg-subtle">finished </dt>
            <dd className="inline">{formatTimestamp(run.finishedAt)}</dd>
          </div>
          {run.finishedAt && run.startedAt && (
            <div>
              <dt className="inline text-fg-subtle">duration </dt>
              <dd className="inline">
                {((run.finishedAt.getTime() - run.startedAt.getTime()) / 1000).toFixed(1)}s
              </dd>
            </div>
          )}
        </dl>
      </header>

      <div className="mt-6">
        <RunSummaryCard
          summary={summary}
          classification={run.classification as Parameters<typeof formatClassificationLabel>[0]}
        />
      </div>

      <section className="mt-6 rounded-md border border-border bg-surface p-6">
        <h2 className="font-serif text-xl font-semibold text-fg mb-4">Metrics</h2>
        <RunDetailCharts reports={reports} />
      </section>
    </div>
  );
}
