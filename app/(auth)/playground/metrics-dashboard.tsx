'use client';

// metrics-dashboard.tsx — Top-level F9 Live metrics dashboard (docs/spec.md §4.2).
//
// Renders seven synchronized Recharts LineCharts for the core per-tick observables:
//   1. Communication success rate (world1, world2, combined)
//   2. Distinct active tokens Nw (world1, world2)
//   3. Mean token weight (world1, world2)
//   4. Largest cluster size (world1, world2)
//   5. Louvain modularity of cumulative interaction graph (combined)
//   6. Assimilation index (cross-world; null gaps rendered as line breaks)
//   7. Segregation index (world2 immigrants)
//
// All Recharts imports are inside chart-panel.tsx — this file imports only ChartPanel
// so the recharts bundle chunk is not duplicated in the module graph.
//
// Color scheme: Okabe-Ito 8-color qualitative palette (colorblind-safe).
// Reference: https://jfly.uni-koeln.de/color/

import { useMemo, useState } from 'react';

import { ChartPanel } from './chart-panel';
import type { YAxisMode } from './chart-panel';
import { getHistoryWindow } from './metrics-history';
import type { MetricsHistory, TickReport } from './metrics-history';

// ─── Okabe-Ito colorblind-safe palette ───────────────────────────────────────
// Reserved assignment: sky-blue = World 1, vermillion = World 2, bluish-green = Combined
const COLORS = {
  skyBlue: '#56B4E9',
  vermillion: '#D55E00',
  bluishGreen: '#009E73',
  blue: '#0072B2',
  orange: '#E69F00',
  reddishPurple: '#CC79A7',
};

// ─── Mean token weight helper ─────────────────────────────────────────────────

/**
 * Compute the mean token weight across all languages in a perLanguage record.
 * Returns NaN when no valid (non-NaN) per-language mean exists.
 * This is a v1 simplification; step 25's language selector will refine this.
 */
function meanOverLanguages(
  perLanguage: Record<string, { meanTokenWeight: number }>,
): number {
  const vals = Object.values(perLanguage)
    .map((v) => v.meanTokenWeight)
    .filter((v) => !isNaN(v));
  if (vals.length === 0) return NaN;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

// ─── Chart configuration ──────────────────────────────────────────────────────

interface ChartConfig {
  id: string;
  title: string;
  series: Array<{ dataKey: string; name: string; color: string }>;
  shaper: (r: TickReport) => Record<string, number | null>;
  defaultYAxisMode: YAxisMode;
}

const CHART_CONFIGS: ChartConfig[] = [
  {
    id: 'success-rate',
    title: 'Communication Success Rate',
    series: [
      { dataKey: 'world1', name: 'World 1', color: COLORS.skyBlue },
      { dataKey: 'world2', name: 'World 2', color: COLORS.vermillion },
      { dataKey: 'overall', name: 'Combined', color: COLORS.bluishGreen },
    ],
    defaultYAxisMode: 'auto',
    shaper: (r) => ({
      tick: r.tick,
      world1: r.scalar.world1.successRate.rate,
      world2: r.scalar.world2.successRate.rate,
      overall: r.scalar.overall.successRate.rate,
    }),
  },
  {
    id: 'distinct-tokens',
    title: 'Distinct Active Tokens (Nw)',
    series: [
      { dataKey: 'world1', name: 'World 1', color: COLORS.skyBlue },
      { dataKey: 'world2', name: 'World 2', color: COLORS.vermillion },
    ],
    defaultYAxisMode: 'auto',
    shaper: (r) => ({
      tick: r.tick,
      world1: r.scalar.world1.distinctActiveTokens,
      world2: r.scalar.world2.distinctActiveTokens,
    }),
  },
  {
    id: 'mean-weight',
    title: 'Mean Token Weight',
    series: [
      { dataKey: 'world1', name: 'World 1', color: COLORS.skyBlue },
      { dataKey: 'world2', name: 'World 2', color: COLORS.vermillion },
    ],
    defaultYAxisMode: 'auto',
    shaper: (r) => ({
      tick: r.tick,
      world1: meanOverLanguages(r.scalar.world1.perLanguage),
      world2: meanOverLanguages(r.scalar.world2.perLanguage),
    }),
  },
  {
    id: 'largest-cluster',
    title: 'Largest Cluster Size',
    series: [
      { dataKey: 'world1', name: 'World 1', color: COLORS.skyBlue },
      { dataKey: 'world2', name: 'World 2', color: COLORS.vermillion },
    ],
    defaultYAxisMode: 'auto',
    shaper: (r) => ({
      tick: r.tick,
      world1: r.graph.world1.largestClusterSize,
      world2: r.graph.world2.largestClusterSize,
    }),
  },
  {
    id: 'modularity',
    title: 'Louvain Modularity (cumulative graph)',
    series: [{ dataKey: 'combined', name: 'Combined', color: COLORS.bluishGreen }],
    defaultYAxisMode: 'auto',
    shaper: (r) => ({
      tick: r.tick,
      combined: r.graph.interactionGraphModularity,
    }),
  },
  {
    id: 'assimilation',
    title: 'Assimilation Index (W2)',
    series: [{ dataKey: 'value', name: 'Assimilation', color: COLORS.skyBlue }],
    defaultYAxisMode: 'zeroOne',
    shaper: (r) => ({
      tick: r.tick,
      // null renders as a gap in Recharts (connectNulls={false}), which is correct
      // semantics for ticks with no W2-Immigrant ↔ W2-Native interactions.
      value: r.graph.assimilationIndex,
    }),
  },
  {
    id: 'segregation',
    title: 'Segregation Index (W2-Immigrants)',
    series: [{ dataKey: 'value', name: 'Segregation', color: COLORS.vermillion }],
    defaultYAxisMode: 'auto',
    shaper: (r) => ({
      tick: r.tick,
      value: r.graph.segregationIndex,
    }),
  },
];

// ─── Y-axis state ─────────────────────────────────────────────────────────────

interface YAxisConfig {
  mode: YAxisMode;
  min?: number;
  max?: number;
}

function buildInitialYAxisConfigs(): Record<string, YAxisConfig> {
  return Object.fromEntries(CHART_CONFIGS.map((c) => [c.id, { mode: c.defaultYAxisMode }]));
}

// ─── Component ───────────────────────────────────────────────────────────────

export interface MetricsDashboardProps {
  history: MetricsHistory;
  /** Maximum number of ticks to render per chart. Defaults to 1000. */
  maxDisplayPoints?: number;
}

export function MetricsDashboard({ history, maxDisplayPoints = 1000 }: MetricsDashboardProps) {
  const view = useMemo(
    () => getHistoryWindow(history, maxDisplayPoints),
    [history, maxDisplayPoints],
  );

  const chartData = useMemo(
    () => Object.fromEntries(CHART_CONFIGS.map((c) => [c.id, view.map(c.shaper)])),
    [view],
  );

  const [yAxisConfigs, setYAxisConfigs] = useState<Record<string, YAxisConfig>>(
    buildInitialYAxisConfigs,
  );

  const [pinnedChartId, setPinnedChartId] = useState<string | null>(null);

  const orderedConfigs = pinnedChartId
    ? [
        CHART_CONFIGS.find((c) => c.id === pinnedChartId)!,
        ...CHART_CONFIGS.filter((c) => c.id !== pinnedChartId),
      ]
    : CHART_CONFIGS;

  return (
    <div className="flex flex-col gap-2">
      {/* Tick counter */}
      <div
        className="text-sm text-gray-400 px-4"
        data-testid="current-tick"
      >
        Tick: {view[view.length - 1]?.tick ?? 0}
      </div>

      {/* Chart grid */}
      <div
        className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 p-4"
        data-testid="metrics-dashboard"
      >
        {orderedConfigs.map((config) => {
          const yConf = yAxisConfigs[config.id];
          return (
            <ChartPanel
              key={config.id}
              testId={`chart-${config.id}`}
              title={config.title}
              series={config.series}
              data={chartData[config.id]}
              syncId="msksim-dashboard"
              yAxisMode={yConf.mode}
              yAxisCustomMin={yConf.min}
              yAxisCustomMax={yConf.max}
              onYAxisModeChange={(mode, min, max) =>
                setYAxisConfigs((prev) => ({ ...prev, [config.id]: { mode, min, max } }))
              }
              isPinned={pinnedChartId === config.id}
              onPinToggle={() =>
                setPinnedChartId((prev) => (prev === config.id ? null : config.id))
              }
            />
          );
        })}
      </div>
    </div>
  );
}
