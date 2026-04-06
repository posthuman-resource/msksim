// Server-only. Do not import from a client component. Transitive imports count
// — the DAL file must also be server-only.
import 'server-only';

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { env } from '@/lib/env';

// ---------------------------------------------------------------------------
// Lazy-init singleton. The database connection opens on first method call, not
// at module load. This prevents build-time failures on Render.com (and any CI)
// where the database is unavailable during `next build`.
// See CLAUDE.md 'Known gotchas' and tests/build-safety.test.ts.
// ---------------------------------------------------------------------------

type SqliteDb = InstanceType<typeof Database>;
type DrizzleDb = ReturnType<typeof drizzle>;

let _sqlite: SqliteDb | undefined;
let _db: DrizzleDb | undefined;

function init(): void {
  if (_db) return;
  mkdirSync(dirname(env.MSKSIM_DB_PATH), { recursive: true });
  _sqlite = new Database(env.MSKSIM_DB_PATH);
  _sqlite.pragma('journal_mode = WAL');
  _sqlite.pragma('foreign_keys = ON');
  _db = drizzle({ client: _sqlite });
}

function lazyProxy<T extends object>(resolve: () => T): T {
  return new Proxy({} as T, {
    get(_, prop) {
      const target = resolve();
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? (value as Function).bind(target) : value;
    },
  });
}

/** Drizzle ORM instance. Opens the DB connection lazily on first access. */
export const db: DrizzleDb = lazyProxy(() => {
  init();
  return _db!;
});

/** Raw better-sqlite3 handle. Opens the DB connection lazily on first access. */
export const sqlite: SqliteDb = lazyProxy(() => {
  init();
  return _sqlite!;
});
