---
step: '05'
title: 'cli user management'
kind: foundation
ui: false
timeout_minutes: 20
prerequisites:
  - 'step 03: user schema and argon2 hashing'
  - 'step 04: session schema and service'
---

## 1. Goal

Build the single command-line tool a human administrator uses to manage the tiny user population of msksim: `scripts/users.ts`. The tool exposes four subcommands — `add`, `remove`, `list`, and `change-password` — that operate directly against the drizzle client from step 02, the `users` table from step 03, and the `sessions` table's cascade from step 04. This is the step that completes the **user-facing half** of the auth override recorded in CLAUDE.md "Stack and versions" (the spec itself says auth is out of scope — see section 3 below). No UI, no session issuance, no login form, no proxy, no DAL — all of those are later steps that _use_ users created by this CLI. The invariant this step establishes is: _the only way to mint, rename-away, rotate-credentials-for, or enumerate users in msksim is `npx tsx scripts/users.ts …`, and that path flows through `hashPassword` from step 03 so every row in the `users` table carries a real Argon2id hash._

A second, equally important invariant: **argument shape stability with `scripts/run-plan.ts`**. The orchestrator's `ensureSeedUser()` function (see CLAUDE.md "UI verification harness" and `scripts/run-plan.ts` lines 662–684) already calls `npx tsx scripts/users.ts add <seed-user> <seed-pass>` and `npx tsx scripts/users.ts change-password <seed-user> <seed-pass>` before every UI step. This plan file's positional-argument contract **must** match what `run-plan.ts` already hard-codes; any rename of subcommands or reordering of positionals would silently break the UI-verification pipeline starting at step 07.

## 2. Prerequisites

- **Step 03 — user schema and argon2 hashing.** The `users` table is exported from `db/schema/users.ts` via the `db/schema/index.ts` barrel, and `lib/auth/password.ts` exports `hashPassword(plain: string): Promise<string>`. This CLI imports both. If either is missing, the implementing claude must stop and report rather than papering over the dependency.
- **Step 04 — session schema and service.** The `sessions` table carries `user_id text not null references users(id) on delete cascade`. The CLI's `remove` subcommand relies on this cascade for "delete a user and all their live sessions in one statement" behaviour — it does **not** issue a separate `DELETE FROM sessions WHERE user_id = ?`, because the FK cascade is the canonical single source of truth. The cascade requires `PRAGMA foreign_keys = ON` on the drizzle client connection, which step 02 (per its section 7 bullet 7 and step 04's CLAUDE.md addendum) establishes in `lib/db/client.ts`.
- **Step 02 — drizzle sqlite scaffolding.** The module-load singleton at `lib/db/client.ts`, the `@/` path alias, the `tsx`-based script invocation pattern (already used by `scripts/migrate.ts` and `scripts/run-plan.ts`), and the in-memory-sqlite test helper pattern established there (override `MSKSIM_DB_PATH = ':memory:'` **before** importing `lib/db/client`). This CLI's tests reuse that pattern verbatim — see section 9.
- **Node ≥ 20.9** (CLAUDE.md "Stack and versions"). `node:util.parseArgs` is stable since Node 18.11, so 20.9 is comfortably above the floor. `crypto.randomUUID` (used transitively via the `users` table's `$defaultFn` id default from step 03) has been stable since Node 19, also safely covered.

## 3. Spec references

- **`docs/spec.md` §10 "Out of Scope"** explicitly lists _"Multi-user / server-side orchestration. The app runs entirely in the researcher's browser. There is no shared backend, no user accounts, no collaboration over the network."_ Authentication — and therefore the very existence of a "user" entity, and therefore the very existence of this CLI — is **not in spec scope**. The step is a user-override feature, not a spec feature.
- **`CLAUDE.md` "Stack and versions"** records the override verbatim: _"simple username/password authentication, all routes gated; CLI tool for adding/removing/changing passwords of users, which should just have basic usernames."_ This plan file implements the second half of that sentence literally — four subcommands, simple positional arguments, no framework. The word "simple" in the override is load-bearing and drives the "paths not taken" discussion in section 4 and the library decision in section 8: _no commander, no yargs, no citty_.
- **`CLAUDE.md` "Authentication patterns"** already fixes the users-row shape (step 03) and the sessions-row cascade (step 04). This step writes rows into those tables; it does not invent any new schema.
- **`CLAUDE.md` "Directory layout"** already pre-declares this file's location: _"`scripts/` — CLI tools (`run-plan.ts` already present; `users.ts` added in step 05; `migrate.ts` added in step 02)"_. The CLAUDE.md updates in section 11 are therefore a confirmation-only touch, not a new-section append.

## 4. Research notes

### Local Next.js 16 documentation (shipped in `node_modules/next/dist/docs/`)

A CLI tool has no direct contact with the Next.js runtime — it runs under plain `tsx` in Node, with no bundler, no Turbopack, no React, and no request lifecycle. The local Next docs are still relevant, though, because the CLI _imports server-side modules that were written for that runtime_, and the rules governing those modules flow through to the CLI.

1. **`01-app/02-guides/authentication.md` — §"Creating a password hashing utility" and §"Sign-up and login functionality"** (the same pages step 03 cited). Confirms the `hashPassword` signature shape and idiomatic call site: `const hashedPassword = await hashPassword(plainPassword); await db.insert(users).values({ username, passwordHash: hashedPassword })`. This CLI is literally a non-Next caller of that same API: we import `hashPassword` from `lib/auth/password.ts` and compose it with drizzle insert/update statements. The Next doc does not need to know we are in a CLI; the API is the same. This citation anchors the CLI's handlers to the same hashing primitive the login Server Action in step 07 will use, which is what makes a CLI-added user loginable.

2. **`01-app/02-guides/data-security.md` — §"Preventing client-side execution of server-only code"**. The `server-only` package's core promise is that it throws _at client-bundle build time_, not at Node runtime: _"you can mark a module with the `server-only` package… This ensures that proprietary code or internal business logic stays on the server by causing a build error if the module is imported in the client environment."_ The CLI transitively imports `lib/db/client.ts` (via `scripts/users-actions.ts`) and `lib/auth/password.ts`, both of which start with `import 'server-only'`. Under `tsx` / Node there is no client bundle and no build step, so `server-only` resolves to a trivial re-export that is a runtime no-op — exactly what we want. The CLI is therefore safe to import server-only modules even though its top-level file has no `import 'server-only'` of its own. This is the authoritative local-docs justification for the scope-boundary decision in section 7 (step 4) and the docstring in `scripts/users.ts`.

3. **`01-app/02-guides/upgrading/version-16.md` — §"Node.js runtime and browser support"** (lines ~106–113 per step 03's citation). Pins **Node ≥ 20.9** as the framework floor, which is also the floor for this CLI. We specifically use Node core primitives that are well above that floor: `node:util.parseArgs` (stable since 18.11), `node:process.exit(code)` (always), and `console.error` / `process.stderr.write` (always). No polyfills, no shims. The v16 doc is also the authority for why the CLI does not share the async `cookies()`/`headers()` rules with the Next runtime — those APIs do not exist in a CLI context and `scripts/users.ts` never imports from `next/headers`. The CLI's isolation from the Next async-request-API breaking change is explicit and deliberate.

### External sources (WebFetched)

4. **`node:util.parseArgs` — https://nodejs.org/api/util.html#utilparseargsconfig**. The Node standard library ships a small argument parser that is more than sufficient for four subcommands with ≤ 2 positional arguments each. Key facts consumed by this plan:
   - Signature: `parseArgs({ args?, options?, strict?, allowPositionals?, tokens?, allowNegative? })`. When `args` is omitted, it defaults to `process.argv.slice(2)` — i.e., exactly what `node:process.argv` exposes minus the executable and script paths.
   - Result shape: `{ values: Record<string, string|boolean|...>, positionals: string[], tokens? }`. The CLI needs `values` for `--help` (a boolean) and `positionals` for the subcommand name and its arguments.
   - Defaults: `strict: true` and `allowPositionals: false` unless overridden. This CLI sets `allowPositionals: true` (because every subcommand takes positional arguments) and keeps `strict: true` (because we want to reject unknown flags rather than silently drop them — an unknown flag almost always means a typo, and the user deserves an early error). `options` is declared minimally: just a `help` boolean with a `short: 'h'` alias. Everything else flows through `positionals`.
   - Strict behaviour: under `strict: true`, unknown options throw a `TypeError` that bubbles up with a clear, node-generated message; the CLI catches it and exits with code 2 (usage error), matching the standard conventions in section 10.
   - Alternative considered: parsing `process.argv.slice(2)` by hand with array destructuring. This is also acceptable and the user explicitly allowed it ("either hand-roll argument parsing… or use node:util's parseArgs"). The plan picks `parseArgs` for `--help`/`-h` hygiene (parseArgs handles the short alias) and for the early-reject-unknown-flags behaviour; the **subcommand dispatch** is still a hand-rolled switch statement on `positionals[0]`, because parseArgs has no concept of subcommands and pretending otherwise would be worse than doing the two-line switch directly.

5. **`tsx` — https://github.com/privatenumber/tsx and https://tsx.is**. The TypeScript executor for Node that msksim already uses (see `scripts/migrate.ts` and `scripts/run-plan.ts`'s shebang `#!/usr/bin/env tsx`). Key facts:
   - `tsx` is a drop-in Node replacement that transparently compiles `.ts` files on import, supports ESM and CJS, and does not require a build step. It is already a dev dependency from step 00.
   - Shebang pattern: `#!/usr/bin/env -S npx tsx` (POSIX `env -S` to pass the multi-word `npx tsx` to the kernel; without `-S`, the kernel would try to find an executable literally named `npx tsx` and fail). The existing `scripts/run-plan.ts` uses the simpler `#!/usr/bin/env tsx` because `tsx` is installed in `node_modules/.bin/` and resolvable on `PATH` when invoked via `npm run`. **We match `run-plan.ts`'s choice**: `#!/usr/bin/env tsx`, on the assumption that `tsx` is available on the current shell's `PATH` (either because `node_modules/.bin` is injected by npm scripts, or because the user is running via `npx tsx scripts/users.ts …`, which bypasses the shebang entirely). This is a conscious consistency decision — see also section 8.
   - If direct shebang invocation (`./scripts/users.ts add alice hunter2`) turns out to fail on a developer machine where `tsx` is not on `PATH`, the fallback is the documented canonical form in the file header: _"Also invokable as `npx tsx scripts/users.ts <subcommand> [args]`"_. Both paths must work; the documentation wording must not promise only the shebang path.
   - Setting the executable bit: `chmod +x scripts/users.ts`. Git preserves the mode bit in tree objects (`100755` vs `100644`), so committing the file with the bit set carries it into clones. The implementing claude verifies this with `git ls-files --stage scripts/users.ts | awk '{print $1}'` and expects `100755`. See also acceptance criteria in section 10.

### Path not taken

6. **`commander`, `yargs`, `citty`, `minimist`, and `arg` were all considered and rejected.** Every one of these packages is competent, well-maintained, and has a richer feature set than `node:util.parseArgs`. The reasons to reject every one of them are:
   - **The user explicitly said "simple".** CLAUDE.md "Stack and versions" records the override as _"CLI tool for adding/removing/changing passwords of users, which should just have basic usernames"_, and the surrounding sentence emphasizes minimalism. Adding a 50–200-kB dependency with declarative command trees, help generation, coercion, and middleware layers is the literal opposite of simple.
   - **Four subcommands with ≤ 2 positionals each is below every CLI framework's break-even complexity.** The entire dispatch is roughly `switch (positionals[0]) { case 'add': … case 'remove': … case 'list': … case 'change-password': … default: printUsage(); process.exit(2); }`. A framework would replace ~20 lines of exhaustive switch with ~20 lines of declarative command definitions plus a dependency, which trades one kind of simplicity for another at a net cost of an installed package.
   - **Dependency hygiene.** This repo's dependency graph is deliberately small: step 02 added drizzle + better-sqlite3, step 03 added argon2, step 04 added nothing, and this step is also intended to add _nothing_. `package.json` stays clean, `npm ci` stays fast, and supply-chain surface area stays minimal.
   - **`node:util.parseArgs` is in core since Node 18.11.** The Node version floor is 20.9 (CLAUDE.md "Stack and versions"), so the built-in is always available. Using a framework to paper over an API that is literally one import away would be ceremony for the sake of ceremony.
   - **The Next 16 docs say nothing about CLI tools.** There is no "Next prefers commander" or "Next uses yargs internally" guidance that would tilt this decision toward a specific framework on framework-consistency grounds. The right call is therefore the smallest thing that works.

7. **Single-file dispatch without a separate actions module was considered and rejected for testability.** The naive shape is `scripts/users.ts` as one monolithic file that does both argument parsing and database work. It is 30 lines shorter. It is also effectively untestable, because the only way to exercise the handlers under Vitest is to spawn a child process per test case, which is slow (~200 ms per spawn × ~8 tests = ~1.6 s floor, plus process-cleanup flakes) and loses stack-trace fidelity on assertion failures. The plan therefore splits the CLI into two files: `scripts/users-actions.ts` holds the **pure handler functions** (each taking `db` as an explicit parameter, so the tests can substitute an in-memory client) and `scripts/users.ts` is a thin argument-parser wrapper that (a) reads CLI args, (b) imports the singleton `db` from `@/lib/db/client`, (c) dispatches to the correct handler, (d) translates thrown errors into exit codes and stderr messages. This split is the lowest-cost way to make the handlers unit-testable _without_ spawning child processes, and it matches the testability discipline already established in steps 03 and 04 (password.ts and sessions.ts are libraries with vitest-friendly exports).

### Total citations

Three local Next doc sections (sources 1, 2, 3) + two external URLs WebFetched (sources 4, 5) + two paths-not-taken (sources 6, 7) = **7 links, quota satisfied** (≥ 3 local, ≥ 2 external, ≥ 1 path-not-taken, total ≥ 5).

## 5. Files to create

1. **`scripts/users-actions.ts`** — the testable handler module. No shebang, no `process.exit`, no direct argument parsing. Starts with `import 'server-only';` on line 1 (transitively required because it imports the drizzle client; the rationale is identical to steps 03 and 04). Second block of imports: `import { eq } from 'drizzle-orm'`, `import { db as defaultDb } from '@/lib/db/client'`, `import { users } from '@/db/schema'`, `import { hashPassword } from '@/lib/auth/password'`. Exports four async functions, each taking an optional `db` parameter (so tests can inject an in-memory client) and each returning a plain value or throwing a typed error:
   - `export async function addUser(username: string, password: string, db = defaultDb): Promise<void>`. Checks for an existing row with `db.select().from(users).where(eq(users.username, username)).limit(1)`; if present, throws `new UserAlreadyExistsError(username)`. Otherwise computes `const passwordHash = await hashPassword(password)` and runs `db.insert(users).values({ username, passwordHash })`. No return value on success; the caller prints its own confirmation. Lets any other error (e.g., a drizzle constraint violation caused by a race with a second `addUser` call in the same process) propagate.
   - `export async function removeUser(username: string, db = defaultDb): Promise<void>`. Runs `const result = db.delete(users).where(eq(users.username, username)).returning({ id: users.id })`. If `result.length === 0`, throws `new UserNotFoundError(username)`. Otherwise returns. **Relies on `sessions.user_id` `ON DELETE CASCADE`** (step 04) for session cleanup — **does not** separately delete sessions, and a comment in the code explains why.
   - `export async function listUsers(db = defaultDb): Promise<string[]>`. Runs `db.select({ username: users.username }).from(users).orderBy(users.username)` and returns just the `username` strings, sorted alphabetically (SQLite's `ORDER BY` on a text column is case-sensitive lexicographic, which is fine for v1 and matches how a `LIKE` search would behave). Returns an empty array on an empty table — not an error.
   - `export async function changePassword(username: string, newPassword: string, db = defaultDb): Promise<void>`. Computes `const passwordHash = await hashPassword(newPassword)` first (so a bad hashing library call surfaces before the DB write). Then runs `const result = db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.username, username)).returning({ id: users.id })`. If `result.length === 0`, throws `new UserNotFoundError(username)`. Otherwise returns. The explicit `updatedAt: new Date()` ensures the step-03 `$onUpdateFn` fires predictably even in the injection-test path where the drizzle runtime hooks may or may not be wired into the in-memory client (both paths still produce a correct row; the explicit value is a belt-and-suspenders).

   The module also exports two typed error classes for the CLI layer to match on:
   - `export class UserAlreadyExistsError extends Error { constructor(public username: string) { super(\`user "${username}" already exists\`); this.name = 'UserAlreadyExistsError'; } }`
   - `export class UserNotFoundError extends Error { constructor(public username: string) { super(\`user "${username}" not found\`); this.name = 'UserNotFoundError'; } }`

   These two classes are the ABI between `users-actions.ts` and `users.ts` for exit-code mapping (see section 7). They are not part of the external npm surface — nothing outside `scripts/` imports from this module — so naming and shape are internal concerns.

2. **`scripts/users.ts`** — the CLI entrypoint. **First line is the shebang** `#!/usr/bin/env tsx` (matching `scripts/run-plan.ts`'s convention; see section 4 source 5 for the rationale). Second line blank. Then a file-header JSDoc block documenting:
   - Purpose (one sentence).
   - Canonical invocation: both `npx tsx scripts/users.ts <subcommand> …` and `./scripts/users.ts <subcommand> …` (the latter when the executable bit is set and `tsx` is on `PATH`).
   - Subcommand summary: `add <username> <password>`, `remove <username>`, `list`, `change-password <username> <new-password>`, `--help`.
   - Exit codes: 0 success, 1 user-facing error (missing user, duplicate user, hashing failure), 2 usage error (unknown subcommand, wrong argument count, unknown flag).
   - A one-line note that the file is safe to run under `tsx`/Node even though it transitively imports `server-only` modules, because `server-only` is a client-bundle guard, not a runtime guard (source 2).
   - A one-line note pinning the argument shape to `scripts/run-plan.ts`'s `ensureSeedUser()` (lines 672–683): _"do not rename `add` or `change-password`, and do not reorder `<username> <password>` — `run-plan.ts` depends on this shape."_

   Then imports: `import { parseArgs } from 'node:util'`, and the four handlers plus the two error classes from `./users-actions`. No other imports at the top level. In particular, **do not** eagerly import `@/lib/db/client` here — the handlers import it themselves, so the CLI entrypoint only loads the DB when it actually dispatches to a handler. This keeps `--help` and the usage-error path free of any DB side effects.

   Then the `main()` function (async), which:
   a. Calls `const { values, positionals } = parseArgs({ options: { help: { type: 'boolean', short: 'h' } }, strict: true, allowPositionals: true })` inside a `try` block. Catches `TypeError` (what parseArgs throws on unknown flags), prints the message plus the usage string to stderr, and exits 2.
   b. If `values.help` is true, prints the usage string to stdout and exits 0.
   c. If `positionals.length === 0`, prints the usage string to stderr and exits 2.
   d. Dispatches on `positionals[0]` via a switch. Each case validates its positional-argument count, calls the matching handler, prints the success message to stdout on the happy path, and falls through to the catch block on errors.
   e. The catch block (wrapping the entire dispatch) matches on `err instanceof UserAlreadyExistsError`, `err instanceof UserNotFoundError`, or anything else: the first two print the message to stderr and exit 1; the fallback prints the message to stderr with a stack trace and exits 1 as well (a bare `throw` from an unexpected place is still a user-facing error from the CLI's perspective, not a usage error). Usage errors (bad subcommand name, wrong argument count) print to stderr and exit 2, and they never enter the catch block because the catch is only wrapped around handler invocations.
   f. The final line of the file is `main().catch((err) => { process.stderr.write(String(err) + '\n'); process.exit(1); });` as a defensive safety net against an async error escaping `main`. This matches the pattern in `scripts/run-plan.ts` (line 782).

   The usage string is a module-level constant, roughly:

   ```
   Usage: scripts/users.ts <subcommand> [args]

   Subcommands:
     add <username> <password>            create a user
     remove <username>                    delete a user (cascades to sessions)
     list                                 print all usernames, one per line
     change-password <username> <new>     update a user's password
     --help, -h                           show this message
   ```

   (The above is illustrative; the implementing claude writes the actual string as a template literal in the file.)

3. **`scripts/users-actions.test.ts`** — Vitest suite colocated with the module it tests (per CLAUDE.md "Testing conventions" established in step 00). `// @vitest-environment node` at the top (redundant with the default, but explicit). The file's first executable statement sets `process.env.MSKSIM_DB_PATH = ':memory:'` and `process.env.MSKSIM_SESSION_SECRET = 'a'.repeat(48)` **before any import of `@/lib/db/client`**, using the same ordering discipline step 02 established. Imports `describe`, `it`, `expect`, `beforeEach` from `vitest`. Dynamically imports `addUser`, `removeUser`, `listUsers`, `changePassword`, `UserAlreadyExistsError`, `UserNotFoundError` from `./users-actions`; dynamically imports `db` from `@/lib/db/client`; dynamically imports `users` from `@/db/schema`; dynamically imports `verifyPassword` from `@/lib/auth/password`; dynamically imports `eq` from `drizzle-orm`. Dynamic imports are required so that the env stubbing above runs **before** the `lib/db/client` module-level initializer parses `env.MSKSIM_DB_PATH`. Before each test, runs the drizzle migrator (`import { migrate } from 'drizzle-orm/better-sqlite3/migrator'`) against the in-memory DB with `migrationsFolder: './db/migrations'`, and truncates the `users` table between tests so each case starts clean. The seven test cases in section 9 are the bodies. The tests do **not** spawn `scripts/users.ts` as a child process; that is explicitly the wrong approach per section 4 source 7.

## 6. Files to modify

1. **`package.json`** — add one npm script entry (optional but nice, per the task brief):

   ```
   "users": "tsx scripts/users.ts"
   ```

   Placed alphabetically or at the end of the `scripts` block — the implementing claude chooses the least-diff placement. With this entry, the CLI can be invoked as `npm run users -- add alice hunter2` (the `--` separates npm's args from the script's args). Do **not** add the entry as `"users": "npx tsx scripts/users.ts"` — `npm run` already resolves `tsx` through `node_modules/.bin`, so the extra `npx` would be redundant and would slow every invocation by one process startup.

   **No dependency changes.** Not adding `commander`, `yargs`, `citty`, `arg`, `minimist`, or any other CLI framework, per section 4 source 6.

2. **`CLAUDE.md`** — trivial confirmation touch to "Directory layout"; see section 11. Hard cap: ≤ 3 lines.

No other files are modified. In particular, **`scripts/run-plan.ts` is not touched.** Its `ensureSeedUser()` function already matches the argument shape this plan locks in.

## 7. Implementation approach

Proceed in this order. Each bullet is a commit-internal operation; the whole step lands in one commit per CLAUDE.md "Commit-message convention" (see section 12).

1. **Re-read the prerequisites.** Before writing any code, the implementing claude confirms that `lib/auth/password.ts` exports `hashPassword` (step 03), that `db/schema/index.ts` re-exports `users` (step 03), that `lib/db/client.ts` enables `PRAGMA foreign_keys = ON` (step 02 or step 04), and that `scripts/run-plan.ts` exists with the `ensureSeedUser` shape documented in section 2 of this plan. Any missing prerequisite is a stop-and-report condition.

2. **Write `scripts/users-actions.ts` first, before the entrypoint.** The actions module is the reusable, testable core, and it has no dependency on argument parsing. Start with `import 'server-only';`, then the drizzle and hash imports, then the two error classes, then the four handlers. Each handler follows the same shape: (a) do its read-or-write against the passed-in `db` parameter, (b) check for the "no rows affected" condition where applicable and throw the matching typed error, (c) return on success. Keep functions pure of `process.stdout` and `console.log` — printing is the entrypoint's job, not the handler's.

3. **Write `scripts/users-actions.test.ts` next**, before the entrypoint. Following the testability discipline from section 4 source 7, writing the tests against the actions module immediately (before the CLI wrapper) confirms the handler contract in isolation. The test file sets the env stubs **before** importing the client, runs migrations in a `beforeEach`, and covers the seven cases enumerated in section 9. Run `npm test -- scripts/users-actions` and confirm all tests pass before moving on.

4. **Write `scripts/users.ts`**. Shebang on line 1, file header JSDoc including the `run-plan.ts` argument-shape pin, imports, usage-string constant, `main()`, and the safety-net `.catch()` at the bottom. The dispatch switch is exhaustive: `add`, `remove`, `list`, `change-password`, and a `default` case that falls through to the usage error. Every case validates its positional-argument count before calling the handler, and the error case (wrong count) exits with code 2 and a stderr message that names the subcommand and shows the expected shape. Every happy path prints a single confirmation line to stdout: `added user "alice"`, `removed user "alice"`, the list one-per-line for `list`, and `updated password for user "alice"` for `change-password`.

5. **Make `scripts/users.ts` executable.** Run `chmod +x scripts/users.ts` in the working tree. Verify that `git diff` (or, more precisely, `git diff --summary`) reports a mode change from `100644` to `100755`. If the file was newly created in this step, the mode is captured at add time; still run `chmod +x` before `git add` to be safe. This is the single most forgettable step in the whole plan and the acceptance criteria in section 10 explicitly verify it.

6. **Add the npm script**. Edit `package.json` to add `"users": "tsx scripts/users.ts"` inside the `scripts` block. This is a minimal edit — do not reformat surrounding entries, do not re-alphabetize the whole block unless that matches existing project style, and do not add any other fields.

7. **Run the CLI end-to-end against a scratch DB**, to validate the full pipeline from shebang through argument parsing to database write and readback. The commands (run in sequence; the implementing claude captures the outputs for the commit body):
   - `rm -f data/msksim.db && npm run db:migrate` — fresh DB with the users and sessions tables.
   - `npx tsx scripts/users.ts` — prints usage to stderr, exits 2. The claude verifies the exit code with `echo $?`.
   - `npx tsx scripts/users.ts --help` — prints usage to stdout, exits 0.
   - `npx tsx scripts/users.ts add test-user test-pass` — prints `added user "test-user"`, exits 0.
   - `npx tsx scripts/users.ts add test-user test-pass` (duplicate) — prints `user "test-user" already exists` to stderr, exits 1.
   - `npx tsx scripts/users.ts list` — prints `test-user` on its own line, exits 0.
   - `npx tsx scripts/users.ts list | grep test-user` — exits 0 (the acceptance criterion in section 10).
   - `npx tsx scripts/users.ts change-password test-user new-pass` — prints `updated password for user "test-user"`, exits 0.
   - `npx tsx scripts/users.ts change-password ghost irrelevant` — prints `user "ghost" not found` to stderr, exits 1.
   - `npx tsx scripts/users.ts remove test-user` — prints `removed user "test-user"`, exits 0.
   - `npx tsx scripts/users.ts remove test-user` (again) — prints `user "test-user" not found` to stderr, exits 1.
   - `./scripts/users.ts list` (direct shebang invocation) — exits 0 and prints an empty table (the table was truncated by the remove above). If this fails because `tsx` is not on `PATH` in the current shell, the claude documents the failure in the commit body and moves on; the npm-script path remains the canonical invocation. This is not a blocker.
   - Clean up: `rm -f data/msksim.db` (the DB is gitignored but a stale file on disk would clutter subsequent steps).

8. **Run `npm test`** (the full suite). The new `scripts/users-actions.test.ts` file must pass, and all previous steps' tests (00, 01, 02, 03, 04) must still pass with no regressions. Run `npm run typecheck` and `npm run lint` — both must exit 0. If anything fails, fix and repeat from the relevant sub-step, do not paper over with eslint disables.

9. **Commit**. One commit, subject line exactly as in section 12.

Two subtle points worth stating in prose:

- The `server-only` guard. `scripts/users-actions.ts` has `import 'server-only'` on line 1. `scripts/users.ts` does **not** — it is a plain Node entrypoint and nothing in the Next bundler world ever sees it. The transitive import is safe under `tsx` because `server-only` is a client-bundle guard (section 4 source 2). A future agent who tries to "clean up" the `import 'server-only'` on `users-actions.ts` because "it's a script, not a Next module" is wrong and must be corrected: the guard is there because `users-actions.ts` could, in principle, be imported from anywhere in the repo (e.g., by a Server Action that wanted to reuse a handler), and the guard prevents that reuse from accidentally leaking the drizzle client into a client bundle. Leave it.

- The cascade. `removeUser` deletes only from the `users` table. The `sessions` table has `user_id text not null references users(id) on delete cascade` from step 04, so SQLite auto-deletes the matching sessions rows **if** `PRAGMA foreign_keys = ON` is set. Step 02 establishes that pragma in `lib/db/client.ts` and step 04's CLAUDE.md addendum pins it. If a future change accidentally turns the pragma off, this step's "remove cascades sessions" test in section 9 would silently start passing-without-cascading (the `removeUser` call would succeed, but orphan session rows would remain). The test in section 9 case 6 verifies the cascade explicitly: it inserts a session row, runs `removeUser`, and asserts the session count dropped to zero. If that assertion regresses, the fix is in `lib/db/client.ts`, not here.

## 8. Library choices

- **`node:util.parseArgs`** from the Node standard library. No version pin, no install, no package.json entry. See section 4 source 4 for the API and section 4 source 6 for the rejection of every CLI framework.
- **`tsx`** (already a dev dependency from step 00). The CLI is executed via `tsx scripts/users.ts`, either through the npm script (`npm run users -- …`), `npx tsx`, or the shebang. No version change.
- **`drizzle-orm`** and **`better-sqlite3`** (already dependencies from step 02). Imported transitively through `@/lib/db/client` and `@/db/schema`. No version change.
- **`@node-rs/argon2`** (already a dependency from step 03). Imported transitively through `@/lib/auth/password`. No version change.

**No new package.json entries.** Zero dependency delta. This is a deliberate goal of the step; see section 4 source 6.

## 9. Unit tests

All live in `scripts/users-actions.test.ts`. Each test starts from a freshly-migrated in-memory SQLite client per the step-02 pattern (`MSKSIM_DB_PATH = ':memory:'` set before the first import of `@/lib/db/client`; drizzle migrations applied in `beforeEach`; `users` and `sessions` tables truncated between cases). Every assertion uses the real `hashPassword` and `verifyPassword` — there is no mocking of argon2, because the whole point of this step is to prove the CLI produces real rows that will verify against the step-07 login Server Action.

1. **`addUser` inserts a row with a correctly formatted password hash.** Call `await addUser('alice', 'correct horse', db)`. Query `db.select().from(users).where(eq(users.username, 'alice'))` and expect exactly one row. Assert `row.username === 'alice'`. Assert `row.passwordHash` matches the regex `/^\$argon2(id|i|d)\$/` (same regex as step 03's password test). Assert `row.id` is a non-empty string (proving the step-03 `$defaultFn(() => crypto.randomUUID())` fired). Assert `row.createdAt` is a `Date` within ~2 seconds of "now". This is the happy-path insert test and it is the single assertion that proves the full chain _argument → hashPassword → drizzle insert → row_ works end-to-end.

2. **`addUser` with a duplicate username throws `UserAlreadyExistsError` with a clear message.** Call `addUser('alice', 'foo', db)` successfully, then call `addUser('alice', 'bar', db)` and `expect(...).rejects.toThrow(UserAlreadyExistsError)`. Further assert the thrown error's `.message` contains the substring `'alice'` and the word `'exists'`, so a human reading the CLI's stderr can immediately identify the problem user. Also assert that after the failed call, the database still contains exactly one row for `alice` and its `passwordHash` is unchanged (proving the second call did **not** partially update anything).

3. **`listUsers` returns an array of usernames, sorted alphabetically, and does not leak hashes.** Insert three users via `addUser`: `'charlie'`, `'alice'`, `'bob'` in that non-alphabetical order. Call `const out = await listUsers(db)`. Assert `out` is an array of exactly three strings, deep-equal to `['alice', 'bob', 'charlie']`. Assert none of the returned strings contains the substring `'$argon2'` (the hash-leak guard). Call `listUsers(db)` again immediately and assert it returns the same array — no hidden per-call state.

4. **`removeUser` deletes the row and returns without throwing.** Insert a user, call `removeUser('alice', db)`, query `users` and assert the row is gone. Also assert `(await listUsers(db)).length === 0` as a belt-and-suspenders check.

5. **`removeUser` of a nonexistent user throws `UserNotFoundError` with a clear message.** On an empty `users` table, `expect(() => removeUser('ghost', db)).rejects.toThrow(UserNotFoundError)`. Assert `.message` contains `'ghost'` and the word `'not found'`.

6. **`changePassword` updates the hash, the new hash verifies against the new password, and the old hash does not.** Insert `alice` with password `old-pass` via `addUser`. Capture the row's `passwordHash` as `oldHash`. Call `await changePassword('alice', 'new-pass', db)`. Re-query the row; capture `newHash`. Assert `newHash !== oldHash`. Assert `await verifyPassword('new-pass', newHash) === true`. Assert `await verifyPassword('old-pass', newHash) === false`. This is the test that proves the whole point of the `change-password` subcommand.

7. **`changePassword` on a nonexistent user throws `UserNotFoundError`.** On an empty `users` table, `expect(() => changePassword('ghost', 'whatever', db)).rejects.toThrow(UserNotFoundError)`. Assert `.message` contains `'ghost'`.

**Cascade test (stretch, strongly recommended):** insert a user, insert a session row for that user directly via drizzle (using `sessions` from step 04 and a hand-rolled token like `'t'.repeat(64)`), then call `removeUser(username, db)`, then query `sessions` and assert zero rows remain. This pins the "remove cascades to sessions" invariant that step 04 promised and section 7 point 7 of this plan relies on. If `PRAGMA foreign_keys = ON` is not enabled on the test connection, this test fails; the fix is in `lib/db/client.ts`, not here. Mark it as case 8 in the test file so a failure report is unambiguous.

No component tests, no DOM environment, no child-process spawns. All tests run under the default Vitest `node` environment and each case finishes in a handful of milliseconds (the argon2 hashing is the dominant cost).

## 10. Acceptance criteria

The step is complete when **all** of the following are observably true on a clean worktree after running the step:

- `npm test -- scripts/users-actions` exits 0 with all seven required cases (plus the stretch cascade case if included) passing.
- `npm test` (the full suite) exits 0 with no regressions in steps 00/01/02/03/04.
- `npm run typecheck` exits 0. In particular, the handler signatures in `scripts/users-actions.ts` must typecheck cleanly against the inferred types from `users` (step 03's `typeof users.$inferInsert`).
- `npm run lint` exits 0 on `scripts/users.ts` and `scripts/users-actions.ts`.
- **End-to-end CLI smoke**:
  - `rm -f data/msksim.db && npm run db:migrate && npx tsx scripts/users.ts add test-user test-pass && npx tsx scripts/users.ts list | grep test-user && npx tsx scripts/users.ts remove test-user` exits 0 overall and prints expected confirmation lines at each step.
  - `npx tsx scripts/users.ts` (no arguments) prints the usage string to stderr and exits **2**. Verified with `npx tsx scripts/users.ts; echo $?` → `2`.
  - `npx tsx scripts/users.ts --help` prints the usage string to stdout and exits **0**.
  - `npx tsx scripts/users.ts add test-user test-pass` run twice in succession exits **0** the first time and **1** the second time (duplicate). The second invocation prints an error to stderr that names `test-user`.
  - `npx tsx scripts/users.ts remove ghost` (nonexistent user) exits **1** and prints `user "ghost" not found` to stderr.
  - `npx tsx scripts/users.ts change-password ghost x` exits **1**.
- **Executable bit**: `git ls-files --stage scripts/users.ts | awk '{print $1}'` prints `100755`. Running `stat -c '%a' scripts/users.ts` on Linux prints `755`. The file has the shebang `#!/usr/bin/env tsx` on line 1, verified by `head -n 1 scripts/users.ts`.
- **No new dependencies**: `git diff HEAD~1 package.json` shows only the `users` script entry, no `dependencies` or `devDependencies` changes.
- **CLAUDE.md growth** is ≤ 3 lines total across all sections, well under the per-step 100-line cap (see section 11).
- **Argument-shape compatibility with `run-plan.ts`**: the implementing claude visually inspects `scripts/run-plan.ts` `ensureSeedUser()` (lines 662–684) and confirms that `scripts/users.ts add <user> <pass>` and `scripts/users.ts change-password <user> <pass>` are both still honored. If that function has drifted since this plan was written, the plan's argument shape is the authority — change `run-plan.ts` in a separate commit if needed, do not touch it in this step's commit.

## 11. CLAUDE.md updates

Touch **only** the "Directory layout" section. Append nothing new; instead, verify the pre-existing line about `scripts/users.ts` still accurately describes the shipped file. The current line (from step 00's Directory layout entry) reads:

> `scripts/` — CLI tools (`run-plan.ts` already present; `users.ts` added in step 05; `migrate.ts` added in step 02)

After this step, that line is still correct — the file exists, it was added in step 05. **No edit is required.** The implementing claude confirms the line is present and matches the shipped file's location, and if it does, reports "CLAUDE.md Directory layout already accurate; no edit" in the commit body. If for some reason the line is absent (e.g., step 00 landed differently than planned), the implementing claude adds it back at the existing position, with a total line delta of ≤ 3.

**No other CLAUDE.md sections are touched.** The "Authentication patterns" section was populated by steps 03 and 04 and needs nothing from this step (the CLI does not establish a new pattern — it is a thin consumer of the patterns already established). The "Known gotchas" section also needs nothing from this step. The `import 'server-only'` and "PRAGMA foreign_keys = ON" gotchas are already documented.

Total CLAUDE.md growth: **0–3 lines**, well under the section cap and the 100-lines-per-step pipeline guard (`scripts/run-plan.ts` line 572).

## 12. Commit message

Exactly:

```
step 05: cli user management
```

No conventional-commit prefix, no emoji, no trailing period. The `step NN:` marker is load-bearing for `scripts/run-plan.ts` progress detection (CLAUDE.md "Commit-message convention"; `scripts/run-plan.ts` lines 42 and 241–255). One commit for the whole step; if intermediate commits slip in during execution they will be squashed by the orchestrator before advancing (`scripts/run-plan.ts` lines 510–545).

The commit body (optional but encouraged) lists: the three new files, the one-line `package.json` edit, the chmod +x application, the test results (`npm test -- scripts/users-actions` pass count), and the end-to-end smoke log from section 7 step 7. Do **not** include the `step 05` marker twice (subject is enough), do **not** include a `Co-Authored-By` trailer unless the orchestrator adds one explicitly.

## 13. Rollback notes

If this step lands in a broken state and needs to be undone:

1. `git log --oneline` and find the commit immediately prior (the step 04 commit, subject matching `step 04:`).
2. `git reset --hard <step-04-sha>`. This single operation removes `scripts/users.ts`, `scripts/users-actions.ts`, `scripts/users-actions.test.ts`, the `package.json` `users` script entry, and any CLAUDE.md touch (if one was made) in one move. Because this step adds **no new dependencies**, there is nothing to `npm uninstall` — the `git reset` is sufficient.
3. Optional: delete any stale `data/msksim.db` created by the section-7 smoke run. The file is gitignored, so the reset does not remove it; `rm -f data/msksim.db` cleans it up. Leaving it behind is harmless but clutters the working tree.
4. Verify with `npm test` that the earlier steps' suites still pass on the rolled-back tree. `scripts/run-plan.ts`'s `ensureSeedUser()` function will see `scripts/users.ts` missing and log "scripts/users.ts not present yet; skipping seed-user creation" — this is its intended graceful-degradation path (see `scripts/run-plan.ts` lines 664–668), so the rollback does not break any later wave that has not yet run.
5. After the rollback, re-running the step from a clean base is safe: `npx tsx scripts/run-plan.ts --only 05` (with `--force` if the orchestrator sees the prior step-05 commit in any remaining branch history).

There are no database schema changes to revert, no migrations to drop, no dependencies to uninstall, and no CLAUDE.md appends to trim. The rollback footprint for this step is deliberately minimal — another consequence of the "simple" directive from CLAUDE.md "Stack and versions".
