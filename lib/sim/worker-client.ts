// lib/sim/worker-client.ts — Main-thread client wrapper for the simulation Web Worker.
//
// Client-safe module. Constructs the simulation Web Worker and wraps it with Comlink.
// Import from a client component only — SSR execution throws by design (see SSR guard).
// The worker must be constructed inside `useEffect` per CLAUDE.md 'Worker lifecycle'.
//
// Usage:
//   import { createSimulationWorker } from '@/lib/sim/worker-client';
//   import type { TickReport, RunResult, SimulationWorkerApi } from '@/lib/sim/worker-client';
//
//   // Inside a client component's useEffect:
//   const { api, terminate } = createSimulationWorker();
//   await api.init(config, seed);
//   const result = await api.run(100, Comlink.proxy((report) => { ... }));
//   return () => terminate(); // cleanup on unmount
//
// No 'import server-only' — this module is a client-side wrapper.
// No Math.random() — the seeded RNG lives inside the worker and never crosses the wire.

import * as Comlink from 'comlink';
import type { Remote } from 'comlink';

// Type-only imports — erased at compile time by the TypeScript transform.
// The worker module's *code* is NOT pulled into the main-thread bundle by these imports;
// only the type declarations influence the compiler. The runtime entry point is the
// new Worker(new URL(...)) call below, which is what triggers Turbopack's code-splitting.
import type {
  SimulationWorkerApi,
  TickReport,
  RunResult,
  FullStateSnapshot,
  ExperimentConfigInput,
  WorldId,
  ProjectionKind,
  CellData,
} from '@/workers/simulation.worker';

// Re-export all public types so consumers import everything from this module
// without reaching into the worker module directly. This file is the one-stop shop
// for the main-thread API surface.
export type {
  SimulationWorkerApi,
  TickReport,
  RunResult,
  FullStateSnapshot,
  ExperimentConfigInput,
  WorldId,
  ProjectionKind,
  CellData,
};
export type { Remote };

/**
 * Construct the simulation Web Worker and return a typed handle.
 *
 * @returns `api` — a `Remote<SimulationWorkerApi>` proxy whose methods all return
 *   Promises, regardless of whether the worker implementation is sync or async.
 * @returns `terminate` — tears down the Comlink channel and terminates the worker.
 *   Call on component unmount. See cleanup-order note in CLAUDE.md 'Worker lifecycle'.
 *
 * Requirements:
 * - Must be called in the browser (inside `useEffect` or equivalent). SSR throws by design.
 * - Call `terminate()` on component unmount to avoid memory leaks.
 * - Pass `onProgress` callbacks to `api.run()` wrapped with `Comlink.proxy(callback)`.
 *   Bare function values throw `DataCloneError` (functions are not structuredClone-safe).
 *
 * Example (React client component):
 * ```tsx
 * useEffect(() => {
 *   const { api, terminate } = createSimulationWorker();
 *   let cancelled = false;
 *   (async () => {
 *     await api.init(config, seed);
 *     const result = await api.run(200, Comlink.proxy((tick) => {
 *       if (!cancelled) setCurrentTick(tick.tick);
 *     }));
 *     if (!cancelled) setSummary(result.summary);
 *   })();
 *   return () => { cancelled = true; terminate(); };
 * }, []);
 * ```
 */
export function createSimulationWorker(): {
  api: Remote<SimulationWorkerApi>;
  terminate: () => void;
} {
  // SSR guard — Worker is undefined in Node (Next.js server renders components).
  // This throw is by design: constructing a Worker on the server makes no sense
  // and indicates the caller is not respecting the useEffect boundary.
  if (typeof window === 'undefined') {
    throw new Error(
      'createSimulationWorker must be called in the browser (inside useEffect or similar). ' +
        'Do not call at module scope or during SSR.',
    );
  }

  // Turbopack-native worker construction.
  // The new URL(path, import.meta.url) expression form is required — Turbopack
  // recognizes it as a bundler directive and emits a separate worker chunk.
  // { type: 'module' } enables static import statements inside the worker file.
  // Reference: CLAUDE.md 'Worker lifecycle', turbopack.md § Magic Comments.
  const worker = new Worker(new URL('../../workers/simulation.worker.ts', import.meta.url), {
    type: 'module',
  });

  // Wrap with Comlink. api is a Remote<SimulationWorkerApi> — all methods return Promises.
  const api = Comlink.wrap<SimulationWorkerApi>(worker);

  // Cleanup order matters (CLAUDE.md 'Worker lifecycle'):
  // releaseProxy() must fire BEFORE worker.terminate() to tear down Comlink's
  // message-port channel cleanly. Reversing the order can leave dangling Comlink
  // resolvers if a run() promise is in flight when terminate() is called.
  const terminate = (): void => {
    api[Comlink.releaseProxy]();
    worker.terminate();
  };

  return { api, terminate };
}
