import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { runs } from './runs';

export const snapshots = sqliteTable(
  'snapshots',
  {
    // Surrogate PK: snapshots are individually addressable (e.g., replay UI loads one
    // snapshot by id). A composite PK on (run_id, tick, kind) would work but surrogate
    // keys are simpler for the replay page's URL params.
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // ON DELETE CASCADE: deleting a run deletes all its snapshots.
    runId: text('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    // The tick at which the snapshot was taken. sampleInterval in the config controls
    // how often snapshots are captured (default every 10 ticks per spec §7.2).
    tick: integer('tick').notNull(),
    // Two snapshot flavors per spec §7.2. Closed enum — adding a third flavor is a
    // migration-level change, which is the correct friction for v1.
    kind: text('kind', { enum: ['inventory', 'interaction_graph'] }).notNull(),
    // Opaque JSON TEXT — read wholesale, never SQL-filtered on inner fields.
    contentJson: text('content_json').notNull(),
  },
  (table) => [
    // Serves "all snapshots for run X ordered by tick" — the replay view's primary query.
    index('snapshots_run_tick_idx').on(table.runId, table.tick),
  ],
);

export type Snapshot = typeof snapshots.$inferSelect;
export type NewSnapshot = typeof snapshots.$inferInsert;
export type SnapshotKind = 'inventory' | 'interaction_graph';
