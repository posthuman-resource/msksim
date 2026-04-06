// @vitest-environment node
//
// Regression guard: importing server modules must NOT trigger database access
// or env validation. Render.com build machines (and any CI running `next build`)
// have no database and no runtime secrets. If these imports throw at module-load
// time, the build breaks.
//
// See CLAUDE.md 'Known gotchas' for the lazy-init Proxy rationale.

import { afterEach, describe, expect, it, vi } from 'vitest';

describe('build-time safety', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('lib/env.ts can be imported without valid env vars', async () => {
    vi.stubEnv('MSKSIM_SESSION_SECRET', '');
    delete process.env.MSKSIM_DB_PATH;
    vi.resetModules();

    // Import must not throw — validation is deferred to first property access.
    const { env } = await import('@/lib/env');
    expect(env).toBeDefined();
  });

  it('lib/db/client.ts can be imported without a reachable database', async () => {
    vi.stubEnv('MSKSIM_SESSION_SECRET', '');
    vi.stubEnv('MSKSIM_DB_PATH', '/nonexistent/build/db.sqlite');
    vi.resetModules();

    // Import must not throw — DB connection is deferred to first method call.
    const { db, sqlite } = await import('@/lib/db/client');
    expect(db).toBeDefined();
    expect(sqlite).toBeDefined();
  });
});
