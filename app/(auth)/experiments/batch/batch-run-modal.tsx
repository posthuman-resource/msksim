'use client';

import { useState, useEffect, useCallback, useSyncExternalStore, useRef } from 'react';
import { createPortal } from 'react-dom';

import { createWorkerPool } from './worker-pool';
import type { BatchState, ReplicateState } from './worker-pool';
import type { ExperimentConfig } from '@/lib/schema/experiment';
import { persistCompletedRun, persistFailedReplicate } from './actions';
import { HelpTip } from '../../components/help-tip';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ConfigOption {
  id: string;
  name: string;
  config: ExperimentConfig;
}

interface BatchRunModalProps {
  configs: ConfigOption[];
  open: boolean;
  onClose: () => void;
}

// ─── Initial idle state for useSyncExternalStore ─────────────────────────────

const INITIAL_STATE: BatchState = {
  status: 'idle',
  replicates: [],
  config: null,
  baseSeed: 0,
  totalTicks: 0,
  concurrency: 0,
  startedAt: null,
  finishedAt: null,
};

// ─── Progress cell ───────────────────────────────────────────────────────────

function ReplicateCell({ replicate }: { replicate: ReplicateState }) {
  const statusColor: Record<string, string> = {
    pending: 'bg-zinc-100 text-zinc-500',
    running: 'bg-blue-50 text-blue-700',
    completed: 'bg-green-50 text-green-700',
    failed: 'bg-red-50 text-red-700',
    cancelled: 'bg-amber-50 text-amber-700',
  };

  const pct =
    replicate.totalTicks > 0 ? Math.round((replicate.tick / replicate.totalTicks) * 100) : 0;

  return (
    <div
      data-testid={`replicate-${replicate.id}`}
      className={`rounded-lg border p-3 ${statusColor[replicate.status] ?? 'bg-zinc-50'}`}
    >
      <div className="flex items-center justify-between text-xs font-medium">
        <span>Seed {replicate.seed}</span>
        <span data-testid={`replicate-${replicate.id}-status`}>{replicate.status}</span>
      </div>
      {replicate.status === 'running' && (
        <div className="mt-1.5">
          <div className="h-1.5 rounded-full bg-blue-200">
            <div
              className="h-1.5 rounded-full bg-blue-600 transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="mt-0.5 block text-[10px]">
            tick {replicate.tick}/{replicate.totalTicks}
          </span>
        </div>
      )}
      {replicate.status === 'completed' && (
        <span className="mt-1 block text-[10px]">{replicate.tick} ticks</span>
      )}
      {replicate.status === 'failed' && replicate.errorMessage && (
        <span className="mt-1 block text-[10px] text-red-600 truncate">
          {replicate.errorMessage}
        </span>
      )}
    </div>
  );
}

// ─── Main modal ──────────────────────────────────────────────────────────────

export function BatchRunModal({ configs, open, onClose }: BatchRunModalProps) {
  // Form state
  const [selectedConfigId, setSelectedConfigId] = useState<string>('');
  const [replicateCount, setReplicateCount] = useState(3);
  const [baseSeed, setBaseSeed] = useState(1);
  const [totalTicks, setTotalTicks] = useState(50);
  const [concurrency, setConcurrency] = useState(1);

  // Set default concurrency from navigator on mount
  useEffect(() => {
    if (typeof navigator !== 'undefined') {
      setConcurrency(Math.max(1, Math.min(8, (navigator.hardwareConcurrency ?? 2) - 1)));
    }
  }, []);

  // Auto-select first config when configs load
  useEffect(() => {
    if (configs.length > 0 && !selectedConfigId) {
      setSelectedConfigId(configs[0].id);
    }
  }, [configs, selectedConfigId]);

  // Pool ref — persists across renders
  const poolRef = useRef<ReturnType<typeof createWorkerPool> | null>(null);

  useEffect(() => {
    const pool = createWorkerPool({
      persistCompleted: async (args) => {
        return persistCompletedRun(args);
      },
      persistFailed: async (args) => {
        return persistFailedReplicate(args);
      },
    });
    poolRef.current = pool;
    return () => {
      pool.cancelBatch();
      poolRef.current = null;
    };
  }, []);

  // Subscribe to pool state via useSyncExternalStore
  const subscribe = useCallback(
    (cb: () => void) => poolRef.current?.onUpdate(cb) ?? (() => {}),
    [],
  );
  const getSnapshot = useCallback(() => poolRef.current?.getState() ?? INITIAL_STATE, []);
  const batchState = useSyncExternalStore(subscribe, getSnapshot, () => INITIAL_STATE);

  const maxConcurrency =
    typeof navigator !== 'undefined'
      ? Math.max(1, Math.min(8, (navigator.hardwareConcurrency ?? 2) - 1))
      : 1;

  const isRunning = batchState.status === 'running';
  const isTerminal = batchState.status === 'completed' || batchState.status === 'cancelled';

  function handleStart() {
    const selected = configs.find((c) => c.id === selectedConfigId);
    if (!selected || !poolRef.current) return;

    poolRef.current.startBatch({
      config: selected.config,
      configId: selected.id,
      replicateCount,
      baseSeed,
      totalTicks,
      concurrency,
    });
  }

  function handleCancel() {
    poolRef.current?.cancelBatch();
  }

  function handleClose() {
    if (isRunning) return; // must cancel first
    onClose();
  }

  // Overall progress
  const terminal = batchState.replicates.filter(
    (r) => r.status === 'completed' || r.status === 'failed' || r.status === 'cancelled',
  ).length;
  const total = batchState.replicates.length;
  const overallPct = total > 0 ? Math.round((terminal / total) * 100) : 0;

  if (!open) return null;

  const modal = (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/40" onClick={handleClose} />

      {/* Modal */}
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-zinc-900">Batch Run</h2>
          <span data-testid="batch-status-overall" className="text-sm font-medium text-zinc-500">
            {batchState.status}
          </span>
        </div>

        {/* Start form — shown when idle */}
        {batchState.status === 'idle' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Configuration</label>
              <select
                data-testid="batch-config-select"
                className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
                value={selectedConfigId}
                onChange={(e) => setSelectedConfigId(e.target.value)}
              >
                {configs.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">
                  Replicates
                  <HelpTip helpKey="batch.replicates" />
                </label>
                <input
                  data-testid="batch-replicate-count"
                  type="number"
                  min={1}
                  max={50}
                  value={replicateCount}
                  onChange={(e) =>
                    setReplicateCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))
                  }
                  className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">
                  Base seed
                  <HelpTip helpKey="batch.baseSeed" />
                </label>
                <input
                  data-testid="batch-base-seed"
                  type="number"
                  value={baseSeed}
                  onChange={(e) => setBaseSeed(Number(e.target.value) || 1)}
                  className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">
                  Concurrency ({concurrency}/{maxConcurrency})
                  <HelpTip helpKey="batch.concurrency" />
                </label>
                <input
                  data-testid="batch-concurrency"
                  type="range"
                  min={1}
                  max={maxConcurrency}
                  value={concurrency}
                  onChange={(e) => setConcurrency(Number(e.target.value))}
                  className="w-full"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">
                  Total ticks
                  <HelpTip helpKey="batch.totalTicks" />
                </label>
                <input
                  data-testid="batch-total-ticks"
                  type="number"
                  min={1}
                  value={totalTicks}
                  onChange={(e) => setTotalTicks(Math.max(1, Number(e.target.value) || 50))}
                  className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
                />
              </div>
            </div>

            <button
              data-testid="batch-start-button"
              onClick={handleStart}
              disabled={!selectedConfigId}
              className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Start batch
            </button>
          </div>
        )}

        {/* Running / terminal — progress grid */}
        {(isRunning || isTerminal) && (
          <div>
            {/* Overall progress bar */}
            <div className="mb-4">
              <div className="flex items-center justify-between text-xs text-zinc-500 mb-1">
                <span>
                  {terminal} / {total} replicates
                </span>
                <span>{overallPct}%</span>
              </div>
              <div className="h-2 rounded-full bg-zinc-200">
                <div
                  className="h-2 rounded-full bg-blue-600 transition-all"
                  style={{ width: `${overallPct}%` }}
                />
              </div>
            </div>

            {/* Replicate grid */}
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
              {batchState.replicates.map((r) => (
                <ReplicateCell key={r.id} replicate={r} />
              ))}
            </div>

            {/* Action buttons */}
            <div className="mt-4 flex gap-2 justify-end">
              {isRunning && (
                <button
                  data-testid="batch-cancel-button"
                  onClick={handleCancel}
                  className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
                >
                  Cancel batch
                </button>
              )}
              {isTerminal && (
                <button
                  data-testid="batch-close-button"
                  onClick={handleClose}
                  className="rounded-md bg-zinc-600 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
                >
                  Close
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modal, document.body) : null;
}
