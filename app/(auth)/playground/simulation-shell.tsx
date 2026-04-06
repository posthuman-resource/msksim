'use client';

// app/(auth)/playground/simulation-shell.tsx — Top-level client component for /playground.
//
// Owns the simulation Web Worker lifecycle (construct, init, play/pause, reset).
// Fetches lattice projection data on demand — not on every tick — to avoid
// saturating the postMessage channel (see CLAUDE.md 'Worker lifecycle').
//
// Three effects:
//   1. Worker construction (empty deps) — construct, init, warm-up, fetch first projection.
//   2. Projection/world refresh (deps: selectedWorld, projectionKind) — re-fetch when toggled.
//   3. Play/pause loop (dep: isRunning) — setInterval that steps and refreshes each beat.
//
// Cleanup order: cancelled flag → terminate() (releaseProxy then worker.terminate).
// React 19 strict-mode double-invocation is tolerated: the cancel flag + terminate()
// return function ensures the second invocation starts with a fresh worker.

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as Comlink from 'comlink';

import { createSimulationWorker } from '@/lib/sim/worker-client';
import type {
  Remote,
  WorldId,
  ProjectionKind,
  CellData,
  SimulationWorkerApi,
} from '@/lib/sim/worker-client';
import { ExperimentConfig } from '@/lib/schema/experiment';
import { LatticeCanvas } from './lattice-canvas';
import { ProjectionToggle } from './projection-toggle';
import { AgentTooltip } from './agent-tooltip';
import type { HoveredAgentInfo } from './agent-tooltip';
import { tokenToColor } from './colors';

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

type WorkerHandle = {
  api: Remote<SimulationWorkerApi>;
  terminate: () => void;
};

export function SimulationShell() {
  const workerRef = useRef<WorkerHandle | null>(null);

  const [isRunning, setIsRunning] = useState(false);
  const [currentTick, setCurrentTick] = useState(0);
  const [selectedWorld, setSelectedWorld] = useState<WorldId>('world1');
  const [projectionKind, setProjectionKind] = useState<ProjectionKind>('class');
  const [cells, setCells] = useState<CellData[]>([]);
  const [hoveredAgent, setHoveredAgent] = useState<HoveredAgentInfo | null>(null);
  const [hoveredPointer, setHoveredPointer] = useState<{ x: number; y: number } | null>(null);
  const [ready, setReady] = useState(false);

  // Keep selectedWorld and projectionKind in refs so async callbacks capture fresh values.
  const selectedWorldRef = useRef(selectedWorld);
  const projectionKindRef = useRef(projectionKind);
  useEffect(() => {
    selectedWorldRef.current = selectedWorld;
  }, [selectedWorld]);
  useEffect(() => {
    projectionKindRef.current = projectionKind;
  }, [projectionKind]);

  // ─── Effect 1: worker construction ───────────────────────────────────────────

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

  // ─── Effect 2: projection / world refresh ────────────────────────────────────

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

  // ─── Effect 3: play / pause loop ─────────────────────────────────────────────

  useEffect(() => {
    if (!isRunning) return;
    const handle = workerRef.current;
    if (!handle) return;

    const id = setInterval(() => {
      (async () => {
        try {
          const report = await handle.api.step(1);
          setCurrentTick(report.tick + 1);
          const projection = await handle.api.getLatticeProjection(
            selectedWorldRef.current,
            projectionKindRef.current,
          );
          setCells(projection);
        } catch {
          // Worker terminated mid-interval — stop the loop.
          setIsRunning(false);
        }
      })();
    }, TICK_INTERVAL_MS);

    return () => clearInterval(id);
  }, [isRunning]);

  // ─── Hover callback ───────────────────────────────────────────────────────────

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

  // ─── Legend items for dominant-token projection ───────────────────────────────

  const legendItems = useMemo(() => {
    if (projectionKind !== 'dominant-token') return [];
    const seen = new Set<string>();
    for (const c of cells) {
      if (c.topToken) seen.add(c.topToken);
    }
    const all = Array.from(seen).sort();
    return all.map((t) => ({ token: t, color: tokenToColor(t, all) }));
  }, [cells, projectionKind]);

  // ─── JSX ──────────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-4 p-6">
      {/* Header row */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Play / Pause */}
        <button
          data-testid="play-pause-button"
          onClick={() => setIsRunning((r) => !r)}
          disabled={!ready}
          className="rounded bg-blue-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50"
        >
          {isRunning ? 'Pause' : 'Play'}
        </button>

        {/* World selector */}
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

        {/* Status readout */}
        <span className="text-sm text-gray-500">
          Tick: {currentTick} &middot; World: {selectedWorld}
        </span>

        {!ready && <span className="text-sm text-gray-400 italic">Initialising…</span>}
      </div>

      {/* Projection toggle */}
      <ProjectionToggle
        projectionKind={projectionKind}
        onChange={setProjectionKind}
        legendItems={legendItems}
      />

      {/* Canvas + tooltip wrapper */}
      <div className="relative">
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
    </div>
  );
}
