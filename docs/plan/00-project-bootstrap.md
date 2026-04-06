---
step: '00'
title: 'project bootstrap'
kind: foundation
ui: false
timeout_minutes: 20
prerequisites: []
---

## 1. Goal

Turn the pristine `create-next-app` scaffold into a project that every later step can build on: a minimal temporary home page (instead of the default Next.js marketing splash), Vitest wired up with both `node` and `happy-dom` environments, the `@/` path alias resolving in both TypeScript and Vitest, the ESLint flat config verified as Next-16-correct, a Node version guard for the `≥ 20.9` requirement imposed by native modules in later steps, fresh `next typegen` output, and the empty directory skeleton documented in CLAUDE.md's "Directory layout" section. No runtime libraries are installed here — drizzle, argon2, Zod, recharts, sigma, graphology, Comlink, and pure-rand all belong to their respective later steps. The step ends with a single commit that leaves the working tree green (`lint`, `typecheck`, and `test` all pass) so step 01 can begin from a known-good baseline.

## 2. Prerequisites

- None (first step).

## 3. Spec references

- `docs/spec.md` §8 "Architecture Sketch" — mentions that config and metric schemas are defined once and reused across UI, worker, persistence, and export; step 00 creates the empty `lib/schema/` directory that step 01 will populate.
- `docs/spec.md` "Target stack" line in the header — confirms the expected stack (Next.js 16 + React 19 + TypeScript 5 + Tailwind 4), which matches the current `package.json` and sets the Node ≥ 20.9 requirement asserted in this step.
- Step 00 is foundation-only and implements no features from §4 "Features"; feature work begins in later steps.

## 4. Research notes

- `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md § Node.js runtime and browser support` — authoritative statement that Next 16 requires Node ≥ 20.9.0 and TypeScript ≥ 5.1.0; drives the `scripts/check-node-version.ts` implementation and the `typecheck` script.
- `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md § next lint Command` — explicit note that `next lint` is removed in v16 and that `next build` no longer runs linting. Confirms that the existing `"lint": "eslint"` script in `package.json` is correct and that no migration is needed beyond verifying `eslint.config.mjs` exists.
- `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md § ESLint Flat Config` — `@next/eslint-plugin-next` now defaults to flat config, aligning with ESLint v10 which will drop legacy support. The current `eslint.config.mjs` already imports `eslint-config-next/core-web-vitals` and `eslint-config-next/typescript`, which is the flat-config entrypoint.
- `node_modules/next/dist/docs/01-app/03-api-reference/06-cli/next.md § next typegen options` — `next typegen` generates `PageProps<...>`, `LayoutProps<...>`, and `RouteContext<...>` helpers into `<distDir>/types`. The doc explicitly calls out the CI flow `next typegen && tsc --noEmit`, which this step's `typecheck` script mirrors. Output lands in `.next/types` (already covered by `/.next/` in `.gitignore`).
- `node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md § Manual Setup` — the official Next 16 guide for wiring Vitest. Note: the doc recommends `@vitejs/plugin-react` + `jsdom` + `@testing-library/react`. This step **does not install React testing libraries** (they belong to the first UI step, step 07) but it does install `vite-tsconfig-paths` from the same doc for the `@/` alias.
- https://vitest.dev/guide/ (fetched) — Vitest requires Node ≥ 20.0.0 and Vite ≥ 6.0.0; recommended to install as a devDependency; config goes in `vitest.config.ts` with a default export from `defineConfig({ test: { ... } })`. Default test environment is `node`; `happy-dom`, `jsdom`, and `edge-runtime` are available as opt-ins.
- https://vitest.dev/guide/environment.html (fetched) — per-file environment override is via the docblock comment `// @vitest-environment happy-dom` at the top of a test file. Four built-in environments (`node`, `jsdom`, `happy-dom`, `edge-runtime`). The `environmentMatchGlobs` option has been removed from recent Vitest versions in favor of the docblock comment and per-project config; **this step uses file-name suffix (`*.dom.test.ts`) plus the docblock comment as the opt-in convention** and notes that inside `vitest.config.ts` the per-project `test.environment` default stays `node`.
- **Path not taken — Jest instead of Vitest.** Jest has larger community reach but requires Babel transforms for TypeScript and struggles with ESM-only packages that later steps will pull in (`pure-rand` is ESM-first; Comlink is ESM). Vitest uses Vite's native ESM handling, is the tool the Next 16 docs recommend alongside Jest, and its `vite-tsconfig-paths` plugin gives the `@/` alias for free without a separate `jest.config.ts` module-name-mapper block. Jest is rejected.
- **Path not taken — putting the Node version check in a `preinstall` hook.** A `preinstall` hook would run before `node_modules` is populated, which means `tsx` is not yet available to execute a TypeScript check script. Using `prestart`/`predev`/`pretest` hooks runs after install and works with either `node` (for a plain `.js` check) or `npx tsx` (for `.ts`). **Recommendation: write the check as `scripts/check-node-version.ts`, run it via `npx tsx scripts/check-node-version.ts`, and wire it as `prestart`, `predev`, and `pretest` hooks in `package.json`.** This catches both `npm run dev` and `npm test` with a clear error before any native bindings try to compile.

Total links: 8 (5 local doc citations, 2 external URLs fetched, 1 path-not-taken). Exceeds the ≥ 5 total floor.

## 5. Files to create

- `vitest.config.ts` — Vitest config with `node` as default environment, `vite-tsconfig-paths` plugin for `@/` resolution, and coverage provider set to `v8`.
- `scripts/check-node-version.ts` — standalone `tsx`-runnable script that reads `process.versions.node`, parses `major.minor`, and `process.exit(1)`s with a clear message if below `20.9`. Run via `prestart`/`predev`/`pretest` hooks.
- `tests/smoke.test.ts` — single smoke test that imports a trivial module through the `@/` alias and asserts something simple. Proves Vitest + path alias wiring works end-to-end. Keep this file permanently as a canary.
- `lib/.gitkeep`, `lib/db/.gitkeep`, `lib/auth/.gitkeep`, `lib/sim/.gitkeep`, `lib/schema/.gitkeep` — placeholder files for the server-side utility tree. Steps 01-17 replace these with real modules.
- `workers/.gitkeep` — placeholder for the Web Worker tree (populated in steps 19-20).
- `db/.gitkeep`, `db/schema/.gitkeep`, `db/migrations/.gitkeep` — placeholder for the drizzle tree (populated in step 02 onwards).
- `tests/.gitkeep` — top-level cross-cutting tests directory (colocated `*.test.ts` files live next to their source; `tests/` is for integration tests). The smoke test satisfies this initially so a separate `.gitkeep` may be unnecessary — use judgement at implementation time.

## 6. Files to modify

- `app/page.tsx` — delete the default create-next-app marketing content. Replace with a minimal server component that renders an `<h1>` with the text "msksim" and a link to `/docs/spec.md`. Add a one-line JSDoc comment noting this is a temporary placeholder until authentication and the real app shell arrive in step 07.
- `app/layout.tsx` — change `metadata.title` from `"Create Next App"` to `"msksim"` and `metadata.description` from `"Generated by create next app"` to a single sentence describing the project ("Agent-based simulation of a color-term Naming Game").
- `package.json` — add `"test": "vitest run"`, `"test:watch": "vitest"`, `"test:coverage": "vitest run --coverage"`, `"typecheck": "tsc --noEmit"`, `"predev": "npx tsx scripts/check-node-version.ts"`, `"prestart": "npx tsx scripts/check-node-version.ts"`, `"pretest": "npx tsx scripts/check-node-version.ts"` scripts. Add `vitest`, `@vitest/coverage-v8`, `happy-dom`, `vite-tsconfig-paths`, and `tsx` as `devDependencies` with the versions pinned in section 8.
- `public/` — delete `next.svg`, `vercel.svg`, `file.svg`, `window.svg`, `globe.svg`. Leave `public/` itself (the directory stays — `favicon.ico` is in `app/`, not `public/`, but the directory is still used by Next).
- `tsconfig.json` — verify the `paths: { "@/*": ["./*"] }` entry is present (it already is in the current file). No change expected; reference only.
- `.gitignore` — verify that `/.next/` already covers `.next/types`. No change expected.

## 7. Implementation approach

1. **Read the current state.** Re-read `package.json`, `tsconfig.json`, `eslint.config.mjs`, `.gitignore`, `app/page.tsx`, `app/layout.tsx`, and `ls public/` to confirm the starting point matches what this plan assumes. If anything is different (for example a previous agent already deleted some SVGs), adapt but do not scope-creep.

2. **Node version guard first.** Create `scripts/check-node-version.ts`. The script reads `process.versions.node`, splits on `.`, parses the major and minor as integers, and exits with a non-zero code and a clear error message (`msksim requires Node ≥ 20.9 (found vX.Y.Z). See the "Stack and versions" section of CLAUDE.md`) if the version is below `20.9`. Install `tsx` as a devDependency at this point so the script is runnable. Add the `predev`, `prestart`, and `pretest` hooks to `package.json` per section 6.

3. **Page and metadata cleanup.** Rewrite `app/page.tsx` as a minimal server component (no `"use client"`, no `next/image`) with a `<main>` containing an `<h1>"msksim"</h1>` and a paragraph linking to `/docs/spec.md`. Strip the Tailwind flex classes down to a small readable layout — no need to preserve the dark-mode splash styling. The page is temporary; step 07 replaces it with the authenticated app shell. Update `app/layout.tsx`'s `metadata.title` and `metadata.description`.

4. **Delete the starter SVGs.** Remove `public/next.svg`, `public/vercel.svg`, `public/file.svg`, `public/window.svg`, `public/globe.svg`. The new `app/page.tsx` no longer references them, so nothing should break.

5. **ESLint flat config verification.** Inspect `eslint.config.mjs`. The current file already uses `defineConfig` from `eslint/config` and imports `eslint-config-next/core-web-vitals` and `eslint-config-next/typescript`. This **is** the Next 16 flat-config entrypoint; no migration is needed. Run `npm run lint` and confirm it exits 0. If linting fails for a reason introduced by other step-00 changes, fix those changes — do not modify `eslint.config.mjs` unless there's a concrete Next 16 delta it's missing.

6. **Install Vitest and friends.** `npm install -D vitest@4.1.2 @vitest/coverage-v8@4.1.2 happy-dom@20.8.9 vite-tsconfig-paths@6.1.1 tsx@<latest>`. Use `--save-dev` / `-D`. Do **not** install `@vitejs/plugin-react` or any React testing libraries — they belong to step 07 when real component tests land.

7. **Write `vitest.config.ts`.** Use `defineConfig` from `vitest/config`. Set `plugins: [tsconfigPaths()]` so `@/` resolves from `tsconfig.json`. Set `test.environment = "node"` as the default. The per-file `happy-dom` opt-in is via the `// @vitest-environment happy-dom` docblock comment (per the fetched Vitest environment guide). Set `test.coverage.provider = "v8"` and `test.coverage.reporter = ["text", "html"]`. Do not set `environmentMatchGlobs` — recent Vitest versions prefer the docblock approach, and using the docblock keeps test-file conventions simple.

8. **Add the test/typecheck scripts to `package.json`.** `test` → `vitest run`, `test:watch` → `vitest`, `test:coverage` → `vitest run --coverage`, `typecheck` → `tsc --noEmit`. Order them logically near the existing `lint` script.

9. **Write the smoke test.** Create a tiny module at `lib/smoke.ts` (or similar — pick a location that survives the directory skeleton; `lib/` is created in step 00 anyway) with a single exported function that returns a constant, for example `export function greet(): string { return "hello"; }`. Then write `tests/smoke.test.ts` that imports `greet` via `@/lib/smoke` and asserts the return value. This proves (a) Vitest runs, (b) TypeScript compiles through Vitest, and (c) the `@/` alias resolves through `vite-tsconfig-paths`. The smoke test is kept permanently as a canary.

10. **Create the empty directory skeleton.** Per CLAUDE.md section "Directory layout": create `lib/db/`, `lib/auth/`, `lib/sim/`, `lib/schema/`, `workers/`, `db/`, `db/schema/`, `db/migrations/`, and `tests/` (if not already present from step 9). Use `.gitkeep` files to make empty directories committable. If `lib/smoke.ts` was created under `lib/` directly then `lib/` does not also need a `.gitkeep`.

11. **Run `npx next typegen`.** This generates `.next/types/` with `PageProps`, `LayoutProps`, `RouteContext` helpers. These types are referenced in `tsconfig.json`'s `include` (`.next/types/**/*.ts`, `.next/dev/types/**/*.ts`) so `typecheck` can see them. The output directory is already gitignored via `/.next/`.

12. **Run the green-bar sequence.** In this order: `npm run lint`, `npm run typecheck`, `npm test`. All three must exit 0 before committing. If any fails, diagnose and fix within the scope of this step — do not defer failures to later steps.

13. **Update CLAUDE.md per section 11 of this plan.** Append the listed content to the "Directory layout" and "Testing conventions" sections of `CLAUDE.md`, respecting the ≤ 30-lines-per-section-per-commit cap stated in CLAUDE.md's "Living-document rules".

14. **Commit.** Single commit with subject exactly `step 00: project bootstrap`. Include `package.json`, `package-lock.json`, `vitest.config.ts`, `scripts/check-node-version.ts`, the rewritten `app/page.tsx` and `app/layout.tsx`, the deletions under `public/`, the new directory skeleton (`.gitkeep` files), the smoke test and module, and the CLAUDE.md updates. Do not commit `.next/` — it is gitignored.

## 8. Library choices

Versions verified against the npm registry on 2026-04-05.

- `vitest@4.1.2` — test runner. Chosen over Jest for native ESM handling and the `vite-tsconfig-paths` integration (see "path not taken" in section 4). Requires Node ≥ 20.0.0, which we already enforce at ≥ 20.9.
- `@vitest/coverage-v8@4.1.2` — V8-based coverage provider. Required as a peer for `vitest run --coverage`. Version kept in lockstep with `vitest` per Vitest's release policy.
- `happy-dom@20.8.9` — DOM implementation for component tests. Chosen over `jsdom` because it is significantly faster and is already the de-facto default alongside Vitest in the TypeScript ecosystem; performance matters when the test suite grows to include the simulation smoke tests in step 18. Note: the Next 16 Vitest guide recommends `jsdom`, but we deviate deliberately — the deviation is documented here so later steps know why.
- `vite-tsconfig-paths@6.1.1` — plugin that teaches Vite (and therefore Vitest) to read `paths` from `tsconfig.json`. This is how the `@/` alias resolves in tests without duplicating the alias in `vitest.config.ts`.
- `tsx@<latest>` — TypeScript-aware Node runner, used by `scripts/check-node-version.ts` and (in later steps) `scripts/migrate.ts`, `scripts/users.ts`, and `scripts/run-plan.ts`. Pin to the current stable at implementation time.

No other runtime or test-time packages are installed in this step.

## 9. Unit tests

A single smoke test at `tests/smoke.test.ts` that:

1. Imports a trivial helper (e.g. `greet`) from `@/lib/smoke` via the `@/` alias.
2. Asserts the helper returns the expected constant string.

This one test is sufficient as an end-to-end proof that: (a) Vitest itself runs, (b) `vite-tsconfig-paths` resolves `@/` correctly, (c) TypeScript compiles through Vitest's transformer, and (d) the `node` default environment is picked up (no docblock needed). A failure in any of the four layers fails this test. The test stays in the repository permanently as a canary — step 01 and later steps must not delete it.

## 10. Acceptance criteria

- `node --version` exits 0 and prints `v20.9.*` or newer. `scripts/check-node-version.ts` exits 0 when run directly via `npx tsx scripts/check-node-version.ts`.
- `npm run lint` exits 0 with no errors.
- `npm run typecheck` exits 0 with no errors.
- `npm test` exits 0 and reports `1 passed` (the smoke test).
- `npx next typegen` exits 0 and produces `.next/types/` (or `.next/dev/types/` depending on phase).
- `ls app/page.tsx` shows a file whose content is a small placeholder server component — `grep -l "Create Next App" app/` returns nothing and `grep -l "msksim" app/page.tsx` matches.
- `ls public/` does not contain `next.svg`, `vercel.svg`, `file.svg`, `window.svg`, or `globe.svg`.
- `grep "Create Next App" app/layout.tsx` returns nothing; `grep "msksim" app/layout.tsx` matches.
- The following directories exist (with `.gitkeep` files where empty): `lib/`, `lib/db/`, `lib/auth/`, `lib/sim/`, `lib/schema/`, `workers/`, `db/`, `db/schema/`, `db/migrations/`, `tests/`.
- `git log -1 --pretty=%s` prints exactly `step 00: project bootstrap`.
- `.next/` remains gitignored (`git status --short | grep ".next"` returns nothing tracked).
- No UI verification (MCP script). Step 00 is `ui: false`.

## 11. CLAUDE.md updates

Step 00 populates two CLAUDE.md sections. Total appended lines across both sections: ≤ 25, well under the 30-line-per-section and 100-line-per-step caps documented in the "Living-document rules" section of CLAUDE.md.

**Append to the "Directory layout" section** (below the existing bullet list, preserving depth-first order). Approximately 10 lines:

```
- `vitest.config.ts` — Vitest root config (established step 00)
- `scripts/check-node-version.ts` — Node ≥ 20.9 guard (established step 00)
- `tests/smoke.test.ts` — Vitest + `@/` alias canary (established step 00); must not be deleted
```

**Append to the "Testing conventions" section** (below the existing bullets established in step 00). Approximately 8 lines:

```
- `tests/smoke.test.ts` is the alias/config canary. If it fails, the test harness itself is broken — fix the harness before diagnosing the failing feature.
- `scripts/check-node-version.ts` runs via the `predev`/`prestart`/`pretest` hooks. Bypass only with `npm run <script> --ignore-scripts`, and document why in the commit message.
- The `test:coverage` script uses `@vitest/coverage-v8`. Keep `vitest` and `@vitest/coverage-v8` pinned to the same version; Vitest releases them in lockstep.
```

The implementing agent must respect the order in CLAUDE.md's "Living-document rules" section: these appends happen as part of the single step-00 commit, not as a separate edit.

## 12. Commit message

`step 00: project bootstrap`

## 13. Rollback notes

`git reset --hard HEAD~1` undoes the commit. `rm -rf node_modules .next && npm install` refreshes the dependency tree back to the pre-step-00 state (only the listed devDependencies were added; no runtime dependencies changed). The five deleted SVGs and the original `app/page.tsx` content are restored by the git reset.
