---
step: '01'
title: 'zod config schema'
kind: foundation
ui: false
timeout_minutes: 20
prerequisites:
  - 'step 00: project bootstrap'
---

## 1. Goal

Establish a single, authoritative Zod schema set that describes every knob in the `msksim` simulation, so that later steps (drizzle column derivation in step 08, the Web Worker RPC boundary in step 20, the config editor UI in step 25, export/import in step 25, and hypothesis presets in step 31) all parse, validate, and serialize configs through one module. The schemas must ship with sensible defaults that match the canonical 3:2 monolingual:bilingual setup from the source PDF, so that `ExperimentConfig.parse({})` alone produces a runnable simulation. Derived TypeScript types (`z.infer<typeof ...>`) are the only way the rest of the codebase references config shapes — no hand-written mirror interfaces — guaranteeing that a schema change propagates everywhere at compile time.

## 2. Prerequisites

- Commit marker `step 00: project bootstrap` present in `git log`. Step 00 installs Vitest, establishes the `vitest.config.ts`, enforces Node ≥ 20.9, adopts the flat ESLint config, and creates the `lib/schema/` directory skeleton (empty). Step 01 fills that directory.
- Node ≥ 20.9 (enforced by step 00; required for Next 16 and native modules downstream).
- `@/` TypeScript path alias wired in `tsconfig.json` (also step 00).

## 3. Spec references

The schemas must cover every data-model field and configurable rule called out in `docs/spec.md`. Concretely:

- `docs/spec.md` §3.1 Worlds — the four `AgentClass` values (`W1-Mono`, `W1-Bi`, `W2-Native`, `W2-Immigrant`) and the two-world structure.
- `docs/spec.md` §3.2 Agent state — fields the schema must be capable of seeding: `class`, `position`, `inventory` (per-language, per-referent token weights), and the `(speaker.class, hearer.class)` axis used by `speakerLanguagePolicy`.
- `docs/spec.md` §3.3 Interaction rules — Δ⁺ on success, optional Δ⁻ on failure, the retry-limit for "find another peer," the scheduler modes (sequential / random / priority), and the four concrete PDF-stated language policy rules.
- `docs/spec.md` §3.4 Initial conditions — the 3:2 monolingual:bilingual default, per-class vocabulary seeding, and the fact that the specific lexemes (`yellow`, `red`, `jaune`, `rouge`) are defaults and must be user-configurable.
- `docs/spec.md` §3.5 — the "opaque `(language, lexeme)` pair" decision: `Language` and `Referent` are opaque strings, not enums. Weight update defaults to additive with an optional L1-normalized alternative. Number of referents is configurable (default 2).
- `docs/spec.md` §4.1 F1 (World construction) — agent count, mono:bi ratio, lattice dimensions, `NeighborhoodType` (`moore` / `von-neumann`).
- `docs/spec.md` §4.1 F2 (Agent vocabulary bootstrapping) — referent × language matrix is user-editable.
- `docs/spec.md` §4.1 F3 (Interaction engine) — Δ⁺, Δ⁻, retry limit, scheduler, weight-update rule are all pluggable.
- `docs/spec.md` §4.1 F4 (Spatial mode selector) — three topology types: `lattice`, `well-mixed`, `network`. This is the discriminated union.
- `docs/spec.md` §4.1 F5 (Language-selection policy) — the four PDF-stated default rules and a registry for alternatives; policies are referenced by identifier, not by function closure (see §3 "deterministic-serializable" below).
- `docs/spec.md` §4.1 F6 (Preferential attachment) — warm-up length, similarity metric (softmax over cosine similarity), temperature, ablation toggle.
- `docs/spec.md` §4.3 F11 (Experiment configuration UI) — the saved-config JSON shape; schemas back form generation and validation.
- `docs/spec.md` §4.3 F12 (Batch queue) — replicate count, auto-incremented seeds, concurrency cap.
- `docs/spec.md` §4.3 F13 (Parameter sweep) — parameter path strings plus per-parameter value grids for the cartesian product.
- `docs/spec.md` §7.2 Per-tick tensor snapshots — `sampleInterval` for snapshot cadence.
- `docs/spec.md` §11 Open Questions — documents that weight-update rule, number of referents, and mobility are configurable; the schema makes each of these choices traceable by exposing them as fields with explicit defaults.

## 4. Research notes

Local Next.js 16 docs (authoritative per `CLAUDE.md` "Next.js 16 deltas from training data" and `AGENTS.md`):

- `node_modules/next/dist/docs/01-app/02-guides/forms.md` §"Form validation" — the Next 16 docs explicitly recommend Zod for server-side validation of Server Action inputs (`schema.safeParse(...)` pattern). This is load-bearing for step 25 (Experiment Config UI), which will pass the same schemas from `lib/schema/` into both its React form and its Server Action handler. Reusing one schema across the two call sites is the Next-recommended path.
- `node_modules/next/dist/docs/01-app/02-guides/authentication.md` §"Validate form fields on the server" — shows the canonical pattern of defining a `SignupFormSchema` in `app/lib/definitions.ts` and importing it from both the client form and the `'use server'` action. Mirrors how `lib/schema/config.ts` will be imported by the step-25 form and by any Server Action that persists configs via the drizzle client.
- `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md` §"Preventing environment poisoning" — explains that modules can be shared between Server and Client Components and that `import 'server-only'` is the guard for code that must not cross the client boundary. The Zod schemas in step 01 are _deliberately_ client-safe: Zod has no Node built-ins and no native modules, so `lib/schema/` is one of the few `lib/` modules that does **not** start with `import 'server-only'`. This is the inverse of `lib/db/` and `lib/auth/`.
- `node_modules/next/dist/docs/01-app/02-guides/data-security.md` §"Using a Data Access Layer for mutations" — reinforces that Server Action arguments should be validated at the DAL boundary. Step 08 will use these schemas as the validation step before drizzle writes hit `configs` and `runs` tables.
- `node_modules/next/dist/docs/01-app/03-api-reference/08-turbopack.md` §"Magic Comments" — confirms that Turbopack supports `new Worker(new URL(...))` expressions, which is the channel through which step 20 will send a `ExperimentConfig` payload into the simulation worker. The schemas must be deterministic-serializable (no functions) for that postMessage boundary to work.

External references (WebFetched):

- `https://zod.dev/` — confirmed that **Zod 4 is the current stable release** ("💎 Zod 4 is now stable!" banner) as of the research date. Zod 4 is TypeScript-first, requires TS strict mode, supports `z.infer<typeof Schema>` for type extraction, and ships "Built-in JSON Schema conversion" which is a nice-to-have for the step-25 form generator but not required by this step.
- `https://zod.dev/api` — confirmed the `z.discriminatedUnion("discriminator", [variant1, variant2, ...])` API and its narrowing behavior: once parsed, TypeScript narrows the type based on the literal discriminator field. Also confirmed that `.default(value)` short-circuits parsing when the input is `undefined`, so `ExperimentConfig.parse({})` will correctly fill every field with its default. This is exactly the substrate required to make `TopologyConfig` an `{ type: "lattice" | "well-mixed" | "network", ... }` tagged union with per-variant fields.

Paths not taken:

- **Valibot** (`https://valibot.dev/`) was evaluated. It ships smaller runtime bundles via tree-shaking and has a similar discriminated-union API. It was rejected because (a) `CLAUDE.md` "Stack and versions" already names Zod as the project standard for "UI forms, Server Actions, workers, and database column derivations," (b) Next 16's own docs (`forms.md`, `authentication.md`) use Zod in every example, making Zod the path of least friction for step 25's `useActionState` error surfacing, and (c) the marginal bundle savings are irrelevant for an authenticated research tool not optimized for public-page TTFB.
- **ArkType** was considered for its runtime-identical type syntax but rejected for the same "ecosystem gravity" reason and because its discriminated-union ergonomics are less documented than Zod's.
- **Hand-written TypeScript interfaces + a custom validator** was considered and rejected: it would duplicate every field in two places (interface + runtime check) and silently drift. `z.infer` keeps runtime and compile-time types locked.

## 5. Files to create

- `lib/schema/config.ts` — the root module that re-exports every public schema. Imports from the sibling files below and composes the top-level `ExperimentConfig` and `BatchConfig` schemas. **No `import 'server-only'`** — this module is deliberately shared between server, client, and worker contexts.
- `lib/schema/primitives.ts` — the leaf schemas: `AgentClass` (the four-valued `z.enum`), `Language` (branded opaque `z.string().min(1)`), `Referent` (same shape), `TokenLexeme` (same shape), `Token` (object of `{ language, lexeme }`), `Weight` (`z.number().nonnegative()`), and the `WeightUpdateRule` enum (`additive | l1-normalized`).
- `lib/schema/topology.ts` — `NeighborhoodType` enum (`moore | von-neumann`), and `TopologyConfig` as a `z.discriminatedUnion("type", [...])` with three variants: `lattice` (width, height, neighborhood), `well-mixed` (no extra fields beyond the tag), and `network` (placeholder fields for v2 per `docs/spec.md` §2: `kind`, `parameters`).
- `lib/schema/policy.ts` — `LanguagePolicyRuleId` (`z.enum([...])`) listing the four default policy identifiers (`"w1bi-to-w1mono-always-l1"`, `"w1bi-to-w1bi-configurable"`, `"w2imm-to-w2native-both"`, `"w2imm-to-w2imm-both"`) plus the "bias between languages" variant identifiers. `LanguagePolicyEntry` = `{ speakerClass, hearerClass, ruleId, languageBias? }`. `LanguagePolicySet` is the array of entries covering all `(speakerClass, hearerClass)` pairs. Policies are referenced by identifier only — never by function closure — so that configs are JSON-serializable.
- `lib/schema/world.ts` — `VocabularySeed` (nested record: `AgentClass` → `Language` → `Referent` → array of `{ lexeme, initialWeight }`) and `WorldConfig` (`agentCount`, `monolingualBilingualRatio`, `topology`, `referents`, `vocabularySeed`).
- `lib/schema/preferential.ts` — `PreferentialAttachmentConfig` (`enabled`, `warmUpTicks`, `temperature`, `similarityMetric` = `cosine` for v1).
- `lib/schema/experiment.ts` — `SchedulerMode` enum (`sequential | random | priority`), `ExperimentConfig` (world1, world2, tickCount, deltaPositive, deltaNegative, retryLimit, weightUpdateRule, schedulerMode, languagePolicies, preferentialAttachment, seed, sampleInterval).
- `lib/schema/batch.ts` — `BatchConfig` (replicateCount, seeds auto-derived from a base seed + replicate index if not explicitly supplied, concurrency) and `SweepConfig` (list of `{ paramPath: string, values: unknown[] }` entries for step 28's cartesian product generator).
- `lib/schema/defaults.ts` — all canonical defaults as plain exported constants (`defaultWorldConfig`, `defaultExperimentConfig`, `defaultLanguagePolicies`, etc.), the single source that the `.default(...)` calls in the schema files point at. Extracting defaults from the schemas themselves keeps the origin of each numeric traceable back to the spec sections they come from (via `// per docs/spec.md §X` comments).
- `lib/schema/config.test.ts` — Vitest suite covering the assertions in section 9 below.

Subdividing into per-concept files is a judgment call: one monolithic `config.ts` would be ~400 lines and harder to review. Splitting along the boundaries the spec itself draws (topology, policy, world, experiment, batch) keeps each file short and lets the test file import only what it's exercising.

## 6. Files to modify

- `package.json` — add `zod` to `dependencies` (not `devDependencies`, because it will be imported at runtime from Server Actions and Web Workers alike). Pin to the latest stable Zod 4.x that `npm view zod version` returns at the time of execution. The agent must verify on npm rather than hard-coding a version here.

No other files are modified. `CLAUDE.md` is not touched in this step except possibly a one-line "Known gotchas" entry (see section 11).

## 7. Implementation approach

1. **Install Zod.** Run `npm install zod@latest` and record the resolved version in `package.json`. Confirm it is Zod 4.x; if npm's latest has regressed to a 3.x line (unlikely), install `zod@^4`. Do **not** install `zod-form-data` — step 25 can pull that in later if it needs it.
2. **Start with leaves.** Write `lib/schema/primitives.ts` first. `Language`, `Referent`, and `TokenLexeme` are all `z.string().min(1)` with brand types so the type system distinguishes a `Language` from a `Referent` from a `TokenLexeme` even though all three are strings at runtime. This is the "opaque string identifier" pattern from `docs/spec.md` §3.5 encoded in TypeScript. `AgentClass` is `z.enum(["W1-Mono", "W1-Bi", "W2-Native", "W2-Immigrant"])`. `Weight` is `z.number().nonnegative()`. `WeightUpdateRule` is `z.enum(["additive", "l1-normalized"])`. Every numeric validator carries `.min(...)` or `.positive()` where physically meaningful per the plan-file contract.
3. **Topology discriminated union.** Write `lib/schema/topology.ts`. Following the Zod 4 API confirmed by the WebFetch, use `z.discriminatedUnion("type", [latticeVariant, wellMixedVariant, networkVariant])`. Each variant is a `z.object({ type: z.literal("lattice"), ... })`. The lattice variant requires `width > 0`, `height > 0`, and `neighborhood: z.enum(["moore", "von-neumann"]).default("moore")`. The well-mixed variant has no extra fields (just the `type` literal). The network variant has placeholder `kind: z.enum(["small-world", "scale-free", "user-supplied"]).default("small-world")` and a `parameters: z.record(z.unknown()).default({})` for v2 evolution — this keeps the schema future-proof without blocking v1. The whole discriminated union gets a `.default({ type: "lattice", width: 20, height: 20, neighborhood: "moore" })` at the call site in `WorldConfig`.
4. **Language policy by identifier, not closure.** Write `lib/schema/policy.ts`. The PDF's four rules in §3.3 become the literal members of `LanguagePolicyRuleId`. Each rule is just a tag; the _implementation_ of each rule lives later in `lib/sim/policies/` (step 12). The schema layer is deliberately ignorant of the behavior — it only knows that `"w2imm-to-w2native-both"` is a valid identifier. `LanguagePolicyEntry` carries `{ speakerClass, hearerClass, ruleId, languageBias?: { L1: number, L2: number } | undefined }`. `LanguagePolicySet` is a `z.array(LanguagePolicyEntry).default(defaultLanguagePolicies)`, where `defaultLanguagePolicies` is a fully populated array covering all 4 × 4 `(speakerClass, hearerClass)` pairs, wired to the PDF's stated defaults and fallthroughs for the eight pairs the PDF does not explicitly name (e.g. mono-to-immigrant across worlds cannot happen, but a defensive default is still listed). This guarantees `ExperimentConfig.parse({}).languagePolicies` is exhaustive.
5. **World config composition.** Write `lib/schema/world.ts`. `VocabularySeed` is a `z.record(AgentClass, z.record(Language, z.record(Referent, z.array(z.object({ lexeme: TokenLexeme, initialWeight: Weight })))))` — four nested records. The default is lifted from `lib/schema/defaults.ts` and mirrors slides 3–4 of the source PDF: W1-Mono gets L1 yellow/red at weight 1.0, W1-Bi gets both L1 and L2 at weight 1.0, W2-Native gets L2 only, W2-Immigrant matches W1-Bi. `WorldConfig` wraps `agentCount: z.number().int().positive().default(50)`, `monolingualBilingualRatio: z.number().positive().default(1.5)` (3:2 as a ratio of 1.5), `topology`, `referents: z.array(Referent).default(["yellow-like", "red-like"])`, and `vocabularySeed` with its own default.
6. **Preferential attachment.** Write `lib/schema/preferential.ts`. Straightforward: `enabled: z.boolean().default(true)`, `warmUpTicks: z.number().int().nonnegative().default(100)`, `temperature: z.number().positive().default(1.0)`, `similarityMetric: z.enum(["cosine"]).default("cosine")`. A single-element enum is intentional: it leaves room for `"jaccard"` or `"dot-product"` in v2 without breaking current configs.
7. **Experiment assembly.** Write `lib/schema/experiment.ts`. `SchedulerMode = z.enum(["sequential", "random", "priority"]).default("random")`. `ExperimentConfig` composes `world1: WorldConfig`, `world2: WorldConfig`, `tickCount: z.number().int().positive().default(5000)`, `deltaPositive: z.number().positive().default(0.1)`, `deltaNegative: z.number().nonnegative().default(0)` (spec §3.3 states Δ⁻ defaults to 0, "no weight decrement on failure in the minimal Naming Game"), `retryLimit: z.number().int().nonnegative().default(3)`, `weightUpdateRule`, `schedulerMode`, `languagePolicies`, `preferentialAttachment`, `seed: z.number().int().default(0)` (seed of 0 is explicitly supported per F10), and `sampleInterval: z.number().int().positive().default(10)` per §7.2. Every field has `.default(...)`, so `ExperimentConfig.parse({})` succeeds.
8. **Batch and sweep.** Write `lib/schema/batch.ts`. `BatchConfig` = `{ experiment: ExperimentConfig, replicateCount: z.number().int().positive().default(10), baseSeed: z.number().int().default(0), concurrency: z.number().int().positive().default(1) }`. The seeds-per-replicate derivation (`baseSeed + replicateIndex`) is a **runtime concern** owned by step 27, not the schema — the schema stores only `baseSeed`. `SweepConfig` = `{ baseExperiment: ExperimentConfig, axes: z.array(z.object({ paramPath: z.string().min(1), values: z.array(z.unknown()).min(1) })).min(1), replicatesPerCell: z.number().int().positive().default(10) }`. `paramPath` uses dot-separated JSON-pointer-ish strings (e.g. `"world1.monolingualBilingualRatio"`), which step 28 interprets.
9. **Derived TypeScript types.** In `lib/schema/config.ts`, re-export every schema and also export the inferred types: `export type ExperimentConfig = z.infer<typeof ExperimentConfig>;`, and similarly for `WorldConfig`, `TopologyConfig`, `BatchConfig`, `SweepConfig`, `AgentClass`, `Language`, `Referent`, etc. Downstream code **never** writes a hand-rolled interface for any of these shapes.
10. **Defaults origin traceability.** `lib/schema/defaults.ts` holds every literal default value as a named export with a `// per docs/spec.md §X.Y` comment. Every `.default(...)` in the schema files imports from `defaults.ts` rather than inlining the literal. Reviewers can audit the spec mapping in a single file.
11. **Verification.** `ExperimentConfig.parse({})` must return a config. The test file in step 9 exercises this. Additionally, a quick `tsc --noEmit` pass through `npm run typecheck` confirms that the inferred types resolve end-to-end. Nothing in this step runs a simulation — that's steps 09-18.

## 8. Library choices

- **`zod`** — pinned to the latest stable **Zod 4.x** release, verified against `npm view zod version` at execution time. Exact version string is decided by the agent when it runs `npm install zod@latest` and writes the result to `package.json`. No other dependencies.

No dev dependencies need to be added: Vitest and `@types/node` are already installed by step 00.

## 9. Unit tests

`lib/schema/config.test.ts` is a single Vitest file with the following named tests. Each test pins its inputs explicitly — no shared fixtures that could drift.

1. **`ExperimentConfig.parse({})` returns a valid config.** The parsed object is deep-equal to `defaultExperimentConfig` from `lib/schema/defaults.ts`. Every field is populated, no `undefined` leaks through.
2. **Default config matches the PDF canonical setup.** Assert `parsed.world1.monolingualBilingualRatio === 1.5`, `parsed.world1.agentCount === 50`, `parsed.deltaPositive > 0`, `parsed.deltaNegative === 0`, and that the default `vocabularySeed` contains `yellow`/`red` (L1) and `jaune`/`rouge` (L2) at weight 1.0 for the appropriate agent classes.
3. **`tickCount: 0` fails.** `ExperimentConfig.safeParse({ tickCount: 0 })` returns `success: false`, and the emitted `ZodError` mentions `tickCount` and the `positive` constraint in a human-readable way (test asserts the error path is `["tickCount"]`).
4. **`deltaPositive: -1` fails.** Same style — confirms numeric range guards are wired.
5. **`agentCount: 0` in either world fails.** Covers the per-world validation.
6. **`monolingualBilingualRatio: 0` fails.** Per the "ratio > 0" requirement in the plan contract.
7. **Topology discriminated union narrows correctly.** Parse `{ type: "lattice", width: 30, height: 30 }` and assert TypeScript narrows to the lattice variant (compile-time assertion via a `satisfies` clause on `parsed.type === "lattice" ? parsed.width : never`). Parse `{ type: "well-mixed" }` and assert there is no `width` field at the type level.
8. **Topology invalid variant rejected.** `{ type: "lattice", width: -1 }` fails parsing.
9. **`JSON.stringify` → `JSON.parse` → `parse` roundtrip is identity.** Build a non-default config (tweak `seed`, `tickCount`, and the topology to `well-mixed`), serialize, deserialize, re-parse, and assert deep-equal to the original. This guarantees no functions, class instances, or `Map`/`Set` objects have snuck into the schema output (deterministic-serializable requirement from the plan contract).
10. **All `(speakerClass, hearerClass)` pairs resolve to a valid `LanguagePolicyRuleId`.** Iterate the cartesian product of the four `AgentClass` values and assert that `defaultLanguagePolicies` contains exactly one entry per pair whose `ruleId` is a member of the `LanguagePolicyRuleId` enum.
11. **Network topology placeholder shape parses.** `{ type: "network", kind: "small-world", parameters: { k: 4 } }` parses; `{ type: "network", kind: "not-a-kind" }` fails.
12. **`BatchConfig.parse({ experiment: {} })` produces a runnable batch.** Confirms nested defaults compose.
13. **`SweepConfig.parse({ baseExperiment: {}, axes: [{ paramPath: "world1.monolingualBilingualRatio", values: [0.5, 1.0, 1.5, 2.0] }] })` succeeds and retains the values array in order.** Confirms sweep inputs are preserved.
14. **`z.infer` types compile.** A type-only test file or inline `satisfies` expressions confirm that `ExperimentConfig` (the inferred type) is assignable from the output of `parse({})`.

All tests are deterministic — no `Date.now()`, no `Math.random()`, no I/O. They run under Vitest's default `node` environment (no `happy-dom` needed).

## 10. Acceptance criteria

- `npm test -- lib/schema` exits 0 with every test in §9 passing.
- `npm run typecheck` (the alias step 00 establishes, effectively `tsc --noEmit`) exits 0 — the inferred types must resolve without errors anywhere in the project.
- `npm run lint` exits 0 against the new files (ESLint flat config from step 00).
- A one-off node REPL-style sanity check (the agent runs it interactively, not committed): `node --input-type=module -e "import('./lib/schema/config.ts').then(m => console.log(JSON.stringify(m.ExperimentConfig.parse({}), null, 2)))"` (or equivalently `npx tsx -e "..."`) prints a populated config JSON object to stdout without throwing. This is a smoke check; it is not a committed script.
- No UI verification harness run — this is a non-UI step and therefore does **not** invoke chrome-devtools MCP. Per `CLAUDE.md` "UI verification harness," only steps tagged `ui: true` spin up a dev server.
- A single commit is produced with the subject `step 01: zod config schema` (see section 12).

## 11. CLAUDE.md updates

Append at most one bullet to `CLAUDE.md` "Known gotchas" (hard cap 20 items, ≤ 10 new lines here):

> - `Language`, `Referent`, and `TokenLexeme` in `lib/schema/` are **opaque branded strings**, not enums, per `docs/spec.md` §3.5. Do not tighten them to `z.enum(["L1", "L2"])` — the researcher UI renames them, and the defaults (`"L1"`, `"L2"`, `"yellow-like"`, etc.) are labels, not invariants. Widening is fine; narrowing will break the step-25 config editor.

If the step decides there is no surprising behavior worth noting, the `CLAUDE.md updates` section of the plan is honored by leaving the file unchanged. Either outcome is acceptable per the living-document rules ("≤ 30 lines appended per section per commit"). `lib/schema/` is **not** added to the "Directory layout" section by this step — step 00 already declared it (`lib/schema/` with the "Zod config schemas (step 01)" note).

## 12. Commit message

```
step 01: zod config schema
```

Exactly this string, no conventional-commit prefix, no trailing text. `scripts/run-plan.ts` greps for this marker to track pipeline progress (per `CLAUDE.md` "Commit-message convention"). If intermediate commits appear during implementation, they are squashed via `git reset --soft HEAD~N && git commit` before advancing.

## 13. Rollback notes

If the step must be undone (e.g. a downstream step reveals a schema flaw that is cheaper to redo than to patch):

1. Identify the commit SHA immediately prior to `step 01: zod config schema` via `git log --oneline`.
2. `git reset --hard <prior-sha>` — this discards the schema files, `config.test.ts`, and the `zod` dependency addition in one go. Acceptable here only because no downstream work builds on step 01 yet; once later steps have landed, prefer a forward-fix commit.
3. `npm uninstall zod` followed by `npm install` to regenerate `node_modules` cleanly, ensuring the `package-lock.json` matches the rolled-back `package.json`.
4. Verify `git status` is clean and `npm run typecheck` still passes on the rolled-back tree (it will, because nothing else imports from `lib/schema/` yet).
5. Re-run the pipeline from step 01 with an adjusted plan file.
