'use client';

import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

import type { CellAggregate } from '@/lib/sim/sweep/aggregate';
import type { ParameterPick, SweepValue } from './sweep-runner';

interface HeatmapProps {
  parameterPicks: ParameterPick[];
  aggregates: ReadonlyMap<string, CellAggregate>;
  metricLabel: string;
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function formatValue(v: SweepValue): string {
  if (typeof v === 'number') {
    return Number.isInteger(v) ? String(v) : v.toPrecision(3);
  }
  return String(v);
}

function colorScale(t: number): string {
  // Simple HSL gradient from blue (low) to red (high). Acceptable for v1; v2
  // can swap in d3-scale-chromatic for a perceptually uniform colormap.
  const clamped = Math.max(0, Math.min(1, t));
  const hue = 240 - clamped * 240;
  return `hsl(${hue.toFixed(0)}, 75%, 50%)`;
}

function cellKeyFor(values: SweepValue[]): string {
  return JSON.stringify(values);
}

function findRange(aggregates: ReadonlyMap<string, CellAggregate>): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const a of aggregates.values()) {
    if (Number.isFinite(a.mean)) {
      if (a.mean < min) min = a.mean;
      if (a.mean > max) max = a.mean;
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };
  if (min === max) return { min: min - 0.5, max: max + 0.5 };
  return { min, max };
}

// ─── Subcomponents ───────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div
      data-testid="sweep-heatmap-empty"
      className="rounded-md border-2 border-dashed border-zinc-200 bg-zinc-50 p-8 text-center text-sm text-zinc-500"
    >
      Configure at least one parameter and run the sweep to see results.
    </div>
  );
}

function OneDimensionalBarChart({
  picks,
  aggregates,
  metricLabel,
}: {
  picks: ParameterPick[];
  aggregates: ReadonlyMap<string, CellAggregate>;
  metricLabel: string;
}) {
  const data = useMemo(
    () =>
      picks[0].values.map((v) => {
        const agg = aggregates.get(cellKeyFor([v]));
        return {
          parameterValue: formatValue(v),
          mean: agg?.mean ?? 0,
          stdDev: agg?.stdDev ?? 0,
          n: agg?.n ?? 0,
          classification: agg?.classification ?? null,
        };
      }),
    [picks, aggregates],
  );

  return (
    <div data-testid="sweep-heatmap" className="rounded-lg border border-zinc-200 bg-white p-4">
      <ResponsiveContainer width="100%" height={320}>
        <BarChart data={data} margin={{ top: 16, right: 16, left: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
          <XAxis dataKey="parameterValue" label={{ value: picks[0].label, position: 'bottom' }} />
          <YAxis label={{ value: metricLabel, angle: -90, position: 'insideLeft' }} />
          <Tooltip
            formatter={(value: unknown, _name: unknown, ctx: { payload?: { stdDev: number } }) => {
              const v = typeof value === 'number' ? value : 0;
              const sd = ctx?.payload?.stdDev ?? 0;
              return [`${v.toFixed(4)} ± ${sd.toFixed(4)}`, metricLabel];
            }}
          />
          <Bar dataKey="mean" fill="#4a90e2" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

interface GridProps {
  xPick: ParameterPick;
  yPick: ParameterPick;
  /** Optional fixed third-axis value, baked into each cell key. */
  fixedPrefix?: SweepValue[];
  /** Optional fixed third-axis value, baked into each cell key (suffix). */
  fixedSuffix?: SweepValue[];
  aggregates: ReadonlyMap<string, CellAggregate>;
  range: { min: number; max: number };
  metricLabel: string;
}

function TwoDimensionalGrid({
  xPick,
  yPick,
  fixedPrefix = [],
  fixedSuffix = [],
  aggregates,
  range,
  metricLabel,
}: GridProps) {
  const cellW = 80;
  const cellH = 60;
  const padLeft = 110;
  const padTop = 28;
  const padBottom = 40;
  const padRight = 90;

  const width = padLeft + xPick.values.length * cellW + padRight;
  const height = padTop + yPick.values.length * cellH + padBottom;

  return (
    <svg
      data-testid="sweep-heatmap"
      width={width}
      height={height}
      role="img"
      aria-label={`${metricLabel} heatmap`}
      className="block"
    >
      {/* Title */}
      <text x={padLeft} y={18} fontSize={12} fontWeight={600} fill="#27272a">
        {metricLabel}
      </text>

      {/* Y axis label */}
      <text
        x={12}
        y={padTop + (yPick.values.length * cellH) / 2}
        fontSize={11}
        fill="#52525b"
        textAnchor="middle"
        transform={`rotate(-90, 12, ${padTop + (yPick.values.length * cellH) / 2})`}
      >
        {yPick.label}
      </text>

      {/* X axis label */}
      <text
        x={padLeft + (xPick.values.length * cellW) / 2}
        y={height - 8}
        fontSize={11}
        fill="#52525b"
        textAnchor="middle"
      >
        {xPick.label}
      </text>

      {/* Y tick labels */}
      {yPick.values.map((v, yi) => (
        <text
          key={`yt-${yi}`}
          x={padLeft - 8}
          y={padTop + yi * cellH + cellH / 2 + 4}
          fontSize={10}
          fill="#71717a"
          textAnchor="end"
        >
          {formatValue(v)}
        </text>
      ))}

      {/* X tick labels */}
      {xPick.values.map((v, xi) => (
        <text
          key={`xt-${xi}`}
          x={padLeft + xi * cellW + cellW / 2}
          y={padTop + yPick.values.length * cellH + 16}
          fontSize={10}
          fill="#71717a"
          textAnchor="middle"
        >
          {formatValue(v)}
        </text>
      ))}

      {/* Cells */}
      {yPick.values.map((yv, yi) =>
        xPick.values.map((xv, xi) => {
          const key = cellKeyFor([...fixedPrefix, xv, yv, ...fixedSuffix]);
          const agg = aggregates.get(key);
          const t =
            agg && Number.isFinite(agg.mean) && range.max !== range.min
              ? (agg.mean - range.min) / (range.max - range.min)
              : 0.5;
          const fill = agg && Number.isFinite(agg.mean) ? colorScale(t) : '#e4e4e7';
          const tooltip = agg
            ? `mean=${agg.mean.toFixed(4)}\nstdDev=${agg.stdDev.toFixed(4)}\nn=${agg.n}\nclass=${agg.classification ?? 'n/a'}`
            : 'no data';
          return (
            <g key={`cell-${xi}-${yi}`} data-testid={`heatmap-cell-${xi}-${yi}`}>
              <rect
                x={padLeft + xi * cellW}
                y={padTop + yi * cellH}
                width={cellW}
                height={cellH}
                fill={fill}
                stroke="#fff"
                strokeWidth={1}
              >
                <title>{tooltip}</title>
              </rect>
              <text
                x={padLeft + xi * cellW + cellW / 2}
                y={padTop + yi * cellH + cellH / 2 + 4}
                fontSize={11}
                fill="#fafafa"
                textAnchor="middle"
                style={{ pointerEvents: 'none' }}
              >
                {agg && Number.isFinite(agg.mean) ? agg.mean.toPrecision(3) : '—'}
              </text>
            </g>
          );
        }),
      )}

      {/* Color legend */}
      <ColorBar
        x={width - padRight + 16}
        y={padTop}
        width={14}
        height={yPick.values.length * cellH}
        range={range}
      />
    </svg>
  );
}

function ColorBar({
  x,
  y,
  width,
  height,
  range,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  range: { min: number; max: number };
}) {
  const stops = 12;
  const step = height / stops;
  return (
    <g>
      {Array.from({ length: stops }).map((_, i) => {
        const t = 1 - i / (stops - 1);
        return (
          <rect
            key={`stop-${i}`}
            x={x}
            y={y + i * step}
            width={width}
            height={step + 1}
            fill={colorScale(t)}
          />
        );
      })}
      <text x={x} y={y - 4} fontSize={9} fill="#52525b">
        {range.max.toPrecision(3)}
      </text>
      <text x={x} y={y + height + 10} fontSize={9} fill="#52525b">
        {range.min.toPrecision(3)}
      </text>
    </g>
  );
}

function ThreeDimensionalSmallMultiples({
  picks,
  aggregates,
  metricLabel,
}: {
  picks: ParameterPick[];
  aggregates: ReadonlyMap<string, CellAggregate>;
  metricLabel: string;
}) {
  const range = findRange(aggregates);
  const [xPick, yPick, zPick] = picks;

  return (
    <div data-testid="sweep-heatmap" className="space-y-4">
      <div className="text-sm font-medium text-zinc-700">
        Faceted by <span className="font-semibold">{zPick.label}</span>
      </div>
      <div className="flex flex-wrap gap-6">
        {zPick.values.map((zv, zi) => (
          <div
            key={`facet-${zi}`}
            data-testid={`sweep-heatmap-facet-${zi}`}
            className="rounded-md border border-zinc-200 bg-white p-3"
          >
            <div className="mb-2 text-xs font-semibold text-zinc-700">
              {zPick.label} = {formatValue(zv)}
            </div>
            <TwoDimensionalGrid
              xPick={xPick}
              yPick={yPick}
              fixedSuffix={[zv]}
              aggregates={aggregates}
              range={range}
              metricLabel={metricLabel}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main entry ──────────────────────────────────────────────────────────────

export function Heatmap({ parameterPicks, aggregates, metricLabel }: HeatmapProps) {
  const dim = parameterPicks.length;
  const range = useMemo(() => findRange(aggregates), [aggregates]);

  if (dim === 0 || aggregates.size === 0) return <EmptyState />;
  if (dim === 1) {
    return (
      <OneDimensionalBarChart
        picks={parameterPicks}
        aggregates={aggregates}
        metricLabel={metricLabel}
      />
    );
  }
  if (dim === 2) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white p-4">
        <TwoDimensionalGrid
          xPick={parameterPicks[0]}
          yPick={parameterPicks[1]}
          aggregates={aggregates}
          range={range}
          metricLabel={metricLabel}
        />
      </div>
    );
  }
  if (dim === 3) {
    return (
      <ThreeDimensionalSmallMultiples
        picks={parameterPicks}
        aggregates={aggregates}
        metricLabel={metricLabel}
      />
    );
  }
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-700">
      Sweep dimension {dim} is not supported. Pick 1–3 parameters.
    </div>
  );
}
