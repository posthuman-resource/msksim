import { loadEnvConfig } from '@next/env';
import { defineConfig } from 'drizzle-kit';

loadEnvConfig(process.cwd());

const dbPath = process.env.MSKSIM_DB_PATH ?? './data/msksim.db';

export default defineConfig({
  dialect: 'sqlite',
  schema: './db/schema/index.ts',
  out: './db/migrations',
  dbCredentials: {
    url: dbPath,
  },
});
