---
step: '03'
title: 'user schema and argon2 hashing'
kind: foundation
ui: false
timeout_minutes: 20
prerequisites:
  - 'step 02: drizzle sqlite scaffolding'
---

## 1. Goal

Introduce the first drizzle entity — the `users` table — and implement a minimal, idiomatic password-hashing utility (`lib/auth/password.ts`) on top of `@node-rs/argon2`. This step establishes the storage shape that step 05 (CLI user management) will write into, the verification primitive that step 07 (login page) will call from its Server Action, and the first committed SQL migration under `db/migrations/`. Scope is deliberately narrow: no sessions, no cookies, no DAL, no UI — only the schema, the password module, and tests that prove the roundtrip.

## 2. Prerequisites

- Step 02 landed: `lib/db/client.ts` exists, `drizzle.config.ts` exists, `db/schema/` exists and has an `index.ts` re-export file, the env schema has `DATABASE_URL` (or equivalent), `scripts/migrate.ts` exists and exits 0 on a fresh DB, and Vitest runs cleanly via `npm test`.
- Node ≥ 20.9 is in place (CLAUDE.md "Stack and versions"). This is a hard floor for both `better-sqlite3` and `@node-rs/argon2` native binaries.
- The pre-flight native-build check from step 00 already proved that `@node-rs/argon2` loads on this machine; if it fails here, run `npm rebuild @node-rs/argon2` (covered in section 7).
- No existing `users` table or `lib/auth/` directory — step 03 creates both.

## 3. Spec references

- **`docs/spec.md` §10 "Out of Scope"** explicitly lists _"Multi-user / server-side orchestration. The app runs entirely in the researcher's browser. There is no shared backend, no user accounts, no collaboration over the network."_ Authentication is **not in spec scope**. It is a deliberate **user override** recorded in `CLAUDE.md` "Stack and versions", which pins the v1 storage and auth posture: Drizzle + `better-sqlite3` server-side, all routes gated, `@node-rs/argon2` for password hashing, table-backed sessions with HttpOnly cookies. Step 03 implements the first half of that override (passwords and the users row); step 04 implements sessions.
- **`CLAUDE.md` "Stack and versions"** — the authoritative override entry: _"`@node-rs/argon2` for password hashing, server-side table-backed sessions with HttpOnly cookies. All routes are gated for v1."_ Cite this section verbatim in the commit body if asked to justify why a spec-out-of-scope feature is being built.
- **`CLAUDE.md` "Authentication patterns"** — step 03 is its first population event. Implementing claude MUST append to this section per section 11 below, not rewrite it.

## 4. Research notes

### Local Next.js 16 documentation (shipped in `node_modules/next/dist/docs/`)

1. **`01-app/02-guides/authentication.md` — §"Sign-up and login functionality → Create a user or check user credentials"** (lines ~301-360 of the shipped file). Next's example is structurally exactly what we need: Server Action, Zod validation, then `const hashedPassword = await bcrypt.hash(password, 10)` followed by `db.insert(users).values({ ..., password: hashedPassword })`. We replace `bcrypt` with `@node-rs/argon2` (justified in section 8 and confirmed by OWASP in §4-external below) and otherwise follow the same three-step shape — step 03 provides the hashing primitive that step 07 will call in exactly this idiom.
2. **`01-app/02-guides/data-security.md` — §"Preventing client-side execution of server-only code"** (lines ~238-264). States: _"To prevent server-only code from being executed on the client, you can mark a module with the `server-only` package... This ensures that proprietary code or internal business logic stays on the server by causing a build error if the module is imported in the client environment."_ `lib/auth/password.ts` MUST begin with `import 'server-only'` for two reasons: (a) Next 16 + Turbopack would otherwise silently attempt to resolve `@node-rs/argon2`'s native `.node` binding in a client bundle and emit the opaque binding-failure error that CLAUDE.md "Known gotchas" explicitly warns about, and (b) the Next docs call this pattern out by name in the authentication-adjacent data-security guide.
3. **`01-app/02-guides/upgrading/version-16.md` — §"Node.js runtime and browser support"** (lines ~106-113). Pins Node ≥ 20.9 as the framework floor. `@node-rs/argon2` 2.0.2's prebuilt binaries target modern NAPI versions shipped with Node 20+; the combination is coherent. The same file's §"Turbopack by default" (lines ~114-166) is why we cannot rely on any `webpack.resolve.fallback` trick to keep native modules out of client bundles — Turbopack enforces the separation structurally, so `import 'server-only'` is the only correct guard.

### External sources (WebFetched)

4. **`@node-rs/argon2` — https://github.com/napi-rs/node-rs/tree/main/packages/argon2**. Key facts used by this plan:
   - Exports `hash(password: string | Buffer, options?, abortSignal?): Promise<string>` and `verify(hashed: string | Buffer, password: string | Buffer, options?, abortSignal?): Promise<boolean>`.
   - Default algorithm is **Argon2id** (the hybrid variant OWASP recommends). Defaults are memory 19,456 KiB (≈19 MiB), time cost 2, parallelism 1, output 32 bytes, version 0x13. These match the OWASP baseline one-for-one (see source 5), so no hand-tuning is needed.
   - Cross-platform with prebuilt binaries and **no `node-gyp` or postinstall step**. The npm registry record for `2.0.2` lists optional dependencies for darwin-x64, darwin-arm64, linux-x64-gnu, linux-x64-musl, linux-arm64-gnu, linux-arm64-musl, win32-x64-msvc, win32-arm64-msvc, wasm32-wasi, and several others — meaning the common dev and CI environments this repo will run in are prebuilt.
   - Fallback if the prebuilt binary does not resolve on a given machine: `npm rebuild @node-rs/argon2` (documented in CLAUDE.md "Stack and versions" and the existing step 00 pre-flight).

5. **OWASP Password Storage Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html**. Recommends: _"Use Argon2id with a minimum configuration of 19 MiB of memory, an iteration count of 2, and 1 degree of parallelism"_ (i.e., m=19456, t=2, p=1). These are _exactly_ the `@node-rs/argon2` defaults, which is why this plan forbids passing a custom `options` argument — doing so would be a hand-tune with no justification. OWASP additionally positions bcrypt as a legacy-only choice: _"The bcrypt password hashing function should only be used for password storage in legacy systems where Argon2 and scrypt are not available."_ This is the primary external justification for the "path not taken" in section 8.

6. **Drizzle ORM SQLite column types — https://orm.drizzle.team/docs/column-types/sqlite**. Confirms the idioms used in section 5: `text().primaryKey()`, `text().notNull().unique()`, and the two alternatives for timestamps — SQL-side `integer({ mode: 'timestamp' }).default(sql\`(CURRENT_TIMESTAMP)\`)`versus runtime`integer({ mode: 'timestamp' }).$defaultFn(() => new Date()).$onUpdateFn(() => new Date())`. This plan picks the runtime `$defaultFn` / `$onUpdateFn`pair for`updated_at`because SQLite has no native`ON UPDATE CURRENT_TIMESTAMP` trigger and drizzle's runtime hook is the idiomatic, portable answer.

### Path not taken

7. **Why not `bcrypt` (or `@node-rs/bcrypt`, or the pure-JS `argon2` package)?**
   - **`bcrypt` (kelektiv/node.bcrypt.js)**: OWASP (source 5) now classifies bcrypt as a legacy algorithm, acceptable only where Argon2 is unavailable. Argon2id is available via `@node-rs/argon2`, so there is no reason to adopt bcrypt. The Next 16 auth example still shows `bcrypt.hash(password, 10)` as a placeholder, but that is an illustration of _where_ to hash, not a prescription of _which_ algorithm.
   - **`@node-rs/bcrypt`**: same algorithm caveat as above, same native-binding posture as `@node-rs/argon2` (prebuilt via NAPI), no upside.
   - **Pure-JS `argon2` (node-argon2 wrapped around WASM, or the `argon2-browser` family)**: pure-JS / WASM Argon2 is roughly one order of magnitude slower than the Rust binding at equivalent parameters. Login time is already user-visible at ~100 ms with the native binding (CLAUDE.md "Known gotchas"); a 10× slowdown would push it past the perceptual budget. Additionally, `@node-rs/argon2` ships a `browser.js` wasm fallback automatically, so the pure-JS alternative offers nothing we would not already have in degraded environments.
   - **`Bun.password` / `crypto.hash` style built-ins**: not available in the Node 20.9 runtime Next 16 requires, so out of scope.

Total citations: three local Next docs (sources 1, 2, 3) + three external URLs WebFetched (sources 4, 5, 6) + one path-not-taken discussion = **7 links, quota satisfied**.

## 5. Files to create

1. **`db/schema/users.ts`** — drizzle table definition for `users`. Columns:
   - `id` — `text('id').primaryKey()`. **Choice: UUID v4**, generated at insert time via a `$defaultFn(() => crypto.randomUUID())` so that the database row is self-ID'ing and CLI / Server-Action call sites never have to construct IDs by hand. **Justification** (picked over nanoid): `crypto.randomUUID()` is built into Node 20 and the browser, needs no dependency, is 128-bit collision-safe for the small user population this tool will ever hold (two researchers plus any future collaborators), and matches the ID style steps 04 and 08 will reuse for `sessions` and `runs`. Nanoid is shorter and URL-friendly but users are never rendered in URLs in msksim, so its one advantage does not apply here.
   - `username` — `text('username').notNull().unique()`. Human-chosen short string. Uniqueness is a DB constraint, not just an application check, so that a race between two `scripts/users.ts add` calls cannot produce duplicates.
   - `passwordHash` — `text('password_hash').notNull()` (note snake_case on the SQL side via the first argument to `text()`, camelCase on the TS field name). Stores the full self-describing argon2 hash string (e.g., `$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>`). **No separate salt column** — the hash string embeds salt and parameters, which is the whole point of the format.
   - `createdAt` — `integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())`. Drizzle runtime default; inserts without an explicit value receive "now".
   - `updatedAt` — `integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date())`. SQLite has no `ON UPDATE CURRENT_TIMESTAMP` trigger, so we use drizzle's runtime `$onUpdateFn` — confirmed by source 6.

2. **`lib/auth/password.ts`** — begins with `import 'server-only'` on line 1 (see source 2 and CLAUDE.md "Known gotchas"). Exports:
   - `export async function hashPassword(plain: string): Promise<string>` — thin wrapper around `hash(plain)` from `@node-rs/argon2`. No second argument, so the library's defaults (Argon2id, m=19456, t=2, p=1) apply. Returns the self-describing hash string.
   - `export async function verifyPassword(plain: string, hash: string): Promise<boolean>` — thin wrapper around `verify(hash, plain)` from `@node-rs/argon2`. Note the argument order flip: the library's `verify` signature is `verify(hashed, password)` but our wrapper presents the more conventional `(plain, hash)` ordering to match the `hashPassword` name and to match call sites like `verifyPassword(formData.password, user.passwordHash)`. Document this flip in a short comment.
   - No custom options, no catch blocks that swallow errors — a thrown error from `@node-rs/argon2` propagates so callers see the real cause.

3. **`lib/auth/password.test.ts`** — Vitest suite, colocated per CLAUDE.md "Testing conventions". Default `node` environment, no `happy-dom` needed. Imports `hashPassword`, `verifyPassword`, and (for the last assertion) the users table and the step-02 in-memory drizzle client factory. See section 9 for the exact assertions.

4. **`db/migrations/0001_<drizzle-generated-slug>.sql`** (plus the matching `db/migrations/meta/_journal.json` update). Produced by running `npx drizzle-kit generate` once, after `db/schema/users.ts` is in place and re-exported from `db/schema/index.ts`. The implementing claude commits the generated SQL file verbatim — do not hand-edit it. Drizzle picks the slug deterministically from its own naming logic; both the `.sql` file and the updated `_journal.json` must be in the same commit, per CLAUDE.md "Database access patterns".

## 6. Files to modify

1. **`package.json`** — add `@node-rs/argon2` to `dependencies` (not `devDependencies`; it is required by the server runtime). Pin exactly `"@node-rs/argon2": "2.0.2"` (current stable on the npm registry as of this step). Running `npm install @node-rs/argon2@2.0.2` produces this entry plus the matching `package-lock.json` update; commit both.

2. **`db/schema/index.ts`** (the step 02 barrel file) — add `export * from './users'` so that `lib/db/client.ts` consumers and `drizzle.config.ts` can see the new table. No other edits to this file.

## 7. Implementation approach

Proceed in this order. Each bullet is a commit-internal operation, not a separate commit — the whole step is one commit per CLAUDE.md "Commit-message convention".

1. **Install the dependency**. Run `npm install @node-rs/argon2@2.0.2`. On Linux, macOS, and Windows dev machines this pulls a prebuilt NAPI binary from the matching `@node-rs/argon2-<platform>` optional dependency, no build step. If the package fails to load at test time with an error about a missing `.node` file (usually on exotic architectures or in constrained containers), the implementing claude should run `npm rebuild @node-rs/argon2` once and retry. If that also fails, surface the error in the step's log and stop — do not paper over a broken native binding by switching to a pure-JS fallback.

2. **Write the users schema** at `db/schema/users.ts`. Use drizzle's `sqliteTable('users', { ... })` constructor. Columns exactly as listed in section 5.1. Export both the table object (as `users`) and the inferred types via `typeof users.$inferSelect` and `typeof users.$inferInsert` so that step 05 (CLI user management) and step 07 (login Server Action) can type their call sites.

3. **Re-export from the barrel**. Add `export * from './users'` to `db/schema/index.ts`. Confirm by opening the file afterwards that the step 02 contents are still present — do not replace the file.

4. **Generate the migration**. Run `npx drizzle-kit generate`. Drizzle will diff the current schema against the last recorded snapshot in `db/migrations/meta/` and emit a new `.sql` file plus an update to the journal. Inspect the generated SQL to make sure it contains a `CREATE TABLE users` statement with the four columns, the `PRIMARY KEY (id)` clause, and the `UNIQUE` constraint on `username`. Do **not** hand-edit the generated file; if something is wrong, fix `db/schema/users.ts` and re-run `drizzle-kit generate`.

5. **Verify the migration applies on a fresh DB**. Remove `data/msksim.db` (gitignored) if it exists in the working directory and run `npm run db:migrate`. It must exit 0. Then run it again; drizzle must detect that the migration is already applied and do nothing. If either run fails, diagnose before continuing — almost always it is a typo in a column definition.

6. **Write `lib/auth/password.ts`**. First line: `import 'server-only'`. Second non-blank line: `import { hash, verify } from '@node-rs/argon2'`. Implement `hashPassword` and `verifyPassword` exactly as specified in section 5.2. Include a one-line comment above `verifyPassword` noting the argument-order flip relative to the library. No other exports, no options object, no custom error handling.

7. **Write `lib/auth/password.test.ts`**. Four assertions from section 9 plus the users-table insert assertion. Use `describe('password', ...)` and individual `it(...)` blocks so a failure report points at the specific assertion. The insert test constructs a fresh in-memory drizzle client using whatever factory step 02 exported (the plan for step 02 labeled this as the helper used by its own schema-level tests), applies migrations, inserts a row with a hashed password, reads it back, and asserts that `verifyPassword(plaintext, row.passwordHash)` returns `true`. This wires password.ts and users.ts together in a single end-to-end assertion.

8. **Run the full test suite** with `npm test`. All existing step 00 / 01 / 02 tests must still pass; the new `lib/auth/password.test.ts` file must pass. Run `npm run typecheck` (or whatever command the repo exposes per step 00) to confirm the schema type inference compiles.

9. **Commit**. One commit. See section 12 for the exact subject.

The `import 'server-only'` guard is load-bearing. Without it, Turbopack in Next 16 will happily attempt to include `lib/auth/password.ts` in a client bundle the moment a client component imports from anywhere that transitively touches it, and the user will see an opaque native-binding failure with a stack trace that points to Turbopack internals rather than to the real cause. Source 2 documents this pattern; CLAUDE.md "Known gotchas" and "Database access patterns" both call it out.

## 8. Library choices

- **`@node-rs/argon2@2.0.2`** (pinned exactly, not caret-ranged, because the native binding surface is part of the ABI contract and this repo prefers reproducible builds over automatic minor upgrades).
  - Justification vs `bcrypt` / `@node-rs/bcrypt`: OWASP classifies bcrypt as legacy-only and Argon2id as the primary recommendation (source 5). Argon2id is memory-hard, bcrypt is not; memory-hardness is what resists modern GPU and ASIC attacks. There is no cost to choosing the modern primitive here.
  - Justification vs pure-JS `argon2` / WASM Argon2: the Rust native binding is roughly 10× faster at equivalent parameters and login cost is already user-visible at ~100 ms (CLAUDE.md "Known gotchas"). The prebuilt-binary story for `@node-rs/argon2` covers every platform this repo will realistically run on (source 4: 14 optional dependencies spanning darwin, linux-gnu, linux-musl, windows, android, freebsd, and wasi), so the portability argument for pure-JS is moot. `@node-rs/argon2` also ships a wasm fallback at `browser.js` automatically, so degraded-environment coverage is free.
  - Justification for defaults: the library ships Argon2id, m=19456, t=2, p=1, which are exactly the OWASP minimums (sources 4 and 5). Hand-tuning would be a distraction with no positive outcome. If future profiling shows login is too slow or too fast for its threat model, the knob to turn is the `options` argument to `hash`, and the place to record that decision is a new subsection of CLAUDE.md "Authentication patterns" — not this step.

No other new libraries. `crypto.randomUUID` is a Node 20 built-in. Drizzle, `better-sqlite3`, Zod, and Vitest all landed in earlier steps.

## 9. Unit tests

All live in `lib/auth/password.test.ts`. The file starts with `import { describe, it, expect } from 'vitest'` and imports `hashPassword` and `verifyPassword` from `./password`.

1. **Hash shape**. `const h = await hashPassword('foo'); expect(h).toMatch(/^\$argon2(id|i|d)\$/)`. The Argon2 self-describing hash format starts with `$argon2<variant>$`; `@node-rs/argon2`'s default variant is `argon2id` but the regex accepts `argon2i` and `argon2d` defensively in case a future library upgrade flips the default. Confirms the library is producing a parseable, variant-tagged hash string (not, e.g., raw bytes or a hex dump).
2. **Roundtrip**. `expect(await verifyPassword('foo', await hashPassword('foo'))).toBe(true)`. The happy path: same plaintext, same hash, verifies to `true`.
3. **Wrong password fails**. `expect(await verifyPassword('bar', await hashPassword('foo'))).toBe(false)`. Different plaintext must not verify against a hash for a different plaintext.
4. **Unique salts produce different hashes**. `const a = await hashPassword('foo'); const b = await hashPassword('foo'); expect(a).not.toBe(b)`. Argon2 generates a fresh random salt per call, so two hashes of the same plaintext must not be byte-identical. This is a direct correctness check that we did not accidentally stub salting, and also that we are not calling the library with a fixed-salt options object.
5. **Users table insert roundtrip**. Using the in-memory drizzle client factory from step 02's test suite: build a fresh client, run migrations, `await db.insert(users).values({ username: 'alice', passwordHash: await hashPassword('correct horse') }).returning()`, read the row back with `db.select().from(users).where(eq(users.username, 'alice'))`, and assert `await verifyPassword('correct horse', row.passwordHash)` returns `true`. This is the end-to-end assertion that proves the schema compiles under type inference, that the NOT NULL / UNIQUE constraints do not block valid inserts, that `id` / `createdAt` / `updatedAt` default values fire without being passed explicitly, and that the password round-trips through the DB column unchanged.

The test file has no component-level concerns and runs under the default Vitest `node` environment.

## 10. Acceptance criteria

- `npm test -- lib/auth` (or equivalently `npm test lib/auth/password.test.ts`) exits 0. All five assertions in section 9 pass.
- `npm test` (the full suite) exits 0. No regression in step 00/01/02 tests.
- `npm run db:migrate` on a fresh DB (with `data/msksim.db` deleted) exits 0 and creates a `users` table. Running it a second time is a no-op and also exits 0.
- `npm run typecheck` exits 0. In particular, `typeof users.$inferSelect` and `typeof users.$inferInsert` must resolve and not produce `any`.
- The generated migration file exists under `db/migrations/` and is staged for the commit. The matching `db/migrations/meta/_journal.json` update is also staged.
- `lib/auth/password.ts` begins with `import 'server-only'` on line 1. Grepping `grep -n "^import 'server-only'" lib/auth/password.ts` returns a match on line 1.
- `package.json` lists `@node-rs/argon2` at exactly `2.0.2`; `package-lock.json` is updated accordingly.

## 11. CLAUDE.md updates

Two sections receive appends; both stay within their hard caps per CLAUDE.md "Living-document rules".

- **"Authentication patterns"** (hard cap 80 lines; step 03 is the first populator) — append ≤ 15 lines covering:
  - The password policy: Argon2id via `@node-rs/argon2` with library defaults (m=19456, t=2, p=1), and the rationale that those defaults match the OWASP recommendation exactly.
  - The users-table shape: `id` (text PK, uuid v4 via `crypto.randomUUID`), `username` (text unique not null), `password_hash` (text not null, self-describing hash, no separate salt column), `created_at`, `updated_at` (both integer timestamp, drizzle runtime defaults, `updated_at` using `$onUpdateFn`).
  - The `import 'server-only'` requirement for `lib/auth/password.ts`.

- **"Known gotchas"** (hard cap 20 items) — append ≤ 3 items:
  - _"Argon2 hashing is slow by design (~100 ms per call with library defaults). Only hash at login and at user creation; never in a loop, a request-fanout, or a Server Component render path. Rationale: the memory-hardness that makes it attack-resistant is the same cost on the defender."_ (Note: CLAUDE.md "Known gotchas" already contains a short version of this caveat; if it is already present, the implementing claude should **not** duplicate it — verify before appending.)
  - _"`@node-rs/argon2` ships prebuilt NAPI binaries for all common platforms. If `require('@node-rs/argon2')` throws on a new dev machine, the fix is `npm rebuild @node-rs/argon2`, not switching libraries."_
  - _"The Argon2 hash string is self-describing (variant, params, salt, hash all embedded). Do not add a separate `salt` column to `users`; the hash string is the whole record."_

The implementing claude must verify both sections' line counts after the append and abort if either overflows its cap; promote overflow content into a new dedicated section per CLAUDE.md "Living-document rules" rather than truncating.

## 12. Commit message

Exactly:

```
step 03: user schema and argon2 hashing
```

No conventional-commit prefix, no emoji, no trailing period. The `step NN:` marker is load-bearing for `scripts/run-plan.ts` progress detection (CLAUDE.md "Commit-message convention"). One commit for the whole step; if intermediate commits slip in during execution they will be squashed by the orchestrator before advancing.

## 13. Rollback notes

If the step needs to be undone:

1. `git reset --hard <prior commit SHA>` — where `<prior>` is the step 02 commit. This single operation removes `db/schema/users.ts`, the new migration file under `db/migrations/`, the `_journal.json` update, `lib/auth/password.ts`, `lib/auth/password.test.ts`, the `db/schema/index.ts` edit, the `package.json` / `package-lock.json` edits, and the CLAUDE.md appends in one move.
2. `npm uninstall @node-rs/argon2` — redundant if the `git reset` already reverted `package.json` and `package-lock.json`, but run it anyway to drop the installed artifacts from `node_modules/` so a subsequent `npm install` does not silently resurrect the dependency.
3. Delete `data/msksim.db` (the gitignored local SQLite file) so that the next `npm run db:migrate` starts from an empty DB and does not carry a lingering `users` table from the rolled-back state. The migration journal in the database itself would otherwise disagree with the (now absent) `db/migrations/` entry.
4. Verify with `npm test` that the earlier steps' suites still pass on the rolled-back tree. If step 02's tests reference users or password, the rollback target is wrong — step 02 never references users.

After these four steps the repository is byte-identical to the step 02 tip and safe to re-run step 03 from scratch.
