import type { RunSummary, ConvergenceStatus } from '@/lib/sim/metrics/types';
import { formatClassificationLabel } from '@/lib/sim/metrics/serialize';
import type { RunClassification } from '@/lib/sim/metrics/types';
import { HelpTip } from '../components/help-tip';

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
    <div data-testid="run-summary-card" className="rounded-md border border-border bg-surface p-4">
      <h2 className="font-serif text-lg font-semibold text-fg mb-3">Run summary</h2>

      <div className="flex flex-wrap gap-x-6 gap-y-2 mb-4">
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-fg-muted">
            Classification
            <HelpTip helpKey="run.classification" />
          </span>
          <span
            className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium"
            style={{ borderColor: cls.color, color: cls.color }}
          >
            {cls.label}
          </span>
        </div>

        {summary && (
          <>
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase tracking-wide text-fg-muted">
                Convergence
                <HelpTip helpKey="run.convergence" />
              </span>
              <span className="text-sm font-medium text-fg">
                {convergenceLabel(summary.convergenceStatus)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase tracking-wide text-fg-muted">
                Time to consensus
                <HelpTip helpKey="run.timeToConsensus" />
              </span>
              <span className="text-sm font-medium font-mono text-fg">
                {summary.timeToConsensus !== null
                  ? `tick ${summary.timeToConsensus}`
                  : 'not reached'}
              </span>
            </div>
          </>
        )}
      </div>

      {summary && Object.keys(summary.meanMetrics).length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-1 border-t border-border pt-3">
          {Object.entries(summary.meanMetrics)
            .slice(0, 6)
            .map(([key, val]) => (
              <div key={key} className="flex items-baseline justify-between text-sm">
                <span className="text-fg-muted">{key}</span>
                <span className="font-mono text-fg">
                  {typeof val === 'number' && Number.isFinite(val) ? val.toFixed(4) : 'N/A'}
                </span>
              </div>
            ))}
        </div>
      )}

      {!summary && <p className="text-sm text-fg-muted">Summary not available.</p>}
    </div>
  );
}
