// Sweep orchestration. Composes step 27's worker pool to run each cell of a
// cartesian-product grid as a sequential batch, then loads each replicate's
// persisted RunSummary so the sweep form can aggregate per-cell stats.
//
// Pure TypeScript module — no React, no JSX. Imported by `sweep-form.tsx`.

import {
  createWorkerPool,
  type BatchState,
  type PersistCompletedHandler,
  type PersistFailedHandler,
  type ReplicateState,
  type WorkerPool,
} from '@/app/(auth)/experiments/batch/worker-pool';
import type { ExperimentConfig } from '@/lib/schema/experiment';
import type { RunSummary } from '@/lib/sim/metrics/types';

import { cartesianProduct } from '@/lib/sim/sweep/cartesian-product';
import { setByPath } from '@/lib/sim/sweep/aggregate';

// ─── Public types ────────────────────────────────────────────────────────────

export type SweepValue = string | number | boolean;

/**
 * One sweepable axis as configured by the user. `path` is the catalog dot-path,
 * `values` is the explicit grid the user supplied (numeric range expanded, or
 * checked enum/boolean values).
 */
export interface ParameterPick {
  path: string;
  label: string;
  values: SweepValue[];
}

export interface CellState {
  /** JSON-stringified parameter tuple. Stable identifier across renders. */
  cellKey: string;
  /** Parallel-to-pickList tuple of parameter values. */
  parameterValues: SweepValue[];
  /** Index into the cartesian-product order. */
  cellIndex: number;
  status: 'pending' | 'running' | 'completed' | 'cancelled';
  replicates: ReplicateState[];
}

export type SweepPhase = 'idle' | 'running' | 'completed' | 'cancelled';

export interface SweepState {
  phase: SweepPhase;
  cells: CellState[];
  /** runId → RunSummary cache, populated as replicates land. */
  cellReplicates: Map<string, RunSummary[]>;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface SweepSpec {
  baseConfig: ExperimentConfig;
  configId: string;
  parameterPicks: ParameterPick[];
  replicatesPerCell: number;
  totalTicks: number;
  concurrency: number;
  baseSeed?: number;
}

export interface SweepRunner {
  startSweep(spec: SweepSpec): Promise<void>;
  cancel(): Promise<void>;
  getState(): SweepState;
  onUpdate(listener: (state: SweepState) => void): () => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isTerminal(status: ReplicateState['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

/**
 * Apply per-cell parameter overrides onto a deep clone of the base config.
 * Each pick's `path` is a dot-path; the corresponding value is set in the clone
 * via setByPath. structuredClone is used so the base config remains untouched
 * across cells.
 */
export function applyPickOverrides(
  baseConfig: ExperimentConfig,
  picks: readonly ParameterPick[],
  values: readonly SweepValue[],
): ExperimentConfig {
  const cloned = structuredClone(baseConfig) as unknown as Record<string, unknown>;
  for (let i = 0; i < picks.length; i++) {
    setByPath(cloned, picks[i].path, values[i]);
  }
  return cloned as unknown as ExperimentConfig;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export interface SweepRunnerOptions {
  persistCompleted: PersistCompletedHandler;
  persistFailed: PersistFailedHandler;
  loadRunSummary: (runId: string) => Promise<RunSummary | null>;
  /** Optional override; passed through to the underlying worker pool. */
  createWorker?: Parameters<typeof createWorkerPool>[0]['createWorker'];
  /** Optional override of the pool factory itself; lets tests inject a stub. */
  createPool?: typeof createWorkerPool;
}

const INITIAL_STATE: SweepState = {
  phase: 'idle',
  cells: [],
  cellReplicates: new Map(),
  startedAt: null,
  finishedAt: null,
};

function snapshot(s: SweepState): SweepState {
  return {
    phase: s.phase,
    startedAt: s.startedAt,
    finishedAt: s.finishedAt,
    cells: s.cells.map((c) => ({
      cellKey: c.cellKey,
      parameterValues: [...c.parameterValues],
      cellIndex: c.cellIndex,
      status: c.status,
      replicates: c.replicates.map((r) => ({ ...r })),
    })),
    cellReplicates: new Map(s.cellReplicates),
  };
}

export function createSweepRunner(options: SweepRunnerOptions): SweepRunner {
  const poolFactory = options.createPool ?? createWorkerPool;

  let state: SweepState = { ...INITIAL_STATE, cellReplicates: new Map() };
  let cachedSnapshot: SweepState = snapshot(state);
  const listeners = new Set<(s: SweepState) => void>();

  let pool: WorkerPool | null = null;
  let cancelled = false;

  function emit() {
    cachedSnapshot = snapshot(state);
    listeners.forEach((fn) => fn(cachedSnapshot));
  }

  async function awaitBatchDrain(p: WorkerPool): Promise<BatchState> {
    return new Promise<BatchState>((resolve) => {
      const check = (s: BatchState) => {
        if (s.replicates.length > 0 && s.replicates.every((r) => isTerminal(r.status))) {
          unsub();
          resolve(s);
        }
      };
      const unsub = p.onUpdate(check);
      // Also check the current snapshot in case the batch already drained.
      check(p.getState());
    });
  }

  async function startSweep(spec: SweepSpec): Promise<void> {
    if (state.phase === 'running') {
      throw new Error('A sweep is already running');
    }

    cancelled = false;

    const grid = cartesianProduct(spec.parameterPicks.map((p) => p.values));
    const cells: CellState[] = grid.map((values, cellIndex) => ({
      cellKey: JSON.stringify(values),
      parameterValues: values,
      cellIndex,
      status: 'pending',
      replicates: [],
    }));

    state = {
      phase: 'running',
      cells,
      cellReplicates: new Map(),
      startedAt: Date.now(),
      finishedAt: null,
    };
    emit();

    pool = poolFactory({
      persistCompleted: options.persistCompleted,
      persistFailed: options.persistFailed,
      createWorker: options.createWorker,
    });

    const baseSeed = spec.baseSeed ?? 1;

    for (let i = 0; i < cells.length; i++) {
      if (cancelled) break;
      const cell = cells[i];
      cell.status = 'running';
      emit();

      const cellConfig = applyPickOverrides(
        spec.baseConfig,
        spec.parameterPicks,
        cell.parameterValues,
      );
      const cellBaseSeed = baseSeed + cell.cellIndex * spec.replicatesPerCell;

      // Mirror per-replicate state from the pool into our per-cell tracking.
      const unsub = pool.onUpdate((batchState) => {
        cell.replicates = batchState.replicates.map((r) => ({ ...r }));
        emit();
      });

      pool.startBatch({
        config: cellConfig,
        configId: spec.configId,
        replicateCount: spec.replicatesPerCell,
        baseSeed: cellBaseSeed,
        totalTicks: spec.totalTicks,
        concurrency: spec.concurrency,
      });

      const finalBatch = await awaitBatchDrain(pool);
      unsub();

      cell.replicates = finalBatch.replicates.map((r) => ({ ...r }));

      // Load summaries for completed replicates (failed/cancelled have no summary).
      const summaries: RunSummary[] = [];
      for (const r of finalBatch.replicates) {
        if (r.status === 'completed' && r.runId) {
          try {
            const summary = await options.loadRunSummary(r.runId);
            if (summary) summaries.push(summary);
          } catch {
            // Skip — a single missing summary should not fail the sweep.
          }
        }
      }
      state.cellReplicates.set(cell.cellKey, summaries);
      cell.status = cancelled ? 'cancelled' : 'completed';
      emit();
    }

    if (!cancelled) {
      state.phase = 'completed';
    } else {
      state.phase = 'cancelled';
      // Mark any still-pending cells as cancelled.
      for (const c of state.cells) {
        if (c.status === 'pending' || c.status === 'running') c.status = 'cancelled';
      }
    }
    state.finishedAt = Date.now();
    emit();
  }

  async function cancel(): Promise<void> {
    if (state.phase !== 'running') return;
    cancelled = true;
    if (pool) await pool.cancelBatch();
    // The startSweep loop sees `cancelled` and breaks; emit happens there.
    // But also flush a snapshot now so listeners see the cancellation request
    // even if no per-replicate update fires before the loop exits.
    emit();
  }

  return {
    startSweep,
    cancel,
    getState: () => cachedSnapshot,
    onUpdate(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
