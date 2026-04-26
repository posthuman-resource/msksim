'use client';

// app/(auth)/playground/projection-toggle.tsx — Three-button projection selector.
//
// Renders "Class" / "Dominant Token" / "Matching Rate" toggle buttons plus a
// context-appropriate legend for the currently-active projection.

import type { ProjectionKind } from '@/lib/sim/worker-client';
import { classToColor } from './colors';
import { HelpTip } from '../components/help-tip';

export interface LegendItem {
  token: string;
  color: string;
}

interface ProjectionToggleProps {
  projectionKind: ProjectionKind;
  onChange: (k: ProjectionKind) => void;
  /** Used by the dominant-token legend. Precomputed by SimulationShell. */
  legendItems?: LegendItem[];
}

const KINDS: { kind: ProjectionKind; label: string; testId: string; helpKey: string }[] = [
  {
    kind: 'class',
    label: 'Class',
    testId: 'projection-button-class',
    helpKey: 'playground.projection.class',
  },
  {
    kind: 'dominant-token',
    label: 'Dominant Token',
    testId: 'projection-button-dominant-token',
    helpKey: 'playground.projection.dominantToken',
  },
  {
    kind: 'matching-rate',
    label: 'Matching Rate',
    testId: 'projection-button-matching-rate',
    helpKey: 'playground.projection.matchingRate',
  },
];

const CLASS_ENTRIES: { label: string; color: string }[] = [
  { label: 'W1-Mono', color: classToColor('W1-Mono') },
  { label: 'W1-Bi', color: classToColor('W1-Bi') },
  { label: 'W2-Native', color: classToColor('W2-Native') },
  { label: 'W2-Immigrant', color: classToColor('W2-Immigrant') },
];

export function ProjectionToggle({
  projectionKind,
  onChange,
  legendItems = [],
}: ProjectionToggleProps) {
  return (
    <div className="flex flex-col gap-2">
      {/* Projection buttons. HelpTip is a sibling, not a child — nesting a
          <button> inside a <button> is invalid HTML and triggers a hydration
          error in React 19. */}
      <div className="flex gap-1" role="group" aria-label="Projection kind">
        {KINDS.map(({ kind, label, testId, helpKey }) => (
          <span key={kind} className="inline-flex items-center">
            <button
              data-testid={testId}
              aria-pressed={projectionKind === kind}
              onClick={() => onChange(kind)}
              className={[
                'rounded px-3 py-1 text-sm font-medium transition-colors',
                projectionKind === kind
                  ? 'bg-accent text-accent-fg'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300',
              ].join(' ')}
            >
              {label}
            </button>
            <HelpTip helpKey={helpKey} variant="dark" />
          </span>
        ))}
      </div>

      {/* Legend */}
      <div
        data-testid="projection-legend"
        className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-700"
      >
        {projectionKind === 'class' &&
          CLASS_ENTRIES.map(({ label, color }) => (
            <span key={label} className="flex items-center gap-1">
              <span
                className="inline-block h-3 w-3 rounded-sm"
                style={{ backgroundColor: color }}
              />
              {label}
            </span>
          ))}

        {projectionKind === 'dominant-token' &&
          (legendItems.length > 0 ? (
            legendItems.map(({ token, color }) => (
              <span key={token} className="flex items-center gap-1">
                <span
                  className="inline-block h-3 w-3 rounded-sm"
                  style={{ backgroundColor: color }}
                />
                {token}
              </span>
            ))
          ) : (
            <span className="text-gray-400 italic">No tokens yet</span>
          ))}

        {projectionKind === 'matching-rate' && (
          <>
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-3 rounded-sm bg-red-500" />
              Low match
            </span>
            <span
              className="inline-block h-3 w-12 rounded-sm"
              style={{ background: 'linear-gradient(to right, #ef4444, #22c55e)' }}
            />
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-3 rounded-sm bg-green-500" />
              High match
            </span>
          </>
        )}
      </div>
    </div>
  );
}
