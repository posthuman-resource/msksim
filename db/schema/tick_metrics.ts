import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { runs } from './runs';

export const tickMetrics = sqliteTable(
  'tick_metrics',
  {
    // ON DELETE CASCADE: deleting a run deletes all its metric rows.
    runId: text('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    // 0-indexed tick number per docs/spec.md §3.3.
    tick: integer('tick').notNull(),
    // Per-world breakdowns plus cross-world aggregate.
    world: text('world', { enum: ['world1', 'world2', 'both'] }).notNull(),
    // Free-form text (not enum) — the metric set is open-ended; adding a new metric
    // is a sim-core change only, not a migration. Examples: 'success_rate',
    // 'mean_token_weight', 'assimilation_index', 'segregation_index', etc.
    metricName: text('metric_name').notNull(),
    // IEEE-754 double — adequate for ratios, counts, and modularity values in [-1,1].
    metricValue: real('metric_value').notNull(),
  },
  (table) => [
    // Composite PK prevents duplicate observations and is the primary index path.
    // Order matches the CSV export's ORDER BY: run_id, tick, world, metric_name.
    primaryKey({ columns: [table.runId, table.tick, table.world, table.metricName] }),
    // Serves "all ticks of one metric for one run" — the time-series chart shape.
    index('tick_metrics_run_metric_idx').on(table.runId, table.metricName),
    // Serves "all metrics of one tick for one run" — the live dashboard replay shape.
    index('tick_metrics_run_tick_idx').on(table.runId, table.tick),
  ],
);

export type TickMetric = typeof tickMetrics.$inferSelect;
export type NewTickMetric = typeof tickMetrics.$inferInsert;
