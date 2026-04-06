import 'server-only';

import { z } from 'zod';

const envSchema = z.object({
  MSKSIM_DB_PATH: z.string().default('./data/msksim.db'),
  MSKSIM_SESSION_SECRET: z
    .string()
    .min(
      32,
      'MSKSIM_SESSION_SECRET must be at least 32 characters. Generate one with: openssl rand -base64 48',
    ),
});

type Env = z.infer<typeof envSchema>;

// ---------------------------------------------------------------------------
// Lazy validation. Env vars are parsed on first property access, not at module
// load. This prevents build-time crashes on Render.com (and any CI) where
// runtime secrets like MSKSIM_SESSION_SECRET are unavailable during `next build`.
// See CLAUDE.md 'Known gotchas' and tests/build-safety.test.ts.
// ---------------------------------------------------------------------------

let _resolved: Readonly<Env> | undefined;

function resolve(): Readonly<Env> {
  if (_resolved) return _resolved;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${missing}`);
  }
  _resolved = Object.freeze(parsed.data);
  return _resolved;
}

export const env: Readonly<Env> = new Proxy({} as Env, {
  get(_, prop) {
    return Reflect.get(resolve(), prop);
  },
});
