'use client';

import { useMemo } from 'react';

import { MetricsDashboard } from '@/app/(auth)/playground/metrics-dashboard';
import { createMetricsHistory, appendTick } from '@/app/(auth)/playground/metrics-history';
import type { TickReport } from '@/app/(auth)/playground/metrics-history';

/**
 * Client wrapper that reconstructs MetricsHistory from serialized TickReport[]
 * and renders MetricsDashboard. The detail page passes reports as a JSON-serializable
 * prop; this component builds the ring buffer on the client side.
 */
export function RunDetailCharts({ reports }: { reports: TickReport[] }) {
  const history = useMemo(() => {
    const capacity = Math.max(10_000, reports.length);
    let h = createMetricsHistory(capacity);
    for (const report of reports) {
      h = appendTick(h, report);
    }
    return h;
  }, [reports]);

  return <MetricsDashboard history={history} />;
}
