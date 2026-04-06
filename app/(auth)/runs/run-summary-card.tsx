import type { RunSummary, ConvergenceStatus } from '@/lib/sim/metrics/types';
import { formatClassificationLabel } from '@/lib/sim/metrics/serialize';
import type { RunClassification } from '@/lib/sim/metrics/types';

function convergenceLabel(status: ConvergenceStatus): string {
  switch (status) {
    case 'converged':
      return 'Converged';
    case 'metastable':
      return 'Metastable';
    case 'diverged':
      return 'Diverged';
    case 'unresolved':
      return 'Unresolved';
  }
}

export function RunSummaryCard({
  summary,
  classification,
}: {
  summary: RunSummary | null;
  classification: RunClassification | null;
}) {
  const cls = formatClassificationLabel(classification);

  return (
    <div data-testid="run-summary-card" className="rounded-lg bg-white p-4 shadow-sm">
      <h2 className="text-lg font-semibold text-zinc-900 mb-3">Run Summary</h2>

      <div className="flex flex-wrap gap-4 mb-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-zinc-500">Classification:</span>
          <span
            className="inline-block rounded px-2 py-0.5 text-xs font-semibold text-white"
            style={{ backgroundColor: cls.color }}
          >
            {cls.label}
          </span>
        </div>

        {summary && (
          <>
            <div className="flex items-center gap-2">
              <span className="text-sm text-zinc-500">Convergence:</span>
              <span className="text-sm font-medium text-zinc-800">
                {convergenceLabel(summary.convergenceStatus)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-zinc-500">Time to consensus:</span>
              <span className="text-sm font-medium text-zinc-800">
                {summary.timeToConsensus !== null ? `Tick ${summary.timeToConsensus}` : 'Not reached'}
              </span>
            </div>
          </>
        )}
      </div>

      {summary && Object.keys(summary.meanMetrics).length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {Object.entries(summary.meanMetrics)
            .slice(0, 6)
            .map(([key, val]) => (
              <div key={key} className="text-sm">
                <span className="text-zinc-500">{key}: </span>
                <span className="font-medium text-zinc-800">
                  {typeof val === 'number' && Number.isFinite(val) ? val.toFixed(4) : 'N/A'}
                </span>
              </div>
            ))}
        </div>
      )}

      {!summary && (
        <p className="text-sm text-zinc-500">Summary not available.</p>
      )}
    </div>
  );
}
