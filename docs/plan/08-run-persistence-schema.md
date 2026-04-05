---
step: "08"
title: "run persistence schema"
kind: foundation
ui: false
timeout_minutes: 20
prerequisites:
  - "step 01: zod config schema"
  - "step 02: drizzle sqlite scaffolding"
  - "step 03: user schema and argon2 hashing"
---

## 1. Goal

Introduce the four domain tables that persist simulation work product: `configs` (saved experiment configurations), `runs` (completed simulation runs with their outcome and classification), `tick_metrics` (the long-format per-tick scalar observations), and `snapshots` (sampled per-tick agent-state snapshots). For each table this step also creates a thin server-only helper module under `lib/db/` that encapsulates the insert / read / list / delete queries that steps 25, 26, 27, and 30 will consume. The step is **pure persistence scaffolding**: there is no simulation engine here (steps 09-18 populate these tables), no batch queue (step 27), no export route (step 30), and no UI (step 26). It is the server-side equivalent of what `docs/spec.md` §8 calls the "Persistence (IndexedDB)" box, relocated to SQLite per the user override in `CLAUDE.md` "Stack and versions", so that every downstream step writes and reads through drizzle instead of IndexedDB / Dexie. The invariant the step establishes: *after it lands, any later step that says "persist a run" means "insert one row into `runs` plus N rows into `tick_metrics` plus K rows into `snapshots` via the helpers in `lib/db/`", and the CSV export in step 30 is a straight `SELECT ... FROM tick_metrics WHERE run_id = ?` with no JSON reshaping on the hot path.*

## 2. Prerequisites

- **Step 01 — zod config schema.** The `ExperimentConfig` Zod schema in `lib/schema/` is the authoritative shape for the JSON serialized into `configs.content_json`. This step does not re-define the shape; its `saveConfig` helper takes a parsed `ExperimentConfig` in and emits text on write, and `loadConfig` parses the text back through the same schema on read. If step 01 has not landed, the helpers cannot type their arguments and this step must stop and report.
- **Step 02 — drizzle sqlite scaffolding.** The singleton `db` client at `lib/db/client.ts`, the `db/schema/index.ts` barrel, the `drizzle-kit generate` pipeline, and `scripts/migrate.ts` must already exist. This step imports the singleton, appends four new schema modules to the barrel, and runs `drizzle-kit generate` once to emit a single migration file. It also depends on the `PRAGMA foreign_keys = ON` that step 02's client initializer sets (without it the `ON DELETE CASCADE` clauses defined here would be silent no-ops — see the "Known gotchas" entry added in step 04 for the rationale).
- **Step 03 — user schema and argon2 hashing.** The `users` table must exist so that `configs.created_by` and `runs.created_by` can carry `FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL`. The `ON DELETE SET NULL` choice — not `CASCADE` — is deliberate: deleting a researcher account should **not** delete the research artifacts they created, only the ownership pointer. If the user row is gone the config/run becomes orphaned but still queryable, which is the right trade for a two-researcher tool where accounts may be rotated.

Step 04 (sessions) is **not** a prerequisite: this step does not touch the request-time session layer. Step 05 (CLI user management) is also not a prerequisite because the CLI operates on the users table directly, orthogonal to this step's tables.

## 3. Spec references

- **`docs/spec.md` §7 — Metrics and Observables** defines every column that lands in `tick_metrics`. §7.1 enumerates the scalar per-tick metrics (`communication success rate`, `mean token weight`, `token weight variance`, `Nw`, `matching rate`, `largest-cluster size`, `cluster count`, `interaction-graph modularity`, `assimilation index`, `segregation index`, `time-to-consensus`). §7.2 describes the sampled tensor snapshots that populate `snapshots`. §7.3 defines the end-of-run classification (`assimilation / segregation / mixed / inconclusive`) that lands in `runs.classification` plus the convergence-status fields that land in `runs.summary_json`.
- **`docs/spec.md` §8 — Architecture Sketch** places a "Persistence (IndexedDB)" box below the worker and explicitly lists *"configs, runs, metrics, snapshots"* as the entity set. This step preserves those four entities but **replaces the IndexedDB substrate with SQLite via drizzle**, per the override recorded in `CLAUDE.md` "Stack and versions". The ASCII diagram's four-entity list is load-bearing — every entity in the diagram has a corresponding table in this step, one-to-one.
- **`docs/spec.md` §F15 — Recorded runs** states: *"Every completed run is persisted to browser-local storage (IndexedDB) with its config, seed, tick-by-tick metrics, and a summary snapshot. A runs browser lists them with filter/sort, and each run can be re-opened to any of the live views."* The "browser-local storage (IndexedDB)" phrase is the one this step overrides; the remainder of F15 — config, seed, tick-by-tick metrics, summary snapshot, browsable list — is the schema's shopping list.
- **`docs/spec.md` §F16 — Export** specifies *"CSV is long-format (one row per tick per metric) for easy ingestion into tidyverse/pandas; file names include the config hash and seed for traceability"*. This is the single most important design driver for the `tick_metrics` table shape in this step. The table is long-format *because the export is long-format*, and the SHA-256 content hash stored on `configs.content_hash` is what step 30's export filenames pull from.
- **`CLAUDE.md` "Stack and versions"** records the SQLite override verbatim: *"Persistence: Drizzle ORM + `better-sqlite3` (server-side SQLite). Overrides the spec's IndexedDB suggestion in §8/F15/F16; the data model (configs, runs, tick metrics, snapshots) is preserved, but storage moves server-side."* This step is the step where that override becomes schema.
- **`CLAUDE.md` "Export conventions"** (populated in step 30 but declared in advance by the living document rules) commits the project to filenames that *"include the config SHA-256 (first 8 hex) and the seed"*. That commitment is the reason `configs.content_hash` is a first-class column rather than being recomputed on demand from `content_json`.
- **`CLAUDE.md` "Database access patterns"** already records the rules this step must obey: every file under `lib/db/` begins with `import 'server-only';`, schema entity files live at `db/schema/<entity>.ts` and are re-exported from `db/schema/index.ts`, writes happen in Server Actions, reads happen in Server Components via the DAL or in Server Actions, and client components never import from `lib/db/`. This step adds four schema modules and four helper modules, each of which honors every one of those rules.

## 4. Research notes

Minimum requirements met: **3 local Next doc citations, 2 WebFetched external URLs (drizzle + sqlite), 1 path-not-taken, total ≥ 5 links.**

### Local Next.js 16 documentation

1. **`node_modules/next/dist/docs/01-app/02-guides/data-security.md`**, heading *"Preventing client-side execution of server-only code"* (~lines 238-264). Canonical rationale for the `import 'server-only';` line at the top of every helper file in `lib/db/`. The doc states: *"This ensures that proprietary code or internal business logic stays on the server by causing a build error if the module is imported in the client environment."* The four helper modules created in this step (`lib/db/configs.ts`, `lib/db/runs.ts`, `lib/db/tick-metrics.ts`, `lib/db/snapshots.ts`) each transitively pull in `better-sqlite3`'s native binding through `@/lib/db/client`, so leaking any of them into a client component would trigger the opaque Turbopack native-binding failure that `CLAUDE.md` "Known gotchas" warns about. The `server-only` guard is the compile-time defense; this step treats it as non-negotiable.

2. **`node_modules/next/dist/docs/01-app/02-guides/data-security.md`**, heading *"Data Access Layer"* (~lines 55-129) and *"Using a Data Access Layer for mutations"* (~lines 387-427). Establishes the pattern: wrap DB queries behind a dedicated server-only module, keep `process.env` access confined to that layer, and treat the helper functions as the only legal path between Server Actions and the underlying tables. The helpers in this step are the read-and-write half of that DAL surface for simulation data. Step 26's runs browser page will read through `listRuns` and `getRun`; step 26's "save run" Server Action will write through `createRun`, `insertTickMetrics`, and `saveSnapshot`; step 30's export route will read through `loadTickMetrics`. Step 06 already landed the auth half of the DAL (`verifySession()` in `lib/auth/dal.ts`); this step is strictly additive — the simulation-data DAL and the auth DAL are independent modules that callers compose.

3. **`node_modules/next/dist/docs/01-app/02-guides/forms.md`**, heading *"Form validation"*. Next 16 recommends Zod validation of Server Action inputs via `schema.safeParse(...)`. The `saveConfig` helper in this step does **not** validate inside the helper — it takes an already-parsed `ExperimentConfig` (the type inferred from the step-01 Zod schema) — because validation is the caller's job at the Server Action boundary. The helper's contract is: *"if you hand me a typed `ExperimentConfig`, I promise to canonicalize it, hash it, and insert it"*. The JSON serialization inside the helper is deterministic (sorted keys) so that `content_hash` is stable across insertions of the same logical config; step 30's export filename reuses that hash.

4. **`node_modules/next/dist/docs/01-app/03-api-reference/08-turbopack.md`**, heading *"Magic Comments"* and the adjacent module-resolution section. Reminder that Turbopack has no `webpack.resolve.fallback` escape hatch for native modules; the only correct way to keep `better-sqlite3` out of the client bundle is the `import 'server-only';` guard on every file that imports `@/lib/db/client`. This is the same rationale cited in steps 02, 03, 04, and 06 — restated here because this step adds the biggest single batch of new `lib/db/` files so far and any omission would be especially easy to miss in review.

### External WebFetched references

5. **Drizzle ORM — Indexes and Constraints**, `https://orm.drizzle.team/docs/indexes-constraints` (WebFetched). Confirms the `primaryKey({ columns: [...] })` helper for composite primary keys, the `index('name').on(table.col)` and `uniqueIndex('name').on(table.col)` helpers for single- and multi-column indexes, and the pattern for declaring constraints inside the third-argument callback of `sqliteTable('name', { ... }, (table) => [ ... ])`. This is the exact API `tick_metrics` uses for its `(run_id, tick, world, metric_name)` composite PK plus the two secondary indexes on `(run_id, metric_name)` and `(run_id, tick)`. The drizzle doc also confirms that foreign-key references are declared on the individual column via `.references(() => other.id, { onDelete: 'cascade' | 'set null' | ... })`; this step uses `'cascade'` on every `run_id` reference and `'set null'` on every `created_by` reference.

6. **Drizzle ORM — SQLite column types**, `https://orm.drizzle.team/docs/column-types/sqlite` (WebFetched). Confirms that SQLite has no native JSON column type — drizzle's `text({ mode: 'json' }).$type<T>()` stores JSON as TEXT with TypeScript inference on the TS side. This step chooses plain `text()` (not `{ mode: 'json' }`) for `content_json`, `summary_json`, and `content_json` on `snapshots`, because (a) the inserted value is already a string (canonicalized JSON from the helper), (b) `{ mode: 'json' }` invokes drizzle's automatic `JSON.parse`/`stringify` on read/write which would re-shuffle key order and invalidate the content hash, and (c) the read side — step 30's CSV export — never parses the JSON at all; it goes straight from `tick_metrics` rows into CSV rows with no JSON touching the hot path. The doc also confirms the `integer({ mode: 'timestamp' })` and `integer({ mode: 'timestamp_ms' })` modes used by `created_at`, `updated_at`, `started_at`, and `finished_at`; this step uses `'timestamp'` (seconds resolution, via `unixepoch()` default) for audit-trail columns and `'timestamp_ms'` nowhere — millisecond precision is unnecessary for anything this step persists.

7. **SQLite JSON1 documentation**, `https://www.sqlite.org/json1.html` (WebFetched). Confirms that *"SQLite stores JSON as ordinary text"* and that there is no native JSON column type — SQLite's type affinity system only knows NULL, INTEGER, REAL, TEXT, and BLOB. JSONB (the binary representation introduced in SQLite 3.45.0) is available but is a different format from PostgreSQL's JSONB, is opaque, and offers no win here because the helpers never issue `json_extract`-style queries against the columns — `content_json` and `summary_json` are opaque blobs from SQL's point of view, read and written atomically. This reinforces the choice in reference 6: plain TEXT columns, caller-side serialization, no `{ mode: 'json' }`.

### Path not taken

8. **Single `metrics_json` TEXT column on `runs` instead of the long-format `tick_metrics` table — rejected.** The obvious simpler shape is: one row per run, and a single `metrics_json` TEXT column that stores the entire tick-by-tick trajectory as a JSON array. Writes would be one `INSERT` per run instead of N inserts (where N ≈ tickCount × metricCount × worlds — for a 5,000-tick run with 10 metrics and 2 worlds, roughly 100,000 rows). It is **rejected for three concrete reasons**:
   - *(a) The step 30 CSV export is long-format (F16) and needs to stream row-at-a-time.* With `tick_metrics` as a proper table, the export is `SELECT tick, world, metric_name, metric_value FROM tick_metrics WHERE run_id = ? ORDER BY tick ASC, metric_name ASC` piped straight into the CSV writer with no intermediate JSON buffering — the memory footprint is O(1) in the number of metric rows. With `metrics_json`, the export has to read the whole blob, `JSON.parse` it, iterate the parsed structure, and emit rows — memory footprint becomes O(N) in metric count per run and the streaming API route in step 30 collapses into a non-streaming response.
   - *(b) Filter queries become impossible.* A common research query is *"show me the last 200 ticks of `assimilation_index` across all runs of config X"*. With the long format that is `SELECT tick, metric_value FROM tick_metrics tm JOIN runs r ON tm.run_id = r.id WHERE r.config_id = ? AND tm.metric_name = 'assimilation_index' ORDER BY tm.tick DESC LIMIT 200` — a single indexed scan. With `metrics_json` that is "read every run, JSON.parse every blob, filter client-side", which is operationally untenable.
   - *(c) Indexing.* SQLite indexes on JSON paths exist (via generated columns and `json_extract`) but they add schema complexity, require a specific JSON shape stability, and are fragile to future shape changes. A plain composite index on `(run_id, metric_name)` and another on `(run_id, tick)` — which this step declares — is boring, stable, and serves both primary query patterns described in §7.
   
   The rejection does not generalize to `summary_json` on `runs` (end-of-run aggregate metrics) or `content_json` on `snapshots` (tensor snapshots) — those are legitimately opaque blobs queried atomically, never streamed or filtered on inner fields, and TEXT-storage is the right tool. The split is: *long-format rows for anything the CSV export streams; opaque JSON blobs for anything the UI loads wholesale for a single run at a time*.

Total links: 4 local Next doc references + 3 external WebFetched URLs (drizzle indexes, drizzle sqlite types, sqlite json) + 1 path-not-taken = **8 citations, quota satisfied with margin**.

## 5. Files to create

All paths relative to the repo root.

### Schema modules (four new files under `db/schema/`)

- **`db/schema/configs.ts`** — first line `import 'server-only';`. Defines `configs` via `sqliteTable('configs', { ... })` with columns:
  - `id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID())` — same UUID-v4 pattern step 03 uses on `users.id`, same rationale (self-identifying rows, no hand-constructed IDs in call sites).
  - `name: text('name').notNull()` — user-friendly label, shown in the step-26 browser and the step-25 config library.
  - `contentJson: text('content_json').notNull()` — the canonicalized JSON string of the `ExperimentConfig` produced by step 01's Zod schema. Plain `text()`, not `{ mode: 'json' }`, per research note 6. The column name is snake_case on the SQL side (`content_json`) and camelCase on the TS field side (`contentJson`); drizzle handles the mapping.
  - `contentHash: text('content_hash').notNull()` — SHA-256 hex digest of `contentJson`. Used for dedup (two `saveConfig` calls with identical logical content produce identical hashes) and for step 30's export filenames (`msksim-<hash-first-8-hex>-seed-<n>-metrics.csv`).
  - `createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())` — drizzle runtime default; inserts without an explicit value receive "now".
  - `updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date())` — drizzle runtime `$onUpdateFn` because SQLite has no `ON UPDATE CURRENT_TIMESTAMP` trigger. Same idiom as `users.updatedAt` in step 03.
  - `createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' })` — nullable because deleting a user must not delete the config (see §2 prerequisites). The column is declared without `.notNull()` precisely because `ON DELETE SET NULL` needs a nullable target.
  - Exports: the `configs` table, plus the inferred types `typeof configs.$inferSelect` and `typeof configs.$inferInsert` under the names `Config` and `NewConfig`.

- **`db/schema/runs.ts`** — first line `import 'server-only';`. Defines `runs` via `sqliteTable('runs', { ... })` with columns:
  - `id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID())`.
  - `configId: text('config_id').notNull().references(() => configs.id, { onDelete: 'cascade' })` — deleting a config cascades to all its runs, which is intended: a config is the "experiment definition", and its runs are meaningless without it. Imported from `./configs`.
  - `seed: integer('seed').notNull()` — the RNG seed used for this run. Together with `configId` it fully determines the deterministic trajectory (per the determinism requirement in `docs/spec.md` §8 "Key architectural commitments").
  - `startedAt: integer('started_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())` — runtime default on insert; step 26's "start run" Server Action creates the row with status `'pending'`, and the default fills `startedAt` at that point.
  - `finishedAt: integer('finished_at', { mode: 'timestamp' })` — nullable; only set when the run reaches `status in ('completed', 'failed', 'cancelled')`. Populated by the `finishRun` helper.
  - `status: text('status', { enum: ['pending', 'running', 'completed', 'failed', 'cancelled'] }).notNull().$defaultFn(() => 'pending')` — drizzle's `{ enum: [...] }` option emits a TypeScript literal-union type for the column and a CHECK constraint on the SQL side. Initial status is always `'pending'`.
  - `tickCount: integer('tick_count').notNull().$defaultFn(() => 0)` — how many ticks were actually executed. Filled by `finishRun` at completion. Zero on insert.
  - `summaryJson: text('summary_json')` — nullable; filled by `finishRun` with the end-of-run summary metrics from step 17 (`{ meanSuccessRate, timeToConsensus, finalAssimilationIndex, finalSegregationIndex, ... }`). Not parsed by the DB; opaque TEXT. Null while the run is still pending or running.
  - `classification: text('classification', { enum: ['assimilated', 'segregated', 'mixed', 'inconclusive'] })` — nullable until the run reaches a terminal status. Same `{ enum }` pattern as `status`. Populated by `finishRun` based on the step-17 classifier output.
  - `errorMessage: text('error_message')` — nullable; populated only when `status === 'failed'`. The runs browser in step 26 renders this in the row detail view.
  - `createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' })` — same nullable-ownership pattern as `configs.createdBy`.
  - Exports: the `runs` table, plus `Run = typeof runs.$inferSelect` and `NewRun = typeof runs.$inferInsert`, plus a `RunStatus` type alias for the status enum and a `RunClassification` type alias for the classification enum — downstream code imports these directly instead of re-declaring the literal unions.

- **`db/schema/tick_metrics.ts`** — first line `import 'server-only';`. Defines `tickMetrics` via `sqliteTable('tick_metrics', { ... })` with columns:
  - `runId: text('run_id').notNull().references(() => runs.id, { onDelete: 'cascade' })` — imported from `./runs`.
  - `tick: integer('tick').notNull()` — the simulation tick number, 0-indexed per `docs/spec.md` §3.3.
  - `world: text('world', { enum: ['world1', 'world2', 'both'] }).notNull()` — the three legal values: per-world breakdowns plus the cross-world aggregate used for metrics like `time-to-consensus`.
  - `metricName: text('metric_name').notNull()` — free-form text, not an enum, because the metric set in `docs/spec.md` §7.1 is open-ended (step 15 adds scalars, step 16 adds graph metrics, step 17 adds run-summary metrics, and a v2 extension could add noise-rate metrics per §11 open question 4). Using `text()` not `{ enum: [...] }` means adding a new metric is a code change in the sim core only, not a migration. Examples the engine emits: `'success_rate'`, `'mean_token_weight'`, `'token_weight_variance'`, `'nw'`, `'matching_rate'`, `'largest_cluster_size'`, `'cluster_count'`, `'interaction_modularity'`, `'assimilation_index'`, `'segregation_index'`.
  - `metricValue: real('metric_value').notNull()` — `real` is SQLite's IEEE-754 double; adequate for every metric in §7.1 (all are either ratios, counts castable to double, or modularity values in [-1, 1]).
  - The third argument to `sqliteTable` is a callback that returns an array with the composite primary key and the two secondary indexes:
    - `primaryKey({ columns: [table.runId, table.tick, table.world, table.metricName] })` — prevents duplicate inserts for the same logical observation and doubles as the primary index scan path.
    - `index('tick_metrics_run_metric_idx').on(table.runId, table.metricName)` — serves queries of the form *"all ticks of one metric for one run"*, which is the single most common UI query (a time series chart is exactly this shape). Without this index SQLite would fall back to a scan of the composite primary key (which orders by `tick` first), and filtering by `metricName` would require reading every row of the run.
    - `index('tick_metrics_run_tick_idx').on(table.runId, table.tick)` — serves queries of the form *"all metrics of one tick for one run"*, which is the shape the step-21/22 live dashboard uses when replaying a recorded run. The composite PK already covers this ordering but an explicit secondary index here is belt-and-braces: it is cheap (SQLite indexes are small) and makes the query plan stable against future column-order refactors.
  - Exports: the `tickMetrics` table (note the camelCase export name for the TS identifier; the SQL table is still `tick_metrics`), plus `TickMetric = typeof tickMetrics.$inferSelect` and `NewTickMetric = typeof tickMetrics.$inferInsert`.

- **`db/schema/snapshots.ts`** — first line `import 'server-only';`. Defines `snapshots` via `sqliteTable('snapshots', { ... })` with columns:
  - `id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID())` — snapshots are addressable individually (e.g., the step-25 replay UI may load one specific snapshot by id), hence a surrogate key rather than a composite PK on `(run_id, tick, kind)`.
  - `runId: text('run_id').notNull().references(() => runs.id, { onDelete: 'cascade' })`.
  - `tick: integer('tick').notNull()` — the tick at which the snapshot was taken. `docs/spec.md` §7.2 says samples are taken "every N ticks" with N configurable (default 10 per the step-01 config schema's `sampleInterval`).
  - `kind: text('kind', { enum: ['inventory', 'interaction_graph'] }).notNull()` — two snapshot flavors per §7.2: full agent inventories and cumulative interaction-graph adjacency. Closed enum because the set is fixed at v1; adding a third flavor is a migration-level change, which is the correct friction.
  - `contentJson: text('content_json').notNull()` — opaque JSON TEXT, same storage convention as `configs.contentJson` and `runs.summaryJson`. Read wholesale; never JSON-filtered at the SQL layer.
  - Third-argument callback: `index('snapshots_run_tick_idx').on(table.runId, table.tick)` — serves the primary query pattern *"all snapshots for run X ordered by tick"* used by the step-25 replay view.
  - Exports: the `snapshots` table, `Snapshot = typeof snapshots.$inferSelect`, `NewSnapshot = typeof snapshots.$inferInsert`, and a `SnapshotKind` type alias.

### Helper modules (four new files under `lib/db/`)

- **`lib/db/configs.ts`** — first line `import 'server-only';`. Imports `db` from `@/lib/db/client`, `configs` (and `Config`, `NewConfig`) from `@/db/schema/configs`, `eq` and `desc` from `drizzle-orm`, `createHash` from `node:crypto`, and the inferred `ExperimentConfig` type from `@/lib/schema/config`. Exports four functions:
  - `saveConfig({ name, config, createdBy }: { name: string; config: ExperimentConfig; createdBy?: string | null }): Promise<Config>` — canonicalizes `config` to JSON with **sorted keys** (a small recursive `canonicalize(value)` helper inside the file; deterministic ordering is load-bearing because the hash must be identical for two logically equivalent configs), computes SHA-256 over the canonical string via `createHash('sha256').update(canonical).digest('hex')`, and inserts a row. Returns the inserted `Config` (use `.returning()`). Notes the canonicalization is intentionally recursive over nested objects and arrays — arrays preserve insertion order, objects re-sort by key — matching the recipe `docs/spec.md` F16 implicitly requires when it says "file names include the config hash".
  - `loadConfig(id: string): Promise<{ row: Config; parsed: ExperimentConfig } | null>` — selects by id, returns `null` on empty result, otherwise `JSON.parse`s `row.contentJson` and re-parses through `ExperimentConfig.parse(...)` (from step 01) before returning. The double parse is intentional: `JSON.parse` handles the text-to-object transform; the Zod schema handles validation *and* type narrowing so the caller gets a fully-typed `ExperimentConfig` without any `any` in the pipeline. If Zod rejects the stored content (which should never happen unless the schema evolved incompatibly), the error propagates — this is the "schema drift detector" for us.
  - `listConfigs(opts?: { limit?: number; createdBy?: string }): Promise<Config[]>` — returns all configs sorted by `updatedAt` descending. Optional filters: `limit` (default 100, so the step-25 config library renders instantly) and `createdBy` (for "show me only my configs"). Does not parse the JSON — listing is a metadata operation, so `contentJson` is returned as text and the caller decides whether to parse.
  - `deleteConfig(id: string): Promise<void>` — single `delete` with `where eq(configs.id, id)`. Cascades to `runs`, `tick_metrics`, `snapshots` by FK. The helper body is one line; the documentation comment is the important part: *"Deleting a config deletes every run, every tick metric row, and every snapshot that references it. This is irreversible. Callers should confirm with the user before invoking."*

- **`lib/db/runs.ts`** — first line `import 'server-only';`. Imports `db`, `runs` (and `Run`, `NewRun`, `RunStatus`, `RunClassification`), `eq`, `and`, `desc`. Exports six functions:
  - `createRun({ configId, seed, createdBy }: { configId: string; seed: number; createdBy?: string | null }): Promise<Run>` — inserts a row with status `'pending'`, returning the full row. `startedAt` and `tickCount` pick up their runtime defaults.
  - `updateRunStatus(id: string, status: RunStatus): Promise<void>` — narrow update for the `'pending' -> 'running'` and `'running' -> 'cancelled'` transitions. Does not touch `finishedAt` or `summaryJson`.
  - `finishRun({ id, status, tickCount, summary, classification, errorMessage }: { id: string; status: 'completed' | 'failed' | 'cancelled'; tickCount: number; summary?: unknown; classification?: RunClassification | null; errorMessage?: string | null }): Promise<Run>` — atomic finalization: sets `status`, `finishedAt = new Date()`, `tickCount`, `summaryJson = summary ? JSON.stringify(summary) : null`, `classification`, `errorMessage`. Returns the updated row via `.returning()`. The type of `summary` is intentionally `unknown` because the end-of-run summary shape comes from step 17 which has not landed yet; step 17 will narrow it by re-exporting a specific type that this helper can re-import without a circular dependency.
  - `getRun(id: string): Promise<Run | null>` — single select by id.
  - `listRuns(opts?: { limit?: number; configId?: string; status?: RunStatus; createdBy?: string }): Promise<Run[]>` — returns runs sorted by `startedAt` descending, with optional filters. Used by step 26's runs browser.
  - `deleteRun(id: string): Promise<void>` — single delete; cascades to `tick_metrics` and `snapshots` via FK.

- **`lib/db/tick-metrics.ts`** — first line `import 'server-only';`. Imports `db`, `tickMetrics` (and `TickMetric`, `NewTickMetric`), `eq`, `and`, `asc`. Exports two functions:
  - `insertTickMetrics(runId: string, rows: Array<{ tick: number; world: 'world1' | 'world2' | 'both'; metricName: string; metricValue: number }>): Promise<void>` — bulk insert. Wraps the insert in a `db.transaction(tx => { ... })` block and iterates over `rows` calling `tx.insert(tickMetrics).values({ runId, ...row })` for each. The transaction is **mandatory** — without it, inserting 100,000 rows for a single run would issue 100,000 separate auto-commits and take multiple seconds per run; with a single transaction better-sqlite3 processes the whole batch in well under 100 ms. The `runId` is bound from the helper argument rather than from each row because a batch always belongs to one run; this also saves 16 bytes per row (one less column to serialize per `.values()` call). The helper accepts up to the entire run's worth of rows in a single call — there is no internal batching or chunking, because better-sqlite3's synchronous transaction API does not benefit from chunking the way async drivers do.
  - `loadTickMetrics(runId: string, metricName?: string): Promise<TickMetric[]>` — returns rows for the given run, optionally filtered to one metric, ordered by `(tick asc, world asc, metricName asc)`. The ordering is the CSV-friendly stable order step 30 will stream in. If `metricName` is provided, the query uses the `tick_metrics_run_metric_idx` index declared on the schema; if not, it falls back to the composite primary key scan which is still indexed on `runId` first.

- **`lib/db/snapshots.ts`** — first line `import 'server-only';`. Imports `db`, `snapshots` (and `Snapshot`, `NewSnapshot`, `SnapshotKind`), `eq`, `and`, `asc`. Exports two functions:
  - `saveSnapshot({ runId, tick, kind, content }: { runId: string; tick: number; kind: SnapshotKind; content: unknown }): Promise<Snapshot>` — stringifies `content` to JSON (no sorted-keys canonicalization here — snapshots are inspected by humans, not hashed), inserts, returns the row. Single insert, no transaction needed (step 27's batch orchestrator will call `saveSnapshot` from inside its own transaction if it cares).
  - `loadSnapshots(runId: string, opts?: { kind?: SnapshotKind }): Promise<Snapshot[]>` — select rows, ordered by `tick asc`, optionally filtered by `kind`. Uses the `snapshots_run_tick_idx` index.

### Test file

- **`lib/db/persistence.test.ts`** — one consolidated Vitest file at the `lib/db/` level (not colocated next to each helper file, because the tests exercise cross-table behavior and FK cascades). Uses the same in-memory drizzle client pattern established by step 02's and step 04's tests: open `better-sqlite3(':memory:')`, run `PRAGMA foreign_keys = ON`, push the full schema (configs, runs, tick_metrics, snapshots, plus users for the FK targets), and tear down in `afterEach`. Imports the helpers under test directly from `@/lib/db/configs`, `@/lib/db/runs`, `@/lib/db/tick-metrics`, and `@/lib/db/snapshots`. The nine test cases are enumerated in §9 below.

### Generated migration file

- **`db/migrations/NNNN_<drizzle-slug>.sql`** — produced by `npx drizzle-kit generate` after all four schema modules are in place and re-exported from `db/schema/index.ts`. The filename is generated by drizzle-kit and is not hand-chosen. The matching update to `db/migrations/meta/_journal.json` (and any `snapshot.json` under `db/migrations/meta/`) is committed in the same commit. The implementing claude does not hand-edit the SQL file under any circumstances — if the generated SQL is wrong, the fix is in `db/schema/*.ts`, not in the migration.

## 6. Files to modify

- **`db/schema/index.ts`** — append four `export * from './configs';`, `export * from './runs';`, `export * from './tick_metrics';`, `export * from './snapshots';` lines. The file already contains the `users` and `sessions` exports from steps 03 and 04; preserve those untouched. Order the new exports alphabetically after `sessions` (configs, runs, snapshots, tick_metrics) for file-level consistency, or in dependency order (configs → runs → tick_metrics → snapshots) — either is acceptable, pick dependency order because it makes the barrel read as a narrative.
- **`package.json`** — **no new dependencies**. `crypto.randomUUID` and `crypto.createHash` are both Node core via `node:crypto`. `drizzle-orm`, `drizzle-kit`, and `better-sqlite3` all landed in step 02. Zod landed in step 01. If any of these turn out to be missing from `package.json` because an earlier step landed differently than planned, the implementing claude stops and surfaces the delta — it does not paper over a missing prerequisite with an inline install.

## 7. Implementation approach

Prose, not code. The implementing claude walks this sequence in order; each sub-step is internal to the single commit that wraps the whole step.

1. **Verify prerequisites.** Confirm that `db/schema/index.ts` already re-exports `users` and `sessions`. Confirm that `lib/schema/config.ts` exists and exports `ExperimentConfig`. Confirm that `lib/db/client.ts` exists and begins with `import 'server-only';`. Confirm that `better-sqlite3` loads (one-line `node -e "require('better-sqlite3')(':memory:').close()"` — fast, cheap, catches reinstall regressions). If any check fails, stop and report — do not attempt to cover for an earlier missing step by recreating its artifacts.

2. **Write the four schema files in dependency order.** Start with `db/schema/configs.ts` (depends only on `users`, which exists). Then `db/schema/runs.ts` (depends on `configs` and `users`). Then `db/schema/tick_metrics.ts` (depends on `runs`). Then `db/schema/snapshots.ts` (depends on `runs`). Each file begins with `import 'server-only';` as line 1, imports its FK targets via relative path (`./configs`, `./runs`, `./users`), declares the table with the third-argument callback for composite PK / indexes where applicable, and exports the table plus the inferred types. Do not try to share a common timestamps fragment — drizzle's column definitions do not compose cleanly across files and the duplication is trivial (four lines × four files = 16 lines).

3. **Append exports to `db/schema/index.ts`.** Four new lines, in dependency order. Preserve the step 03/04 exports.

4. **Generate the migration.** Run `npx drizzle-kit generate`. Inspect the emitted SQL file and verify: (a) four `CREATE TABLE` statements exist; (b) every FK clause includes the correct `ON DELETE` action (`CASCADE` for `runs.config_id`, `tick_metrics.run_id`, `snapshots.run_id`; `SET NULL` for `configs.created_by`, `runs.created_by`); (c) the `tick_metrics` composite primary key is `PRIMARY KEY (run_id, tick, world, metric_name)` in that order; (d) both secondary indexes on `tick_metrics` are present; (e) the `snapshots_run_tick_idx` index is present. If any of these are missing or wrong, the fix is in the drizzle schema file — re-run `drizzle-kit generate` after every edit, and commit only the final version.

5. **Run the migration on a scratch DB.** Delete `data/msksim.db` (gitignored), then run `npm run db:migrate` twice. The first call must apply the new migration (plus step 03 and step 04 migrations) cleanly from an empty DB; the second call must be a no-op and also exit 0. If either run fails, the fix is in the schema file — iterate until the migration is idempotent. Afterwards delete `data/msksim.db` again so it does not linger in the working tree (it is gitignored anyway but keeping the tree tidy makes the commit diff unambiguous).

6. **Write the four helper files in dependency order.** `lib/db/configs.ts` first — it introduces the canonicalization helper and the SHA-256 hashing, which are the most delicate bits of this step. The canonicalization function is small (one recursive pass) but load-bearing: it sorts object keys, preserves array order, and bottoms out on primitives. Then `lib/db/runs.ts`, which imports nothing unusual — straightforward drizzle selects, updates, and inserts. Then `lib/db/tick-metrics.ts`, whose only subtlety is the `db.transaction` wrapping for the bulk insert — the transaction is the single most important correctness detail in this file, so call it out in a comment above the function. Then `lib/db/snapshots.ts`, which is the simplest of the four (two functions, no transactions, no canonicalization). Every file begins with `import 'server-only';` on line 1 — no exceptions; the implementing claude grep-verifies this before commit.

7. **Write the consolidated test file.** One `describe('lib/db persistence', ...)` block at the top with a `beforeEach` that constructs the in-memory DB and a `afterEach` that closes it. Use the schema-push helper that step 02 established for its own tests (reuse, do not reinvent — if it is a small inline helper in step 02's test file, it is acceptable to re-inline here; if it was factored into a test util, import it). Each of the nine test cases in §9 is a separate `it(...)` block so a failure points at a specific assertion. The cascade test explicitly verifies that `PRAGMA foreign_keys` is `ON` on the test connection as its first step — if it is not, the test fails loudly with a clear message rather than silently passing because the cascade is a no-op.

8. **Run the tests.** `npm test -- lib/db` must be green. If the cascade test fails because the pragma is off, the fix is in `lib/db/client.ts` (step 02) — this step does not silently re-enable it in the test helper. The whole point of the pragma living in the singleton is so every caller (production and test) gets the same behavior.

9. **Run the full typecheck.** `npm run typecheck`. The generic parameters on the helper functions must resolve — especially `Config`, `Run`, `TickMetric`, `Snapshot` — without landing in `any`. The `ExperimentConfig` import chain from `lib/schema/config` through `lib/db/configs.ts` must resolve without cycles.

10. **Run lint.** `npm run lint`. The helpers must pass the flat ESLint config from step 00 without suppression comments.

11. **Verify the `server-only` guard on every helper file.** A final `grep -rn "^import 'server-only'" lib/db/` (via the repo's grep tool, not Bash) must show a line-1 match on all four new files plus the existing `lib/db/client.ts` and any other files already under `lib/db/`.

12. **Update CLAUDE.md "Database access patterns".** See §11 for the exact appended bullets and the hard cap.

13. **Commit.** One commit, subject line `step 08: run persistence schema`, body lists the four tables created, the composite PK and index strategy on `tick_metrics`, the FK cascade/set-null split, and the helper modules added.

**Key design decisions the implementing claude must not second-guess mid-implementation.** The long-format `tick_metrics` shape is non-negotiable (see path-not-taken in §4). The composite PK ordering `(run_id, tick, world, metric_name)` is the order the CSV export consumes, so it must be that order. The two secondary indexes are both required — the step-21/22 live dashboard's "all metrics of one tick" query would be a full-run scan without the second one, and the step-26 time-series chart's "all ticks of one metric" query would be a full-run scan without the first one. The `created_by` columns use `SET NULL`, the `config_id` / `run_id` columns use `CASCADE`; the asymmetry is intentional and documented in §2. TEXT columns for `content_json` and `summary_json` (not `{ mode: 'json' }`) are mandatory for the content-hash stability reason in §4 research note 6. Canonicalization in `saveConfig` sorts object keys recursively — without that the hash is unstable.

## 8. Library choices

No new libraries in this step.

- `drizzle-orm` and `drizzle-kit` — already installed in step 02, same versions.
- `better-sqlite3` — already installed in step 02, same version.
- `zod` — already installed in step 01; consumed transitively via the `ExperimentConfig` import from `@/lib/schema/config` in `lib/db/configs.ts`.
- `node:crypto` — Node core, provides both `randomUUID` (already used by step 03's users table) and `createHash('sha256')` (new consumer in this step). No package to install.
- `vitest` — already installed in step 00.

The implementing claude verifies via `npm ls better-sqlite3 drizzle-orm drizzle-kit zod` that each resolves to exactly one version before writing any code; if any of them is missing or at an unexpected version, the step stops.

## 9. Unit tests

All nine assertions live in `lib/db/persistence.test.ts`. Each uses a fresh in-memory drizzle client with `PRAGMA foreign_keys = ON`, constructed in `beforeEach` and closed in `afterEach`.

1. **Insert config, verify row.** Build a minimal `ExperimentConfig` via `ExperimentConfig.parse({})` (step 01 guarantees the default is runnable). Call `saveConfig({ name: 'baseline', config })`. Assert the returned row has: a defined `id` (valid uuid), `name === 'baseline'`, non-empty `contentJson`, non-empty `contentHash` of length 64 (hex SHA-256), and non-null `createdAt` / `updatedAt`. Re-read the row via `db.select().from(configs).where(eq(configs.id, returned.id))` and deep-equal against the returned value.

2. **Hash is correctly computed and stored.** Call `saveConfig` twice with the *same logical config* but different property insertion orders (build the object two different ways: once with `{ seed: 0, tickCount: 100 }` and once with `{ tickCount: 100, seed: 0 }`, then wrap each through the `ExperimentConfig` parser). Assert the two returned rows have **identical** `contentHash` values. This proves the canonicalization sorts keys. Additionally assert that a manual `createHash('sha256').update(row.contentJson).digest('hex')` matches `row.contentHash` — i.e., the stored hash is of the stored canonical string, not some other intermediate.

3. **Insert run referencing config, verify FK.** `saveConfig` a config, then `createRun({ configId: config.id, seed: 42 })`. Assert the returned run has `configId === config.id`, `seed === 42`, `status === 'pending'`, `tickCount === 0`, `startedAt !== null`, `finishedAt === null`, `summaryJson === null`, `classification === null`, `errorMessage === null`. Then try `createRun({ configId: 'nonexistent-id', seed: 0 })` and assert it throws with a FK-constraint error message.

4. **Bulk insert 100 tick_metrics rows, load by run_id, assert count = 100.** Create config + run. Build an array of 100 metric rows spanning two ticks (0 and 1) × two worlds (`'world1'`, `'world2'`) × 25 distinct metric names (`'m0'` through `'m24'`). Call `insertTickMetrics(run.id, rows)`. Call `loadTickMetrics(run.id)` with no metric filter and assert the returned array length is exactly 100. Assert the rows are sorted `(tick asc, world asc, metricName asc)`. Assert every row's `runId` equals `run.id`.

5. **Load by (run_id, metric_name), assert filter works.** Reuse the setup from test 4. Call `loadTickMetrics(run.id, 'm7')` and assert the returned array length is exactly 4 (two ticks × two worlds). Assert every returned row has `metricName === 'm7'`. Call `loadTickMetrics(run.id, 'nonexistent-metric')` and assert the returned array is empty.

6. **Delete config cascades to run, tick_metrics, snapshots.** Create config, create run, insert 10 tick_metrics rows, insert 3 snapshots. Assert the four tables collectively hold 1 + 1 + 10 + 3 = 15 rows. Call `deleteConfig(config.id)`. Re-query each table. Assert `configs` has 0 rows, `runs` has 0 rows, `tickMetrics` has 0 rows, `snapshots` has 0 rows. This test depends on `PRAGMA foreign_keys = ON` being set on the connection; the first line of the test body explicitly asserts `db.get(sql\`PRAGMA foreign_keys\`).foreign_keys === 1` (or equivalent) so a silent failure of the cascade surfaces as a clear pragma-off diagnostic instead of a mysterious 15-row residue.

7. **listConfigs returns configs sorted by updatedAt desc.** Save three configs at different times using `vi.setSystemTime` to advance virtual time between inserts: `save(A, t=0)`, `save(B, t=1000)`, `save(C, t=2000)`. Call `listConfigs()` and assert the returned order is `[C, B, A]` (newest first). Add a `limit: 2` option to the same call and assert the returned length is 2 and the order is `[C, B]`.

8. **finishRun atomically sets terminal status, tickCount, summary, classification.** Create config + run, then call `finishRun({ id: run.id, status: 'completed', tickCount: 5000, summary: { meanSuccessRate: 0.73 }, classification: 'assimilated' })`. Re-read the run and assert `status === 'completed'`, `tickCount === 5000`, `finishedAt !== null`, `classification === 'assimilated'`, and `JSON.parse(row.summaryJson!) === { meanSuccessRate: 0.73 }`. Also assert the returned row from `finishRun` matches the re-read row exactly (i.e., `.returning()` was actually used).

9. **saveSnapshot and loadSnapshots round-trip and ordering.** Create config + run. Call `saveSnapshot({ runId: run.id, tick: 20, kind: 'inventory', content: { agents: [] } })`, then `saveSnapshot({ runId: run.id, tick: 10, kind: 'interaction_graph', content: { nodes: 0, edges: 0 } })`. Call `loadSnapshots(run.id)` and assert length 2, order `[tick=10, tick=20]` (ascending). Call `loadSnapshots(run.id, { kind: 'inventory' })` and assert length 1, `kind === 'inventory'`. Assert `JSON.parse(row.contentJson)` round-trips the original `content` object.

All nine tests are deterministic under Vitest's default `node` environment. No network I/O, no filesystem I/O beyond the `:memory:` SQLite database, no `Math.random()` (`crypto.randomUUID` is used but never asserted on exact value — only on shape), no wall-clock reads other than the `vi.setSystemTime` advances in test 7.

## 10. Acceptance criteria

The step is complete when all of the following are observably true on a clean clone after running the new step:

- `npm run db:generate` produces exactly one new migration file under `db/migrations/` (plus the matching `_journal.json` update), no additional files. The migration contains four `CREATE TABLE` statements, the three cascade FKs, the two set-null FKs, the composite PK on `tick_metrics`, and three secondary indexes.
- `npm run db:migrate` applies the new migration cleanly from an empty `data/msksim.db` and exits 0. A second invocation is a no-op and also exits 0.
- `npm test -- lib/db` exits 0 with all nine tests from §9 passing.
- `npm test` (full suite) exits 0. No regression in step 00/01/02/03/04/05/06/07 tests.
- `npm run typecheck` exits 0. The `Config`, `Run`, `TickMetric`, and `Snapshot` inferred types resolve without `any` leakage.
- `npm run lint` exits 0 with no suppression comments added.
- `grep -rn "^import 'server-only'" lib/db/` returns a line-1 hit on every file in `lib/db/` (four new files plus `lib/db/client.ts` from step 02, plus whatever else lives there by the time this step runs). Equivalent ripgrep invocation via the repo's grep tooling is fine.
- The commit contains exactly: four new schema files under `db/schema/`, four new helper files under `lib/db/`, one new test file `lib/db/persistence.test.ts`, one new generated migration file under `db/migrations/`, the `_journal.json` update under `db/migrations/meta/`, the `db/schema/index.ts` edit, and the CLAUDE.md append. No stray `.next/`, no accidental `.env`, no `data/msksim.db`.
- The commit diff does not touch `package.json` or `package-lock.json` (no new dependencies).

## 11. CLAUDE.md updates

Append to the **"Database access patterns"** section. The hard cap is 50 lines; the section currently holds ~10-15 lines from step 02 (the `import 'server-only'` rule, the singleton client rule, the schema / migrations layout rule, the writes-in-Server-Actions / reads-via-DAL rule). This step appends ≤ 25 new lines that document the four-table persistence model, the long-format rationale, the JSON-as-text convention, and the helper-module discipline. The appended content, in prose form (rewritten as CLAUDE.md bullets by the implementing claude):

- The simulation persistence layer has four tables: `configs` (saved `ExperimentConfig`s with canonicalized JSON and SHA-256 content hashes), `runs` (one row per completed or in-flight simulation with `status`, `classification`, and a nullable `summary_json`), `tick_metrics` (long-format, one row per `(run_id, tick, world, metric_name)` observation), and `snapshots` (sampled agent-state blobs keyed by `run_id` + `tick` + `kind`). Cascade policy: `runs.config_id`, `tick_metrics.run_id`, and `snapshots.run_id` are `ON DELETE CASCADE`. `configs.created_by` and `runs.created_by` are `ON DELETE SET NULL` — deleting a user never deletes their research artifacts.
- `tick_metrics` is deliberately long-format (one row per metric per tick per world) rather than a single `metrics_json` column on `runs`. Rationale: the step 30 CSV export streams `SELECT tick, world, metric_name, metric_value FROM tick_metrics WHERE run_id = ? ORDER BY tick, metric_name` directly into the response with O(1) memory. A JSON blob would force `JSON.parse` on the hot path and make the export non-streaming. It also enables cross-run filter queries (e.g., "all assimilation_index trajectories for configs with seed > 100") via plain SQL predicates.
- `tick_metrics` has a composite primary key `(run_id, tick, world, metric_name)` plus two secondary indexes: `(run_id, metric_name)` for the "all ticks of one metric" query pattern used by time-series charts, and `(run_id, tick)` for the "all metrics of one tick" pattern used by live dashboard replay.
- `content_json` on `configs`, `summary_json` on `runs`, and `content_json` on `snapshots` are plain TEXT columns, **not** drizzle `text({ mode: 'json' })`. SQLite has no native JSON type anyway (json1 stores as TEXT), and `{ mode: 'json' }` would run automatic `JSON.parse`/`stringify` on every read/write, which would re-shuffle key order and invalidate `content_hash`. Callers serialize and parse explicitly.
- `configs.content_hash` is SHA-256 over the canonical JSON (keys sorted recursively). Step 30's export filenames pull the first 8 hex characters from this column. Two `saveConfig` calls with the same logical content produce identical hashes; dedup is the application's responsibility, not the schema's (no `UNIQUE` constraint on `content_hash`, because the same researcher may legitimately save the same config twice under different names).
- All four new helper modules in `lib/db/` (`configs.ts`, `runs.ts`, `tick-metrics.ts`, `snapshots.ts`) start with `import 'server-only';` on line 1. Bulk inserts into `tick_metrics` are wrapped in `db.transaction(...)` — a single run can emit ~100k rows and un-transacted inserts would auto-commit each row and take seconds.

The implementing claude verifies the appended content is ≤ 25 lines and that the "Database access patterns" section total stays under its 50-line hard cap after the append. If the cap would be exceeded, promote the new content into a new dedicated section per `CLAUDE.md` "Living-document rules" rather than truncating any existing bullets.

No other CLAUDE.md sections are touched in this step.

## 12. Commit message

Exactly:

```
step 08: run persistence schema
```

No conventional-commit prefix, no emoji, no trailing period. The `step 08:` marker is load-bearing for `scripts/run-plan.ts` progress detection (`CLAUDE.md` "Commit-message convention"). One commit for the whole step; if `claude -p` produces intermediate commits during implementation they are squashed by the orchestrator before advancing to step 09.

The commit body (optional but recommended) lists:
- The four tables created (`configs`, `runs`, `tick_metrics`, `snapshots`) and their FK cascade/set-null split.
- The `tick_metrics` composite PK and the two secondary indexes.
- The four helper modules under `lib/db/` and the `server-only` discipline.
- The generated migration filename (picked by drizzle-kit, recorded here for traceability).
- Confirmation that no new packages were added.

## 13. Rollback notes

If this step lands in a bad state and needs to be undone (destructive — requires user confirmation per `CLAUDE.md` commit-safety rules):

1. `git log --oneline` to find the commit SHA immediately prior to `step 08: run persistence schema` (expected to be the step 07 commit, found via `git log --grep='^step 07:'`).
2. `git reset --hard <prior-sha>` — single-move rollback. This removes the four schema files, the four helper files, the test file, the generated migration file, the `_journal.json` update, the `db/schema/index.ts` edit, and the CLAUDE.md append in one operation.
3. Delete the local `data/msksim.db` (gitignored but physically present) so a future `npm run db:migrate` starts from an empty DB and does not carry lingering `configs`/`runs`/`tick_metrics`/`snapshots` tables from the rolled-back state. The in-DB migration journal would otherwise disagree with the now-absent migration file and the next `db:migrate` would fail.
4. Run `npm install` to reconcile `node_modules/` with the reverted `package.json` — this is a no-op for this step (no packages were added) but is cheap and defensive.
5. Run `npm run typecheck` and `npm test` to confirm the working tree is clean and the step 00-07 suites still pass.
6. Re-run `npx tsx scripts/run-plan.ts --only 08` once the underlying issue is fixed to redo the step from a clean base.

After rollback the repository is byte-identical to the step 07 tip. Step 08 is a pure scaffolding step with no downstream dependencies inside this same wave (steps 09-12 consume the drizzle singleton but not the domain tables), so rolling back step 08 does not force rolling back any completed later step — but any step in the 18-32 range that has already landed and writes to `configs` / `runs` / `tick_metrics` / `snapshots` will be broken by the rollback and must also be reverted. Rolling back step 08 when step 26 or step 30 has already landed is not supported by this plan file — in that case, prefer a forward-fix commit.
