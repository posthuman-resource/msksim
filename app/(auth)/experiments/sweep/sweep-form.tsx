'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { cartesianProduct } from '@/lib/sim/sweep/cartesian-product';
import { aggregateSweep, type CellAggregate } from '@/lib/sim/sweep/aggregate';
import {
  findParameter,
  outcomeMetricOptions,
  sweepParameters,
  type SweepParameterEntry,
} from '@/lib/sim/sweep/parameters';
import type { ExperimentConfig } from '@/lib/schema/experiment';

import { persistCompletedRun, persistFailedReplicate } from '../batch/actions';
import { loadRunSummary } from './actions';
import {
  createSweepRunner,
  type ParameterPick,
  type SweepRunner,
  type SweepState,
  type SweepValue,
} from './sweep-runner';
import { Heatmap } from './heatmap';

// ─── Props ───────────────────────────────────────────────────────────────────

interface ConfigOption {
  id: string;
  name: string;
  config: ExperimentConfig;
}

interface SweepFormProps {
  configs: ConfigOption[];
  initialConfigId: string | null;
}

// ─── Initial state ───────────────────────────────────────────────────────────

const INITIAL_STATE: SweepState = {
  phase: 'idle',
  cells: [],
  cellReplicates: new Map(),
  startedAt: null,
  finishedAt: null,
};

// ─── Range parsing helpers ───────────────────────────────────────────────────

/**
 * Parse a textarea string of numeric values. Accepts:
 *   - "0.1, 0.2, 0.3"        (explicit list)
 *   - "0.1:0.5:0.1"          (start:stop:step inclusive of stop within tolerance)
 *   - "0.1..0.5 step 0.1"    (alias)
 * Returns the deduped, sorted list of numbers, or an empty list if the input
 * is unparseable.
 */
function parseNumericValues(input: string): number[] {
  const trimmed = input.trim();
  if (!trimmed) return [];

  const colon = trimmed.match(/^(-?\d*\.?\d+)\s*:\s*(-?\d*\.?\d+)\s*:\s*(-?\d*\.?\d+)$/);
  if (colon) {
    const [, a, b, s] = colon;
    return expandRange(Number(a), Number(b), Number(s));
  }
  const dotdot = trimmed.match(/^(-?\d*\.?\d+)\s*\.\.\s*(-?\d*\.?\d+)\s+step\s+(-?\d*\.?\d+)$/i);
  if (dotdot) {
    const [, a, b, s] = dotdot;
    return expandRange(Number(a), Number(b), Number(s));
  }
  // Fallback: comma- or whitespace-separated list.
  const parts = trimmed.split(/[,\s]+/).filter((p) => p.length > 0);
  const out: number[] = [];
  for (const p of parts) {
    const n = Number(p);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

function expandRange(start: number, stop: number, step: number): number[] {
  if (!Number.isFinite(start) || !Number.isFinite(stop) || !Number.isFinite(step) || step <= 0) {
    return [];
  }
  const out: number[] = [];
  const tol = step * 1e-9;
  for (let v = start; v <= stop + tol; v += step) {
    out.push(Number(v.toFixed(10)));
  }
  return out;
}

// ─── Parameter row ───────────────────────────────────────────────────────────

interface ParamRow {
  rowId: number;
  path: string | null;
  /** Free-text value for numeric ranges; per-row local state. */
  numericText: string;
  /** Selected enum/boolean values. */
  selectedValues: SweepValue[];
}

function emptyRow(rowId: number): ParamRow {
  return { rowId, path: null, numericText: '', selectedValues: [] };
}

function rowToValues(row: ParamRow, entry: SweepParameterEntry | null): SweepValue[] {
  if (!entry) return [];
  if (entry.kind.kind === 'number') return parseNumericValues(row.numericText);
  return row.selectedValues;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function SweepForm({ configs, initialConfigId }: SweepFormProps) {
  // Form state
  const [selectedConfigId, setSelectedConfigId] = useState<string>(
    initialConfigId ?? configs[0]?.id ?? '',
  );
  const [rows, setRows] = useState<ParamRow[]>([emptyRow(0)]);
  const nextRowIdRef = useRef(1);
  const [replicatesPerCell, setReplicatesPerCell] = useState(3);
  const [totalTicks, setTotalTicks] = useState(50);
  // Lazy init avoids reading `navigator` during SSR (it is undefined there).
  const [concurrency, setConcurrency] = useState<number>(() =>
    typeof navigator === 'undefined'
      ? 1
      : Math.max(1, Math.min(8, (navigator.hardwareConcurrency ?? 2) - 1)),
  );

  // Outcome metric for the heatmap (post-completion)
  const [outcomeMetric, setOutcomeMetric] = useState<string>(outcomeMetricOptions[0].selector);

  // Pre-compute the flat values array for each row
  const picks: ParameterPick[] = useMemo(() => {
    const out: ParameterPick[] = [];
    for (const row of rows) {
      if (!row.path) continue;
      const entry = findParameter(row.path);
      if (!entry) continue;
      const values = rowToValues(row, entry);
      if (values.length === 0) continue;
      out.push({ path: row.path, label: entry.label, values });
    }
    return out;
  }, [rows]);

  const totalCells = useMemo(
    () => (picks.length === 0 ? 0 : cartesianProduct(picks.map((p) => p.values)).length),
    [picks],
  );
  const totalRuns = totalCells * replicatesPerCell;

  // Sweep runner, persisted across renders
  const runnerRef = useRef<SweepRunner | null>(null);

  useEffect(() => {
    const runner = createSweepRunner({
      persistCompleted: persistCompletedRun,
      persistFailed: persistFailedReplicate,
      loadRunSummary,
    });
    runnerRef.current = runner;
    return () => {
      runner.cancel();
      runnerRef.current = null;
    };
  }, []);

  const subscribe = useCallback(
    (cb: () => void) => runnerRef.current?.onUpdate(cb) ?? (() => {}),
    [],
  );
  const getSnapshot = useCallback(() => runnerRef.current?.getState() ?? INITIAL_STATE, []);
  const sweepState = useSyncExternalStore(subscribe, getSnapshot, () => INITIAL_STATE);

  // Compute aggregates whenever metric or sweep state changes (post-completion)
  const aggregates = useMemo<Map<string, CellAggregate>>(() => {
    if (sweepState.cellReplicates.size === 0) return new Map();
    return aggregateSweep(sweepState.cellReplicates, outcomeMetric);
  }, [sweepState.cellReplicates, outcomeMetric]);

  const isRunning = sweepState.phase === 'running';
  const isTerminal = sweepState.phase === 'completed' || sweepState.phase === 'cancelled';

  function handleStart() {
    const selected = configs.find((c) => c.id === selectedConfigId);
    if (!selected || !runnerRef.current) return;
    if (picks.length === 0) return;
    runnerRef.current.startSweep({
      baseConfig: selected.config,
      configId: selected.id,
      parameterPicks: picks,
      replicatesPerCell,
      totalTicks,
      concurrency,
      baseSeed: 1,
    });
  }

  function handleCancel() {
    runnerRef.current?.cancel();
  }

  // Row helpers
  function addRow() {
    if (rows.length >= 3) return;
    const id = nextRowIdRef.current++;
    setRows((rs) => [...rs, emptyRow(id)]);
  }
  function removeRow(rowId: number) {
    setRows((rs) => rs.filter((r) => r.rowId !== rowId));
  }
  function updateRow(rowId: number, patch: Partial<ParamRow>) {
    setRows((rs) => rs.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r)));
  }

  const usedPaths = new Set(rows.map((r) => r.path).filter((p): p is string => p !== null));
  const metricLabel =
    outcomeMetricOptions.find((o) => o.selector === outcomeMetric)?.label ?? outcomeMetric;

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div data-testid="sweep-form" className="mx-auto max-w-5xl space-y-6 pb-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-zinc-900">Parameter sweep</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Vary 1–3 parameters across a grid of values; each cell runs N replicates through the
            batch queue.
          </p>
        </div>
        <span data-testid="sweep-phase" className="text-sm font-medium text-zinc-500">
          {sweepState.phase}
        </span>
      </div>

      {sweepState.phase === 'idle' && (
        <div className="space-y-6 rounded-lg border border-zinc-200 bg-white p-6">
          <div>
            <label className="block text-sm font-medium text-zinc-700">Base configuration</label>
            <select
              data-testid="sweep-config-select"
              className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
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

          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="block text-sm font-medium text-zinc-700">
                Sweep parameters ({rows.length}/3)
              </label>
              <button
                data-testid="sweep-add-parameter"
                onClick={addRow}
                disabled={rows.length >= 3}
                className="rounded-md bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-200 disabled:opacity-50"
              >
                Add parameter
              </button>
            </div>

            <div className="space-y-3">
              {rows.map((row, rowIndex) => (
                <ParameterRow
                  key={row.rowId}
                  rowIndex={rowIndex}
                  row={row}
                  usedPaths={usedPaths}
                  onUpdate={(patch) => updateRow(row.rowId, patch)}
                  onRemove={() => removeRow(row.rowId)}
                  canRemove={rows.length > 1}
                />
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-zinc-700">Replicates per cell</label>
              <input
                data-testid="sweep-replicates"
                type="number"
                min={1}
                max={30}
                value={replicatesPerCell}
                onChange={(e) =>
                  setReplicatesPerCell(Math.max(1, Math.min(30, Number(e.target.value) || 1)))
                }
                className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700">Total ticks</label>
              <input
                data-testid="sweep-total-ticks"
                type="number"
                min={1}
                value={totalTicks}
                onChange={(e) => setTotalTicks(Math.max(1, Number(e.target.value) || 50))}
                className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700">Concurrency</label>
              <input
                data-testid="sweep-concurrency"
                type="number"
                min={1}
                max={8}
                value={concurrency}
                onChange={(e) =>
                  setConcurrency(Math.max(1, Math.min(8, Number(e.target.value) || 1)))
                }
                className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md bg-zinc-50 px-4 py-3">
            <div>
              <div className="text-xs uppercase tracking-wide text-zinc-500">Total runs</div>
              <div data-testid="sweep-total-runs" className="text-lg font-semibold text-zinc-900">
                {totalCells} cells × {replicatesPerCell} replicates = {totalRuns}
              </div>
            </div>
            {totalRuns > 500 && (
              <div
                data-testid="sweep-large-warning"
                className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs font-medium text-red-700"
              >
                Warning: {totalRuns} runs exceeds the 500-run guardrail.
              </div>
            )}
          </div>

          <button
            data-testid="sweep-start-button"
            onClick={handleStart}
            disabled={!selectedConfigId || picks.length === 0 || totalRuns === 0}
            className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Start sweep
          </button>
        </div>
      )}

      {(isRunning || isTerminal) && <SweepProgress sweepState={sweepState} totalRuns={totalRuns} />}

      {isRunning && (
        <div className="flex justify-end">
          <button
            data-testid="sweep-cancel-button"
            onClick={handleCancel}
            className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            Cancel sweep
          </button>
        </div>
      )}

      {isTerminal && (
        <div className="space-y-4 rounded-lg border border-zinc-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-zinc-900">Results</h2>
            <div>
              <label className="mr-2 text-sm text-zinc-600">Metric:</label>
              <select
                data-testid="sweep-metric-select"
                className="rounded-md border border-zinc-300 px-2 py-1 text-sm"
                value={outcomeMetric}
                onChange={(e) => setOutcomeMetric(e.target.value)}
              >
                {outcomeMetricOptions.map((o) => (
                  <option key={o.selector} value={o.selector}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <Heatmap parameterPicks={picks} aggregates={aggregates} metricLabel={metricLabel} />
        </div>
      )}
    </div>
  );
}

// ─── Per-row parameter editor ────────────────────────────────────────────────

function ParameterRow({
  rowIndex,
  row,
  usedPaths,
  onUpdate,
  onRemove,
  canRemove,
}: {
  rowIndex: number;
  row: ParamRow;
  usedPaths: Set<string>;
  onUpdate: (patch: Partial<ParamRow>) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const entry = row.path ? findParameter(row.path) : null;
  const availableEntries = sweepParameters.filter(
    (p) => !usedPaths.has(p.path) || p.path === row.path,
  );

  return (
    <div
      data-testid={`sweep-param-row-${rowIndex}`}
      className="rounded-md border border-zinc-200 bg-zinc-50 p-3"
    >
      <div className="flex items-center gap-2">
        <select
          data-testid={`sweep-param-path-${rowIndex}`}
          className="flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm"
          value={row.path ?? ''}
          onChange={(e) => {
            const newPath = e.target.value || null;
            const newEntry = newPath ? findParameter(newPath) : null;
            onUpdate({
              path: newPath,
              numericText: '',
              selectedValues: newEntry?.kind.kind === 'boolean' ? [] : [],
            });
          }}
        >
          <option value="">— select parameter —</option>
          {availableEntries.map((p) => (
            <option key={p.path} value={p.path}>
              {p.label}
            </option>
          ))}
        </select>
        {canRemove && (
          <button
            data-testid={`sweep-param-remove-${rowIndex}`}
            onClick={onRemove}
            className="rounded-md bg-zinc-200 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-300"
            aria-label="Remove parameter"
          >
            Remove
          </button>
        )}
      </div>

      {entry && <p className="mt-1 text-xs text-zinc-500">{entry.description}</p>}

      {entry?.kind.kind === 'number' && (
        <div className="mt-2">
          <label className="block text-xs font-medium text-zinc-700">
            Values (comma-separated, or start:stop:step)
          </label>
          <input
            data-testid={`sweep-param-values-${rowIndex}`}
            type="text"
            placeholder="e.g. 0.3, 0.6  or  0.1:0.5:0.1"
            className="mt-1 w-full rounded-md border border-zinc-300 px-2 py-1 font-mono text-sm"
            value={row.numericText}
            onChange={(e) => onUpdate({ numericText: e.target.value })}
          />
          <div className="mt-1 text-xs text-zinc-500">
            Parsed: [{parseNumericValues(row.numericText).join(', ') || '—'}]
          </div>
        </div>
      )}

      {entry?.kind.kind === 'boolean' && (
        <div className="mt-2 flex gap-4">
          {[true, false].map((b) => {
            const checked = row.selectedValues.includes(b);
            return (
              <label key={String(b)} className="flex items-center gap-1 text-sm">
                <input
                  data-testid={`sweep-param-bool-${rowIndex}-${String(b)}`}
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...row.selectedValues.filter((v) => v !== b), b]
                      : row.selectedValues.filter((v) => v !== b);
                    onUpdate({ selectedValues: next });
                  }}
                />
                {String(b)}
              </label>
            );
          })}
        </div>
      )}

      {entry?.kind.kind === 'enum' && (
        <div className="mt-2 flex flex-wrap gap-3">
          {entry.kind.values.map((v) => {
            const checked = row.selectedValues.includes(v);
            return (
              <label key={v} className="flex items-center gap-1 text-sm">
                <input
                  data-testid={`sweep-param-enum-${rowIndex}-${v}`}
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...row.selectedValues.filter((x) => x !== v), v]
                      : row.selectedValues.filter((x) => x !== v);
                    onUpdate({ selectedValues: next });
                  }}
                />
                {v}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Progress display ────────────────────────────────────────────────────────

function SweepProgress({ sweepState, totalRuns }: { sweepState: SweepState; totalRuns: number }) {
  const completedReplicates = sweepState.cells.reduce(
    (acc, c) =>
      acc +
      c.replicates.filter(
        (r) => r.status === 'completed' || r.status === 'failed' || r.status === 'cancelled',
      ).length,
    0,
  );
  const denom = totalRuns || sweepState.cells.length;
  const pct = denom > 0 ? Math.round((completedReplicates / denom) * 100) : 0;

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4" data-testid="sweep-progress">
      <div className="mb-2 flex items-center justify-between text-sm text-zinc-600">
        <span>
          {completedReplicates} / {denom} replicates terminal
        </span>
        <span>{pct}%</span>
      </div>
      <div className="h-2 rounded-full bg-zinc-200">
        <div className="h-2 rounded-full bg-blue-600 transition-all" style={{ width: `${pct}%` }} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {sweepState.cells.map((c) => (
          <div
            key={c.cellKey}
            data-testid={`sweep-cell-${c.cellIndex}`}
            className={`rounded-md border p-2 text-xs ${
              c.status === 'completed'
                ? 'border-green-300 bg-green-50 text-green-700'
                : c.status === 'running'
                  ? 'border-blue-300 bg-blue-50 text-blue-700'
                  : c.status === 'cancelled'
                    ? 'border-amber-300 bg-amber-50 text-amber-700'
                    : 'border-zinc-200 bg-zinc-50 text-zinc-500'
            }`}
          >
            <div className="font-medium">cell {c.cellIndex}</div>
            <div className="truncate">{c.parameterValues.map((v) => String(v)).join(', ')}</div>
            <div className="mt-1">{c.status}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
