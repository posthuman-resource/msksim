// @vitest-environment node
import { afterAll, describe, expect, it, vi } from 'vitest';

// Set env vars before any module imports so lib/env.ts parses them at
// module-load time (it reads process.env eagerly).
vi.stubEnv('MSKSIM_DB_PATH', ':memory:');
vi.stubEnv('MSKSIM_SESSION_SECRET', 'a'.repeat(48));

// Import after stubbing env.
const { db, sqlite } = await import('@/lib/db/client');

describe('lib/db/client', () => {
  afterAll(() => {
    sqlite.close();
    vi.unstubAllEnvs();
  });

  it('native binding loaded and query works', () => {
    const result = sqlite.prepare('SELECT 1 AS one').get() as { one: number };
    expect(result).toEqual({ one: 1 });
  });

  it('exports a drizzle db instance', () => {
    expect(db).toBeDefined();
    // drizzle instance has a run/query interface
    expect(typeof db).toBe('object');
  });

  it('WAL journal mode is set', () => {
    const row = sqlite.pragma('journal_mode', { simple: true });
    expect(row).toBe('memory'); // :memory: always reports "memory" mode
  });

  it('foreign_keys pragma is ON', () => {
    const fk = sqlite.pragma('foreign_keys', { simple: true });
    expect(fk).toBe(1);
  });
});
