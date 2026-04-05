import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { users } from './users';

export const configs = sqliteTable('configs', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  // Canonicalized JSON string of ExperimentConfig. Plain text, not { mode: 'json' },
  // because automatic JSON.parse/stringify would re-shuffle key order and invalidate
  // content_hash. See CLAUDE.md "Database access patterns".
  contentJson: text('content_json').notNull(),
  // SHA-256 hex digest of contentJson (keys sorted recursively). Step 30's export
  // filenames use the first 8 hex characters of this column.
  contentHash: text('content_hash').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date()),
  // ON DELETE SET NULL: deleting a user must not delete their research artifacts.
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
});

export type Config = typeof configs.$inferSelect;
export type NewConfig = typeof configs.$inferInsert;
