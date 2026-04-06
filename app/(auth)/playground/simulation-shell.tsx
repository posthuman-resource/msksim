'use client';

// app/(auth)/playground/simulation-shell.tsx — Top-level client component for /playground.
//
// Owns the simulation Web Worker lifecycle (construct, init, play/pause/step/reset).
// Step 24 adds: seed state, config state, configHashShort state, tickRate state,
// handleSeedChange, handleConfigUpdate, handleRebootstrap callbacks, and ControlsPanel.
//
// Transport controls (play/pause/step/reset) and all per-run state live here.
// ControlsPanel is stateless aside from slider drafts — it receives props and callbacks.
//
// Three effects:
//   1. Worker construction (empty deps) — construct, init, warm-up, fetch first projection.
//   2. Projection/world refresh (deps: selectedWorld, projectionKind) — re-fetch when toggled.
//   3. Play/pause loop (dep: isRunning) — setInterval that steps tickRate times and refreshes.
//   4. Config-hash recomputation (dep: config) — async SHA-256 via config-hash helper.
//
// Cleanup order: cancelled flag → terminate() (releaseProxy then worker.terminate).
// React 19 strict-mode double-invocation is tolerated: the cancel flag + terminate()
// return function ensures the second invocation starts with a fresh worker.

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';

import { createSimulationWorker } from '@/lib/sim/worker-client';
import type {
  Remote,
  WorldId,
  ProjectionKind,
  CellData,
  SimulationWorkerApi,
  TickReport,
} from '@/lib/sim/worker-client';
import { ExperimentConfig } from '@/lib/schema/experiment';
import { LatticeCanvas } from './lattice-canvas';
import { ProjectionToggle } from './projection-toggle';
import { AgentTooltip } from './agent-tooltip';
import type { HoveredAgentInfo } from './agent-tooltip';
import { tokenToColor } from './colors';
import { createMetricsHistory, appendTick } from './metrics-history';
import type { MetricsHistory } from './metrics-history';
import { MetricsDashboard } from './metrics-dashboard';
import { NetworkView } from './network-view';
import { ControlsPanel } from './controls-panel';
import { computeConfigHashShort } from './config-hash';
import type { SerializedGraph } from 'graphology-types';

/** Hard-coded default config so the playground renders immediately without DB access. */
const DEFAULT_CONFIG = ExperimentConfig.parse({});
const DEFAULT_SEED = DEFAULT_CONFIG.seed;

/** Lattice dimensions from the default config (both worlds share the same topology). */
const LATTICE_WIDTH = (() => {
  const t = DEFAULT_CONFIG.world1.topology;
  return t.type === 'lattice' ? t.width : 10;
})();
const LATTICE_HEIGHT = (() => {
  const t = DEFAULT_CONFIG.world1.topology;
  return t.type === 'lattice' ? t.height : 10;
})();

/** Interval between play-mode ticks (ms). Fast enough for visible progress, not overwhelming. */
const TICK_INTERVAL_MS = 200;

/**
 * Poll the interaction graph from the worker every N ticks during play mode.
 * Low frequency so ForceAtlas2 layout runs infrequently.
 */
const INTERACTION_GRAPH_POLL_INTERVAL = 10;

/** Active view tab. */
type ViewTab = 'lattice' | 'metrics' | 'network';

type WorkerHandle = {
  api: Remote<SimulationWorkerApi>;
  terminate: () => void;
};

export function SimulationShell() {
  const workerRef = useRef<WorkerHandle | null>(null);

  // ─── Core run state ───────────────────────────────────────────────────────
  const [isRunning, setIsRunning] = useState(false);
  const [currentTick, setCurrentTick] = useState(0);
  const [ready, setReady] = useState(false);

  // ─── Step 24: seed, config, hash, tickRate ───────────────────────────────
  const [seed, setSeed] = useState(DEFAULT_SEED);
  const [config, setConfig] = useState<ExperimentConfig>(DEFAULT_CONFIG);
  const [configHashShort, setConfigHashShort] = useState('--------');
  const [tickRate, setTickRate] = useState<1 | 10 | 100 | 1000>(1);

  // Recompute config hash whenever config changes.
  useEffect(() => {
    let cancelled = false;
    computeConfigHashShort(config)
      .then((hash) => {
        if (!cancelled) setConfigHashShort(hash);
      })
      .catch(() => {
        // crypto.subtle unavailable (non-secure context in tests) — show placeholder.
        if (!cancelled) setConfigHashShort('--------');
      });
    return () => {
      cancelled = true;
    };
  }, [config]);

  // ─── Visualization state ─────────────────────────────────────────────────
  const [selectedWorld, setSelectedWorld] = useState<WorldId>('world1');
  const [projectionKind, setProjectionKind] = useState<ProjectionKind>('class');
  const [cells, setCells] = useState<CellData[]>([]);
  const [hoveredAgent, setHoveredAgent] = useState<HoveredAgentInfo | null>(null);
  const [hoveredPointer, setHoveredPointer] = useState<{ x: number; y: number } | null>(null);
  const [metricsHistory, setMetricsHistory] = useState<MetricsHistory>(() =>
    createMetricsHistory(10_000),
  );
  const [view, setView] = useState<ViewTab>('lattice');
  const [interactionGraph, setInteractionGraph] = useState<{
    graph: SerializedGraph;
    communities: Map<string, number>;
  } | null>(null);

  // Keep selectedWorld and projectionKind in refs so async callbacks capture fresh values.
  const selectedWorldRef = useRef(selectedWorld);
  const projectionKindRef = useRef(projectionKind);
  // Tick counter for low-frequency interaction-graph polling.
  const ticksSinceGraphPollRef = useRef(0);
  useEffect(() => {
    selectedWorldRef.current = selectedWorld;
  }, [selectedWorld]);
  useEffect(() => {
    projectionKindRef.current = projectionKind;
  }, [projectionKind]);

  // ─── Helper: full reset of display state ─────────────────────────────────
  // Called by handleReset, handleSeedChange, and handleRebootstrap.
  const clearDisplayState = useCallback(() => {
    setCurrentTick(0);
    setMetricsHistory(createMetricsHistory(10_000));
    setInteractionGraph(null);
    setCells([]);
    ticksSinceGraphPollRef.current = 0;
  }, []);

  // ─── Effect 1: worker construction ───────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    const handle = createSimulationWorker();
    workerRef.current = handle;

    (async () => {
      try {
        await handle.api.init(DEFAULT_CONFIG, DEFAULT_SEED);
        // Warm-up: run 5 ticks so the initial render shows non-trivial state.
        const report = await handle.api.step(5);
        if (cancelled) return;
        setCurrentTick(report.tick + 1);

        const initial = await handle.api.getLatticeProjection(
          selectedWorldRef.current,
          projectionKindRef.current,
        );
        if (cancelled) return;
        setCells(initial);
        setReady(true);
      } catch {
        // Worker was terminated before init completed (strict-mode second invocation).
      }
    })();

    return () => {
      cancelled = true;
      handle.terminate();
      workerRef.current = null;
    };
  }, []);

  // ─── Effect 2: projection / world refresh ────────────────────────────────

  useEffect(() => {
    if (!ready) return;
    const handle = workerRef.current;
    if (!handle) return;
    let cancelled = false;

    (async () => {
      try {
        const projection = await handle.api.getLatticeProjection(selectedWorld, projectionKind);
        if (!cancelled) setCells(projection);
      } catch {
        // Worker terminated or reset between request and response.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedWorld, projectionKind, ready]);

  // ─── Effect 3: play / pause loop ─────────────────────────────────────────
  // Uses tickRate to step multiple ticks per interval frame.

  // Keep tickRate in a ref so the interval callback always reads the current value.
  const tickRateRef = useRef(tickRate);
  useEffect(() => {
    tickRateRef.current = tickRate;
  }, [tickRate]);

  useEffect(() => {
    if (!isRunning) return;
    const handle = workerRef.current;
    if (!handle) return;

    const id = setInterval(() => {
      (async () => {
        try {
          const report = await handle.api.step(tickRateRef.current);
          setCurrentTick(report.tick + 1);
          setMetricsHistory((h) => appendTick(h, report as TickReport));
          const projection = await handle.api.getLatticeProjection(
            selectedWorldRef.current,
            projectionKindRef.current,
          );
          setCells(projection);

          // Low-frequency interaction-graph poll.
          ticksSinceGraphPollRef.current += tickRateRef.current;
          if (ticksSinceGraphPollRef.current >= INTERACTION_GRAPH_POLL_INTERVAL) {
            ticksSinceGraphPollRef.current = 0;
            const igReport = await handle.api.getInteractionGraph();
            setInteractionGraph({
              graph: igReport.graph,
              communities: new Map(igReport.communities),
            });
          }
        } catch {
          setIsRunning(false);
        }
      })();
    }, TICK_INTERVAL_MS);

    return () => clearInterval(id);
  }, [isRunning]);

  // ─── Transport callbacks (step 24) ───────────────────────────────────────

  const handlePlay = useCallback(() => {
    setIsRunning(true);
  }, []);

  const handlePause = useCallback(() => {
    setIsRunning(false);
  }, []);

  const handleStep = useCallback(() => {
    const handle = workerRef.current;
    if (!handle || isRunning) return;

    (async () => {
      try {
        const report = await handle.api.step(1);
        setCurrentTick(report.tick + 1);
        setMetricsHistory((h) => appendTick(h, report as TickReport));
        const projection = await handle.api.getLatticeProjection(
          selectedWorldRef.current,
          projectionKindRef.current,
        );
        setCells(projection);
      } catch {
        // Worker unavailable.
      }
    })();
  }, [isRunning]);

  const handleReset = useCallback(() => {
    const handle = workerRef.current;
    if (!handle) return;
    setIsRunning(false);

    (async () => {
      try {
        await handle.api.reset();
        await handle.api.init(config, seed);
        clearDisplayState();
        const projection = await handle.api.getLatticeProjection(
          selectedWorldRef.current,
          projectionKindRef.current,
        );
        setCells(projection);
      } catch {
        // Worker unavailable.
      }
    })();
  }, [config, seed, clearDisplayState]);

  // ─── Seed change (step 24) ────────────────────────────────────────────────

  const handleSeedChange = useCallback(
    (newSeed: number) => {
      const handle = workerRef.current;
      if (!handle) return;
      setIsRunning(false);
      setSeed(newSeed);

      (async () => {
        try {
          await handle.api.reset();
          await handle.api.init(config, newSeed);
          clearDisplayState();
          const projection = await handle.api.getLatticeProjection(
            selectedWorldRef.current,
            projectionKindRef.current,
          );
          setCells(projection);
        } catch {
          // Worker unavailable.
        }
      })();
    },
    [config, clearDisplayState],
  );

  // ─── Live config update (step 24) ────────────────────────────────────────

  const handleConfigUpdate = useCallback((partial: Partial<ExperimentConfig>) => {
    const handle = workerRef.current;
    if (!handle) return;
    setConfig((prev) => ({ ...prev, ...partial }));
    handle.api.updateConfig(partial).catch(() => {
      // Worker unavailable or not yet initialized — ignore.
    });
  }, []);

  // ─── Rebootstrap (step 24) — reset-required params ───────────────────────

  const handleRebootstrap = useCallback(
    (partial: Partial<ExperimentConfig>) => {
      const handle = workerRef.current;
      if (!handle) return;
      setIsRunning(false);
      const merged = { ...config, ...partial };
      setConfig(merged);

      (async () => {
        try {
          await handle.api.reset();
          await handle.api.init(merged, seed);
          clearDisplayState();
          const projection = await handle.api.getLatticeProjection(
            selectedWorldRef.current,
            projectionKindRef.current,
          );
          setCells(projection);
        } catch {
          // Worker unavailable.
        }
      })();
    },
    [config, seed, clearDisplayState],
  );

  // ─── Hover callback ───────────────────────────────────────────────────────

  const onHoverCell = useCallback((position: number | null, clientX: number, clientY: number) => {
    if (position === null) {
      setHoveredAgent(null);
      setHoveredPointer(null);
      return;
    }
    setHoveredPointer({ x: clientX, y: clientY });

    const handle = workerRef.current;
    if (!handle) return;

    (async () => {
      try {
        const snapshot = await handle.api.getSnapshot();
        const worldData = selectedWorldRef.current === 'world1' ? snapshot.world1 : snapshot.world2;
        const agentData = worldData.find((a) => a.position === position);
        if (!agentData) return;

        const lines: string[] = [];
        for (const [lang, ref, lex, w] of agentData.inventory) {
          lines.push(`${lang}.${ref}.${lex} = ${w.toFixed(3)}`);
        }

        setHoveredAgent({
          id: agentData.agentId,
          class: agentData.class,
          position: agentData.position,
          inventoryLines: lines,
        });
      } catch {
        // Snapshot failed — tooltip will just stay hidden.
      }
    })();
  }, []);

  // ─── Legend items for dominant-token projection ───────────────────────────

  const legendItems = useMemo(() => {
    if (projectionKind !== 'dominant-token') return [];
    const seen = new Set<string>();
    for (const c of cells) {
      if (c.topToken) seen.add(c.topToken);
    }
    const all = Array.from(seen).sort();
    return all.map((t) => ({ token: t, color: tokenToColor(t, all) }));
  }, [cells, projectionKind]);

  // ─── Tab styling helper ───────────────────────────────────────────────────

  const tabClass = (t: ViewTab) =>
    [
      'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
      view === t
        ? 'border-blue-500 text-blue-400'
        : 'border-transparent text-gray-400 hover:text-gray-200',
    ].join(' ');

  // ─── JSX ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-4 p-6">
      {/* Controls panel (step 24) */}
      <ControlsPanel
        tick={currentTick}
        isRunning={isRunning}
        ready={ready}
        seed={seed}
        config={config}
        configHashShort={configHashShort}
        tickRate={tickRate}
        onPlay={handlePlay}
        onPause={handlePause}
        onStep={handleStep}
        onReset={handleReset}
        onSeedChange={handleSeedChange}
        onTickRateChange={setTickRate}
        onConfigUpdate={handleConfigUpdate}
        onRebootstrap={handleRebootstrap}
      />

      {/* World selector row */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1" role="group" aria-label="World selector">
          {(['world1', 'world2'] as WorldId[]).map((w) => (
            <button
              key={w}
              data-testid={`world-button-${w}`}
              aria-pressed={selectedWorld === w}
              onClick={() => setSelectedWorld(w)}
              className={[
                'rounded px-3 py-1.5 text-sm font-medium transition-colors',
                selectedWorld === w
                  ? 'bg-gray-700 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300',
              ].join(' ')}
            >
              {w === 'world1' ? 'World 1' : 'World 2'}
            </button>
          ))}
        </div>

        <span className="text-sm text-gray-500">World: {selectedWorld}</span>

        {!ready && <span className="text-sm text-gray-400 italic">Initialising…</span>}
      </div>

      {/* View tab bar */}
      <div className="flex gap-0 border-b border-slate-700">
        <button
          data-testid="tab-lattice"
          onClick={() => setView('lattice')}
          className={tabClass('lattice')}
        >
          Lattice
        </button>
        <button
          data-testid="tab-metrics"
          onClick={() => setView('metrics')}
          className={tabClass('metrics')}
        >
          Metrics
        </button>
        <button
          data-testid="tab-network"
          onClick={() => setView('network')}
          className={tabClass('network')}
        >
          Network
        </button>
      </div>

      {/* Lattice view */}
      {view === 'lattice' && (
        <>
          {/* Projection toggle */}
          <ProjectionToggle
            projectionKind={projectionKind}
            onChange={setProjectionKind}
            legendItems={legendItems}
          />

          {/* Canvas + tooltip */}
          <div className="relative shrink-0 w-fit">
            <LatticeCanvas
              world={selectedWorld}
              projectionKind={projectionKind}
              cells={cells}
              latticeWidth={LATTICE_WIDTH}
              latticeHeight={LATTICE_HEIGHT}
              onHoverCell={onHoverCell}
            />
            {hoveredAgent && hoveredPointer && (
              <AgentTooltip
                agent={hoveredAgent}
                pointerX={hoveredPointer.x}
                pointerY={hoveredPointer.y}
              />
            )}
          </div>
        </>
      )}

      {/* Metrics view */}
      {view === 'metrics' && (
        <div className="flex-1 min-w-0">
          <MetricsDashboard history={metricsHistory} />
        </div>
      )}

      {/* Network view */}
      {view === 'network' && (
        <NetworkView
          graph={interactionGraph?.graph ?? null}
          communities={interactionGraph?.communities ?? null}
        />
      )}
    </div>
  );
}
