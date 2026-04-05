// Server-only. Do not import from a client component. Transitive imports count
// — the DAL file must also be server-only.
import 'server-only';

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { env } from '@/lib/env';

// Ensure the parent directory exists (creates ./data/ by default).
mkdirSync(dirname(env.MSKSIM_DB_PATH), { recursive: true });

// Module-level singleton — synchronous open, WAL mode for better concurrency.
export const sqlite = new Database(env.MSKSIM_DB_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle({ client: sqlite });
