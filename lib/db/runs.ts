import 'server-only';

import { and, count, desc, eq, gte, lte } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { configs } from '@/db/schema/configs';
import { runs, type Run, type RunClassification, type RunStatus } from '@/db/schema/runs';

/**
 * Create a new run row with status 'pending'.
 * startedAt and tickCount receive their drizzle runtime defaults on insert.
 */
export async function createRun({
  configId,
  seed,
  createdBy,
}: {
  configId: string;
  seed: number;
  createdBy?: string | null;
}): Promise<Run> {
  const [row] = await db.insert(runs).values({ configId, seed, createdBy }).returning();
  return row;
}

/**
 * Update status for pending→running or running→cancelled transitions.
 * Does not touch finishedAt or summaryJson — use finishRun for terminal states.
 */
export async function updateRunStatus(id: string, status: RunStatus): Promise<void> {
  await db.update(runs).set({ status }).where(eq(runs.id, id));
}

/**
 * Atomically finalize a run: sets status, finishedAt, tickCount, summaryJson,
 * classification, and errorMessage. Returns the updated row.
 *
 * summary is typed as unknown because the end-of-run summary shape comes from
 * step 17 (sim engine) which has not landed yet; step 17 will narrow it.
 */
export async function finishRun({
  id,
  status,
  tickCount,
  summary,
  classification,
  errorMessage,
}: {
  id: string;
  status: 'completed' | 'failed' | 'cancelled';
  tickCount: number;
  summary?: unknown;
  classification?: RunClassification | null;
  errorMessage?: string | null;
}): Promise<Run> {
  const [row] = await db
    .update(runs)
    .set({
      status,
      finishedAt: new Date(),
      tickCount,
      summaryJson: summary != null ? JSON.stringify(summary) : null,
      classification: classification ?? null,
      errorMessage: errorMessage ?? null,
    })
    .where(eq(runs.id, id))
    .returning();
  return row;
}

/** Get a single run by id. Returns null if not found. */
export async function getRun(id: string): Promise<Run | null> {
  const rows = await db.select().from(runs).where(eq(runs.id, id));
  return rows[0] ?? null;
}

/**
 * List runs sorted by startedAt descending, with optional filters.
 * Used by the step-26 runs browser.
 */
export async function listRuns(opts?: {
  limit?: number;
  configId?: string;
  status?: RunStatus;
  createdBy?: string;
}): Promise<Run[]> {
  const limit = opts?.limit ?? 100;
  const conditions = [];
  if (opts?.configId) conditions.push(eq(runs.configId, opts.configId));
  if (opts?.status) conditions.push(eq(runs.status, opts.status));
  if (opts?.createdBy) conditions.push(eq(runs.createdBy, opts.createdBy));

  let query = db.select().from(runs).orderBy(desc(runs.startedAt)).$dynamic();
  if (conditions.length > 0) {
    query = query.where(and(...conditions));
  }
  return query.limit(limit);
}

/** Delete a run by id. Cascades to tick_metrics and snapshots via FK. */
export async function deleteRun(id: string): Promise<void> {
  await db.delete(runs).where(eq(runs.id, id));
}

/**
 * List runs joined with their config name, avoiding the N+1 problem.
 * Used by the runs browser page (step 26).
 */
export async function listRunsWithConfig(opts?: {
  limit?: number;
  offset?: number;
  configId?: string;
  status?: RunStatus;
  classification?: RunClassification;
  finishedAfter?: Date;
  finishedBefore?: Date;
  orderBy?: 'finishedAt' | 'tickCount';
}): Promise<Array<Run & { configName: string; configHash: string }>> {
  const limit = opts?.limit ?? 50;
  const conditions = [];
  if (opts?.configId) conditions.push(eq(runs.configId, opts.configId));
  if (opts?.status) conditions.push(eq(runs.status, opts.status));
  if (opts?.classification) conditions.push(eq(runs.classification, opts.classification));
  if (opts?.finishedAfter) conditions.push(gte(runs.finishedAt, opts.finishedAfter));
  if (opts?.finishedBefore) conditions.push(lte(runs.finishedAt, opts.finishedBefore));

  const orderCol = opts?.orderBy === 'tickCount' ? runs.tickCount : runs.finishedAt;

  let query = db
    .select({
      id: runs.id,
      configId: runs.configId,
      seed: runs.seed,
      startedAt: runs.startedAt,
      finishedAt: runs.finishedAt,
      status: runs.status,
      tickCount: runs.tickCount,
      summaryJson: runs.summaryJson,
      classification: runs.classification,
      errorMessage: runs.errorMessage,
      createdBy: runs.createdBy,
      configName: configs.name,
      configHash: configs.contentHash,
    })
    .from(runs)
    .innerJoin(configs, eq(runs.configId, configs.id))
    .orderBy(desc(orderCol))
    .$dynamic();

  if (conditions.length > 0) {
    query = query.where(and(...conditions));
  }

  return query.limit(limit).offset(opts?.offset ?? 0);
}

/**
 * Count runs matching the given filters. Used for pagination in the runs browser.
 */
export async function countRuns(opts?: {
  configId?: string;
  status?: RunStatus;
  classification?: RunClassification;
  finishedAfter?: Date;
  finishedBefore?: Date;
}): Promise<number> {
  const conditions = [];
  if (opts?.configId) conditions.push(eq(runs.configId, opts.configId));
  if (opts?.status) conditions.push(eq(runs.status, opts.status));
  if (opts?.classification) conditions.push(eq(runs.classification, opts.classification));
  if (opts?.finishedAfter) conditions.push(gte(runs.finishedAt, opts.finishedAfter));
  if (opts?.finishedBefore) conditions.push(lte(runs.finishedAt, opts.finishedBefore));

  let query = db.select({ value: count() }).from(runs).$dynamic();
  if (conditions.length > 0) {
    query = query.where(and(...conditions));
  }
  const [row] = await query;
  return row.value;
}
