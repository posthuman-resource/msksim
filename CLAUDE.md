@AGENTS.md

# msksim — Project Charter and Conventions

This document is the **living context** for every agent (human or AI) working in this repository. Common conventions live here so `docs/plan/NN-*.md` step files can reference them by section name instead of duplicating. Treat the sections below as authoritative.

## Purpose and audience

`msksim` is a research instrument for Meissa and Mike: an **agent-based simulation of a Naming Game** that studies how the communication success of color terms emerges under linguistic pressure modulated by geographical location. Full specification: `docs/spec.md`. Source materials: `docs/How color terms communication success is emerged through language modulated by geographical.pdf`, `docs/pdftext.md`, `docs/interpretation.md`.

The deliverable is a **browser-hosted research tool** — not a production consumer app. The users are two researchers iterating on hypotheses and generating publication-grade figures. Scope is governed entirely by `docs/spec.md` plus the user overrides listed under "Stack and versions" below.

## Stack and versions

- **Runtime**: Node.js ≥ 20.9 (required by Next 16; native modules will fail on older versions).
- **Framework**: Next.js 16.2.2 (App Router, Turbopack, Server Actions).
- **UI**: React 19.2.4, Tailwind CSS 4.
- **Language**: TypeScript 5 (strict mode).
- **Persistence**: Drizzle ORM + `better-sqlite3` (server-side SQLite). **Overrides** the spec's IndexedDB suggestion in §8/F15/F16; the data model (configs, runs, tick metrics, snapshots) is preserved, but storage moves server-side.
- **Authentication**: `@node-rs/argon2` for password hashing, server-side table-backed sessions with HttpOnly cookies. **All routes are gated for v1.** The `app/(public)/` route group exists from day one for future public-report carveouts; it is currently empty.
- **Schemas**: Zod (shared between UI forms, Server Actions, workers, and database column derivations).
- **Charts**: Recharts.
- **Graph rendering**: sigma.js + graphology + `graphology-communities-louvain`.
- **Workers**: Native `new Worker(new URL(...))` + Comlink. **No webpack worker-loader** — that pattern is obsolete under Turbopack (see Next 16 deltas below).
- **Testing**: Vitest. `node` environment by default; `happy-dom` for component tests.
- **CLI entrypoint**: `tsx` (invoked via `npx tsx scripts/<name>.ts`).

## Next.js 16 deltas from training data

Next.js 16 has breaking changes from most Next 14/15 material in training data. **Every agent must consult `node_modules/next/dist/docs/` before writing Next-specific code** — this is also required by `AGENTS.md`. The load-bearing deltas:

- **`middleware.ts` → `proxy.ts`.** The exported function is `proxy`, not `middleware`. Proxy runs on Node runtime only; setting `runtime` in the file throws at build time. Codemod: `npx @next/codemod@canary middleware-to-proxy .`. Local docs: `01-app/03-api-reference/03-file-conventions/proxy.md`, `01-app/02-guides/upgrading/version-16.md`.
- **Auth policy lives in a Data Access Layer, not the proxy.** The v16 docs warn: *"Always verify authentication and authorization inside each Server Function rather than relying on Proxy alone."* Use `lib/auth/dal.ts` with `import 'server-only'` and React's `cache()` wrapping `verifySession()`. Every Server Component in `(auth)` and every Server Action calls it. Proxy does cheap cookie-presence redirects only. Local docs: `01-app/02-guides/authentication.md`, `01-app/02-guides/data-security.md`.
- **Turbopack is the default** for both `next dev` and `next build`. A custom `webpack` config **fails the build**. The canonical worker pattern is `new Worker(new URL('./foo.worker.ts', import.meta.url), { type: 'module' })`. Do **not** use webpack worker-loader patterns from Next 14/15 tutorials — including the Park.is blog post cited in `docs/spec.md` §8/§12.4, which is obsolete for v16. Local docs: `01-app/03-api-reference/08-turbopack.md`, `version-16.md`.
- **Async request APIs**: `cookies()`, `headers()`, `params`, `searchParams` are all async. Always `await` them. Forgetting the `await` produces a silently Promise-shaped object.
- **`next lint` removed.** Use ESLint CLI directly with flat config (`eslint.config.mjs`). The starter's `package.json` already has `"lint": "eslint"`. Codemod: `npx @next/codemod@canary next-lint-to-eslint-cli .`.
- **`serverRuntimeConfig` / `publicRuntimeConfig` removed.** Use environment variables directly.
- **`next typegen`** generates `PageProps<...>` types for dynamic route segments. Run after adding dynamic segments like `/runs/[id]`.
- **Node minimum is 20.9.** Older Node versions fail native-module compilation for `@node-rs/argon2` and `better-sqlite3`.

## Directory layout

Populated incrementally as steps land. Hard cap: 40 lines. Entries in depth-first order.

- `app/` — Next.js App Router
  - `app/(auth)/` — route group for authenticated pages (created in step 06)
  - `app/(public)/` — route group for future public pages (created in step 06, initially empty except for the step-19 worker smoke page which is removed in step 20)
  - `app/login/` — login page (step 07; outside `(auth)` and `(public)` groups)
  - `app/api/` — HTTP API routes (reserved for streaming exports in step 30)
- `lib/` — server-side utilities (all files begin with `import 'server-only'` unless explicitly marked client-safe)
  - `lib/db/` — drizzle client, query helpers (step 02)
  - `lib/auth/` — password hashing, session service, DAL (steps 03-06)
  - `lib/sim/` — pure simulation core: RNG, types, topologies, engine, metrics (steps 09-17)
  - `lib/schema/` — Zod config schemas (step 01)
- `workers/` — Web Worker entrypoints (steps 19-20)
- `db/` — drizzle schema and migrations
  - `db/schema/` — table definitions
  - `db/migrations/` — generated SQL migrations (committed)
- `scripts/` — CLI tools (`run-plan.ts` already present; `users.ts` added in step 05; `migrate.ts` added in step 02)
- `docs/`
  - `docs/spec.md` — source of truth for features
  - `docs/plan.md` — summary of the build plan
  - `docs/plan/NN-*.md` — step-by-step build plan files
  - `docs/plan/logs/` — run-plan.ts execution logs (gitignored)
  - `docs/screenshots/` — MCP verification screenshots (committed)
- `tests/` — cross-cutting integration tests; single-module tests colocate as `*.test.ts`
- `data/` — local SQLite file `msksim.db` (gitignored)
- `vitest.config.ts` — Vitest root config (established step 00)
- `scripts/check-node-version.ts` — Node ≥ 20.9 guard (established step 00)
- `tests/smoke.test.ts` — Vitest + `@/` alias canary (established step 00); must not be deleted

## Commit-message convention

**Plan-step commits** have subjects starting exactly `step NN: <short title>`, where `NN` is the two-digit step number. Example: `step 07: login and app shell`. `scripts/run-plan.ts` detects progress by grepping `git log` for this marker and normalizes close-but-off variants (`Step 7:`, `step 7 -`, `STEP 07:`) to the canonical form via a post-step `git commit --amend`.

Non-plan commits (human-authored between pipeline runs) use free-form conventional commits (`feat:`, `fix:`, `chore:`). Plan-step commits **must not** also carry a conventional-commit prefix; the `step NN:` marker is load-bearing for detection.

Each plan step must produce **exactly one commit**. If `claude -p` produces multiple intermediate commits during execution, `run-plan.ts` squashes them via `git reset --soft HEAD~N && git commit` before advancing.

## Database access patterns

Populated in steps 02, 08, 26. Hard cap: 50 lines.

Established in step 02:
- Every file under `lib/db/` and `lib/env.ts` starts with `import 'server-only'` as its first import. This is **non-negotiable** — omitting it creates the Turbopack opaque native-binding failure documented in "Known gotchas".
- The drizzle client is a module-load singleton exported from `lib/db/client.ts`. Do not instantiate `drizzle(...)` or `new Database(...)` elsewhere. Tests use `:memory:` by setting `MSKSIM_DB_PATH=':memory:'` **before** importing the module (use `vi.stubEnv`).
- Schema entity files live at `db/schema/<entity>.ts` and are re-exported from `db/schema/index.ts`. `drizzle.config.ts` points at `db/schema/index.ts`. `db/schema/index.ts` must always export at least one symbol so TypeScript treats it as a module (use `__schemaMarker` until the first entity lands).
- Migrations are checked in under `db/migrations/`. `npm run db:generate` creates them from the current schema; `npm run db:migrate` applies them. Migration is **explicit** — never at app startup, never in a `postinstall` hook, never inside a Server Action.
- The DB path and session secret flow through `lib/env.ts` (Zod-validated, reads `process.env` at module-load time). Scripts outside Next use `@next/env`'s `loadEnvConfig(process.cwd())` before importing any module that transitively imports `lib/env.ts`. Because esbuild/tsx hoists static `import` statements above executable code, use an **async wrapper + dynamic `import()`** for the DB client in scripts (see `scripts/migrate.ts`).
- `tsx` scripts that import server-only modules must use `tsx --conditions=react-server`. This activates the `react-server` conditional export in the `server-only` package, mapping it to its own `empty.js` stub instead of the throwing `index.js`.
- Vitest tests of server-only modules require `resolve.alias: { 'server-only': '.../server-only/empty.js' }` in `vitest.config.ts` (already configured in step 02).
- Writes happen in Server Actions; reads happen in Server Components (via the DAL, step 06) or in Server Actions. Client components **never** import from `lib/db/`.

## Authentication patterns

Populated in steps 03-07. Hard cap: 80 lines.

Established in steps 03-07:
- Passwords are hashed with `@node-rs/argon2` using its default parameters. The hash string is self-describing (contains salt + params); no separate columns needed.
- Sessions are **server-side, table-backed** in the `sessions` table with `expires_at`. The session cookie is `HttpOnly`, `SameSite=Lax`, `Secure` in production, opaque (random bytes, stored as the primary key of the session row). Revocation is a single `DELETE` on the row.
- `proxy.ts` does **only** cookie-presence redirects. Users without a session cookie, visiting a path that is not in the public allowlist, are 307'd to `/login`. No DB calls, no argon2 — the proxy is in the hot path on every request.
- **Authorization lives in `lib/auth/dal.ts`**, not the proxy. The DAL exports `verifySession = cache(async () => { ... })`. React's `cache()` dedupes calls within a single request. **Every** Server Component in `app/(auth)/` and every Server Action calls `verifySession()` directly. Do not rely on the proxy alone — refactoring a Server Action to a different route can silently strip proxy coverage, and POSTing directly to a Server Action URL bypasses the page-level check.
- Route groups: `app/(auth)/` for authenticated pages (the `(auth)/layout.tsx` invokes `verifySession()` once, children inherit); `app/(public)/` for future public-report routes (zero-refactor carveout).

Established in step 03:
- **Password policy**: Argon2id via `@node-rs/argon2` defaults (m=19456 KiB, t=2, p=1 — exactly the OWASP minimums). Do not pass a custom `options` argument to `hash()`; the defaults are correct and any hand-tuning is unsupported churn until profiling says otherwise.
- **Users table shape**: `id` (text PK, uuid v4 via `$defaultFn(() => crypto.randomUUID())`), `username` (text, unique, not null), `password_hash` (text, not null; self-describing hash string — no separate salt column), `created_at` / `updated_at` (integer timestamp, drizzle runtime `$defaultFn` / `$onUpdateFn` — SQLite has no native `ON UPDATE CURRENT_TIMESTAMP`).
- `lib/auth/password.ts` must begin with `import 'server-only'` on line 1. Without it, Turbopack bundles `@node-rs/argon2`'s native `.node` binding into a client chunk and fails opaquely (see Known gotchas).

## Testing conventions

Populated in steps 00, 18. Hard cap: 40 lines.

Established in step 00:
- Test runner: **Vitest**. Config in `vitest.config.ts`. Default environment: `node`. Component tests opt into `happy-dom` via file-name convention (`*.dom.test.ts`) or inline docblock (`// @vitest-environment happy-dom`).
- Tests colocate next to source as `*.test.ts` when testing a single module; cross-cutting integration tests live under `tests/`.
- Determinism is a hard requirement for simulation tests: every test that exercises the RNG pins a seed and asserts bit-identical output across repeated invocations.
- Commands: `npm test` → `vitest run`. `npm run test:watch` → `vitest`. Coverage: `vitest run --coverage`.
- `tests/smoke.test.ts` is the alias/config canary. If it fails, the test harness itself is broken — fix the harness before diagnosing the failing feature.
- `scripts/check-node-version.ts` runs via the `predev`/`prestart`/`pretest` hooks. Bypass only with `npm run <script> --ignore-scripts`, and document why in the commit message.
- The `test:coverage` script uses `@vitest/coverage-v8`. Keep `vitest` and `@vitest/coverage-v8` pinned to the same version; Vitest releases them in lockstep.

## UI verification harness

Populated in step 07. Hard cap: 60 lines. **Every later UI step's plan file references this section by name.**

Established in step 07:
- `scripts/run-plan.ts` owns the dev-server lifecycle for UI steps. Per step: `npx next build` → `npx next start -p $MSKSIM_PORT` on a random free port → wait for `GET /` → 200 (polled every 250ms, 60s timeout) → invoke `claude -p` → kill server on exit.
- **`next build && next start`, not `next dev`**. HMR reloads mid-verification cause transient console noise and mid-render DOM observations. The 15-20s build cost per UI step is deterministic and acceptable for an unattended pipeline.
- Each UI step's MCP script reads `process.env.MSKSIM_BASE_URL`, clears storage (`evaluate_script('localStorage.clear(); sessionStorage.clear()')` + cookie clear via DevTools protocol), then logs in with the seed credentials (`MSKSIM_SEED_USER` / `MSKSIM_SEED_PASS`). `run-plan.ts` seeds the user via a direct drizzle call before each UI step; no shelling out to `scripts/users.ts`.
- Every UI step saves a screenshot to `docs/screenshots/step-NN.png` and commits it as part of the step's diff so reviewers can eyeball the visual change.
- Console-log triage: React 19 dev-mode warnings (e.g., strict-mode double-invocation notices) are benign and ignored. Thrown errors, hydration mismatches, unhandled promise rejections, and 4xx/5xx network responses always fail the step.

## Worker lifecycle

Populated in steps 19, 20. Hard cap: 40 lines.

Established in steps 19-20:
- Workers are created with `new Worker(new URL('./name.worker.ts', import.meta.url), { type: 'module' })`. This is the Turbopack-native pattern documented in `node_modules/next/dist/docs/01-app/03-api-reference/08-turbopack.md`. Do **not** use webpack worker-loaders or patterns from Next 14/15 blog posts — they will fail under Turbopack.
- The worker module runs only in the browser. The wrapping client component either (a) constructs the worker inside `useEffect` to avoid SSR `window is undefined`, or (b) uses `next/dynamic` with `ssr: false`. Pick one and document it in the step's plan file.
- Typed RPC via Comlink: `Comlink.wrap<Api>(worker)` on the main thread; `Comlink.expose(impl)` inside the worker.
- **Simulation determinism**: the seeded RNG lives inside the worker and never crosses the wire. A call to `step()` or `run()` is fully self-contained; the main thread cannot influence RNG state by changing message ordering.
- React 19 strict-mode double-invokes effects in development. Worker construction in `useEffect` must be idempotent, or must clean up properly in the effect's return callback.

## Export conventions

Populated in step 30. Hard cap: 20 lines.

Established in step 30:
- Exports stream through **API routes** (not Server Actions), because Server Actions cannot set `Content-Disposition`. Route shape: `app/api/export/[runId]/route.ts`.
- CSV uses **long format**: one row per `(tick, metric_name, metric_value)` triple. Easy to ingest into R's tidyverse or Python's pandas.
- JSON snapshots include full agent inventories at sampled ticks plus the config and seed.
- Filenames include the config SHA-256 (first 8 hex) and the seed: `msksim-<config-hash>-seed-<seed>-<kind>.csv` or `.json`.

## Known gotchas

Bulleted list. Hard cap: 20 items. If a bullet recurs in plan files, promote it into a dedicated section.

- Forgetting `await` on `cookies()`/`headers()`/`params`/`searchParams` in v16 produces a Promise-shaped object silently.
- Importing anything from `lib/db/` or `lib/auth/` into a client component causes Turbopack to attempt native-binding resolution and fail opaquely. `import 'server-only'` at the top of every server-only module is the guard.
- `better-sqlite3` needs `npm rebuild better-sqlite3` if prebuilt binaries are missing for the current Node version.
- Argon2 hashing is slow by design (~100ms). Only hash at login and user creation, never in hot paths.
- React 19 strict mode double-invokes effects in development; worker creation inside `useEffect` must be idempotent or clean up in its return function.
- The Park.is Comlink tutorial cited in `docs/spec.md` §8/§12.4 is for Next 15 + webpack and does **not** apply under Turbopack. Use the `new Worker(new URL(...))` pattern instead.
- `drizzle-kit generate` must be re-run every time `db/schema/*.ts` changes; generated migrations under `db/migrations/` are checked in.
- `Language`, `Referent`, and `TokenLexeme` in `lib/schema/` are **opaque branded strings**, not enums, per `docs/spec.md` §3.5. Do not tighten them to `z.enum(["L1","L2"])` — the researcher UI renames them, and the defaults (`"L1"`, `"L2"`, `"yellow-like"`, etc.) are labels, not invariants. Widening is fine; narrowing will break the step-25 config editor.
- `@node-rs/argon2` ships prebuilt NAPI binaries for all common platforms. If loading it throws on a new dev machine, run `npm rebuild @node-rs/argon2` — do not switch libraries. Rationale: the native binding is 10× faster than pure-JS/WASM at equivalent parameters and prebuilt binaries cover darwin, linux-gnu, linux-musl, and windows.
- The Argon2 hash string is self-describing (variant, params, salt, and hash are all embedded). Do not add a separate `salt` column to `users`; the `password_hash` column is the complete record. Rationale: adding a salt column duplicates data that is already in the hash string and invites desync bugs.
- **Zod 4 does not re-parse `.default(value)` through the schema.** `Schema.default({})` returns `{}` as-is, not `Schema.parse({})`. For complex object schemas, supply a pre-computed full default (e.g. `defaultWorldConfig` in `lib/schema/defaults.ts`) instead of `{}`. Field-level defaults on object children still apply correctly when the parent object is present.

## Living-document rules

- Each plan file's section 11 ("CLAUDE.md updates") lists which sections it will append to and the approximate line count. Hard limit: **≤ 30 lines appended per section per commit**.
- No agent edits sections outside its own commit scope without an explicit instruction from the user or its plan file.
- `scripts/run-plan.ts` verifies CLAUDE.md growth ≤ 100 lines per step; a larger diff aborts the pipeline for human review.
- Section line caps (noted under each heading) are **hard**. If a section overflows, promote its content into a new dedicated section rather than deleting or truncating existing content.
- Citations to `node_modules/next/dist/docs/` are preferred over external blog posts wherever the local doc exists.
- When adding to "Known gotchas", include a brief rationale (*why* it is a gotcha), not just the rule, so future agents can judge edge cases.
