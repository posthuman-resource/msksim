// Client-safe pool manager. Dispatches N replicate simulation runs across M Web Workers
// bounded by a concurrency cap. Not a React component — the React integration lives in
// `batch-run-modal.tsx` which calls `startBatch` / `cancelBatch` and subscribes via `onUpdate`.
// See `CLAUDE.md` 'Worker lifecycle' for the factory and teardown discipline this module composes.

import * as Comlink from 'comlink';
import { createSimulationWorker } from '@/lib/sim/worker-client';
import type { Remote } from 'comlink';
import type { SimulationWorkerApi, TickReport, RunResult } from '@/lib/sim/worker-client';
import type { ExperimentConfig } from '@/lib/schema/experiment';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ReplicateStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface ReplicateState {
  id: number;
  seed: number;
  status: ReplicateStatus;
  tick: number;
  totalTicks: number;
  errorMessage: string | null;
  runId: string | null;
}

export interface BatchState {
  status: 'idle' | 'running' | 'completed' | 'cancelled';
  replicates: ReplicateState[];
  config: ExperimentConfig | null;
  baseSeed: number;
  totalTicks: number;
  concurrency: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface BatchSpec {
  config: ExperimentConfig;
  configId: string;
  replicateCount: number;
  baseSeed: number;
  totalTicks: number;
  concurrency: number;
}

export type PersistCompletedHandler = (args: {
  configId: string;
  seed: number;
  tickCount: number;
  result: RunResult;
}) => Promise<{ runId: string }>;

export type PersistFailedHandler = (args: {
  configId: string;
  seed: number;
  status: 'failed' | 'cancelled';
  tickCount: number;
  errorMessage: string | null;
}) => Promise<{ runId: string }>;

type WorkerHandle = { api: Remote<SimulationWorkerApi>; terminate: () => void };

export interface WorkerPool {
  startBatch(spec: BatchSpec): void;
  cancelBatch(): Promise<void>;
  getState(): BatchState;
  onUpdate(listener: (state: BatchState) => void): () => void;
}

// ─── Initial state ───────────────────────────────────────────────────────────

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

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createWorkerPool(options: {
  persistCompleted: PersistCompletedHandler;
  persistFailed: PersistFailedHandler;
  createWorker?: () => WorkerHandle;
}): WorkerPool {
  const factory = options.createWorker ?? createSimulationWorker;

  let state: BatchState = { ...INITIAL_STATE };
  let cachedSnapshot: BatchState = { ...INITIAL_STATE };
  let spec: BatchSpec | null = null;
  const workers: Array<WorkerHandle | null> = [];
  const listeners = new Set<(state: BatchState) => void>();
  let cancellationToken = { cancelled: false };

  // Track which worker slot is running which replicate id
  const workerAssignment = new Map<number, number>(); // replicateId -> workerIndex

  function emit() {
    cachedSnapshot = structuredClone(state);
    listeners.forEach((fn) => fn(cachedSnapshot));
  }

  function checkDrain() {
    const allTerminal = state.replicates.every(
      (r) => r.status === 'completed' || r.status === 'failed' || r.status === 'cancelled',
    );
    if (allTerminal && state.status === 'running') {
      state.status = 'completed';
      state.finishedAt = Date.now();
      emit();
      for (let i = 0; i < workers.length; i++) {
        workers[i]?.terminate();
        workers[i] = null;
      }
    }
  }

  async function dispatchNext(workerIndex: number) {
    if (!spec) return;
    const replicate = state.replicates.find((r) => r.status === 'pending');
    if (!replicate) {
      checkDrain();
      return;
    }

    replicate.status = 'running';
    workerAssignment.set(replicate.id, workerIndex);
    emit();

    const worker = workers[workerIndex];
    if (!worker) return;

    const localToken = cancellationToken;

    const onProgress = Comlink.proxy((report: TickReport) => {
      if (localToken.cancelled) return;
      const r = state.replicates.find((x) => x.id === replicate.id);
      if (r) {
        r.tick = report.tick;
        emit();
      }
    });

    try {
      await worker.api.init(spec.config, replicate.seed);

      // Race between the simulation run and cancellation
      const cancellationPromise = new Promise<{ cancelled: true }>((resolve) => {
        const check = () => {
          if (localToken.cancelled) {
            resolve({ cancelled: true });
          } else {
            setTimeout(check, 50);
          }
        };
        check();
      });

      const result = await Promise.race([
        worker.api.run(spec.totalTicks, onProgress),
        cancellationPromise,
      ]);

      // If cancelled, cancelBatch already handled the state transitions
      if ('cancelled' in result && result.cancelled) return;

      // Happy path — completed
      const runResult = result as RunResult;
      const persistResult = await options.persistCompleted({
        configId: spec.configId,
        seed: replicate.seed,
        tickCount: runResult.metricsTimeSeries.length,
        result: runResult,
      });

      replicate.status = 'completed';
      replicate.runId = persistResult.runId;
      emit();
      checkDrain();

      if (state.status === 'running') {
        dispatchNext(workerIndex);
      }
    } catch (err) {
      if (localToken.cancelled) return;

      const errorMessage = err instanceof Error ? err.message : String(err);

      try {
        await options.persistFailed({
          configId: spec!.configId,
          seed: replicate.seed,
          status: 'failed',
          tickCount: replicate.tick,
          errorMessage,
        });
      } catch {
        // persist failure — still mark the replicate as failed
      }

      replicate.status = 'failed';
      replicate.errorMessage = errorMessage;
      emit();
      checkDrain();

      if (state.status === 'running') {
        dispatchNext(workerIndex);
      }
    }
  }

  return {
    startBatch(batchSpec: BatchSpec) {
      if (state.status === 'running') {
        throw new Error('A batch is already running');
      }

      spec = batchSpec;
      cancellationToken = { cancelled: false };

      const replicates: ReplicateState[] = Array.from(
        { length: batchSpec.replicateCount },
        (_, i) => ({
          id: i,
          seed: batchSpec.baseSeed + i,
          status: 'pending' as const,
          tick: 0,
          totalTicks: batchSpec.totalTicks,
          errorMessage: null,
          runId: null,
        }),
      );

      // Create workers
      workers.length = 0;
      for (let i = 0; i < batchSpec.concurrency; i++) {
        workers[i] = factory();
      }

      state = {
        status: 'running',
        replicates,
        config: batchSpec.config,
        baseSeed: batchSpec.baseSeed,
        totalTicks: batchSpec.totalTicks,
        concurrency: batchSpec.concurrency,
        startedAt: Date.now(),
        finishedAt: null,
      };
      emit();

      // Dispatch initial tasks — one per worker slot
      for (let i = 0; i < batchSpec.concurrency; i++) {
        dispatchNext(i);
      }
    },

    async cancelBatch() {
      if (state.status !== 'running') return;

      cancellationToken.cancelled = true;

      const pendingIds = state.replicates.filter((r) => r.status === 'pending').map((r) => r.id);
      const runningIds = state.replicates.filter((r) => r.status === 'running').map((r) => r.id);

      // Terminate workers for running replicates
      for (const id of runningIds) {
        const wi = workerAssignment.get(id);
        if (wi !== undefined && workers[wi]) {
          workers[wi]!.terminate();
          workers[wi] = null;
        }
      }

      // Transition all pending and running replicates to cancelled
      for (const id of [...pendingIds, ...runningIds]) {
        state.replicates[id].status = 'cancelled';
      }

      state.status = 'cancelled';
      state.finishedAt = Date.now();
      emit();

      // Persist cancelled replicates
      if (spec) {
        await Promise.allSettled(
          [...pendingIds, ...runningIds].map((id) =>
            options.persistFailed({
              configId: spec!.configId,
              seed: state.replicates[id].seed,
              status: 'cancelled',
              tickCount: state.replicates[id].tick,
              errorMessage: null,
            }),
          ),
        );
      }

      // Terminate any remaining workers
      for (let i = 0; i < workers.length; i++) {
        workers[i]?.terminate();
        workers[i] = null;
      }

      emit();
    },

    getState(): BatchState {
      return cachedSnapshot;
    },

    onUpdate(listener: (state: BatchState) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
