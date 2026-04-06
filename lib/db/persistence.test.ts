// @vitest-environment node
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Stub env before any module that reads process.env at load time.
vi.stubEnv('MSKSIM_DB_PATH', ':memory:');
vi.stubEnv('MSKSIM_SESSION_SECRET', 'a'.repeat(48));

const { db, sqlite } = await import('@/lib/db/client');

const { eq } = await import('drizzle-orm');
const { users } = await import('@/db/schema/users');
const { configs } = await import('@/db/schema/configs');
const { runs } = await import('@/db/schema/runs');
const { tickMetrics } = await import('@/db/schema/tick_metrics');
const { snapshots } = await import('@/db/schema/snapshots');
const { ExperimentConfig } = await import('@/lib/schema/config');

const { saveConfig, listConfigs, deleteConfig } = await import('@/lib/db/configs');
const { createRun, finishRun } = await import('@/lib/db/runs');
const { insertTickMetrics, loadTickMetrics } = await import('@/lib/db/tick-metrics');
const { saveSnapshot, loadSnapshots } = await import('@/lib/db/snapshots');

describe('lib/db persistence', () => {
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
    const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
    migrate(db, { migrationsFolder: './db/migrations' });
  });

  afterAll(() => {
    vi.useRealTimers();
    sqlite.close();
    vi.unstubAllEnvs();
  });

  beforeEach(async () => {
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
    // Clear in FK-safe order (children before parents).
    await db.delete(snapshots);
    await db.delete(tickMetrics);
    await db.delete(runs);
    await db.delete(configs);
    await db.delete(users);
  });

  // ── Test 1: Insert config, verify row ────────────────────────────────────────

  it('saveConfig inserts a row with correct fields', async () => {
    const config = ExperimentConfig.parse({});
    const returned = await saveConfig({ name: 'baseline', config });

    expect(returned.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(returned.name).toBe('baseline');
    expect(returned.contentJson).toBeTruthy();
    expect(returned.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(returned.createdAt).toBeInstanceOf(Date);
    expect(returned.updatedAt).toBeInstanceOf(Date);

    // Re-read and compare.
    const rows = await db.select().from(configs).where(eq(configs.id, returned.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(returned);
  });

  // ── Test 2: Hash is stable across equivalent configs ─────────────────────────

  it('content hash is identical for logically equivalent configs', async () => {
    // Both produce the same fully-defaulted ExperimentConfig.
    const configA = ExperimentConfig.parse({ seed: 42 });
    const configB = ExperimentConfig.parse({ seed: 42 });
    const rowA = await saveConfig({ name: 'A', config: configA });
    const rowB = await saveConfig({ name: 'B', config: configB });

    expect(rowA.contentHash).toBe(rowB.contentHash);

    // Verify the stored hash is SHA-256 of the stored JSON.
    const recomputed = createHash('sha256').update(rowA.contentJson).digest('hex');
    expect(recomputed).toBe(rowA.contentHash);
  });

  // ── Test 3: Insert run referencing config, verify FK ─────────────────────────

  it('createRun returns a pending run and FK rejects nonexistent configId', async () => {
    const config = ExperimentConfig.parse({});
    const savedConfig = await saveConfig({ name: 'test', config });

    const run = await createRun({ configId: savedConfig.id, seed: 42 });
    expect(run.configId).toBe(savedConfig.id);
    expect(run.seed).toBe(42);
    expect(run.status).toBe('pending');
    expect(run.tickCount).toBe(0);
    expect(run.startedAt).toBeInstanceOf(Date);
    expect(run.finishedAt).toBeNull();
    expect(run.summaryJson).toBeNull();
    expect(run.classification).toBeNull();
    expect(run.errorMessage).toBeNull();

    // FK violation: nonexistent configId should throw.
    await expect(createRun({ configId: 'nonexistent-id', seed: 0 })).rejects.toThrow();
  });

  // ── Test 4: Bulk insert 100 tick_metrics rows ─────────────────────────────────

  it('insertTickMetrics bulk inserts and loadTickMetrics returns sorted rows', async () => {
    const config = ExperimentConfig.parse({});
    const savedConfig = await saveConfig({ name: 'test', config });
    const run = await createRun({ configId: savedConfig.id, seed: 1 });

    // 2 ticks × 2 worlds × 25 metric names = 100 rows.
    const rows: Array<{
      tick: number;
      world: 'world1' | 'world2' | 'both';
      metricName: string;
      metricValue: number;
    }> = [];
    for (let tick = 0; tick < 2; tick++) {
      for (const world of ['world1', 'world2'] as const) {
        for (let m = 0; m < 25; m++) {
          rows.push({ tick, world, metricName: `m${m}`, metricValue: tick + m * 0.1 });
        }
      }
    }

    await insertTickMetrics(run.id, rows);

    const loaded = await loadTickMetrics(run.id);
    expect(loaded).toHaveLength(100);
    expect(loaded.every((r) => r.runId === run.id)).toBe(true);

    // Verify sort: (tick asc, world asc, metricName asc).
    for (let i = 1; i < loaded.length; i++) {
      const prev = loaded[i - 1];
      const curr = loaded[i];
      const cmp =
        prev.tick !== curr.tick
          ? prev.tick - curr.tick
          : prev.world !== curr.world
            ? prev.world.localeCompare(curr.world)
            : prev.metricName.localeCompare(curr.metricName);
      expect(cmp).toBeLessThanOrEqual(0);
    }
  });

  // ── Test 5: Load by (run_id, metric_name) filter ─────────────────────────────

  it('loadTickMetrics filters by metricName correctly', async () => {
    const config = ExperimentConfig.parse({});
    const savedConfig = await saveConfig({ name: 'test', config });
    const run = await createRun({ configId: savedConfig.id, seed: 2 });

    // 2 ticks × 2 worlds × 25 metric names = 100 rows.
    const rows: Array<{
      tick: number;
      world: 'world1' | 'world2' | 'both';
      metricName: string;
      metricValue: number;
    }> = [];
    for (let tick = 0; tick < 2; tick++) {
      for (const world of ['world1', 'world2'] as const) {
        for (let m = 0; m < 25; m++) {
          rows.push({ tick, world, metricName: `m${m}`, metricValue: tick + m * 0.1 });
        }
      }
    }
    await insertTickMetrics(run.id, rows);

    const filtered = await loadTickMetrics(run.id, 'm7');
    expect(filtered).toHaveLength(4); // 2 ticks × 2 worlds
    expect(filtered.every((r) => r.metricName === 'm7')).toBe(true);

    const empty = await loadTickMetrics(run.id, 'nonexistent-metric');
    expect(empty).toHaveLength(0);
  });

  // ── Test 6: Delete config cascades to run, tick_metrics, snapshots ────────────

  it('deleteConfig cascades to all child rows', async () => {
    // Verify foreign_keys pragma is ON — if it is not, the cascade will be silent
    // and this test will give a misleading false positive.
    const fkEnabled = sqlite.pragma('foreign_keys', { simple: true });
    expect(fkEnabled, 'PRAGMA foreign_keys must be 1 for cascade tests to be meaningful').toBe(1);

    const config = ExperimentConfig.parse({});
    const savedConfig = await saveConfig({ name: 'to-delete', config });
    const run = await createRun({ configId: savedConfig.id, seed: 0 });

    // Insert 10 tick_metrics rows.
    const metricRows: Array<{
      tick: number;
      world: 'world1' | 'world2' | 'both';
      metricName: string;
      metricValue: number;
    }> = [];
    for (let i = 0; i < 10; i++) {
      metricRows.push({
        tick: i,
        world: 'world1',
        metricName: 'success_rate',
        metricValue: i * 0.1,
      });
    }
    await insertTickMetrics(run.id, metricRows);

    // Insert 3 snapshots.
    await saveSnapshot({ runId: run.id, tick: 0, kind: 'inventory', content: {} });
    await saveSnapshot({ runId: run.id, tick: 5, kind: 'inventory', content: {} });
    await saveSnapshot({ runId: run.id, tick: 10, kind: 'interaction_graph', content: {} });

    // Verify rows exist before deletion.
    expect(await db.select().from(configs)).toHaveLength(1);
    expect(await db.select().from(runs)).toHaveLength(1);
    expect(await db.select().from(tickMetrics)).toHaveLength(10);
    expect(await db.select().from(snapshots)).toHaveLength(3);

    // Delete the config — should cascade to all children.
    await deleteConfig(savedConfig.id);

    expect(await db.select().from(configs)).toHaveLength(0);
    expect(await db.select().from(runs)).toHaveLength(0);
    expect(await db.select().from(tickMetrics)).toHaveLength(0);
    expect(await db.select().from(snapshots)).toHaveLength(0);
  });

  // ── Test 7: listConfigs sorted by updatedAt desc ──────────────────────────────

  it('listConfigs returns configs in updatedAt descending order with optional limit', async () => {
    const config = ExperimentConfig.parse({});

    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
    const A = await saveConfig({ name: 'A', config });
    vi.setSystemTime(new Date('2025-01-01T00:00:01Z'));
    const B = await saveConfig({ name: 'B', config });
    vi.setSystemTime(new Date('2025-01-01T00:00:02Z'));
    const C = await saveConfig({ name: 'C', config });

    const all = await listConfigs();
    expect(all.map((r) => r.id)).toEqual([C.id, B.id, A.id]);

    const limited = await listConfigs({ limit: 2 });
    expect(limited).toHaveLength(2);
    expect(limited.map((r) => r.id)).toEqual([C.id, B.id]);
  });

  // ── Test 8: finishRun sets terminal fields atomically ─────────────────────────

  it('finishRun sets status, tickCount, finishedAt, summaryJson, classification', async () => {
    const config = ExperimentConfig.parse({});
    const savedConfig = await saveConfig({ name: 'test', config });
    const run = await createRun({ configId: savedConfig.id, seed: 7 });

    const finished = await finishRun({
      id: run.id,
      status: 'completed',
      tickCount: 5000,
      summary: { meanSuccessRate: 0.73 },
      classification: 'assimilated',
    });

    expect(finished.status).toBe('completed');
    expect(finished.tickCount).toBe(5000);
    expect(finished.finishedAt).toBeInstanceOf(Date);
    expect(finished.classification).toBe('assimilated');
    expect(JSON.parse(finished.summaryJson!)).toEqual({ meanSuccessRate: 0.73 });

    // Verify .returning() was used — the returned row should match the DB.
    const reread = await db.select().from(runs).where(eq(runs.id, run.id));
    expect(reread[0]).toEqual(finished);
  });

  // ── Test 9: saveSnapshot / loadSnapshots round-trip ──────────────────────────

  it('saveSnapshot and loadSnapshots round-trip with correct ordering', async () => {
    const config = ExperimentConfig.parse({});
    const savedConfig = await saveConfig({ name: 'test', config });
    const run = await createRun({ configId: savedConfig.id, seed: 9 });

    const content1 = { agents: [] };
    const content2 = { nodes: 0, edges: 0 };

    // Insert out of tick order intentionally to verify sort.
    await saveSnapshot({ runId: run.id, tick: 20, kind: 'inventory', content: content1 });
    await saveSnapshot({ runId: run.id, tick: 10, kind: 'interaction_graph', content: content2 });

    const all = await loadSnapshots(run.id);
    expect(all).toHaveLength(2);
    expect(all[0].tick).toBe(10);
    expect(all[1].tick).toBe(20);

    const inventoryOnly = await loadSnapshots(run.id, { kind: 'inventory' });
    expect(inventoryOnly).toHaveLength(1);
    expect(inventoryOnly[0].kind).toBe('inventory');
    expect(JSON.parse(inventoryOnly[0].contentJson)).toEqual(content1);

    // Round-trip the interaction_graph snapshot.
    expect(JSON.parse(all[0].contentJson)).toEqual(content2);
  });
});
