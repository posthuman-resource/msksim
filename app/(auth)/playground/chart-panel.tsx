'use client';

// chart-panel.tsx — Shared wrapper for a single Recharts LineChart with
// Y-axis mode override and pin-to-large-view affordances.
// All Recharts imports live here; metrics-dashboard.tsx does not import from 'recharts'.
//
// Y-axis modes:
//   'auto'     — Recharts auto-scale (domain: ['auto', 'auto'])
//   'zeroOne'  — Fixed [0, 1] range (useful for rates/indices)
//   'custom'   — User-supplied [min, max] via the popover inputs
//
// Pin toggle: promotes the panel to col-span-full in the parent grid.
// syncId prop: synchronized tooltip crosshair across all charts with the same syncId.

import { useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

export interface SeriesConfig {
  dataKey: string;
  name: string;
  color: string;
}

export type YAxisMode = 'auto' | 'zeroOne' | 'custom';

export interface ChartPanelProps {
  title: string;
  series: SeriesConfig[];
  data: Array<Record<string, number | null>>;
  yAxisMode: YAxisMode;
  yAxisCustomMin?: number;
  yAxisCustomMax?: number;
  onYAxisModeChange: (mode: YAxisMode, min?: number, max?: number) => void;
  isPinned: boolean;
  onPinToggle: () => void;
  syncId?: string;
  testId?: string;
}

function yAxisDomain(
  mode: YAxisMode,
  customMin?: number,
  customMax?: number,
): [number | string, number | string] {
  if (mode === 'zeroOne') return [0, 1];
  if (mode === 'custom') return [customMin ?? 0, customMax ?? 1];
  return ['auto', 'auto'];
}

interface YAxisPopoverProps {
  mode: YAxisMode;
  customMin: number;
  customMax: number;
  onChange: (mode: YAxisMode, min?: number, max?: number) => void;
  onClose: () => void;
}

function YAxisPopover({ mode, customMin, customMax, onChange, onClose }: YAxisPopoverProps) {
  const [localMin, setLocalMin] = useState(customMin);
  const [localMax, setLocalMax] = useState(customMax);

  const pick = (m: YAxisMode) => {
    if (m === 'custom') {
      onChange(m, localMin, localMax);
    } else {
      onChange(m);
    }
    onClose();
  };

  return (
    <div className="absolute right-0 top-8 z-10 rounded border border-gray-700 bg-gray-800 p-2 shadow-lg text-xs w-44">
      <div className="flex flex-col gap-1">
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="radio"
            name="ymode"
            checked={mode === 'auto'}
            onChange={() => pick('auto')}
          />
          Auto
        </label>
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="radio"
            name="ymode"
            checked={mode === 'zeroOne'}
            onChange={() => pick('zeroOne')}
          />
          0 to 1
        </label>
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="radio"
            name="ymode"
            checked={mode === 'custom'}
            onChange={() => {
              onChange('custom', localMin, localMax);
            }}
          />
          Custom
        </label>
        {mode === 'custom' && (
          <div className="flex flex-col gap-1 pl-4">
            <label className="flex items-center gap-1">
              Min
              <input
                type="number"
                value={localMin}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  setLocalMin(v);
                  onChange('custom', v, localMax);
                }}
                className="w-16 rounded border border-gray-600 bg-gray-900 px-1 py-0.5 text-gray-200"
              />
            </label>
            <label className="flex items-center gap-1">
              Max
              <input
                type="number"
                value={localMax}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  setLocalMax(v);
                  onChange('custom', localMin, v);
                }}
                className="w-16 rounded border border-gray-600 bg-gray-900 px-1 py-0.5 text-gray-200"
              />
            </label>
          </div>
        )}
      </div>
    </div>
  );
}

export function ChartPanel({
  title,
  series,
  data,
  yAxisMode,
  yAxisCustomMin = 0,
  yAxisCustomMax = 1,
  onYAxisModeChange,
  isPinned,
  onPinToggle,
  syncId,
  testId,
}: ChartPanelProps) {
  const [yAxisPopoverOpen, setYAxisPopoverOpen] = useState(false);

  const domain = yAxisDomain(yAxisMode, yAxisCustomMin, yAxisCustomMax);

  return (
    <div
      data-testid={testId}
      className={`relative rounded border border-gray-700 bg-gray-900 p-2 ${
        isPinned ? 'col-span-full row-span-2 min-h-[24rem]' : 'col-span-1 min-h-[14rem]'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-800 pb-1 mb-1">
        <h3 className="text-sm font-medium text-gray-200 truncate">{title}</h3>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setYAxisPopoverOpen((o) => !o)}
            className="text-xs text-gray-400 hover:text-gray-200"
            aria-haspopup="menu"
          >
            Y: {yAxisMode}
          </button>
          <button
            type="button"
            onClick={onPinToggle}
            aria-pressed={isPinned}
            data-testid={testId ? `${testId}-pin` : undefined}
            className="text-xs text-gray-400 hover:text-gray-200"
          >
            {isPinned ? 'Unpin' : 'Pin'}
          </button>
        </div>
      </div>

      {/* Y-axis mode popover */}
      {yAxisPopoverOpen && (
        <YAxisPopover
          mode={yAxisMode}
          customMin={yAxisCustomMin}
          customMax={yAxisCustomMax}
          onChange={(mode, min, max) => {
            onYAxisModeChange(mode, min, max);
          }}
          onClose={() => setYAxisPopoverOpen(false)}
        />
      )}

      {/* Chart body */}
      <div className="h-[calc(100%-2.5rem)] w-full min-h-[10rem]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            syncId={syncId}
            margin={{ top: 8, right: 16, bottom: 8, left: 16 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis dataKey="tick" tick={{ fontSize: 11 }} stroke="#9ca3af" />
            <YAxis domain={domain} tick={{ fontSize: 11 }} stroke="#9ca3af" />
            <Tooltip contentStyle={{ background: '#1f2937', border: '1px solid #374151' }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {series.map((s) => (
              <Line
                key={s.dataKey}
                dataKey={s.dataKey}
                name={s.name}
                stroke={s.color}
                dot={false}
                isAnimationActive={false}
                strokeWidth={1.5}
                connectNulls={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
