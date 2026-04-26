'use client';

import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { deleteRunAction } from './actions';
import { formatClassificationLabel } from '@/lib/sim/metrics/serialize';
import type { RunClassification } from '@/db/schema/runs';
import { HelpTip } from '../components/help-tip';

export interface RunRow {
  id: string;
  shortId: string;
  configName: string;
  seed: number;
  tickCount: number;
  classification: RunClassification | null;
  startedAt: string;
  finishedAt: string | null;
  durationSeconds: number | null;
}

interface RunsTableProps {
  rows: RunRow[];
  configs: Array<{ id: string; name: string }>;
  activeSort: 'finishedAt' | 'tickCount';
  pagination: { page: number; total: number };
}

const FILTER_LABEL = 'inline-flex items-center gap-1.5 text-sm text-fg-muted';
const FILTER_SELECT =
  'rounded-md border border-border-strong bg-surface px-2 py-1 text-sm text-fg focus:border-accent focus:outline-none';

function FilterBar({
  configs,
  activeSort,
}: {
  configs: Array<{ id: string; name: string }>;
  activeSort: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    params.delete('page'); // reset pagination on filter change
    router.replace(pathname + '?' + params.toString());
  }

  return (
    <div className="flex flex-wrap items-center gap-3 mb-3">
      <label className={FILTER_LABEL}>
        Classification
        <select
          className={FILTER_SELECT}
          value={searchParams.get('classification') ?? ''}
          onChange={(e) => updateParam('classification', e.target.value)}
        >
          <option value="">All</option>
          <option value="assimilated">Assimilated</option>
          <option value="segregated">Segregated</option>
          <option value="mixed">Mixed</option>
          <option value="inconclusive">Inconclusive</option>
        </select>
      </label>

      <label className={FILTER_LABEL}>
        Config
        <select
          className={FILTER_SELECT}
          value={searchParams.get('configId') ?? ''}
          onChange={(e) => updateParam('configId', e.target.value)}
        >
          <option value="">All</option>
          {configs.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <label className={FILTER_LABEL}>
        Sort
        <select
          className={FILTER_SELECT}
          value={activeSort}
          onChange={(e) => updateParam('orderBy', e.target.value)}
        >
          <option value="finishedAt">Finished at</option>
          <option value="tickCount">Tick count</option>
        </select>
      </label>
    </div>
  );
}

function DeleteButton({ id }: { id: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      disabled={isPending}
      className="inline-flex items-center rounded-md px-2 py-1 text-xs font-medium text-danger hover:bg-danger-bg disabled:opacity-50"
      onClick={() => {
        if (!window.confirm('Delete this run? This cannot be undone.')) return;
        startTransition(async () => {
          await deleteRunAction(id);
        });
      }}
    >
      {isPending ? 'Deleting…' : 'Delete'}
    </button>
  );
}

export function RunsTable({ rows, configs, activeSort, pagination }: RunsTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function goToPage(page: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', String(page));
    router.replace(pathname + '?' + params.toString());
  }

  const totalPages = Math.ceil(pagination.total / 50);

  return (
    <div>
      <FilterBar configs={configs} activeSort={activeSort} />

      <div className="overflow-hidden rounded-md border border-border bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                {[
                  'ID',
                  'Config',
                  'Seed',
                  'Ticks',
                  'Classification',
                  'Finished',
                  'Duration',
                  'Actions',
                ].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-fg-muted"
                  >
                    {h === 'Classification' ? (
                      <>
                        Classification
                        <HelpTip helpKey="runs.classification" />
                      </>
                    ) : h === 'Duration' ? (
                      <>
                        Duration
                        <HelpTip helpKey="runs.duration" />
                      </>
                    ) : (
                      h
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody data-testid="runs-table-body" className="divide-y divide-border">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-fg-subtle">
                    No runs found.
                  </td>
                </tr>
              )}
              {rows.map((row) => {
                const cls = formatClassificationLabel(row.classification);
                return (
                  <tr key={row.id} className="hover:bg-surface-muted">
                    <td className="px-3 py-2 font-mono text-xs text-fg-muted">{row.shortId}</td>
                    <td className="px-3 py-2 text-fg">{row.configName}</td>
                    <td className="px-3 py-2 font-mono text-xs text-fg-muted">{row.seed}</td>
                    <td className="px-3 py-2 font-mono text-xs text-fg-muted">{row.tickCount}</td>
                    <td className="px-3 py-2">
                      <span
                        className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium"
                        style={{ borderColor: cls.color, color: cls.color }}
                      >
                        {cls.label}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-fg-muted">
                      {row.finishedAt ?? '—'}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-fg-muted">
                      {row.durationSeconds != null ? `${row.durationSeconds.toFixed(1)}s` : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-start gap-1">
                        <Link
                          href={`/runs/${row.id}`}
                          className="inline-flex items-center rounded-md px-2 py-1 text-xs font-medium text-fg-muted hover:bg-surface-muted hover:text-fg"
                        >
                          View
                        </Link>
                        <DeleteButton id={row.id} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-fg-muted">
          <span className="font-mono text-xs">
            {pagination.page * 50 + 1}–{Math.min((pagination.page + 1) * 50, pagination.total)} of{' '}
            {pagination.total}
          </span>
          <div className="flex gap-2">
            <button
              disabled={pagination.page === 0}
              className="inline-flex items-center rounded-md border border-border-strong bg-surface px-3 py-1 text-sm text-fg hover:bg-surface-muted disabled:opacity-50"
              onClick={() => goToPage(pagination.page - 1)}
            >
              Previous
            </button>
            <button
              disabled={pagination.page >= totalPages - 1}
              className="inline-flex items-center rounded-md border border-border-strong bg-surface px-3 py-1 text-sm text-fg hover:bg-surface-muted disabled:opacity-50"
              onClick={() => goToPage(pagination.page + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
