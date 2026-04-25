@AGENTS.md

# msksim — Project Charter and Conventions

Living context for every agent. `docs/plan/NN-*.md` files reference sections here by name.

## Purpose and audience

Research instrument for Meissa and Mike: agent-based Naming Game simulation studying color term communication success under linguistic pressure modulated by geography. Spec: `docs/spec.md`. Source materials in `docs/`. Deliverable is a browser-hosted research tool, not a production app.

## Stack and versions

- **Runtime**: Node.js ≥ 20.9
- **Framework**: Next.js 16.2.2 (App Router, Turbopack, Server Actions)
- **UI**: React 19.2.4, Tailwind CSS 4
- **Language**: TypeScript 5 (strict)
- **Persistence**: Drizzle ORM + `better-sqlite3` (server-side SQLite; overrides spec's IndexedDB)
- **Auth**: `@node-rs/argon2`, server-side table-backed sessions, HttpOnly cookies. All routes gated.
- **Schemas**: Zod (shared: UI forms, Server Actions, workers, DB)
- **Charts**: Recharts. **Graph**: sigma.js + graphology + louvain.
- **Workers**: `new Worker(new URL(...))` + Comlink. No webpack worker-loader.
- **Testing**: Vitest (`node` default; `happy-dom` for components)
- **CLI**: `tsx` via `npx tsx scripts/<name>.ts`

## Next.js 16 deltas

**Consult `node_modules/next/dist/docs/` before writing Next-specific code** (required by AGENTS.md).

- `middleware.ts` → `proxy.ts`. Exported function is `proxy`. Node runtime only.
- Auth lives in DAL (`lib/auth/dal.ts`), not proxy. Every Server Component/Action calls `verifySession()`.
- Turbopack is default. Custom `webpack` config fails build. Worker: `new Worker(new URL('./foo.worker.ts', import.meta.url), { type: 'module' })`.
- `cookies()`, `headers()`, `params`, `searchParams` are async — always `await`.
- `next lint` removed — use ESLint CLI. `serverRuntimeConfig`/`publicRuntimeConfig` removed — use env vars.
- `next typegen` generates route segment types. Run after adding dynamic segments.

## Directory layout

- `app/(auth)/` — authenticated pages | `app/(public)/` — future public | `app/login/` — login page
- `app/api/` — HTTP API routes | `lib/db/` — drizzle client, helpers | `lib/auth/` — password, sessions, DAL
- `lib/sim/` — simulation core (RNG, types, topologies, engine, metrics) | `lib/schema/` — Zod schemas
- `workers/` — Web Worker entrypoints | `db/schema/` — table defs | `db/migrations/` — SQL (committed)
- `scripts/` — CLI (`run-plan.ts`, `users.ts`, `migrate.ts`) | `tests/` — integration tests
- `docs/spec.md` — feature spec | `docs/plan/` — build plan files | `docs/screenshots/` — MCP screenshots
- `vitest.config.ts` | `tests/smoke.test.ts` — alias canary (must not delete)

## Commit-message convention

Plan-step commits: `step NN: <title>` (exactly one commit per step). Non-plan: conventional (`feat:`, `fix:`, `chore:`). `run-plan.ts` squashes intermediate commits.

- **Pre-commit formatting**: Always run `npm run format` before the final commit. `run-plan.ts` enforces this as a safety net.

## Database access patterns

- Every `lib/db/` file and `lib/env.ts` starts with `import 'server-only'` (non-negotiable).
- DB client and `env` are **lazy-init Proxies** — side-effect-free import, init on first access. Load-bearing for `next build`. Guarded by `tests/build-safety.test.ts`. **Do not convert to eager init.**
- `db/schema/` files must NOT have `import 'server-only'` — drizzle-kit reads them in CJS context.
- Migrations: `npm run db:generate` → `npm run db:migrate`. Explicit only, never at startup.
- Scripts: `@next/env`'s `loadEnvConfig()` + async wrapper + dynamic `import()` for DB. `tsx --conditions=react-server` for server-only imports.
- Vitest: `resolve.alias: { 'server-only': '.../server-only/empty.js' }` (configured).
- Client components **never** import from `lib/db/`.
- Tables: `configs` (ExperimentConfig + SHA-256), `runs`, `tick_metrics` (long-format), `snapshots`. Cascade on delete; `created_by` uses SET NULL.
- `content_json`/`summary_json` are plain `text()` — NOT `{ mode: 'json' }` (preserves key order for hash).
- `better-sqlite3` transactions require synchronous callbacks.
- `lib/db/configs.ts` has `updateConfig({ id, name, config })` (step 25).

## Authentication patterns

- Argon2id defaults. Hash is self-describing (no separate salt column). Slow by design — only at login/user creation.
- Sessions: table-backed, 32-byte random token (hex), cookie `msksim_session`, 7-day TTL. PK = cookie value.
- `proxy.ts` (repo root): cookie-presence redirects only. Imports only `SESSION_COOKIE_NAME`. Must NOT import DB/argon2/sessions.
- DAL: `lib/auth/dal.ts` → `verifySession = cache(async ())`, `getCurrentUser`. Import `cache` from `'react'` (not `'react/cache'`).
- Every Server Component in `(auth)` and every Server Action calls `verifySession()` directly.
- Login page is outside `(auth)`, no `verifySession()`. Login/logout are Server Actions. Generic error message for all failures.
- `sanitizeNext()` validates redirect param (only `/^\/[^/]/`).

## Testing conventions

- Vitest, `node` default, `happy-dom` via `*.dom.test.ts`. Colocate as `*.test.ts`; cross-cutting in `tests/`.
- `tests/smoke.test.ts` is the canary — fix harness before features.
- Simulation determinism: pin seed, assert bit-identical. `Math.random()` banned in `lib/sim/` — use `RNG` interface only (`nextInt`, `nextFloat`, `pick`, `pickWeighted`, `shuffle`).
- Partner-selection is pure `(speaker, candidates, rng, config, tick)` with lexicographic tiebreakers.
- Smoke: `npm run sim:smoke` (CLI, 200 ticks) and `lib/sim/sim-smoke.test.ts` (Vitest, 50 ticks).

## UI verification harness

- `run-plan.ts`: `next build && next start` on random port → seed user → `claude -p` → kill.
- MCP scripts: read `MSKSIM_BASE_URL`, use `new_page` for fresh context, login with seed creds, verify, screenshot.
- Screenshot `docs/screenshots/step-NN-home.png` mandatory. Console: ignore React 19 warnings, fail on errors/4xx/5xx.
- Proxy redirect is 307; Server Action redirect is 303. Both expected.
- `'use server'` makes ALL exports Server Actions — sync helpers in separate file. No `export type` re-exports.
- Recharts: every importing file must have `'use client'`. Verify charts: query `svg path`, assert non-empty `d`.

## Worker lifecycle

- Pattern: `new Worker(new URL('./name.worker.ts', import.meta.url), { type: 'module' })` (Turbopack-native). `import type` only for API on main thread.
- Comlink: `wrap<Api>` main, `expose(impl)` worker. `onProgress` needs `Comlink.proxy()`. `releaseProxy()` before `terminate()`.
- Cleanup: `let cancelled = false` in effect + `return () => { cancelled = true; worker.terminate(); }`.
- Worker at `workers/simulation.worker.ts`: `init`, `step`, `run`, `getMetrics`, `getSnapshot`, `reset`, `updateConfig`, `getInteractionGraph`.
- Seeded RNG lives in worker, never crosses wire. Visualization uses separate RNG (seed + 1).
- Payloads are plain objects (structured-clone safe). No Map/class/functions.
- `next/dynamic` with `ssr: false` invalid in Server Components — import client components directly.
- **Multi-worker batches (step 27)**: `app/(auth)/experiments/batch/worker-pool.ts` calls `createSimulationWorker()` N times (N = concurrency, capped at 8). Slots reuse workers via `dispatchNext(slotIndex)`. Cancellation calls `terminate()` + `Promise.race` with a cancellation token. Pool persists every terminal replicate via step 26's `persistCompletedRun` or `persistFailedReplicate`.
- **Worker pool testing**: the pool's `createWorker` option is injectable — unit tests pass mock factories returning `{ api, terminate }` stubs without constructing real Workers.
- **Parameter sweeps (step 28)**: `app/(auth)/experiments/sweep/sweep-runner.ts` composes the step-27 pool — `createWorkerPool` is called once per sweep and `pool.startBatch(cellSpec)` is invoked sequentially per cell, awaiting each batch's drain via an `onUpdate`-based promise. Cancellation calls `pool.cancelBatch()` on the in-flight cell and marks remaining cells `cancelled` without running them. Per-cell aggregates are computed in memory after each cell drains via `loadRunSummary(runId)` calls into step 26's runs DAL.

## Visualization extensions

- `getInteractionGraph()` returns graphology `SerializedGraph` + Louvain communities + modularity. Import `SerializedGraph` from `graphology-types`.
- sigma v3 + ForceAtlas2: `useRef` for instance, `kill()` in cleanup. Positions cached for warm-start.
- Debug globals: `window.__msksim_debug_graph`, `window.__msksim_debug_sigma` always exposed.

## Export conventions

- API routes (not Server Actions) for `Content-Disposition`. CSV: long format. JSON: full inventories + config + seed.
- Filenames: `msksim-<hash8>-seed-<seed>-<kind>.<ext>`.

## Known gotchas

- `await` all v16 async APIs (`cookies`, `headers`, `params`, `searchParams`) — silent Promise objects otherwise.
- `import 'server-only'` at top of every `lib/db/` and `lib/auth/` file — omission causes opaque Turbopack failure.
- `better-sqlite3`: `npm rebuild` if binaries missing. Opens with `foreign_keys = OFF` — must set ON explicitly.
- `@node-rs/argon2`: `npm rebuild` if loading fails. Ships prebuilt NAPI binaries for all platforms.
- React 19 strict mode double-invokes effects — worker creation must be idempotent or clean up.
- `drizzle-kit generate` after every `db/schema/*.ts` change. Migrations are committed.
- Schema types (`Language`, `Referent`, `TokenLexeme`) are opaque branded strings, not enums — don't narrow.
- Zod 4: `.default({})` returns `{}` as-is. Supply pre-computed full defaults for complex schemas.
- Lattice topologies default to open (non-toroidal) boundaries. Corner cells have fewer neighbors.
- Topology-agnostic invariant: only `topology/factory.ts` may branch on `topology.kind`.
- All Zod schemas must be JSON-serializable (no functions/Map/Set) — cross `postMessage` and persist to SQLite. Policies referenced by string id.
- Engine retry resets per speaker activation. `retries <= retryLimit`. `selectPartner` returns `null` for empty cells.
- Louvain crashes on <2 nodes or 0 edges — guard with `order < 2 || size < 1`.
- Bare relative imports (no `.js`) in `lib/schema/` files. `@/lib/schema/...` always works.
- `crypto.subtle.digest` needs secure context (HTTPS or localhost).
- Debounce worker effects with `useState + useEffect + setTimeout`, not `useDeferredValue`.
- RHF: `watch()` for conditional fields, not `getValues()`. Use `handleSubmit` wrapper with `useActionState`, not `<form action>` directly.
- `navigator.hardwareConcurrency` is **undefined during SSR**. Read it inside `useState` function-initializer or `useEffect`, not at module scope. Degrade: `typeof navigator === 'undefined' ? 1 : Math.max(1, (navigator.hardwareConcurrency ?? 2) - 1)`.
- Server Action body limit is 1MB by default. Batch runs with large `metricsTimeSeries` exceed this. Set `experimental.serverActions.bodySizeLimit` in `next.config.ts`.
- `useSyncExternalStore` compares snapshots via `Object.is`. If `getSnapshot` returns a new object every call (e.g., `structuredClone`), React re-renders infinitely. Cache the snapshot and return the same reference between emits.
- Sweep aggregates (step 28) live **only in the sweep form's React state** and are lost on page reload or navigation away from `/experiments/sweep/new`. The underlying replicates persist as ordinary `runs` rows. Persistence to a `sweeps` table is a v2 concern.
- The step-28 sweepable-parameter catalog (`lib/sim/sweep/parameters.ts`) is hand-maintained, not auto-generated. A module-load-time assertion walks `ExperimentConfig.parse({})` for every catalog dot-path; schema drift surfaces as a loud throw at import time.
- `successPolicy: 'gaussian'` (step 33) adds **exactly one `rng.nextFloat()` draw per interaction** in the success-determination sub-step; the default `'deterministic'` mode adds zero new draws and is bit-identical to all pre-step-33 runs and config-hashes. Future success-policy kinds must follow the same discipline: per-mode RNG accounting in the engine's RNG draw-order docstring + a "deterministic mode unchanged" backwards-compat test.

## Living-document rules

- Plan §11 lists CLAUDE.md changes. Hard limit: ≤30 lines per section per commit, ≤100 lines total per step.
- Section line caps are hard. Overflow → promote to new section.
- Cite `node_modules/next/dist/docs/` over external posts.
