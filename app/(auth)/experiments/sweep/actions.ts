'use server';

import { verifySession } from '@/lib/auth/dal';
import { getRun } from '@/lib/db/runs';
import type { RunSummary } from '@/lib/sim/metrics/types';

/**
 * Load a single run's summary JSON, parsed into the in-memory RunSummary shape.
 * Returns null if the run id does not exist or the run has no summary yet.
 *
 * Used by the sweep runner to fetch each persisted replicate's outcome after
 * the worker pool finishes a cell, so the per-cell aggregation can compute
 * mean/stdDev/dominant-classification per metric.
 */
export async function loadRunSummary(runId: string): Promise<RunSummary | null> {
  await verifySession();
  const row = await getRun(runId);
  if (!row || !row.summaryJson) return null;
  return JSON.parse(row.summaryJson) as RunSummary;
}
