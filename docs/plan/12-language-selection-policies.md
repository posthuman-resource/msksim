---
step: "12"
title: "language selection policies"
kind: sim-core
ui: false
timeout_minutes: 20
prerequisites:
  - "step 01: zod config schema"
  - "step 09: seeded rng and core types"
  - "step 11: agent bootstrapping"
---

## 1. Goal

Implement **F5 (Language-selection policy)** from `docs/spec.md` as a small, pluggable module that the step-13 interaction engine will call once per tick, once per (speaker, hearer) interaction, to decide which `Language` the speaker uses. The module ships a **default policy** that encodes the four concrete rules from `docs/spec.md` §3.3 step 2 verbatim (the "PDF rules"), a handful of **named alternative policies** for ablation experiments (`always-l1`, `always-l2`, `random`, `mirror-hearer`), and a **string-keyed registry** that lets step-01 `PolicyConfig` payloads resolve to behavior by identifier rather than function closure. This identifier-not-closure design is what makes configs JSON-serializable for `postMessage` into the simulation worker (step 20) and for persistence in the drizzle `configs` table (step 08). Policies are **pure functions** of `(speaker, hearer, rng)` and are the single most important lever for answering **RQ5 — Quantifying linguistic pressure** (`docs/spec.md` §1.2), so every behavior documented here is reachable and toggleable from the step-24 UI sliders without any engine code changes.

## 2. Prerequisites

- Commit marker `step 01: zod config schema` present in `git log`. Step 01 produces `lib/schema/policy.ts` exporting `LanguagePolicyRuleId`, `LanguagePolicyEntry`, and `LanguagePolicySet` (collectively referred to as `PolicyConfig` in this plan file for convenience — the schema-level type is whatever step 01 named it, and step 12 imports it as-is). Crucially, step 01's `defaultLanguagePolicies` enumerates all `(speakerClass, hearerClass)` pairs, so the runtime lookup in step 12 is total.
- Commit marker `step 09: seeded rng and core types` present in `git log`. Step 09 exports `RNG` (wrapped `pure-rand` with a `nextFloat(): number` method returning a value in `[0, 1)`), `AgentId`, `Language`, `Referent`, `Token`, `Weight`, and the `AgentClass` enum (`"W1-Mono" | "W1-Bi" | "W2-Native" | "W2-Immigrant"`). Step 09 also commits to RNG instances never escaping the worker boundary (per `CLAUDE.md` "Worker lifecycle").
- Commit marker `step 11: agent bootstrapping` present in `git log`. Step 11 exports `AgentState` — the runtime shape of an agent with `{ id, class, position, inventory, ... }`. Step 12 consumes only `class` and `inventory` from that type; it does **not** assume any particular position encoding, making the policies topology-agnostic per `docs/spec.md` §4.1 F4.
- Node ≥ 20.9, Vitest installed (step 00), the `@/` alias wired (step 00). `lib/sim/` directory already exists from step 09.

## 3. Spec references

- `docs/spec.md` **§3.3 step 2 (Language selection)** — the authoritative statement of the four PDF rules:
  > "W1-Bi speaking to W1-Mono → always L1. W1-Bi speaking to W1-Bi → either language (configurable bias). W2-Immigrant speaking to W2-Native → both languages possible (configurable bias). W2-Immigrant speaking to W2-Immigrant → both languages possible. W1-Mono and W2-Native only know L1 and L2 respectively and always use them."
  These are the exact behaviors the **default** policy must reproduce; step 12 is "how these words become code."
- `docs/spec.md` **§3.5 (Ambiguities)** — the opaque-symbol decision: `Language` is an opaque string at runtime (`"L1"`, `"L2"` are default labels but the user can rename them). Step 12 therefore **never hardcodes the strings `"L1"` or `"L2"`**; it looks up the language labels from the `PolicyConfig` (which step 01 ultimately seeds from the world's `referents`/`vocabularySeed` defaults). If step 01's schema does not already expose explicit `l1Label`/`l2Label` fields, step 12 adds them to its own input type (`PolicyConfig`) and pulls the defaults from `defaultExperimentConfig`.
- `docs/spec.md` **F5 (Language-selection policy)** — the acceptance criterion: "The default policy set reproduces the PDF's stated rules; researchers can swap in alternative policies via the configuration UI." Step 12's registry (`lib/sim/policy/registry.ts`) is the swap-in surface the UI drives through step 24's slider/dropdown.
- `docs/spec.md` **§1.2 RQ5 — Linguistic pressure quantified** — "How much does the choice of language used by bilinguals under linguistic pressure shift the assimilation/segregation outcome?" The biased-coin-flip defaults and the alternative policies (`always-l1`, `always-l2`, `mirror-hearer`) exist specifically so RQ5 sweeps have knobs to turn. Step 28's parameter sweep will mutate `PolicyConfig.w1BiToW1BiL1Bias` and `PolicyConfig.immigrantToNativeL2Bias` along axes; step 12 guarantees those mutations have the precise effects the spec describes.
- `docs/spec.md` **§4.1 F3 (Interaction engine)** — "Unit-testable pure functions for each rule; deterministic given a seed." Step 12's policies are one of those pure-function rules, and "deterministic given a seed" is the single most important invariant for the tests in section 9.

## 4. Research notes

**Local Next.js 16 docs (authoritative per `CLAUDE.md` "Next.js 16 deltas from training data"):**

1. `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md` §"Preventing environment poisoning" — documents `import 'server-only'` as the guard for modules that must not cross the Server → Client boundary. **Step 12's files deliberately do NOT carry `import 'server-only'`.** The policies live under `lib/sim/`, which runs in the simulation Web Worker (step 20), and `lib/sim/` is one of the few `lib/` subtrees that is intentionally shared between Server Components, Client Components, and workers (the same property `lib/schema/` carries, per step 01's implementation approach §7). Step 12 must be loadable in any of these contexts. This is the inverse of `lib/db/` and `lib/auth/`, both of which **do** start with `import 'server-only'` per `CLAUDE.md` "Database access patterns" and "Authentication patterns."
2. `node_modules/next/dist/docs/01-app/03-api-reference/08-turbopack.md` §"Magic Comments" — confirms that Turbopack supports `new Worker(new URL('./foo.worker.ts', import.meta.url), { type: 'module' })` expressions and that module-level imports across that boundary are bundled correctly. This is the transport step 20 will use to pass the step-01 `ExperimentConfig` (including the `PolicyConfig` subset consumed here) from main thread into the worker via `Comlink.expose`. The load-bearing consequence for step 12: **every field reachable from a `PolicyConfig` must be `structuredClone`-safe**. Functions are not `structuredClone`-safe; JSON primitives, arrays, and plain objects are. This is why step 12's registry maps string identifiers to functions in a worker-resident module instead of embedding functions in the config object itself.
3. `node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md` — the canonical Vitest setup for this codebase. Step 12's two test files use the default `node` environment (not `happy-dom`) because they exercise pure TypeScript functions with no DOM dependencies. Step 00 already wrote `vitest.config.ts` with `environment: 'node'` as the default, so the test files need no per-file overrides.

**External references (WebFetched):**

4. **Baronchelli, Loreto & Steels (2010), "In-depth analysis of the naming game dynamics in social networks"** — <https://arxiv.org/abs/1008.1096>. The paper's central empirical result is that "networks with strong community structure hinder the system from reaching global agreement" and that **"clusters of coexisting opinions [persist] indefinitely"** when community structure is strong. The language-selection policies implemented in step 12 are *the mechanism by which this is encoded in the msksim model*: the PDF's rule that "bilinguals in World 1 always use L1 with monolinguals" is literally a structural constraint that prevents L2 tokens from propagating into the W1-Mono subpopulation, which *guarantees* the two-cluster outcome the spec's `docs/pdftext.md` calls "ghettoization" under the right ratio. The `mirror-hearer` alternative policy is the explicit counter-factual: it lets researchers ask "what if immigrants preferentially adopted the hearer's dominant language?" — that is the "consensus engineering" intervention Baronchelli et al. discuss. Researchers running RQ5 sweeps will directly operationalize this by swapping between `'default'` and `'mirror-hearer'` with all other parameters fixed, and the step-12 registry makes that swap a one-character change in JSON.
5. **Zod 4 `z.discriminatedUnion` and `z.enum` API reference** — <https://zod.dev/api>. Confirmed behaviors relevant to step 12: (a) `z.discriminatedUnion("discriminatorKey", [variant1, variant2, ...])` narrows TypeScript on the discriminator automatically, which is how step 01 models the `(speakerClass, hearerClass)` lookup if it chose a discriminated-union representation, and (b) **"discriminated unions are naive — they check input against each option sequentially. Using a discriminator makes parsing more efficient."** The practical consequence for step 12: the runtime lookup inside `createPolicy(...)` uses a plain `Map<${AgentClass}__${AgentClass}, LanguagePolicy>` built once at factory time, not a per-call `discriminatedUnion` parse, because step 12 runs inside the per-tick hot path (potentially millions of calls per run) where re-parsing on every interaction would dominate the runtime budget. Parsing happens at worker-init time in step 20; step 12 treats `PolicyConfig` as already-valid input.

**Paths not taken:**

6. **Functions embedded directly in config objects.** One alternative design would be to let `PolicyConfig` carry the `LanguagePolicy` function itself — e.g. `{ w1BiToW1Bi: (args) => args.rng.nextFloat() < 0.5 ? L1 : L2, ... }` — and skip the registry entirely. **Rejected** because configs must be JSON-serializable for three independent reasons: (a) they cross the main-thread → Web Worker `postMessage` boundary in step 20, and `structuredClone` throws `DataCloneError` on functions; (b) they are persisted to SQLite via drizzle's `json` column type in step 08; (c) the step-25 config editor exports configs as JSON files for reproducibility (US-6, US-12). Reference by **string identifier** via `lib/sim/policy/registry.ts` is the only design that satisfies all three. Step 01's plan file already anticipates this: its §7 step 4 states "policies are referenced by identifier, not by function closure." Step 12 honors that contract.
7. **(Also considered) A class-based policy hierarchy** — e.g. `abstract class LanguagePolicy { abstract choose(...): Language }` with subclasses per rule. Rejected because it complicates the pure-function contract (the engine just wants `(args) => Language`), breaks the closure-over-config pattern that `createPolicy(config)` uses to bake bias values into the returned function, and serves no inheritance use case.

Total research links: **5 required** (3 local Next docs, 2 external WebFetched) plus 1 path not taken (plus a secondary path). All quality gates satisfied.

## 5. Files to create

- `lib/sim/policy.ts` — the **type module**. Exports:
  - `type LanguagePolicy = (args: { speaker: AgentState; hearer: AgentState; rng: RNG }) => Language;`
  - `type LanguagePolicyArgs` as the named form of that argument object, for call sites that want to declare parameters explicitly.
  - `type LanguagePolicyFactory = (config: PolicyConfig) => LanguagePolicy;` — the shape of the exported factory from `lib/sim/policy/registry.ts`.
  - Re-exports nothing; keeps the type surface minimal and decoupled from the implementation files below. No runtime code at all — this file is types only so that consumers (step 13's interaction engine) can import `LanguagePolicy` without dragging in the alternative-policy implementations or the registry's string table.
- `lib/sim/policy/default.ts` — the **default policy** implementation. Exports `createDefaultPolicy(config: PolicyConfig): LanguagePolicy`. Internally builds a `Map` keyed on `${speaker.class}__${hearer.class}` at factory time, populated with 16 entries (one per cartesian product of the four `AgentClass` values), each mapping to a pre-closed lambda that implements the correct rule. At call time, the returned `LanguagePolicy` just looks up the key and invokes the lambda — **no dispatch logic runs per-call beyond the `Map.get`**. This file reads `config.l1Label` and `config.l2Label` (the opaque strings) exactly once per factory call and closes over them, so the returned policy never touches the config again. Unused — the policy never hardcodes `"L1"` or `"L2"`. The four behavior cells are:
  - `"W1-Bi__W1-Mono"` → returns `l1Label` unconditionally (no RNG touch).
  - `"W1-Bi__W1-Bi"` → biased coin flip: `rng.nextFloat() < config.w1BiToW1BiL1Bias ? l1Label : l2Label`.
  - `"W2-Immigrant__W2-Native"` → biased coin flip: `rng.nextFloat() < config.immigrantToNativeL1Bias ? l1Label : l2Label`. (See §7 note on "bias" naming.)
  - `"W2-Immigrant__W2-Immigrant"` → biased coin flip: `rng.nextFloat() < config.immigrantToImmigrantL1Bias ? l1Label : l2Label`.
  - `"W1-Mono__*"` → always `l1Label` (a W1-Mono only knows L1).
  - `"W2-Native__*"` → always `l2Label` (a W2-Native only knows L2).
  - All eight remaining cells (cross-world like `"W1-Bi__W2-Native"`) resolve to a defensive fallthrough: always `l1Label` for W1-* speakers, always `l2Label` for W2-* speakers. These cells are **unreachable in v1** per the spec's "agents do not move between worlds" rule (`docs/spec.md` §3.2), but the map is exhaustive so a future cross-world experiment does not `undefined`-crash.
- `lib/sim/policy/alternatives.ts` — the **named alternative policies** for ablation. Each is a zero-config `LanguagePolicy` (no factory), because the alternatives are deliberately parameter-free so researchers can A/B them without changing anything else:
  - `alwaysL1: LanguagePolicy` — returns the first known language of the speaker; falls back to `l1Label` from an injected constant (see §7 for how the constant is sourced). Pure, no RNG touch.
  - `alwaysL2: LanguagePolicy` — symmetric to `alwaysL1`.
  - `random: LanguagePolicy` — `rng.nextFloat() < 0.5 ? l1Label : l2Label`. Uniform between the two canonical languages; does *not* inspect the speaker's inventory because v1 is strictly bilingual (only L1 and L2 exist per `docs/spec.md` §10). If v2 generalizes to N languages, this policy becomes uniform over `speaker.inventory.keys()`.
  - `mirrorHearer: LanguagePolicy` — inspects `hearer.inventory` and returns whichever of `{l1Label, l2Label}` has the **higher summed token weight** in the hearer's inventory (ties broken deterministically toward `l1Label`). Encodes the Baronchelli 2010 "consensus engineering" intuition: speakers adapt to the hearer's dominant language. No RNG touch (the tie-breaker is a pure lexicographic rule, not a coin flip).
  - Because alternatives need access to `l1Label`/`l2Label` but take no config, they read from a module-private constant `L1_DEFAULT = "L1"`, `L2_DEFAULT = "L2"` that step 12 documents as "hardcoded defaults, overridden by the default-policy factory." This is acceptable because alternatives exist for ablation experiments that stay on default labels; the researcher who renames languages in the UI will also use the default policy for that experiment. Step 12's CLAUDE.md gotcha entry documents this limitation (section 11).
- `lib/sim/policy/registry.ts` — the **registry** and the `createPolicy` factory. Exports:
  - `export const POLICY_NAMES = ['default', 'always-l1', 'always-l2', 'random', 'mirror-hearer'] as const;`
  - `export type PolicyName = typeof POLICY_NAMES[number];`
  - `export function createPolicy(config: PolicyConfig): LanguagePolicy` — reads `config.policyName` (a `PolicyName`-typed string). If `policyName === 'default'`, delegates to `createDefaultPolicy(config)`. Otherwise, looks up the name in a `Map<PolicyName, LanguagePolicy>` of alternatives and returns it directly. **Throws `Error("Unknown policy name: ${name}. Known policies: ${POLICY_NAMES.join(', ')}")` if the name is not found** — with the clear enumeration of valid names in the message so a config typo is self-diagnosing.
  - `export function listPolicies(): readonly PolicyName[]` — returns `POLICY_NAMES`. Used by step 24's UI dropdown.
- `lib/sim/policy/default.test.ts` — Vitest suite covering the default policy's 4 PDF rules under all four `(speakerClass, hearerClass)` cells plus the unreachable-cell fallthroughs. Enumerated in section 9.
- `lib/sim/policy/registry.test.ts` — Vitest suite covering the registry lookup for all 5 named policies, the error path for unknown names, and the `createPolicy({default config})` round-trip. Enumerated in section 9.

All six files are pure TypeScript. None import from `lib/db/`, `lib/auth/`, React, Next, or any framework module. The only external imports are from `@/lib/sim/` (for `AgentState`, `RNG`, `Language`, `AgentClass` from step 09 and step 11) and from `@/lib/schema/` (for `PolicyConfig` from step 01).

## 6. Files to modify

- `lib/sim/index.ts` — re-export the public API of step 12 so downstream steps can `import { createPolicy, LanguagePolicy, type PolicyName } from '@/lib/sim'` without knowing about the `policy/` subdirectory layout. The existing `lib/sim/index.ts` from step 09 already re-exports `RNG` and the core types; step 12 appends `export type { LanguagePolicy, LanguagePolicyArgs, LanguagePolicyFactory } from './policy';` and `export { createPolicy, listPolicies, POLICY_NAMES, type PolicyName } from './policy/registry';`. If step 09 (or a later step under review) has already established a different re-export convention (e.g. named namespace object, barrel file, etc.), step 12 follows that convention instead.

No other files modified. `package.json`, `CLAUDE.md`, `tsconfig.json`, and every existing schema/db/auth file are untouched. `CLAUDE.md` receives at most a small append — see section 11.

## 7. Implementation approach

The work is ordered so that the pure type layer lands before any implementation, every implementation module is loaded only by its test file before being wired into `lib/sim/index.ts`, and the registry is written last because it depends on all the concrete policies existing. Each step below corresponds to roughly one file and one test pass.

First, write `lib/sim/policy.ts` as a **types-only module**. Define `LanguagePolicy`, `LanguagePolicyArgs`, and `LanguagePolicyFactory`. Import `AgentState` from step 11's export location (likely `@/lib/sim/agent` or similar — the exact path depends on how step 11 structured its re-exports, and the agent should read `lib/sim/index.ts` to find the canonical import). Import `RNG` and `Language` from step 09's exports. Confirm the file compiles with `npm run typecheck` before moving on. No runtime code lives here; it is purely the contract the engine and tests consume.

Second, inspect the shape of `PolicyConfig` that step 01 committed. If step 01's `LanguagePolicySet` is an array-of-entries shape rather than the flat object shape this plan assumes (fields like `w1BiToW1BiL1Bias`, `immigrantToNativeL1Bias`, `immigrantToImmigrantL1Bias`, `l1Label`, `l2Label`, `policyName`), **the factory in `default.ts` is responsible for flattening step 01's shape into the internal lookup map**. The plan explicitly does not bind to a specific field layout because that is step 01's decision. What step 12 does commit to is that the runtime effect of `createDefaultPolicy(...)` with the step-01 defaults must match the four PDF rules, and the tests in section 9 enforce this behavioral contract. If field names differ, the tests still check `(speaker.class, hearer.class) → Language` and still pass.

Third, write `lib/sim/policy/default.ts`. The factory is structured like this in prose: (a) at factory call time, read out all bias values and language labels from the `config` argument, capturing them as local `const` bindings; (b) build a `Map<string, LanguagePolicy>` with exactly 16 keys of the form `${AgentClass}__${AgentClass}`; (c) for each of the four PDF rule cells, install a closure that either returns the captured label directly (pure cases) or invokes `rng.nextFloat()` exactly once and compares it to the captured bias (biased cases); (d) install the six "only-knows-one-language" speaker-class cells (W1-Mono always L1, W2-Native always L2) using the same captured labels; (e) install the defensive fallthroughs for the cross-world cells that cannot occur in v1 but must not `undefined`-crash; (f) return a `LanguagePolicy` that does `const key = \`${speaker.class}__${hearer.class}\`; const rule = map.get(key); if (!rule) throw new Error(\`Unexpected class pair: ${key}\`); return rule({ speaker, hearer, rng });`. The exhaustiveness check at runtime is cheap insurance against `AgentClass` growing without the map growing with it.

Fourth, write `lib/sim/policy/alternatives.ts`. Each alternative is a single-expression function. `alwaysL1` returns `L1_DEFAULT` unconditionally. `alwaysL2` returns `L2_DEFAULT`. `random` returns `rng.nextFloat() < 0.5 ? L1_DEFAULT : L2_DEFAULT`. `mirrorHearer` computes `sumL1 = Σ weights in hearer.inventory[L1_DEFAULT]`, `sumL2 = Σ weights in hearer.inventory[L2_DEFAULT]`, and returns `sumL1 >= sumL2 ? L1_DEFAULT : L2_DEFAULT` (ties to L1). The "inventory" access path depends on step 11's `AgentState.inventory` shape — the agent must check step 11's export and adapt the traversal. If step 11's inventory is a nested `Map<Language, Map<Referent, Map<Token, Weight>>>`, the sum is over all `(referent, token)` pairs under the language key. If step 11 chose a plainer shape, the traversal adapts. The test in section 9 is shape-agnostic because it constructs a full-fidelity `AgentState` and asserts only the returned `Language`.

Fifth, write `lib/sim/policy/registry.ts`. Construct a `Map<Exclude<PolicyName, 'default'>, LanguagePolicy>` literal holding the four zero-config alternatives. The `createPolicy` factory switches on `config.policyName`: if `'default'`, it calls `createDefaultPolicy(config)`; otherwise it looks up in the map and throws if missing. Export `POLICY_NAMES` as a `const`-asserted tuple so `PolicyName` is a narrowed string union that step 01's schema can reference via `z.enum(POLICY_NAMES)`. This is the canonical "schema follows code, code does not follow schema" direction for enum-like string sets — step 01 can import the tuple from `@/lib/sim` to drive its own `z.enum` if it has not already. If step 01 already hardcoded these names in its schema, step 12's tuple simply mirrors them (with a comment pointing to the duplicate source of truth and a TODO to unify in a future refactor).

Sixth, write `lib/sim/policy/default.test.ts`. The tests construct minimal `AgentState` fixtures inline — the goal is to avoid any dependency on step 11's bootstrapping helper, because that would couple the policy tests to the bootstrapping implementation. Each test pins a specific seed and constructs a real `RNG` from step 09's helper (not a hand-mocked one) so the "determinism" guarantee is tested against the actual RNG used in production. For the statistical tests (the 50/50 and 80/20 biases), the test calls the policy 10 000 times in a tight loop against a single reseeded RNG, counts occurrences of each language, and asserts the count is within ± 3 binomial standard deviations of the expected mean (for p = 0.5, n = 10 000 this is ~ ± 150; for p = 0.8, n = 10 000 this is ~ ± 120). The wide-but-principled tolerance makes the tests robust against RNG-flavor drift if step 09's RNG switches from pure-rand's Mersenne-Twister to a different algorithm in a future patch, while still catching real bugs like "the bias is inverted" or "the coin flip calls `nextFloat()` zero times."

Seventh, write `lib/sim/policy/registry.test.ts`. Tests cover: each of the 5 named policies resolves to a `typeof === 'function'` value; `createPolicy` with the default config returns a policy whose output on a pinned `(speaker, hearer, rng)` triple matches `createDefaultPolicy(config)` invoked directly (proving the registry's `'default'` dispatch is not dropping any config bindings); an unknown name throws with a message containing the list of known names; `listPolicies()` returns exactly the five names and they are each accepted by `createPolicy`.

Eighth, wire `lib/sim/index.ts` re-exports. Run `npm test -- lib/sim/policy` and `npm run typecheck` and `npm run lint`. Iterate until all three are green. Commit.

A note on "JSON-serializability": it is tempting to test JSON-serializability of a `PolicyConfig` at this step. **Do not** — that is step 01's responsibility (and its test file already covers the `JSON.stringify → JSON.parse → parse` roundtrip per its section 9 test 9). Step 12's tests exercise **behavior**, not schema. This separation keeps each step's test file focused and makes failure localization obvious.

A note on "RNG usage in pure policies": the spec's §4.1 F3 acceptance criterion is "pure functions ... deterministic given a seed." "Pure" here means "side-effect-free except for the RNG threaded through as an argument," which is the conventional reading for seeded Monte Carlo code. The `LanguagePolicy` type takes `rng` as an argument precisely so that the function can be "pure given its inputs" — it does not close over module-level state. Tests assert this by constructing two separate RNG instances with the same seed, calling the same policy on the same `(speaker, hearer)` with each, and asserting bit-identical output across repeated calls.

## 8. Library choices

No new dependencies. Step 09 already added `pure-rand` for the seeded RNG, step 01 already added `zod` for the config schema, and Vitest is present from step 00. Step 12 touches only the existing stack.

## 9. Unit tests

Two test files. Every test constructs its own fixtures inline — no shared `describe.before` state, no module-level mutable fixtures — so tests are independently runnable and failures are self-contained.

**`lib/sim/policy/default.test.ts`:**

1. **W1-Bi → W1-Mono yields L1 in 100% of trials regardless of RNG state.** Construct a W1-Bi speaker and a W1-Mono hearer. Construct an RNG with a fixed seed. Call the policy 1 000 times in a loop (re-using the same RNG so it advances). Assert every return value `=== l1Label`. Repeats with three different seeds (0, 1, 42) to confirm RNG state is irrelevant for this cell.
2. **W1-Mono → W1-Mono yields L1 in 100% of trials.** Same structure: 1 000 calls, every result `=== l1Label`, across three seeds.
3. **W2-Native → W2-Native yields L2 in 100% of trials.** Symmetric.
4. **W1-Bi → W1-Bi with a 0.5 bias yields L1 in ~50% of 10 000 trials.** Construct both agents as W1-Bi, construct a `PolicyConfig` with `w1BiToW1BiL1Bias === 0.5`, build the policy, and call 10 000 times on a single RNG instance. Count L1 occurrences. Assert count is in `[5000 - 150, 5000 + 150]` (a 3σ binomial interval around p = 0.5, n = 10000). Also asserts the count is **not exactly 5000** (soft check that the coin is actually flipping, not a bug where the same value is returned every time — asserted as `count !== 0 && count !== 10000` which is the meaningful lower bar).
5. **W2-Immigrant → W2-Native with `immigrantToNativeL2Bias: 0.8` yields L2 ~80% of the time.** (Naming note: whether step 01 spells the field as an "L1 bias" or "L2 bias," step 12 tests the effective behavior. The test asserts "L2 is chosen in ~8000/10000 trials," phrased as "count of L2 is in [8000 - 120, 8000 + 120]," which is the spec's intent regardless of field-name convention.)
6. **W2-Immigrant → W2-Immigrant with a 0.5 bias yields L1 in ~50% of 10 000 trials.** Symmetric to test 4.
7. **Determinism: same seed, same inputs, same output sequence.** Construct two RNGs with seed = 42. Call the W1-Bi → W1-Bi policy 100 times against each RNG. Assert the two sequences are bit-identical with `expect(a).toEqual(b)`. This is the load-bearing assertion for `docs/spec.md` §4.1 F3's "deterministic given a seed" criterion at the policy level.
8. **Cross-world fallthrough cells do not throw.** For each unreachable cell (`W1-Mono__W2-Native`, `W1-Bi__W2-Immigrant`, etc.), calling the policy on fixture agents in those classes returns a `Language` value in `{l1Label, l2Label}` without throwing. The specific value is an implementation detail of the fallthrough; the test asserts only non-throwing and membership in the two-element set.
9. **Renamed language labels are honored.** Construct a `PolicyConfig` where `l1Label === "firstLanguage"` and `l2Label === "secondLanguage"`. Confirm `W1-Bi → W1-Mono` returns `"firstLanguage"`, not the literal string `"L1"`. This guards against a regression where a future refactor hardcodes the label.

**`lib/sim/policy/registry.test.ts`:**

10. **Registry lookup for each of the 5 named policies returns a callable function.** For each `name` in `POLICY_NAMES`, build a minimal valid `PolicyConfig` with `policyName: name`, call `createPolicy(config)`, and assert `typeof result === 'function'`.
11. **`createPolicy({ default policy config })` matches `createDefaultPolicy` directly.** Build the default config with `policyName: 'default'`. Build an RNG with seed = 0. Build `policyA = createPolicy(config)` and `policyB = createDefaultPolicy(config)`. Call each 100 times against a freshly seeded RNG (separate instances per policy so they don't share state) and assert the two output sequences are equal. This proves the registry's `'default'` dispatch does not drop any config bindings.
12. **Invalid policy name throws with a clear error.** `createPolicy({ ...defaultConfig, policyName: 'not-a-real-policy' as PolicyName })` (cast needed for the test to compile). Assert it throws, assert the thrown `Error.message` contains the literal substring `"not-a-real-policy"`, and assert the message also contains `"default"` (i.e. the known-names list is included for diagnostic value).
13. **`listPolicies()` returns exactly the five names.** `expect(listPolicies()).toEqual(['default', 'always-l1', 'always-l2', 'random', 'mirror-hearer'])`. The order is not load-bearing — if the implementation chooses a different canonical order, the test uses `toEqual` with a sorted comparison instead. The count (5) and set membership are the contract.
14. **`alwaysL1` returns L1 for every `(speaker.class, hearer.class)` combination.** Iterate over all 16 cartesian-product cells and call `alwaysL1({ speaker, hearer, rng })` in each. Every return is `l1Label` (the default module constant). This is the ablation smoke test — it proves `alwaysL1` ignores both class and RNG.
15. **`alwaysL2` symmetric.**
16. **`random` is a biased coin at 0.5.** 10 000 calls; count of L1 in `[5000 - 150, 5000 + 150]`.
17. **`mirrorHearer` returns the hearer's dominant language.** Construct two hearers: one whose inventory has `sum(L1 weights) > sum(L2 weights)`, one whose inventory has the opposite. For the first hearer, `mirrorHearer(...)` returns L1; for the second, L2. A third fixture with exactly-equal weights returns L1 (the documented tie-breaker).

All tests run under `node` environment, pin their seeds, and have no I/O. Combined runtime expected < 500 ms on the development machine.

## 10. Acceptance criteria

- `npm test -- lib/sim/policy` exits 0 with every test in section 9 passing.
- `npm run typecheck` (the alias from step 00) exits 0. Inferred types from `createPolicy`, `LanguagePolicy`, and the registry compile without errors anywhere in the project.
- `npm run lint` exits 0 against the new files under ESLint's flat config from step 00. No `any` leaks, no unused imports.
- Importing from `@/lib/sim` resolves `createPolicy`, `LanguagePolicy`, and `POLICY_NAMES` — confirming the `lib/sim/index.ts` re-export is wired. Confirmed by a single-line smoke check in the policy test files (`import { createPolicy, POLICY_NAMES, type LanguagePolicy } from '@/lib/sim';`) which compiles only if the re-export is correct.
- No UI verification harness run — this is a `ui: false` step and does **not** invoke chrome-devtools MCP, per `CLAUDE.md` "UI verification harness" (only `ui: true` steps spin up a dev server).
- A single commit is produced with subject `step 12: language selection policies` (see section 12).

## 11. CLAUDE.md updates

Append at most **one bullet** to `CLAUDE.md` "Known gotchas" (hard cap 20 items, ≤ 2 new lines here):

> - `PolicyConfig` and all Zod schemas under `lib/schema/` must remain **JSON-serializable** (no functions, no class instances, no `Map`/`Set`) because they cross `postMessage` into the simulation worker (step 20) and are persisted to SQLite in step 08. Named policies live in `lib/sim/policy/registry.ts` and are referenced from configs by string identifier (`'default'`, `'always-l1'`, `'always-l2'`, `'random'`, `'mirror-hearer'`), never by function closure. A regression here will manifest as a silent `DataCloneError` on worker init.

Do not edit any other section of `CLAUDE.md`. `lib/sim/` is already declared in the "Directory layout" section by step 09, so step 12 does not touch that section. If the step reviewer decides even this one-bullet addition is redundant with an existing gotcha, leaving `CLAUDE.md` unchanged is acceptable per the living-document rules.

## 12. Commit message

```
step 12: language selection policies
```

Exactly this string, no conventional-commit prefix, no trailing text, no body. `scripts/run-plan.ts` greps for this marker to track pipeline progress (per `CLAUDE.md` "Commit-message convention"). If intermediate commits appear during implementation (e.g. per-file green test runs), they are squashed via `git reset --soft HEAD~N && git commit` before advancing.

## 13. Rollback notes

If step 12 must be undone (e.g. step 13 reveals that the `LanguagePolicy` argument shape needs a fourth parameter like `referent` and it is cheaper to redo than to patch):

1. Identify the commit SHA immediately prior to `step 12: language selection policies` via `git log --oneline`. Expect it to be `step 11: agent bootstrapping`.
2. `git reset --hard <prior-sha>` — discards all six files created in step 12 plus the `lib/sim/index.ts` re-export edit in one command. Safe because no downstream step has landed yet when rolling back from within the wave-3 dispatch; once step 13 has committed, prefer a forward-fix instead.
3. Verify `git status` is clean.
4. Run `npm run typecheck` and `npm test` against the rolled-back tree. Both should pass — nothing outside `lib/sim/policy/` depends on step 12 yet (step 13 is the first consumer and it has not landed).
5. Re-run the pipeline from step 12 with an adjusted plan file.
