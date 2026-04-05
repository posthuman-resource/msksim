// Schema entry point for drizzle-kit and drizzle ORM.
//
// Entity files (users.ts, sessions.ts, configs.ts, runs.ts, tick_metrics.ts,
// snapshots.ts) will be added in later steps (03, 04, 08) and re-exported
// from here. This file exists so drizzle-kit has a valid schema target.
//
// Example (added by step 03+):
//   export * from './users';
//   export * from './sessions';

// Marker export so TypeScript treats this as a module and drizzle-kit has a
// valid schema target before any entity tables are defined. Remove when the
// first entity file is re-exported here.
export const __schemaMarker = true;
