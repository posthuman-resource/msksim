'use server';

import { revalidatePath } from 'next/cache';

import { verifySession } from '@/lib/auth/dal';
import { db } from '@/lib/db/client';
import { createRun, finishRun } from '@/lib/db/runs';
import { tickMetrics } from '@/db/schema/tick_metrics';
import { serializeTickReportsToMetricRows } from '@/lib/sim/metrics/serialize';
import type { RunResult } from '@/workers/simulation.worker';
import { loadConfig } from '@/lib/db/configs';

export interface PersistRunPayload {
  configId: string;
  seed: number;
  tickCount: number;
  result: RunResult;
}

/**
 * Persist a completed simulation run to the database.
 * Opens a single transaction: insert run row → bulk-insert tick_metrics → finalize run.
 */
export async function persistCompletedRun(
  payload: PersistRunPayload,
): Promise<{ runId: string }> {
  const session = await verifySession();

  const { configId, seed, tickCount, result } = payload;

  // Create run row
  const run = await createRun({ configId, seed, createdBy: session.userId });

  // Serialize metrics to long-format rows
  const metricRows = serializeTickReportsToMetricRows(run.id, result.metricsTimeSeries);

  // Bulk insert tick_metrics in a single synchronous transaction.
  // better-sqlite3 requires synchronous transaction callbacks.
  // Chunk into batches of 500 to stay under SQLite's SQLITE_MAX_VARIABLE_NUMBER limit.
  db.transaction((tx) => {
    const BATCH_SIZE = 500;
    for (let i = 0; i < metricRows.length; i += BATCH_SIZE) {
      const batch = metricRows.slice(i, i + BATCH_SIZE);
      tx.insert(tickMetrics)
        .values(
          batch.map((r) => ({
            runId: r.runId,
            tick: r.tick,
            world: r.world,
            metricName: r.metricName,
            metricValue: r.metricValue,
          })),
        )
        .run();
    }
  });

  // Finalize run
  await finishRun({
    id: run.id,
    status: 'completed',
    tickCount,
    summary: result.summary,
    classification: result.summary.classification,
  });

  revalidatePath('/runs');

  return { runId: run.id };
}

/**
 * Load an experiment config by ID. Used by the playground to hydrate from query params.
 */
export async function loadConfigAction(
  id: string,
): Promise<{ name: string; config: Record<string, unknown>; configHash: string } | null> {
  await verifySession();
  const result = await loadConfig(id);
  if (!result) return null;
  return {
    name: result.row.name,
    config: result.parsed as unknown as Record<string, unknown>,
    configHash: result.row.contentHash,
  };
}
