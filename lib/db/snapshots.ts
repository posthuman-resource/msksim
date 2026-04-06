import 'server-only';

import { and, asc, eq } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { snapshots, type Snapshot, type SnapshotKind } from '@/db/schema/snapshots';

/**
 * Save a snapshot for a run at a given tick.
 * content is JSON-stringified without sorted-keys canonicalization — snapshots
 * are inspected by humans and are never hashed, so key order doesn't matter.
 */
export async function saveSnapshot({
  runId,
  tick,
  kind,
  content,
}: {
  runId: string;
  tick: number;
  kind: SnapshotKind;
  content: unknown;
}): Promise<Snapshot> {
  const [row] = await db
    .insert(snapshots)
    .values({ runId, tick, kind, contentJson: JSON.stringify(content) })
    .returning();
  return row;
}

/**
 * Load snapshots for a run, ordered by tick ascending.
 * Optionally filter by kind ('inventory' | 'interaction_graph').
 * Uses the snapshots_run_tick_idx index.
 */
export async function loadSnapshots(
  runId: string,
  opts?: { kind?: SnapshotKind },
): Promise<Snapshot[]> {
  const conditions = [eq(snapshots.runId, runId)];
  if (opts?.kind !== undefined) {
    conditions.push(eq(snapshots.kind, opts.kind));
  }
  return db
    .select()
    .from(snapshots)
    .where(and(...conditions))
    .orderBy(asc(snapshots.tick));
}
