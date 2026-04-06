'use client';

import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { deleteRunAction } from './actions';
import { formatClassificationLabel } from '@/lib/sim/metrics/serialize';
import type { RunClassification } from '@/db/schema/runs';

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
    <div className="flex flex-wrap items-center gap-3 mb-4">
      <label className="text-sm text-zinc-500">
        Classification:
        <select
          className="ml-1 rounded border border-zinc-300 px-2 py-1 text-sm"
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

      <label className="text-sm text-zinc-500">
        Config:
        <select
          className="ml-1 rounded border border-zinc-300 px-2 py-1 text-sm"
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

      <label className="text-sm text-zinc-500">
        Sort:
        <select
          className="ml-1 rounded border border-zinc-300 px-2 py-1 text-sm"
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
      className="text-red-600 hover:text-red-800 text-sm disabled:opacity-50"
      onClick={() => {
        if (!window.confirm('Delete this run? This cannot be undone.')) return;
        startTransition(async () => {
          await deleteRunAction(id);
        });
      }}
    >
      {isPending ? 'Deleting...' : 'Delete'}
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

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-zinc-500">
              <th className="px-3 py-2 font-medium">ID</th>
              <th className="px-3 py-2 font-medium">Config</th>
              <th className="px-3 py-2 font-medium">Seed</th>
              <th className="px-3 py-2 font-medium">Ticks</th>
              <th className="px-3 py-2 font-medium">Classification</th>
              <th className="px-3 py-2 font-medium">Finished</th>
              <th className="px-3 py-2 font-medium">Duration</th>
              <th className="px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody data-testid="runs-table-body">
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-zinc-400">
                  No runs found.
                </td>
              </tr>
            )}
            {rows.map((row) => {
              const cls = formatClassificationLabel(row.classification);
              return (
                <tr key={row.id} className="border-b border-zinc-100 hover:bg-zinc-50">
                  <td className="px-3 py-2 font-mono text-xs">{row.shortId}</td>
                  <td className="px-3 py-2">{row.configName}</td>
                  <td className="px-3 py-2 font-mono">{row.seed}</td>
                  <td className="px-3 py-2">{row.tickCount}</td>
                  <td className="px-3 py-2">
                    <span
                      className="inline-block rounded px-2 py-0.5 text-xs font-semibold text-white"
                      style={{ backgroundColor: cls.color }}
                    >
                      {cls.label}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs">{row.finishedAt ?? '-'}</td>
                  <td className="px-3 py-2 text-xs">
                    {row.durationSeconds != null ? `${row.durationSeconds.toFixed(1)}s` : '-'}
                  </td>
                  <td className="px-3 py-2 flex gap-2">
                    <Link
                      href={`/runs/${row.id}`}
                      className="text-blue-600 hover:text-blue-800 text-sm"
                    >
                      View
                    </Link>
                    <DeleteButton id={row.id} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-zinc-500">
          <span>
            Showing {pagination.page * 50 + 1}–
            {Math.min((pagination.page + 1) * 50, pagination.total)} of {pagination.total}
          </span>
          <div className="flex gap-2">
            <button
              disabled={pagination.page === 0}
              className="rounded border border-zinc-300 px-3 py-1 disabled:opacity-50"
              onClick={() => goToPage(pagination.page - 1)}
            >
              Previous
            </button>
            <button
              disabled={pagination.page >= totalPages - 1}
              className="rounded border border-zinc-300 px-3 py-1 disabled:opacity-50"
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
