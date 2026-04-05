import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { users } from './users';

export const sessions = sqliteTable('sessions', {
  // The primary key is the opaque session token itself (32 random bytes,
  // hex-encoded). Storing the token as the PK makes validateSession a single
  // PK lookup and destroySession a single PK delete — there is no separate
  // session id. See lib/auth/sessions.ts and CLAUDE.md "Authentication patterns".
  id: text('id').primaryKey(),

  // ON DELETE CASCADE: deleting a user row automatically evicts all of that
  // user's sessions, giving the CLI `users remove` subcommand logout-everywhere
  // behaviour for free.
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),

  // timestamp_ms stores a JavaScript Date as Unix-epoch-ms integer. Arithmetic
  // with Date.now() is natural and timezone-free; ISO strings would require
  // parsing on every read, and integer comparison is cheaper.
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),

  // Seconds resolution is sufficient for an audit trail. sqlite's unixepoch()
  // default means no value is needed on insert.
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
