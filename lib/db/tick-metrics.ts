import 'server-only';

import { and, asc, eq } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { tickMetrics, type TickMetric } from '@/db/schema/tick_metrics';

/**
 * Bulk insert tick metric rows for a run.
 *
 * IMPORTANT: The insert is wrapped in a single transaction. A 5,000-tick run
 * with 10 metrics and 2 worlds produces ~100,000 rows. Without a transaction,
 * better-sqlite3 auto-commits each row individually and the batch takes seconds.
 * With a single transaction the whole batch completes in well under 100ms.
 *
 * NOTE: better-sqlite3 is synchronous. The transaction callback must NOT be async —
 * better-sqlite3 throws "Transaction function cannot return a promise" if it receives
 * an async function. Use .run() on each insert to execute synchronously.
 */
export async function insertTickMetrics(
  runId: string,
  rows: Array<{
    tick: number;
    world: 'world1' | 'world2' | 'both';
    metricName: string;
    metricValue: number;
  }>
): Promise<void> {
  db.transaction((tx) => {
    for (const row of rows) {
      tx.insert(tickMetrics).values({ runId, ...row }).run();
    }
  });
}

/**
 * Load tick metric rows for a run, ordered by (tick asc, world asc, metricName asc).
 * This ordering is the CSV-friendly stable order step 30 will stream.
 *
 * If metricName is provided, the query uses the tick_metrics_run_metric_idx index.
 * Otherwise it falls back to the composite primary key scan (still indexed on runId first).
 */
export async function loadTickMetrics(
  runId: string,
  metricName?: string
): Promise<TickMetric[]> {
  const conditions = [eq(tickMetrics.runId, runId)];
  if (metricName !== undefined) {
    conditions.push(eq(tickMetrics.metricName, metricName));
  }
  return db
    .select()
    .from(tickMetrics)
    .where(and(...conditions))
    .orderBy(asc(tickMetrics.tick), asc(tickMetrics.world), asc(tickMetrics.metricName));
}
