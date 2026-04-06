// workers/simulation.worker.ts — Web Worker entry point for the Naming Game simulation.
//
// This file runs inside a browser Worker context only.
// No window, no document, no next/* imports, no DOM APIs.
// This is the canonical integration point for the pure simulation core (lib/sim/*).
//
// Turbopack-native worker construction:
//   new Worker(new URL('../../workers/simulation.worker.ts', import.meta.url), { type: 'module' })
// The new URL(path, import.meta.url) expression is required — Turbopack recognizes it as a
// bundler directive and emits a separate worker chunk. A string literal would not trigger splitting.
// Reference: CLAUDE.md 'Worker lifecycle'
// Reference: node_modules/next/dist/docs/01-app/03-api-reference/08-turbopack.md § Magic Comments
// Reference: https://developer.mozilla.org/en-US/docs/Web/API/Worker/Worker
// Reference: https://github.com/GoogleChromeLabs/comlink
//
// No 'use client' directive — worker modules have no React context.
// No 'import server-only' — workers run in a client-side bundle context.
// No Math.random() — all entropy flows through the seeded RNG (CLAUDE.md "Testing conventions").

import * as Comlink from 'comlink';
import type { SerializedGraph } from 'graphology-types';

import { ExperimentConfig } from '@/lib/schema/experiment';
import type { AgentClass, Language } from '@/lib/schema/primitives';
import { bootstrapExperiment } from '@/lib/sim/bootstrap';
import { tick } from '@/lib/sim/engine';
import type { SimulationState } from '@/lib/sim/engine';
import {
  createInteractionGraph,
  updateInteractionGraph,
} from '@/lib/sim/metrics/interaction-graph';
import type { UndirectedGraph } from '@/lib/sim/metrics/interaction-graph';
import { computeGraphMetrics, computeInteractionGraphCommunities } from '@/lib/sim/metrics/graph';
import { computeScalarMetrics } from '@/lib/sim/metrics/scalar';
import { computeRunSummary } from '@/lib/sim/metrics/summary';
import type {
  ScalarMetricsSnapshot,
  GraphMetricsSnapshot,
  RunSummary,
} from '@/lib/sim/metrics/types';
import { createRNG } from '@/lib/sim/rng';
import type { RNG } from '@/lib/sim/rng';
import type { WorldId } from '@/lib/sim/world';

// ─── Public API types ─────────────────────────────────────────────────────────
//
// These types are the single source of truth for the worker/main-thread contract.
// The main-thread client (lib/sim/worker-client.ts) imports them via type-only
// imports so the worker module itself is NOT pulled into the main-thread bundle.

// Re-export WorldId so consumers can import it from the worker-client without
// reaching into lib/sim/world directly.
export type { WorldId };

/** Which projection the lattice renderer should display. */
export type ProjectionKind = 'class' | 'dominant-token' | 'matching-rate';

/**
 * Per-cell data returned by getLatticeProjection().
 * Carries only the fields each projection needs — no full inventory serialization.
 * Color computation is left to the main thread (colors.ts helpers).
 */
export interface CellData {
  agentId: string;
  class: AgentClass;
  position: number;
  /** Populated for 'dominant-token' projection. */
  topToken?: string;
  /** Populated for 'matching-rate' projection. Value in [0, 1]. */
  matchingRate?: number;
}

export interface TickReport {
  tick: number;
  scalar: ScalarMetricsSnapshot;
  graph: GraphMetricsSnapshot;
}

export interface RunResult {
  summary: RunSummary;
  metricsTimeSeries: TickReport[];
}

/**
 * Full simulation state snapshot for persistence (step 26) and debugging.
 *
 * Agent inventories are serialized as [language, referent, lexeme, weight][]
 * quadruple arrays instead of the nested Map shape from lib/sim/types.ts.
 * Reason: the nested Map is not structured-clone-safe with TypeScript branded
 * string keys — keys lose their brand discriminants across postMessage. The
 * quadruple-array form survives structured clone without information loss.
 */
export interface FullStateSnapshot {
  tick: number;
  config: ExperimentConfig;
  world1: Array<{
    agentId: string;
    class: string;
    position: number;
    inventory: Array<[string, string, string, number]>;
  }>;
  world2: Array<{
    agentId: string;
    class: string;
    position: number;
    inventory: Array<[string, string, string, number]>;
  }>;
  /** Cumulative interaction graph as an edge list: [speakerId, hearerId, weight]. */
  interactionGraphEdges: Array<[string, string, number]>;
}

/**
 * Raw config input — validated inside init(). In v1, identical to ExperimentConfig.
 * Named separately so step 25's config-editor form can later distinguish raw form
 * data from a fully-parsed ExperimentConfig without breaking this API surface.
 */
export type ExperimentConfigInput = ExperimentConfig;

/**
 * Serialized interaction-graph report returned by getInteractionGraph().
 *
 * `graph` is a plain JSON-serializable graphology SerializedGraph (via graph.export()).
 * `communities` is the Louvain per-node assignment serialized as [agentId, communityId][]
 * tuples — Map is not reliably structured-clone-safe across browser versions, so the
 * quadruple-array pattern established in FullStateSnapshot is reused here. The main
 * thread rehydrates to Map<string, number> before passing into NetworkView.
 */
export interface InteractionGraphReport {
  graph: SerializedGraph;
  communities: Array<[string, number]>;
  modularity: number;
  nodeCount: number;
  edgeCount: number;
}

/**
 * Typed Comlink RPC surface exposed by the simulation worker.
 *
 * All methods return Promises because Comlink wraps synchronous implementations
 * in promise-returning proxies on the main thread.
 *
 * Lifecycle:
 *   1. init(config, seed) — bootstrap state; must be called before step/run.
 *   2. step(count?) / run(totalTicks, onProgress?) — advance simulation.
 *   3. getMetrics() / getSnapshot() — read current state.
 *   4. reset() — clear state; must call init() again before step/run.
 *
 * Callback marshalling:
 *   onProgress passed to run() must be wrapped with Comlink.proxy(callback) on
 *   the main thread. Bare functions throw DataCloneError (not structuredClone-safe).
 */
export interface SimulationWorkerApi {
  init(config: ExperimentConfigInput, seed: number): Promise<void>;
  step(count?: number): Promise<TickReport>;
  run(totalTicks: number, onProgress?: (report: TickReport) => void): Promise<RunResult>;
  /**
   * Return the latest tick's scalar and graph metrics as a named pair.
   * Named properties avoid the type conflict that would arise from merging
   * ScalarMetricsSnapshot and GraphMetricsSnapshot (both have world1/world2
   * with incompatible shapes).
   */
  getMetrics(): Promise<{ scalar: ScalarMetricsSnapshot; graph: GraphMetricsSnapshot }>;
  getSnapshot(): Promise<FullStateSnapshot>;
  reset(): Promise<void>;
  /**
   * Return a per-cell projection for the given world and projection kind.
   * Only the fields required by the active projection are populated.
   * Called on demand (not every tick) to avoid saturating the postMessage channel.
   */
  getLatticeProjection(worldId: WorldId, kind: ProjectionKind): Promise<CellData[]>;
  /**
   * Return a serialized snapshot of the cumulative interaction graph with Louvain
   * community assignments. Added by step 23 for the network view.
   *
   * Uses state.visualizationRng (seeded from config.seed + 1) rather than state.rng
   * so Louvain calls from visualization polling never advance the simulation RNG.
   * This preserves the CLAUDE.md determinism invariant: run(N, ...) twice with the
   * same seed produces bit-identical results regardless of how often the main thread
   * polls getInteractionGraph().
   */
  getInteractionGraph(): Promise<InteractionGraphReport>;
  /**
   * Merge a partial ExperimentConfig into the worker's in-memory config.
   * Added by step 24 for the live-slider controls.
   *
   * The partial is validated via ExperimentConfig.partial().parse() before merging.
   * Only top-level fields are merged shallowly — nested objects (e.g. preferentialAttachment)
   * must be passed as complete replacements, not just the changed sub-field.
   *
   * Live-safe parameters (take effect on the next step() call):
   *   deltaPositive, deltaNegative, interactionProbability, preferentialAttachment.temperature
   * Reset-required parameters (require api.reset() + api.init() to apply correctly):
   *   world1.monolingualBilingualRatio, world2.monolingualBilingualRatio, seed
   *
   * Throws if called before init().
   */
  updateConfig(partial: Partial<ExperimentConfig>): Promise<void>;
}

// ─── Module-level mutable state ───────────────────────────────────────────────
//
// Set by init(), cleared by reset(). All six API methods close over this object.
// The RNG lives here and never crosses the wire — message ordering cannot
// influence RNG state, preserving the determinism invariant.

type WorkerState = {
  simState: SimulationState;
  rng: RNG;
  /**
   * Dedicated RNG for visualization-only operations (e.g. Louvain in getInteractionGraph).
   * Seeded from config.seed + 1 so it never shares state with the simulation RNG.
   * This ensures visualization polling does not advance state.rng and cannot break
   * the determinism invariant (run(N,...) twice → identical results).
   */
  visualizationRng: RNG;
  interactionGraph: UndirectedGraph;
  /** L2 label derived from world1.languages (sorted alphabetically by bootstrap). */
  l2Label: Language;
  scalarTimeSeries: ScalarMetricsSnapshot[];
  graphTimeSeries: GraphMetricsSnapshot[];
};

let state: WorkerState | null = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function assertInitialized(method: string): WorkerState {
  if (state === null) {
    throw new Error(`simulation worker: ${method}() called before init(). Call init() first.`);
  }
  return state;
}

/**
 * Serialize one world's agent array to structured-clone-safe quadruple-array form.
 * Flattens nested Map<Language, Map<Referent, Map<TokenLexeme, Weight>>> to
 * [language, referent, lexeme, weight][] without losing any information.
 */
function serializeAgents(agents: SimulationState['world1']['agents']): FullStateSnapshot['world1'] {
  return agents.map((agent) => {
    const inventory: Array<[string, string, string, number]> = [];
    for (const [lang, refMap] of agent.inventory) {
      for (const [ref, lexMap] of refMap) {
        for (const [lex, w] of lexMap) {
          inventory.push([lang as string, ref as string, lex as string, w as number]);
        }
      }
    }
    return {
      agentId: agent.id as string,
      class: agent.class as string,
      position: agent.position,
      inventory,
    };
  });
}

/**
 * Run one tick and collect the resulting TickReport.
 * Mutates s.simState, s.interactionGraph, s.scalarTimeSeries, s.graphTimeSeries.
 */
function runOneTick(s: WorkerState): TickReport {
  // Capture tick index before advancing (engine increments tickNumber during tick()).
  const currentTick = s.simState.tickNumber;

  const tickResult = tick(s.simState, s.rng);
  updateInteractionGraph(s.interactionGraph, tickResult.interactions);

  const scalar = computeScalarMetrics(
    tickResult.state.world1,
    tickResult.state.world2,
    tickResult.interactions,
  );
  const graph = computeGraphMetrics(
    tickResult.state.world1,
    tickResult.state.world2,
    s.interactionGraph,
    tickResult.interactions,
    { tick: currentTick, l2Label: s.l2Label, rng: s.rng },
  );

  const report: TickReport = { tick: currentTick, scalar, graph };
  s.scalarTimeSeries.push(scalar);
  s.graphTimeSeries.push(graph);
  // Advance state reference (engine mutates in place; this reassignment documents the flow).
  s.simState = tickResult.state;

  return report;
}

// ─── Implementation ───────────────────────────────────────────────────────────

/**
 * Bootstrap the simulation from a config and a deterministic seed.
 * Idempotent: calling init twice with the same seed produces identical state.
 * Calling init a second time overwrites the first call's state without error.
 */
const init: SimulationWorkerApi['init'] = async (rawConfig, seed) => {
  // Validate config at the worker boundary (defensive; callers may pass plain objects
  // deserialized from postMessage structured-clone, which loses class instances).
  const config = ExperimentConfig.parse(rawConfig);
  const { world1, world2, rng } = bootstrapExperiment(config, seed);

  // Derive L2 label using the same logic as scripts/sim-smoke.ts and engine.ts.
  // bootstrap's deriveLanguages sorts world.languages alphabetically, so
  // languages[0] = L1 ("L1") and languages[1] = L2 ("L2") in the default config.
  const l2Label = (world1.languages[1] ?? world2.languages[1] ?? world1.languages[0]) as Language;

  state = {
    simState: { world1, world2, tickNumber: 0, config },
    rng,
    // Dedicated visualization RNG seeded at config.seed + 1 so Louvain calls from
    // getInteractionGraph() never advance the simulation RNG. See WorkerState doc comment.
    visualizationRng: createRNG(seed + 1),
    interactionGraph: createInteractionGraph(),
    l2Label,
    scalarTimeSeries: [],
    graphTimeSeries: [],
  };
};

/**
 * Advance the simulation by `count` ticks (default 1).
 * Returns the TickReport for the last tick executed.
 * The intermediate reports (if count > 1) are stored in the internal time series.
 *
 * Semantics: step(10) runs 10 ticks and returns the 10th tick's report.
 * Intermediate reports are accessible via run() or a future getTickHistory() method.
 */
const step: SimulationWorkerApi['step'] = async (count = 1) => {
  const s = assertInitialized('step');

  if (count <= 0) {
    throw new Error('simulation worker: step() count must be > 0');
  }

  let lastReport: TickReport | undefined;
  for (let i = 0; i < count; i++) {
    lastReport = runOneTick(s);
  }

  return lastReport!;
};

/**
 * Run the simulation for totalTicks ticks, optionally calling onProgress each tick.
 *
 * onProgress MUST be wrapped with Comlink.proxy(callback) on the main thread —
 * bare functions throw DataCloneError (not structuredClone-safe).
 * The worker awaits each onProgress call so a slow main-thread consumer is not
 * overwhelmed at high tick rates.
 *
 * The returned RunResult.summary covers only the ticks produced by THIS call.
 * Calling run(100) then run(50) produces two independent summaries; the full
 * concatenated time series remains in the internal state.
 */
const run: SimulationWorkerApi['run'] = async (totalTicks, onProgress) => {
  const s = assertInitialized('run');

  const startIndex = s.scalarTimeSeries.length;
  const tickReports: TickReport[] = [];

  for (let i = 0; i < totalTicks; i++) {
    const report = runOneTick(s);
    tickReports.push(report);
    if (onProgress !== undefined) {
      // Await so the main thread processes each tick before the next one fires.
      await onProgress(report);
    }
  }

  const summary = computeRunSummary(
    s.scalarTimeSeries.slice(startIndex),
    s.graphTimeSeries.slice(startIndex),
    s.simState.config,
  );

  return { summary, metricsTimeSeries: tickReports };
};

/**
 * Return the latest tick's scalar and graph metrics merged into one flat object.
 * Throws if no ticks have been run yet.
 */
const getMetrics: SimulationWorkerApi['getMetrics'] = async (): Promise<{
  scalar: ScalarMetricsSnapshot;
  graph: GraphMetricsSnapshot;
}> => {
  const s = assertInitialized('getMetrics');

  if (s.scalarTimeSeries.length === 0) {
    throw new Error(
      'simulation worker: getMetrics() called before any ticks ran. Call step() or run() first.',
    );
  }

  const lastScalar = s.scalarTimeSeries[s.scalarTimeSeries.length - 1];
  const lastGraph = s.graphTimeSeries[s.graphTimeSeries.length - 1];

  return { scalar: lastScalar, graph: lastGraph };
};

/**
 * Return a structured-clone-safe snapshot of the full simulation state.
 * Agent inventories are serialized as [language, referent, lexeme, weight][] quadruples.
 * Interaction graph edges are serialized as [speakerId, hearerId, weight][] triples.
 */
const getSnapshot: SimulationWorkerApi['getSnapshot'] = async () => {
  const s = assertInitialized('getSnapshot');

  const interactionGraphEdges: Array<[string, string, number]> = s.interactionGraph
    .edges()
    .map((edgeKey) => [
      s.interactionGraph.source(edgeKey),
      s.interactionGraph.target(edgeKey),
      (s.interactionGraph.getEdgeAttribute(edgeKey, 'weight') as number) ?? 0,
    ]);

  return {
    tick: s.simState.tickNumber,
    config: s.simState.config,
    world1: serializeAgents(s.simState.world1.agents),
    world2: serializeAgents(s.simState.world2.agents),
    interactionGraphEdges,
  };
};

/**
 * Clear all simulation state. A subsequent init() call is required before
 * step() or run() — calling those without an intervening init() throws.
 */
const reset: SimulationWorkerApi['reset'] = async () => {
  state = null;
};

/**
 * Return a per-cell projection for the given world and projection kind.
 *
 * Pure read over current state — does not mutate state.rng or advance any tick.
 * The rng argument to topology.neighbors() is passed by convention even though
 * the lattice implementation does not consume it for neighbor enumeration.
 *
 * Only the fields required by the active projection kind are populated in the
 * returned CellData objects. Color computation is left to the main thread.
 */
const getLatticeProjection: SimulationWorkerApi['getLatticeProjection'] = async (worldId, kind) => {
  const s = assertInitialized('getLatticeProjection');

  const world = worldId === 'world1' ? s.simState.world1 : s.simState.world2;
  const firstReferent = world.referents[0];

  /** Find the top-weighted token for firstReferent across all languages. */
  const topTokenFor = (agent: (typeof world.agents)[number]): string | undefined => {
    let best: { lex: string; w: number } | null = null;
    for (const langMap of agent.inventory.values()) {
      const lexMap = langMap.get(firstReferent);
      if (!lexMap) continue;
      for (const [lex, w] of lexMap.entries()) {
        if (best === null || w > best.w) best = { lex: lex as string, w: w as number };
      }
    }
    return best?.lex;
  };

  if (kind === 'class') {
    return world.agents.map((a) => ({
      agentId: a.id as string,
      class: a.class,
      position: a.position,
    }));
  }

  if (kind === 'dominant-token') {
    return world.agents.map((a) => ({
      agentId: a.id as string,
      class: a.class,
      position: a.position,
      topToken: topTokenFor(a),
    }));
  }

  // kind === 'matching-rate'
  const byPosition = new Map<number, (typeof world.agents)[number]>();
  for (const a of world.agents) byPosition.set(a.position, a);

  return world.agents.map((a) => {
    const myTop = topTokenFor(a);
    let matches = 0;
    let total = 0;
    for (const npos of world.topology.neighbors(a.position, s.rng)) {
      const neighbor = byPosition.get(npos);
      if (!neighbor) continue;
      total += 1;
      if (myTop !== undefined && topTokenFor(neighbor) === myTop) matches += 1;
    }
    return {
      agentId: a.id as string,
      class: a.class,
      position: a.position,
      matchingRate: total === 0 ? 0 : matches / total,
    };
  });
};

/**
 * Return a serialized snapshot of the cumulative interaction graph for network rendering.
 *
 * Louvain community detection uses state.visualizationRng (not state.rng) so repeated
 * calls to this method do not advance the simulation RNG and cannot break determinism.
 * An empty graph (< 2 nodes or < 1 edge) returns empty communities and zero modularity.
 */
const getInteractionGraph: SimulationWorkerApi['getInteractionGraph'] = async () => {
  const s = assertInitialized('getInteractionGraph');

  const { assignments, modularity } = computeInteractionGraphCommunities(
    s.interactionGraph,
    s.visualizationRng,
  );

  return {
    graph: s.interactionGraph.export() as SerializedGraph,
    communities: Array.from(assignments.entries()),
    modularity,
    nodeCount: s.interactionGraph.order,
    edgeCount: s.interactionGraph.size,
  };
};

/**
 * Merge a partial ExperimentConfig into the worker's in-memory config.
 *
 * Live-safe fields (take effect on the next step() call without losing history):
 *   deltaPositive, deltaNegative, interactionProbability, preferentialAttachment
 * Reset-required fields (caller must reset + reinit to apply correctly):
 *   world1.monolingualBilingualRatio, world2.monolingualBilingualRatio, seed
 *
 * Validates the partial via Zod's .partial() so out-of-range values are rejected
 * at the worker boundary before they corrupt the engine's running config.
 */
const updateConfig: SimulationWorkerApi['updateConfig'] = async (partial) => {
  const s = assertInitialized('updateConfig');
  // Validate the partial against the schema. ExperimentConfig.partial() makes every
  // top-level field optional, matching the Partial<ExperimentConfig> contract exactly.
  const parsed = ExperimentConfig.partial().parse(partial);
  s.simState.config = { ...s.simState.config, ...parsed };
};

// ─── Comlink exposure ─────────────────────────────────────────────────────────
//
// No guard needed — this module only runs inside a Worker where self is always defined.

const api: SimulationWorkerApi = {
  init,
  step,
  run,
  getMetrics,
  getSnapshot,
  reset,
  getLatticeProjection,
  getInteractionGraph,
  updateConfig,
};

Comlink.expose(api);
