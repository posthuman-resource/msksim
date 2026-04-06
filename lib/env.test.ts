// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('lib/env', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('parses valid env', async () => {
    vi.stubEnv('MSKSIM_SESSION_SECRET', 'a'.repeat(48));
    vi.stubEnv('MSKSIM_DB_PATH', './data/test.db');

    const { env } = await import('@/lib/env');
    expect(env.MSKSIM_SESSION_SECRET).toBe('a'.repeat(48));
    expect(env.MSKSIM_DB_PATH).toBe('./data/test.db');
  });

  it('throws ZodError when MSKSIM_SESSION_SECRET is missing on first access', async () => {
    vi.stubEnv('MSKSIM_SESSION_SECRET', '');
    vi.resetModules();

    // Import succeeds (lazy validation), but property access triggers the throw.
    const { env } = await import('@/lib/env');
    expect(() => env.MSKSIM_SESSION_SECRET).toThrow(/MSKSIM_SESSION_SECRET/);
  });

  it('defaults MSKSIM_DB_PATH when unset', async () => {
    vi.stubEnv('MSKSIM_SESSION_SECRET', 'b'.repeat(48));
    vi.stubEnv('MSKSIM_DB_PATH', '');
    vi.resetModules();

    // When MSKSIM_DB_PATH is empty string, Zod passes it through (it's a valid string).
    // The default only applies when the key is absent from process.env.
    // Delete it and re-stub to truly test the default.
    delete process.env.MSKSIM_DB_PATH;
    vi.resetModules();

    const { env } = await import('@/lib/env');
    expect(env.MSKSIM_DB_PATH).toBe('./data/msksim.db');
  });
});
