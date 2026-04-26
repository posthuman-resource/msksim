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
    pending: 'bg-surface-muted text-fg-muted',
    running: 'bg-accent-soft text-accent',
    completed: 'bg-success-bg text-success',
    failed: 'bg-danger-bg text-danger',
    cancelled: 'bg-warn-bg text-warn',
  };

  const pct =
    replicate.totalTicks > 0 ? Math.round((replicate.tick / replicate.totalTicks) * 100) : 0;

  return (
    <div
      data-testid={`replicate-${replicate.id}`}
      className={`rounded-md border border-border p-3 ${statusColor[replicate.status] ?? 'bg-surface-muted'}`}
    >
      <div className="flex items-center justify-between text-xs font-medium">
        <span className="font-mono">Seed {replicate.seed}</span>
        <span data-testid={`replicate-${replicate.id}-status`}>{replicate.status}</span>
      </div>
      {replicate.status === 'running' && (
        <div className="mt-1.5">
          <div className="h-1.5 rounded-full bg-surface-muted">
            <div
              className="h-1.5 rounded-full bg-accent transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="mt-0.5 block text-[10px] font-mono">
            tick {replicate.tick}/{replicate.totalTicks}
          </span>
        </div>
      )}
      {replicate.status === 'completed' && (
        <span className="mt-1 block text-[10px] font-mono">{replicate.tick} ticks</span>
      )}
      {replicate.status === 'failed' && replicate.errorMessage && (
        <span className="mt-1 block text-[10px] text-danger truncate">
          {replicate.errorMessage}
        </span>
      )}
    </div>
  );
}

// ─── Main modal ──────────────────────────────────────────────────────────────

export function BatchRunModal({ configs, open, onClose }: BatchRunModalProps) {
  // Form state
  const [selectedConfigIdState, setSelectedConfigId] = useState<string>('');
  const [replicateCount, setReplicateCount] = useState(3);
  const [baseSeed, setBaseSeed] = useState(1);
  const [totalTicks, setTotalTicks] = useState(50);
  // navigator.hardwareConcurrency is undefined during SSR — read inside a
  // useState initializer (per CLAUDE.md "Known gotchas") to avoid the
  // setState-in-effect lint rule and the SSR/CSR mismatch in one shot.
  const [concurrency, setConcurrency] = useState<number>(() => {
    if (typeof navigator === 'undefined') return 1;
    return Math.max(1, Math.min(8, (navigator.hardwareConcurrency ?? 2) - 1));
  });

  // Auto-select first config when configs load — derived during render
  // rather than via a setState-in-effect, per the React "you might not need
  // an effect" guidance.
  const selectedConfigId = selectedConfigIdState || configs[0]?.id || '';

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
      <div className="absolute inset-0 bg-fg/40 backdrop-blur-sm" onClick={handleClose} />

      {/* Modal */}
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-md border border-border bg-surface p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between border-b border-border pb-3">
          <h2 className="font-serif text-xl font-semibold text-fg">Batch run</h2>
          <span
            data-testid="batch-status-overall"
            className="text-xs font-medium uppercase tracking-wide text-fg-muted"
          >
            {batchState.status}
          </span>
        </div>

        {/* Start form — shown when idle */}
        {batchState.status === 'idle' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-fg mb-1">Configuration</label>
              <select
                data-testid="batch-config-select"
                className="w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none"
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
                <label className="block text-sm font-medium text-fg mb-1">
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
                  className="w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm font-mono focus:border-accent focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-fg mb-1">
                  Base seed
                  <HelpTip helpKey="batch.baseSeed" />
                </label>
                <input
                  data-testid="batch-base-seed"
                  type="number"
                  value={baseSeed}
                  onChange={(e) => setBaseSeed(Number(e.target.value) || 1)}
                  className="w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm font-mono focus:border-accent focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-fg mb-1">
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
                  className="w-full accent-accent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-fg mb-1">
                  Total ticks
                  <HelpTip helpKey="batch.totalTicks" />
                </label>
                <input
                  data-testid="batch-total-ticks"
                  type="number"
                  min={1}
                  value={totalTicks}
                  onChange={(e) => setTotalTicks(Math.max(1, Number(e.target.value) || 50))}
                  className="w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm font-mono focus:border-accent focus:outline-none"
                />
              </div>
            </div>

            <button
              data-testid="batch-start-button"
              onClick={handleStart}
              disabled={!selectedConfigId}
              className="w-full inline-flex items-center justify-center rounded-md bg-accent px-3.5 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
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
              <div className="flex items-center justify-between text-xs text-fg-muted mb-1">
                <span className="font-mono">
                  {terminal} / {total} replicates
                </span>
                <span className="font-mono">{overallPct}%</span>
              </div>
              <div className="h-2 rounded-full bg-surface-muted">
                <div
                  className="h-2 rounded-full bg-accent transition-all"
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
                  className="inline-flex items-center rounded-md px-3.5 py-1.5 text-sm font-medium text-danger hover:bg-danger-bg"
                >
                  Cancel batch
                </button>
              )}
              {isTerminal && (
                <button
                  data-testid="batch-close-button"
                  onClick={handleClose}
                  className="inline-flex items-center rounded-md border border-border-strong bg-surface px-3.5 py-1.5 text-sm font-medium text-fg hover:bg-surface-muted"
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
