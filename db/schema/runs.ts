import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { configs } from './configs';
import { users } from './users';

export const runs = sqliteTable('runs', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  // ON DELETE CASCADE: deleting a config deletes all its runs (runs are meaningless
  // without their experiment definition).
  configId: text('config_id')
    .notNull()
    .references(() => configs.id, { onDelete: 'cascade' }),
  seed: integer('seed').notNull(),
  startedAt: integer('started_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
  // Nullable: only set when the run reaches a terminal status.
  finishedAt: integer('finished_at', { mode: 'timestamp' }),
  status: text('status', {
    enum: ['pending', 'running', 'completed', 'failed', 'cancelled'],
  })
    .notNull()
    .$defaultFn(() => 'pending' as const),
  tickCount: integer('tick_count').notNull().$defaultFn(() => 0),
  // Nullable opaque JSON TEXT: end-of-run summary metrics filled by finishRun.
  summaryJson: text('summary_json'),
  // Nullable: set at run completion by finishRun.
  classification: text('classification', {
    enum: ['assimilated', 'segregated', 'mixed', 'inconclusive'],
  }),
  // Nullable: only populated when status === 'failed'.
  errorMessage: text('error_message'),
  // ON DELETE SET NULL: deleting a user must not delete their research artifacts.
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
});

export type Run = typeof runs.$inferSelect;
export type NewRun = typeof runs.$inferInsert;
export type RunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type RunClassification = 'assimilated' | 'segregated' | 'mixed' | 'inconclusive';
