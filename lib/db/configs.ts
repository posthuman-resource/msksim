import 'server-only';

import { createHash } from 'node:crypto';

import { desc, eq } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import type { ExperimentConfig } from '@/lib/schema/config';
import { configs, type Config } from '@/db/schema/configs';

// Recursively canonicalize a value for stable JSON serialization:
// - Object keys are sorted alphabetically at every level.
// - Array element order is preserved.
// - Primitives are returned as-is.
// This ensures that two logically equivalent ExperimentConfigs always produce
// the same hash regardless of how the object was constructed.
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as object).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Save an ExperimentConfig to the database.
 * Canonicalizes the config to JSON with sorted keys, computes SHA-256 over
 * the canonical string, and inserts a row. Returns the inserted Config row.
 *
 * Note: no UNIQUE constraint on content_hash — a researcher may legitimately
 * save the same config twice under different names. Dedup is the caller's job.
 */
export async function saveConfig({
  name,
  config,
  createdBy,
}: {
  name: string;
  config: ExperimentConfig;
  createdBy?: string | null;
}): Promise<Config> {
  const canonical = JSON.stringify(canonicalize(config));
  const contentHash = createHash('sha256').update(canonical).digest('hex');
  const [row] = await db
    .insert(configs)
    .values({ name, contentJson: canonical, contentHash, createdBy })
    .returning();
  return row;
}

/**
 * Load a config by id. Returns null if not found.
 * Re-parses contentJson through the Zod ExperimentConfig schema so callers
 * get a fully-typed object (and so any schema drift surfaces at read time).
 */
export async function loadConfig(
  id: string
): Promise<{ row: Config; parsed: ExperimentConfig } | null> {
  // Import dynamically to avoid a circular dependency: lib/schema/config.ts
  // is not server-only, so it can be imported here at runtime.
  const { ExperimentConfig } = await import('@/lib/schema/config');
  const rows = await db.select().from(configs).where(eq(configs.id, id));
  if (rows.length === 0) return null;
  const row = rows[0];
  const parsed = ExperimentConfig.parse(JSON.parse(row.contentJson));
  return { row, parsed };
}

/**
 * List configs sorted by updatedAt descending.
 * contentJson is returned as raw text — the caller decides whether to parse.
 */
export async function listConfigs(opts?: {
  limit?: number;
  createdBy?: string;
}): Promise<Config[]> {
  const limit = opts?.limit ?? 100;
  let query = db.select().from(configs).orderBy(desc(configs.updatedAt)).$dynamic();
  if (opts?.createdBy) {
    query = query.where(eq(configs.createdBy, opts.createdBy));
  }
  return query.limit(limit);
}

/**
 * Delete a config by id.
 * Cascades to runs, tick_metrics, and snapshots via FK.
 *
 * WARNING: This is irreversible. Callers should confirm with the user before invoking.
 */
export async function deleteConfig(id: string): Promise<void> {
  await db.delete(configs).where(eq(configs.id, id));
}
