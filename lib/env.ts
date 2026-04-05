import 'server-only';

import { z } from 'zod';

const envSchema = z.object({
  MSKSIM_DB_PATH: z.string().default('./data/msksim.db'),
  MSKSIM_SESSION_SECRET: z
    .string()
    .min(32, 'MSKSIM_SESSION_SECRET must be at least 32 characters. Generate one with: openssl rand -base64 48'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const missing = parsed.error.issues
    .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid environment variables:\n${missing}`);
}

export const env = Object.freeze(parsed.data);
