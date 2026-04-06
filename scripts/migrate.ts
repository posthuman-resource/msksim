// DO NOT call this from app code. Run via `npm run db:migrate`.
// Migrations are explicit and must never run at app startup.

// loadEnvConfig must run before any module that reads process.env at load
// time (lib/env.ts). We wrap the rest in an async main so that the dynamic
// imports (which guarantee loadEnvConfig has already run) work in CJS mode.
import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd());

async function main() {
  // Dynamic imports ensure loadEnvConfig has already populated process.env
  // before lib/env.ts parses process.env at module-load time.
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
  const { db, sqlite } = await import('@/lib/db/client');

  const migrationsFolder = './db/migrations';

  migrate(db, { migrationsFolder });

  // Count applied migrations by querying the tracking table.
  let count = 0;
  try {
    const rows = sqlite.prepare('SELECT COUNT(*) as n FROM __drizzle_migrations').get() as {
      n: number;
    };
    count = rows.n;
  } catch {
    // __drizzle_migrations table may not exist if no migrations have run yet.
    count = 0;
  }

  const dbPath = process.env.MSKSIM_DB_PATH ?? './data/msksim.db';
  console.log(`applied migrations: ${count}`);
  console.log(`database: ${dbPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Migration failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
