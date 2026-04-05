---
step: "02"
title: "drizzle sqlite scaffolding"
kind: foundation
ui: false
timeout_minutes: 20
prerequisites:
  - "step 00: project bootstrap"
  - "step 01: zod config schema"
---

## 1. Goal

Install and wire the server-side persistence substrate — Drizzle ORM layered on `better-sqlite3` — with **zero domain tables created in this step**. The deliverable is the plumbing that every later step will obey: a singleton client hidden behind `import 'server-only'`, a canonical schema-and-migrations directory layout under `db/`, a `drizzle.config.ts` that `drizzle-kit generate` can consume, an explicit `scripts/migrate.ts` runner that applies migrations via `drizzle-orm/better-sqlite3/migrator`, a minimal Zod-validated `lib/env.ts`, and a reproducible smoke assertion that the native `better-sqlite3` binding loaded for the current Node version. Tables (`users`, `sessions`, `configs`, `runs`, `tick_metrics`, `snapshots`) land in steps 03, 04, and 08 using the scaffolding created here.

## 2. Prerequisites

- **Step 00 (project bootstrap)** has run, so Vitest is installed, the `@/` alias is configured, Node ≥ 20.9 is asserted, the empty `lib/db/` and `db/schema/` directories exist, `data/` is gitignored, and the pre-flight `better-sqlite3` native build in step 00 has already succeeded once. This step re-verifies the binding because reinstalling adds new entries to `node_modules`.
- **Step 01 (zod config schema)** has installed `zod` at the top level. `lib/env.ts` in this step depends on that installation. Installing `zod` is explicitly **not** this step's job — if step 01 has not landed, the implementing claude must stop and report rather than adding `zod` here.
- Node ≥ 20.9 (already enforced in step 00). Native modules will rebuild against the running Node ABI.
- Package manager is `npm` (existing lockfile). Do **not** switch to pnpm/yarn/bun.

## 3. Spec references

- `docs/spec.md` **§8 — Architecture Sketch**, specifically the "Persistence (IndexedDB)" box and the "Key architectural commitments" list. This step deliberately **diverges** from §8's IndexedDB suggestion.
- `CLAUDE.md` → **"Stack and versions"** section records the override: *"Persistence: Drizzle ORM + `better-sqlite3` (server-side SQLite). Overrides the spec's IndexedDB suggestion in §8/F15/F16; the data model (configs, runs, tick metrics, snapshots) is preserved, but storage moves server-side."* The decision is intentional: the deliverable is a researcher tool with two operators, not a public app, and server-side SQLite trades offline-first for drastically simpler determinism, migration tooling, Server-Action writes, and the ability to run reproducible runs from the CLI without spinning up a browser. The schema entities in §7 and §F15/F16 of the spec remain authoritative — only the substrate changes.
- `docs/spec.md` **§9 — Capability Requirements** lists Dexie/IndexedDB as the "leading candidate" for local persistence. That entry is superseded for this project by the CLAUDE.md override; drizzle + better-sqlite3 covers the same capability (thousands of runs per researcher) with a server-side footprint.

## 4. Research notes

Minimum requirements met: **3 local Next doc citations, 2 WebFetched external URLs, 1 path-not-taken, total ≥ 5 links.**

### Local Next.js 16 documentation

1. **`node_modules/next/dist/docs/01-app/02-guides/data-security.md`**, heading *"Preventing client-side execution of server-only code"*. The canonical guidance: `import 'server-only'` at the top of any module that must never leak into a client bundle. The doc explicitly notes that this "ensures that proprietary code or internal business logic stays on the server by causing a build error if the module is imported in the client environment." This is the primary defense against the Turbopack native-binding failure cited in CLAUDE.md's "Known gotchas" entry for `better-sqlite3`.
2. **`node_modules/next/dist/docs/01-app/02-guides/data-security.md`**, heading *"Data Access Layer"*. Same doc; separate section. Recommends that "only the Data Access Layer should access `process.env`. This keeps secrets from being exposed to other parts of the application." `lib/env.ts` and `lib/db/client.ts` are the seed of the DAL pattern; the `verifySession`-style DAL that consumes them lands in step 06.
3. **`node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md`**, heading *"Resolve alias fallback"* and the adjacent *"Turbopack by default"* section. Key sentence: *"In some projects, client-side code may import files containing Node.js native modules. This will cause `Module not found: Can't resolve 'fs'` type of errors."* Under v16 Turbopack this error is opaque and points at `better-sqlite3`'s `node:fs` / native `.node` binding resolution. The escape hatch is `turbopack.resolveAlias`, but the v16 docs explicitly say *"It is preferable to refactor your modules so that client code doesn't ever import from modules using Node.js native modules."* — which is exactly what `import 'server-only'` guarantees at compile time.
4. **`node_modules/next/dist/docs/01-app/02-guides/authentication.md`**, heading *"Creating a Data Access Layer (DAL)"* and the surrounding *"Session Management"* block. Establishes the pattern of wrapping DB queries behind `import 'server-only'` + `cache()` from React. This step does not create the DAL itself (step 06) but its `lib/db/client.ts` singleton is the module the DAL will import, and the `import 'server-only'` marker is required for the pattern to be safe.
5. **`node_modules/next/dist/docs/01-app/02-guides/environment-variables.md`**, headings *"Loading Environment Variables"* and *"Loading Environment Variables with `@next/env`"*. Next.js loads `.env*` files automatically in the dev/build/start runtimes, but `scripts/migrate.ts` runs under raw `tsx` with no Next context, so it must load env explicitly. The doc recommends `@next/env`'s `loadEnvConfig(projectDir)` for exactly this "root config file for an ORM or test runner" case. `scripts/migrate.ts` uses that pattern so `MSKSIM_DB_PATH` stays in the single `.env` source of truth.

### External WebFetched references

6. **Drizzle ORM — SQLite getting started guide**, `https://orm.drizzle.team/docs/get-started-sqlite` (WebFetched). Confirms the exact package set (`drizzle-orm`, `better-sqlite3`, `-D drizzle-kit`, `-D @types/better-sqlite3`), the constructor pattern `drizzle({ client: new Database(path) })`, the `drizzle.config.ts` shape with `dialect: "sqlite"`, `schema`, and `out`, the `npx drizzle-kit generate` command, and the programmatic migrator entry point `import { migrate } from "drizzle-orm/better-sqlite3/migrator"` → `migrate(db, { migrationsFolder })`. `scripts/migrate.ts` uses that migrator verbatim.
7. **better-sqlite3 README**, `https://github.com/WiseLibs/better-sqlite3` (WebFetched). Establishes: synchronous API (the primary reason to prefer it over `libsql` and `node:sqlite` for deterministic tests), `:memory:` as the in-memory filename, the `db.pragma('journal_mode = WAL')` performance recommendation, and the `npm rebuild better-sqlite3` recovery path when prebuilt binaries are missing for the current Node ABI. The smoke check in this step's implementation approach opens `new Database(':memory:')`, runs a trivial statement, and closes it — that path is the canonical fast verification of a working native build.

### Path not taken

8. **`libsql` / `@libsql/client` was considered and rejected.** libsql is a fork of SQLite with built-in replication and an async-only API (via HTTP or an async native binding). Drizzle ships a first-class `drizzle-orm/libsql` driver and it is the Turso house recommendation. We reject it for three reasons: (a) msksim has no replication requirement — it is a single-researcher tool; (b) the async-only API makes deterministic single-threaded simulation tests slightly harder to reason about when DB reads interleave with RNG draws; (c) `better-sqlite3` is older, more battle-tested, has wider documentation coverage, and avoids the "which libsql build variant did you get?" confusion. **`node:sqlite` (the Node 22+ built-in) was also considered and rejected**: as of April 2026 it is still marked experimental, its API surface is smaller than `better-sqlite3`, and drizzle's driver story for it is immature.

## 5. Files to create

All paths are relative to the repo root.

- **`lib/db/client.ts`** — the singleton drizzle client. First line is `import 'server-only';`. Opens `better-sqlite3` against the validated `MSKSIM_DB_PATH`, ensures the parent directory (`data/` by default) exists, enables `PRAGMA journal_mode = WAL`, and exports `db` (the drizzle instance) plus a typed `Database` reference for migration tooling that needs the raw handle. Module-level singleton — no factory function exported from this file for general use. Import shape: `import { db } from '@/lib/db/client'`.
- **`lib/db/schema.ts`** — a one-line re-export: `export * from '@/db/schema';`. This exists so that call sites can `import { ... } from '@/lib/db/schema'` without reaching into `db/schema/` directly. Starts with `import 'server-only';` since drizzle column builders transitively load the native binding in some codepaths. Later steps (03, 04, 08) add concrete table exports via `db/schema/*.ts`.
- **`db/schema/index.ts`** — the single entry point that `drizzle.config.ts` points at. Initially contains only a header comment explaining that entity files (`users.ts`, `sessions.ts`, `configs.ts`, `runs.ts`, …) will be added in later steps and then re-exported from here. **Do not** create any stub tables — step 03 is responsible for the first table and its migration. The file exports nothing concrete yet; it exists so `drizzle-kit generate` has a valid schema target and so that `db/migrations/.gitkeep` is not the only file under `db/`.
- **`drizzle.config.ts`** — uses `defineConfig` from `drizzle-kit`. Fields: `dialect: "sqlite"`, `schema: "./db/schema/index.ts"`, `out: "./db/migrations"`, `dbCredentials: { url: <resolved MSKSIM_DB_PATH> }`. Loads env via `@next/env`'s `loadEnvConfig(process.cwd())` before reading `process.env.MSKSIM_DB_PATH`, so `drizzle-kit` CLI invocations pick up `.env` the same way Next would. Kept at repo root — `drizzle-kit` searches for `drizzle.config.ts` relative to CWD.
- **`scripts/migrate.ts`** — a `tsx`-runnable script. Loads env via `@next/env`, imports the client from `@/lib/db/client` (yes, it may import the server-only module — scripts run in Node, not a bundler, so the `import 'server-only'` guard is a no-op at runtime), and calls `migrate(db, { migrationsFolder: './db/migrations' })` from `drizzle-orm/better-sqlite3/migrator`. Exits 0 on success, non-zero with a clear message on failure. Logs the resolved DB path and the count of applied migrations. Creates the parent `data/` directory on demand. **Must never** be invoked from application code — the README/CLAUDE comment in this file warns "explicit migration: `npm run db:migrate`, never at app startup".
- **`lib/env.ts`** — a Zod-validated env loader. First line is `import 'server-only';`. Defines one schema: `MSKSIM_DB_PATH` (default `./data/msksim.db`) and `MSKSIM_SESSION_SECRET` (required, min length 32 — the session-cookie signing key used in step 04). Exports a frozen `env` object. Throws at module load time if required vars are missing, with a message that lists exactly which variable is missing. **Depends on `zod`**, which is installed in step 01. If step 01 has not run, this module fails to import — that is the intended failure mode.
- **`.env.example`** — committed template. Documents both variables with comments explaining purpose and how to generate a session secret (`openssl rand -base64 48`). Not symlinked to `.env`; the implementing claude copies it to `.env` once to unblock `scripts/migrate.ts`, and that `.env` is gitignored (already by step 00's `.gitignore`).
- **`db/migrations/.gitkeep`** — zero-byte placeholder so the empty directory survives the commit. Git does not track empty directories; step 03 will add the first actual `.sql` file and then `.gitkeep` can stay or be removed at the implementer's discretion (keep it for clarity).

## 6. Files to modify

- **`package.json`**:
  - Add runtime dependencies: `drizzle-orm`, `better-sqlite3`.
  - Add dev dependencies: `drizzle-kit`, `@types/better-sqlite3`, `@next/env` (only if not already present from step 00 — check before adding; Next pulls it transitively but an explicit dev-dep declaration is safer for `scripts/migrate.ts`).
  - Add scripts: `"db:generate": "drizzle-kit generate"` and `"db:migrate": "tsx scripts/migrate.ts"`. Keep the existing `"dev"`, `"build"`, `"start"`, `"lint"`, `"typecheck"`, and `"test"` scripts from step 00 untouched.
  - Do **not** add `"postinstall": "drizzle-kit generate"` or any auto-migration hook. Generation and migration are explicit, human-triggered, and commit-gated.
- **`.gitignore`** — verify that `/data` and `/data/**` are already ignored from step 00. If step 00 added `/data` only, that is sufficient. Do not add new rules unless the existing ones do not cover `data/msksim.db`. The step must not modify `.gitignore` if it is already correct — document the verification outcome in the commit diff only via the absence of a `.gitignore` change.

## 7. Implementation approach

Prose, not code. The implementing claude walks this sequence:

1. **Verify prerequisites.** Confirm `zod` is present in `package.json` (placed there by step 01). Confirm `lib/db/` and `db/schema/` exist as empty directories from step 00. Confirm Node version is ≥ 20.9. If any check fails, abort with a clear error — do not attempt to cover for an earlier missing step.
2. **Install dependencies.** Run `npm install better-sqlite3 drizzle-orm` then `npm install -D drizzle-kit @types/better-sqlite3`. Use pinned versions from §8 below. Do not run `npm audit fix` or touch unrelated packages.
3. **Native-build smoke check.** Immediately after install, run a one-liner (inline `node -e "require('better-sqlite3')(':memory:').close()"` via `tsx` or plain node — the binding loads the same way) to confirm the prebuilt binary matches the current Node ABI. If it throws `NODE_MODULE_VERSION` mismatch or `no such file` on the `.node` binary, run `npm rebuild better-sqlite3`. If the rebuild also fails, stop and surface the error — the pipeline cannot proceed without a working native build. This protects every subsequent step.
4. **Create `lib/env.ts`.** Define the Zod schema, parse `process.env` at module load, freeze and export. The file begins with `import 'server-only';`. Error messages include the variable name and a hint about how to set it.
5. **Create `db/schema/index.ts`.** Header comment only, no exports yet. State explicitly that entity files land in later steps.
6. **Create `lib/db/schema.ts`** as the server-only re-export facade for `db/schema/index.ts`.
7. **Create `lib/db/client.ts`.** Start with `import 'server-only';`. Import `better-sqlite3`'s `Database` default export, import `drizzle` from `drizzle-orm/better-sqlite3`, import `env` from `@/lib/env`. Ensure `dirname(env.MSKSIM_DB_PATH)` exists (use `node:fs` `mkdirSync` with `recursive: true`). Construct the sqlite connection, set `PRAGMA journal_mode = WAL` and `PRAGMA foreign_keys = ON`. Export a module-level `db = drizzle({ client: sqlite })` singleton and a `sqlite` reference for the migrator. No connection pool, no async init — synchronous at module load is exactly what the singleton wants.
8. **Create `drizzle.config.ts`.** Import `defineConfig` from `drizzle-kit`, load env via `@next/env`'s `loadEnvConfig(process.cwd())` at the top of the file, then read `MSKSIM_DB_PATH` (with the same default). Export `defineConfig({ dialect: "sqlite", schema: "./db/schema/index.ts", out: "./db/migrations", dbCredentials: { url: resolvedDbPath } })`. The `dbCredentials` field is used by `drizzle-kit push` (not used in this project) but harmless for `generate`.
9. **Create `scripts/migrate.ts`.** Load env via `@next/env` as the very first import. Then import `{ sqlite, db }` from `@/lib/db/client` and `{ migrate }` from `drizzle-orm/better-sqlite3/migrator`. Call `migrate(db, { migrationsFolder: './db/migrations' })`. Log `applied migrations: <n>` and the resolved DB path. Wrap in try/catch; exit with code 1 and a helpful message on failure. Add a top-of-file comment: *"DO NOT call this from app code. Run via `npm run db:migrate`."*
10. **Create `.env.example`** with comments for each variable and the `openssl rand -base64 48` hint for `MSKSIM_SESSION_SECRET`. Copy it to `.env` so the migrator smoke run in step 13 of this sequence works. (The `.env` copy is gitignored, so that copy does not land in the commit.)
11. **Create `db/migrations/.gitkeep`.**
12. **Add the npm scripts** to `package.json` as described in §6.
13. **Smoke test `npm run db:generate`.** With no schema entities yet, drizzle-kit generate exits 0 and produces **no SQL files** (or a single empty/comment-only file — both are acceptable; document whichever occurs). This is expected and must be noted in the step's commit message and in the acceptance criteria. If drizzle-kit errors because the schema file has zero exports, the fix is to add a harmless named export to `db/schema/index.ts` (e.g., `export const __schemaMarker = true;`) — prefer that over fabricating a table.
14. **Smoke test `npm run db:migrate`.** With zero migrations in `db/migrations/`, the drizzle migrator opens the DB, creates its internal `__drizzle_migrations` tracking table, finds nothing to apply, and exits 0. The `data/msksim.db` file is created on disk as a side effect.
15. **Write and run the two unit tests** in §9. `vitest run lib/db lib/env` must be green.
16. **Run `npm run typecheck`.** All new files must typecheck cleanly under the strict tsconfig from step 00. The `@/` alias must resolve `@/lib/db/client` and `@/lib/env`.
17. **Reinforce the server-only rule.** Add a single-line JSDoc comment at the top of `lib/db/client.ts` above the `import 'server-only'` line: *"Server-only. Do not import from a client component. Transitive imports count — the DAL file must also be server-only."* This comment is a documentation hook for future agents grepping the file.

The singleton-at-module-load pattern is a deliberate choice. An alternative — lazy init behind a `getDb()` function — adds surface area and creates race windows during tests. With better-sqlite3's synchronous API, module-load initialization is both correct and simple.

## 8. Library choices

Versions pinned to the current stable releases as of **April 2026**. The implementing claude verifies each with `npm view <pkg> version` before installing; if a newer patch release exists within the same minor, use it and note the upgrade in the commit body.

| Package | Kind | Target version | Rationale |
|---|---|---|---|
| `better-sqlite3` | runtime | `^12.8.0` | Latest stable as of March 2026 per its GitHub releases page (visible in the README WebFetch above). Synchronous API, native bindings for Node ≥ 20, prebuilt binaries for common ABIs. |
| `drizzle-orm` | runtime | `^0.44.0` or latest stable `0.x` — verify on npm at install time | Drizzle is still pre-1.0 as of early 2026 (v1.0 RC is in progress per the kit-docs fetch above). Use the latest `0.x` stable. Prefer a caret range so patch updates flow. |
| `drizzle-kit` | dev | match `drizzle-orm` minor family (e.g. `^0.31.0` or latest) — verify on npm | drizzle-kit versions do not always match drizzle-orm exactly but must be in the same compatibility window. Install the version the drizzle docs pair with the chosen drizzle-orm. |
| `@types/better-sqlite3` | dev | `^7.6.0` or latest | Community types for better-sqlite3. Keep in sync with the runtime major. |
| `@next/env` | dev (if not already present) | whatever Next 16 ships | Needed by `scripts/migrate.ts` and `drizzle.config.ts` to load `.env` outside Next's own runtime. Likely already a transitive dependency of `next`; prefer to reuse the existing version rather than add a separate entry if it is already resolvable. |

Do **not** install: `libsql`, `@libsql/client`, `drizzle-orm/libsql`, `sqlite3`, `node:sqlite` shims, or any drizzle driver other than `drizzle-orm/better-sqlite3`. Do not install `dotenv` — `@next/env` is the v16 way.

## 9. Unit tests

Kept intentionally minimal. Both tests run under Vitest's default `node` environment (no DOM).

1. **`lib/db/client.test.ts`** — header comment `// @vitest-environment node`. The test sets `process.env.MSKSIM_DB_PATH = ':memory:'` and `process.env.MSKSIM_SESSION_SECRET = 'a'.repeat(48)` **before** importing the module (use Vitest's `vi.stubEnv` or a top-of-file assignment; module-load ordering is important here because `lib/env.ts` reads the env eagerly). Then imports `db` and `sqlite` from `@/lib/db/client`, runs `sqlite.prepare('SELECT 1 AS one').get()`, asserts the result is `{ one: 1 }`, and closes the connection in an `afterAll`. This proves: (a) the native binding loaded; (b) `import 'server-only'` did not block the test (vitest node env treats it as a no-op); (c) the singleton opened successfully; (d) the env loader accepted the stubbed values.
2. **`lib/env.test.ts`** — two cases. Case A: with `MSKSIM_SESSION_SECRET` set to a 48-char string, dynamic-importing `lib/env` returns a parsed object whose `MSKSIM_SESSION_SECRET` matches. Case B: with `MSKSIM_SESSION_SECRET` deleted from `process.env`, dynamic-importing `lib/env` throws a `ZodError` whose message mentions `MSKSIM_SESSION_SECRET`. Use `vi.resetModules()` between cases to force re-evaluation of the module-level parse. Case C (optional but cheap): `MSKSIM_DB_PATH` defaults to `./data/msksim.db` when unset.

No migration test yet — there are no migrations to run. Step 03 adds the first migration test as part of the users table landing.

## 10. Acceptance criteria

The step is complete when all of the following are observably true on a clean clone after running the new step:

- `npm install` completes with no errors; `node -e "require('better-sqlite3')(':memory:').close()"` exits 0.
- `npm run db:generate` exits 0. Output clearly states "no schema entities found" or produces an empty/comment-only migration. Document in the commit body which of those two drizzle-kit actually does for the installed version — both are acceptable.
- `npm run db:migrate` exits 0 against a fresh (nonexistent) `./data/msksim.db`. The file is created on disk. The internal `__drizzle_migrations` table exists (verify with `sqlite3 data/msksim.db ".tables"` or an equivalent one-shot drizzle read). Re-running `npm run db:migrate` is idempotent and still exits 0 with `applied migrations: 0`.
- `ls -la data/` shows `msksim.db` present with size > 0. (`data/` is gitignored, so nothing here lands in the commit.)
- `npm test -- lib/db lib/env` passes both test files described in §9.
- `npm run typecheck` passes with zero errors.
- `rg "import 'server-only'" lib/db/ lib/env.ts` returns hits on every file in `lib/db/` and on `lib/env.ts`.
- The commit contains exactly the files listed in §5 plus the `package.json` edit from §6 and nothing else (no stray `.next/`, no accidental `.env`, no `data/msksim.db`).

## 11. CLAUDE.md updates

Append to the **"Database access patterns"** section (hard cap 50 lines, currently ~10 lines of established content from step 02 per the schema). Append ≤ 20 new lines formalizing the rules created by this step. The appended bullets — in prose form here, rewritten as CLAUDE.md bullets by the implementing claude — are:

- Every file under `lib/db/` starts with `import 'server-only';` as its first import. This is **non-negotiable** — omitting it creates the Turbopack opaque native-binding failure documented in "Known gotchas".
- The drizzle client is a module-load singleton exported from `lib/db/client.ts`. Never call `drizzle(...)` or `new Database(...)` from any other file. Tests use `:memory:` by overriding `MSKSIM_DB_PATH` **before** importing the module.
- Schema entity files live at `db/schema/<entity>.ts` and are re-exported from `db/schema/index.ts`. `drizzle.config.ts` points at `db/schema/index.ts`.
- Migrations are checked in under `db/migrations/`. `npm run db:generate` creates them from the current schema; `npm run db:migrate` applies them. Migration application is **explicit** and happens via `scripts/migrate.ts` — **never** at app startup, never in a `postinstall` hook, never inside a Server Action.
- The DB path and session secret flow through `lib/env.ts` (Zod-validated). Scripts and config files that run outside Next (`drizzle.config.ts`, `scripts/migrate.ts`) use `@next/env`'s `loadEnvConfig` to pick up `.env` without a Next runtime.
- Writes live in Server Actions; reads live in Server Components (via the DAL from step 06) or in Server Actions. Client components **never** import from `lib/db/`.

No other CLAUDE.md sections are touched in this step.

## 12. Commit message

Exact subject line:

```
step 02: drizzle sqlite scaffolding
```

The commit body lists: packages installed with resolved versions, files created, the `package.json` scripts added, the native-build smoke result, and the `db:generate` / `db:migrate` smoke outcomes. It must **not** use a conventional-commit prefix — the `step 02:` marker is load-bearing for `scripts/run-plan.ts`.

## 13. Rollback notes

If this step's commit lands in a bad state, back it out as follows (destructive — requires user confirmation per CLAUDE.md commit-safety rules):

1. `git reset --hard <prior-commit-sha>` where the prior sha is the step 01 commit identified via `git log --grep='^step 01:'`.
2. `rm -rf data/` to drop the local SQLite file created by the smoke migration.
3. `rm -rf db/migrations/*` (but leave `db/migrations/` itself if step 01 created it; it is recreated below).
4. `npm uninstall better-sqlite3 drizzle-orm drizzle-kit @types/better-sqlite3` — removes the four packages this step added. Do not uninstall `@next/env` (it is a Next transitive dependency).
5. Remove `drizzle.config.ts`, `scripts/migrate.ts`, `lib/env.ts`, `lib/db/client.ts`, `lib/db/schema.ts`, `db/schema/index.ts`, and `.env.example`. The empty `db/migrations/` directory can remain.
6. Delete the local `.env` file created during the smoke run (it is gitignored but physically present on disk).
7. Run `npm install` to reconcile `node_modules` with the reverted `package.json`, then `npm run typecheck` to confirm the working tree is clean.

After rollback, step 02 can be re-run from a clean slate. Step 03 is blocked until step 02 lands successfully — rolling back step 02 forces rolling back any later steps that depend on it.
