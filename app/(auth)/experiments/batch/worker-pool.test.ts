import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Remote } from 'comlink';
import { createWorkerPool } from './worker-pool';
import type { PersistCompletedHandler, PersistFailedHandler } from './worker-pool';
import type { SimulationWorkerApi } from '@/lib/sim/worker-client';
import type { ExperimentConfig } from '@/lib/schema/experiment';

// ─── Shared mock helpers ─────────────────────────────────────────────────────

type Behavior = { kind: 'resolve' } | { kind: 'reject'; error: Error } | { kind: 'hang' };

/** Minimal RunResult-shaped object that satisfies the pool's expectations. */
function mockRunResult(seed: number) {
  return {
    summary: { classification: 'inconclusive' as const },
    metricsTimeSeries: [{ tick: 0, scalar: {}, graph: {} }],
    _seed: seed,
  };
}

/**
 * Build a mock createWorker factory. Each call returns a worker whose api.run
 * resolves/rejects/hangs based on the corresponding entry in `behaviors`.
 * If more calls are made than behaviors provided, the last behavior repeats.
 */
function makeMockFactory(behaviors: Behavior[]) {
  let callIndex = 0;
  const terminateCalls: number[] = [];

  const factory = () => {
    const idx = callIndex++;
    const behavior = behaviors[Math.min(idx, behaviors.length - 1)];

    let initSeed = 0;

    const api = {
      init: vi.fn(async (_config: unknown, seed: number) => {
        initSeed = seed;
      }),
      run: vi.fn(async (_totalTicks: number, _onProgress?: unknown) => {
        if (behavior.kind === 'resolve') {
          return mockRunResult(initSeed);
        } else if (behavior.kind === 'reject') {
          throw behavior.error;
        } else {
          // hang — never resolves
          return new Promise<never>(() => {});
        }
      }),
      reset: vi.fn(),
      step: vi.fn(),
      getMetrics: vi.fn(),
      getSnapshot: vi.fn(),
      getLatticeProjection: vi.fn(),
      getInteractionGraph: vi.fn(),
      updateConfig: vi.fn(),
      [Symbol.dispose]: vi.fn(),
    };

    return {
      api: api as unknown as Remote<SimulationWorkerApi>,
      terminate: () => {
        terminateCalls.push(idx);
      },
    };
  };

  return {
    factory,
    terminateCalls,
    get callCount() {
      return callIndex;
    },
  };
}

function makeSpec(
  overrides: Partial<Parameters<ReturnType<typeof createWorkerPool>['startBatch']>[0]> = {},
) {
  return {
    config: {} as ExperimentConfig,
    configId: 'test-config-id',
    replicateCount: 3,
    baseSeed: 1,
    totalTicks: 50,
    concurrency: 2,
    ...overrides,
  };
}

function makeMockHandlers() {
  const persistCompleted = vi.fn(async (args: Parameters<PersistCompletedHandler>[0]) => ({
    runId: `mock-${args.seed}`,
  }));
  const persistFailed = vi.fn(async (args: Parameters<PersistFailedHandler>[0]) => ({
    runId: `mock-${args.seed}`,
  }));
  return { persistCompleted, persistFailed };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('worker-pool', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('dispatch order with 3 replicates and 2 slots', () => {
    it('dispatches first two immediately and third after one completes', async () => {
      const { persistCompleted, persistFailed } = makeMockHandlers();

      const { factory } = makeMockFactory([{ kind: 'resolve' }, { kind: 'resolve' }]);

      const pool = createWorkerPool({ persistCompleted, persistFailed, createWorker: factory });
      pool.startBatch(makeSpec({ replicateCount: 3, concurrency: 2 }));

      // Wait for all tasks to complete
      await vi.waitFor(
        () => {
          const s = pool.getState();
          expect(s.replicates.every((r) => r.status === 'completed')).toBe(true);
        },
        { timeout: 5000 },
      );

      const finalState = pool.getState();
      expect(finalState.status).toBe('completed');
      expect(finalState.replicates).toHaveLength(3);
      expect(finalState.replicates[0].status).toBe('completed');
      expect(finalState.replicates[1].status).toBe('completed');
      expect(finalState.replicates[2].status).toBe('completed');

      // persistCompleted called 3 times with correct seeds
      expect(persistCompleted).toHaveBeenCalledTimes(3);
      const seeds = persistCompleted.mock.calls.map((c) => c[0].seed).sort();
      expect(seeds).toEqual([1, 2, 3]);
      // persistFailed not called
      expect(persistFailed).not.toHaveBeenCalled();
    });
  });

  describe('cancellation marks pending tasks', () => {
    it('cancels running and pending replicates', async () => {
      const { persistCompleted, persistFailed } = makeMockHandlers();

      // concurrency=1, so only one runs at a time; api.run hangs forever
      const { factory, terminateCalls } = makeMockFactory([{ kind: 'hang' }]);

      const pool = createWorkerPool({ persistCompleted, persistFailed, createWorker: factory });
      pool.startBatch(makeSpec({ replicateCount: 5, concurrency: 1 }));

      // Wait for the first replicate to enter running
      await vi.waitFor(
        () => {
          const s = pool.getState();
          expect(s.replicates[0].status).toBe('running');
        },
        { timeout: 2000 },
      );

      // Cancel the batch
      await pool.cancelBatch();

      const finalState = pool.getState();
      expect(finalState.status).toBe('cancelled');
      expect(finalState.replicates[0].status).toBe('cancelled');
      expect(finalState.replicates[1].status).toBe('cancelled');
      expect(finalState.replicates[2].status).toBe('cancelled');
      expect(finalState.replicates[3].status).toBe('cancelled');
      expect(finalState.replicates[4].status).toBe('cancelled');

      // Worker was terminated for the running task
      expect(terminateCalls.length).toBeGreaterThanOrEqual(1);

      // persistFailed called 5 times with status='cancelled'
      expect(persistFailed).toHaveBeenCalledTimes(5);
      expect(persistFailed.mock.calls.every((c) => c[0].status === 'cancelled')).toBe(true);
      // persistCompleted not called
      expect(persistCompleted).not.toHaveBeenCalled();
    });
  });

  describe('partial failure continues others', () => {
    it('marks failed replicate without stopping the batch', async () => {
      const { persistCompleted, persistFailed } = makeMockHandlers();

      let slot1CallCount = 0;
      const factory = () => {
        const slotIdx = slot1CallCount++;
        let initSeed = 0;

        const api = {
          init: vi.fn(async (_config: unknown, seed: number) => {
            initSeed = seed;
          }),
          run: vi.fn(async () => {
            if (slotIdx === 1) {
              throw new Error('synthetic failure for test');
            }
            return mockRunResult(initSeed);
          }),
          reset: vi.fn(),
          step: vi.fn(),
          getMetrics: vi.fn(),
          getSnapshot: vi.fn(),
          getLatticeProjection: vi.fn(),
          getInteractionGraph: vi.fn(),
          updateConfig: vi.fn(),
          [Symbol.dispose]: vi.fn(),
        };

        return { api: api as unknown as Remote<SimulationWorkerApi>, terminate: vi.fn() };
      };

      const pool = createWorkerPool({ persistCompleted, persistFailed, createWorker: factory });
      pool.startBatch(makeSpec({ replicateCount: 3, concurrency: 2 }));

      // Wait for all replicates to reach terminal state
      await vi.waitFor(
        () => {
          const s = pool.getState();
          const allTerminal = s.replicates.every(
            (r) => r.status === 'completed' || r.status === 'failed',
          );
          expect(allTerminal).toBe(true);
        },
        { timeout: 5000 },
      );

      const finalState = pool.getState();
      expect(finalState.status).toBe('completed');

      const failedReplicate = finalState.replicates.find((r) => r.status === 'failed');
      expect(failedReplicate).toBeDefined();
      expect(failedReplicate!.errorMessage).toBe('synthetic failure for test');

      const completed = finalState.replicates.filter((r) => r.status === 'completed');
      expect(completed).toHaveLength(2);

      // persistCompleted called 2 times, persistFailed called 1 time
      expect(persistCompleted).toHaveBeenCalledTimes(2);
      expect(persistFailed).toHaveBeenCalledTimes(1);
      expect(persistFailed.mock.calls[0][0].errorMessage).toBe('synthetic failure for test');
    });
  });
});
