---
step: '33'
title: 'gaussian success policy'
kind: sim-core
ui: false
timeout_minutes: 25
prerequisites:
  - 'step 09: seeded rng and core types'
  - 'step 13: interaction engine'
  - 'step 14: preferential attachment'
  - 'step 32: polish and e2e smoke'
---

## 1. Goal

Implement a **probabilistic communication-success policy** that replaces the current binary "hearer-knows-the-token" rule with a Gaussian kernel applied to the Euclidean distance between the speaker's and hearer's token-weight vectors. Concretely, this step delivers a new opt-in `successPolicy` field on `ExperimentConfig`, a small numeric helper `euclideanDistanceSq(a, b): number` colocated next to the existing `cosineSimilarity` in `lib/sim/similarity.ts`, and a five-line modification to the success-determination branch of `lib/sim/engine.ts:tick()` that switches between the legacy deterministic rule (default, byte-identical to v1) and the Gaussian rule `Ps(i,j) = exp(-‖xi - xj‖² / (2σ²))` when configured. This step is motivated by the research collaborator's proposal in `docs/Gaussian Communication Success and (1).pdf` (received 4/19, Mike's design write-up locked in 4/25), which models communication success as a continuous probability that decays smoothly with the distance between agent linguistic states rather than as a sharp binary truth-condition. The research value is that it lets the simulation study **how vocabulary tolerance gradients** (sigma sweeps from 0.1 to 5.0) shape consensus dynamics — a question the binary rule cannot ask, because in the binary rule there is no notion of "almost successful." This supports `docs/spec.md` **RQ1** (assimilation/segregation thresholds) by giving the researcher a continuous knob for how strict communication is, and **RQ4** (emergent social cohesion) by surfacing whether tolerance-mediated success rates produce qualitatively different community structure than truth-conditional rules. The single load-bearing invariant for this step is **default-off backwards compatibility**: with `successPolicy: { kind: 'deterministic' }` (the default), every existing test fixture, every existing committed config-hash, and every existing run snapshot must remain bit-identical. The Gaussian branch is opt-in and its RNG draws are added only inside the gaussian arm — the deterministic arm consumes zero new entropy.

## 2. Prerequisites

- Commit marker `step 09: seeded rng and core types` present in `git log`. Step 09 exports the `RNG` interface (`nextInt`, `nextFloat`, `pick`, `pickWeighted`, `shuffle`) — step 33 calls `rng.nextFloat()` exactly once per gaussian-mode interaction and never calls it in deterministic mode. The branded primitives `Language`, `Referent`, `TokenLexeme`, the `Inventory` type, and the `inventoryGet/Set/Increment` helpers are unchanged dependencies.
- Commit marker `step 13: interaction engine` present in `git log`. Step 13 establishes the `tick(state, rng)` entrypoint, the `InteractionEvent` shape, and the success-determination site at the hearer-guess sub-step (currently `lib/sim/engine.ts:286` per the file as committed in step 13). Step 33 modifies that single site and extends `InteractionEvent` with one new optional field; nothing else in the engine changes shape.
- Commit marker `step 14: preferential attachment` present in `git log`. Step 14 exports `cosineSimilarity(a: TokenVector, b: TokenVector): number` and `topKTokenVector(inventory: Inventory, k: number): TokenVector` from `lib/sim/similarity.ts`, plus the `TokenVector = ReadonlyMap<string, number>` type. Step 33 reuses `topKTokenVector` for vector extraction and adds `euclideanDistanceSq(a, b): number` as a sibling export in the same file — the Gaussian rule does not need a new vectorizer.
- Commit marker `step 32: polish and e2e smoke` present in `git log`. Confirms the v1 surface area is locked and step 33 is a true post-v1 extension (per the collaborator timeline in the chat log, all v1 features were complete before her 4/19 PDF arrived). Step 32's e2e screenshot under `docs/screenshots/step-32-*.png` is the visual baseline that must remain achievable when this step's default-off mode is in effect.
- Node ≥ 20.9, Vitest installed, `@/` alias wired, `lib/sim/` and `lib/schema/` directories already present — all from step 00.

## 3. Spec references

- `docs/Gaussian Communication Success and (1).pdf` (collaborator-supplied, in repo at `/docs/`). Page 2 defines the kernel exactly: `Ps(i,j) = exp(-‖xi - xj‖² / (2σ²))` with **σ as a "kernel width"** and **T as the "social temperature"**. The PDF presents two variants of the formula — one with σ in the denominator, one with T — and explicitly states "in our simulation Sigma is the temperature." Mike's design judgment overrides this: σ is exposed as a **separate** `sigma` knob (not aliased to the existing partner-selection `temperature`), because the two parameters control semantically different things (one warps softmax probabilities over candidate partners, the other warps a Gaussian over linguistic states), and conflating them would couple them in confusing ways during research sweeps. The PDF's bullet "Linguistic State Vectors, containing the numerical weights assigned to specific lexemes" is the basis for using the existing `topKTokenVector` infrastructure as the vector source. The "Squared Euclidean Distance, which quantifies the Linguistic Gap or the disparity in intensity of commitment to the vocabulary used" is the basis for `euclideanDistanceSq`.
- `docs/spec.md` **§3.3 Interaction rules step 5 ("Guessing")** — the original spec wording is "If the hearer has the token associated with the same referent, the interaction is a success. Otherwise it is a failure." Step 33 keeps this rule as the default but adds a configurable alternative. The change is **additive** to §3.3, not a rewrite — a future spec amendment (out of scope for step 33) can document the gaussian variant under §11 Open Questions.
- `docs/spec.md` **§11 Open Question 4 (noise / mishearing)** — the spec recommends "no by default in v1, but expose a hook in F3 so it can be added as an ablation parameter later without refactoring." The gaussian success policy is **not** noise: noise would corrupt the (referent, token) pair en route to the hearer; the gaussian rule asks whether two agents in similar linguistic states "succeed" at communicating. The hook from OQ4 lives between the lookup and the success branch; the gaussian rule **replaces** the success branch entirely. Document the distinction in `lib/sim/engine.ts` so a future noise-step implementer doesn't accidentally bolt the noise hook into the gaussian branch.
- `docs/spec.md` **§1.2 RQ1, RQ4** — the research questions this step extends. Step 33's `successProbability: number | null` field on `InteractionEvent` is the raw signal a future metrics step can use to compute "calibration curves" (how often does a 0.7-Ps interaction actually succeed? answer: 70% of the time, in the long run — a sanity check on the kernel). v1 metrics consume only the boolean `success`, so no metrics file changes in this step.
- `docs/spec.md` **F3 (Interaction engine)** acceptance criterion: "Unit-testable pure functions for each rule; deterministic given a seed; configurable Δ⁺, Δ⁻, retry limit; scheduler can be sequential, random, or priority-based." Step 33 preserves this verbatim — `tick` remains pure-given-state-and-rng, the Gaussian branch is unit-testable in isolation against hand-computed Ps values, and determinism is guaranteed because the only entropy source is `rng.nextFloat()` called at a fixed point in the per-interaction sub-step order.

## 4. Research notes

**Local Next.js 16 docs (authoritative per `CLAUDE.md` "Next.js 16 deltas" and `AGENTS.md`):**

1. `node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md` — confirms Vitest as the supported test runner under Next 16, the `node` default environment, and the manual-setup shape step 00 already wired. Step 33's tests live in `lib/sim/engine.test.ts` (extended) and `lib/sim/similarity.test.ts` (extended), both running in the default `node` environment. No DOM, no React, no happy-dom — the success-policy code is pure TypeScript with no Next-specific dependencies. Load-bearing for this step: the Vitest `vite-tsconfig-paths` plugin resolves the `@/` alias step 33's imports use.
2. `node_modules/next/dist/docs/01-app/03-api-reference/08-turbopack.md` — confirms Turbopack is the default bundler in Next 16 and that pure-TypeScript modules with no DOM, no Node built-ins, and no native bindings bundle identically into the server-component graph and the Web Worker graph. The new `euclideanDistanceSq` helper and the modified `tick` function consume only `@/lib/sim/*` and `@/lib/schema/*`, both already established as cross-boundary-safe by steps 09–14. Practical consequence: `lib/sim/similarity.ts` and `lib/sim/engine.ts` deliberately do **not** carry `import 'server-only'` (the inverted-guard pattern). Adding it would break the step-20 worker entrypoint.
3. `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md` — confirms `next lint` is removed and ESLint runs standalone via flat config from step 00. No additional lint wiring is required for step 33; the modified files under `lib/sim/` and the new schema file under `lib/schema/` are picked up by the existing `npm run lint` target. Also reminds us that a custom `webpack` config fails the build under Turbopack — relevant because the gaussian-policy module must remain webpack-config-free (it is, by construction).

**External references (WebFetched at execution time — the implementing agent must fetch these fresh):**

4. **Wikipedia — "Radial basis function kernel"** — `https://en.wikipedia.org/wiki/Radial_basis_function_kernel` (must be WebFetched). Load-bearing facts the implementing agent should confirm: (a) the RBF/Gaussian kernel formula `K(x, y) = exp(-‖x - y‖² / (2σ²))` is exactly the form Meissa's PDF specifies; (b) the "kernel trick" property is irrelevant here (we're not doing SVM regression); (c) the parameter σ is variously called "kernel width," "bandwidth," or "length scale" — the help text in step 35 should use "kernel width" because that's the term Meissa's PDF uses. Consequences for step 33: the implementation is a literal transcription of the formula, no library needed, ~3 lines of arithmetic.
5. **Schelling, T. C. (1971), "Dynamic Models of Segregation"** — `https://www.tandfonline.com/doi/abs/10.1080/0022250X.1971.9989794` (must be WebFetched; the abstract suffices, full text is paywalled). Load-bearing: Schelling's 1971 paper is the canonical reference for similarity-driven agent dynamics, and step 34 (linguistic migration) builds directly on his framework. Step 33 is the _measurement_ prerequisite for step 34's migration rule — the gaussian success rate is what makes "successful communication" a continuous quantity that movement decisions can be conditioned on. Citing Schelling here establishes the conceptual lineage and primes step 34's research notes.

**Paths not taken:**

6. **Aliasing `sigma` to the existing `preferentialAttachment.temperature`.** The PDF says "in our simulation Sigma is the temperature." **Rejected** because the two parameters control semantically different things: temperature is a softmax temperature applied to cosine similarity scores during partner selection (a _who do I talk to_ knob), while sigma is a Gaussian kernel width applied to Euclidean distance during success determination (a _how forgiving is communication_ knob). Sweeping the two together would prevent the researcher from independently tuning exploration-vs-exploitation in partner choice and tolerance-vs-strictness in communication. The cost of an extra config field is one Zod entry and one help-text bullet; the benefit is a clean ablation surface. If the researcher later confirms she wants them coupled, a step 36 can add `coupledSigmaTemperature: boolean` as a derived alias without breaking step 33's contract.
7. **Gating the deterministic rule with the gaussian rule (Ps as a stochastic filter on top of the truth-conditional check).** Considered: keep the existing "hearer must know the token" check, then additionally roll `rng.nextFloat() < Ps` to confirm. **Rejected** because this would require both conditions to be true for success — making success strictly rarer than today's deterministic rule and producing pathological `Ps ≈ 1` runs that look identical to v1. The PDF's framing is unambiguous: Ps _is_ the success probability, full stop. The gaussian rule **replaces** the truth-conditional check; the hearer's actual inventory is read only to score the distance between weight vectors, not to gate success. This produces a meaningfully different dynamic (consensus is reachable purely through weight-vector convergence, even when lexical token sets diverge) and is the dynamic the PDF is asking us to study.
8. **Computing the Gaussian over the full nested-Map inventory rather than the flat top-K vector.** Considered: skip `topKTokenVector` and walk the entire `(language, referent, lexeme)` triple-Map inventory directly, computing distances over every cell. **Rejected** because (a) the existing top-K infrastructure is already proven correct in step 14, (b) walking the full inventory at every interaction is O(L × R × |lexicon|) per interaction vs. O(K) for the cached top-K, and (c) the top-K selection naturally exposes "linguistic identity" (a small set of high-weight tokens) rather than the long tail of low-weight noise. The top-K approach mirrors what step 14's preferential-attachment uses, so the two new features (gaussian success, preferential attachment) share a single notion of "what makes two agents linguistically similar." The K parameter is exposed as `gaussianTopK` in the schema with default 10 (matching step 14's default).

**Total research items: 3 local Next docs + 2 external WebFetched (Wikipedia RBF, Schelling 1971) + 3 paths not taken = 8 citations**, satisfying the ≥ 5 floor with the required ≥ 3 / ≥ 2 / ≥ 1 breakdown.

## 5. Files to create

- `lib/schema/success.ts` — **the schema for the new successPolicy field**. Exports:
  - `export const SuccessPolicyKind = z.enum(['deterministic', 'gaussian']);`
  - `export const DeterministicSuccessPolicy = z.object({ kind: z.literal('deterministic') });`
  - `export const GaussianSuccessPolicy = z.object({ kind: z.literal('gaussian'), sigma: z.number().positive().default(1.0), gaussianTopK: z.number().int().positive().default(10) });`
  - `export const SuccessPolicyConfig = z.discriminatedUnion('kind', [DeterministicSuccessPolicy, GaussianSuccessPolicy]);`
  - `export type SuccessPolicyConfig = z.infer<typeof SuccessPolicyConfig>;`
  - `export const defaultSuccessPolicyConfig: SuccessPolicyConfig = { kind: 'deterministic' };`

  Bare relative imports (no `.js`, per `CLAUDE.md` "Known gotchas"). No `import 'server-only'` (schemas cross the worker boundary). The discriminated union form keeps the Zod parse strict — adding a third kind (e.g. `'sigmoid'`) in the future is one literal entry plus one variant.

- `lib/sim/engine/success-policy.test.ts` — **focused tests for the success-policy branch**. Lives in a subdirectory matching step 13's `lib/sim/engine/weight-update.test.ts` pattern. Section 9 enumerates 8 test cases. Pure TypeScript; default Vitest `node` environment.

All other changes are modifications, not new files.

## 6. Files to modify

- `lib/schema/experiment.ts` — append one field to the top-level `ExperimentConfig` Zod object: `successPolicy: SuccessPolicyConfig.default(defaultSuccessPolicyConfig)`. Add the corresponding import at the top. Append `defaultSuccessPolicyConfig` to whatever local `defaults` re-export exists. Total diff: ≤ 5 lines.

- `lib/schema/index.ts` (if it exists, otherwise the appropriate barrel) — re-export `SuccessPolicyConfig`, `SuccessPolicyKind`, `defaultSuccessPolicyConfig` so downstream code (engine, tests, future UI) can import from `@/lib/schema`.

- `lib/sim/similarity.ts` — append one new exported function:

  ```typescript
  export function euclideanDistanceSq(a: TokenVector, b: TokenVector): number {
    let sum = 0;
    for (const [key, av] of a) {
      const bv = b.get(key) ?? 0;
      const diff = av - bv;
      sum += diff * diff;
    }
    for (const [key, bv] of b) {
      if (!a.has(key)) {
        sum += bv * bv; // a-side missing → diff = 0 - bv
      }
    }
    return sum;
  }
  ```

  Mirror the docstring shape of `cosineSimilarity` (range, edge cases, implementation notes). The function returns 0 for identical vectors, 0 for two empty vectors, and is symmetric in its arguments by construction. No new imports.

- `lib/sim/engine.ts` — modify the success-determination branch in the tick body. Currently (per step 13):

  ```typescript
  const hearerWeight = hearer.inventory.get(language)?.get(referent)?.get(token);
  const success = hearerWeight !== undefined && hearerWeight > 0;
  ```

  Replace with a switch on `config.successPolicy.kind`. Pseudocode:

  ```typescript
  let success: boolean;
  let successProbability: number | null = null;
  switch (config.successPolicy.kind) {
    case 'deterministic': {
      const hearerWeight = hearer.inventory.get(language)?.get(referent)?.get(token);
      success = hearerWeight !== undefined && hearerWeight > 0;
      break;
    }
    case 'gaussian': {
      const k = config.successPolicy.gaussianTopK;
      const speakerVec = topKTokenVector(speaker.inventory, k);
      const hearerVec = topKTokenVector(hearer.inventory, k);
      const distSq = euclideanDistanceSq(speakerVec, hearerVec);
      const sigma = config.successPolicy.sigma;
      successProbability = Math.exp(-distSq / (2 * sigma * sigma));
      success = rng.nextFloat() < successProbability;
      break;
    }
    default: {
      const _exhaustive: never = config.successPolicy;
      throw new Error(`Unknown success policy kind: ${_exhaustive}`);
    }
  }
  ```

  Then thread `successProbability` into the `InteractionEvent` emission. Update the `InteractionEvent` type definition to add `readonly successProbability: number | null;`. The deterministic arm consumes **zero** new RNG draws, preserving determinism for every existing config-hash. The gaussian arm consumes **exactly one** `rng.nextFloat()` per interaction, called at a fixed point in the sub-step order (immediately before the success boolean is set). Document this with a comment at the gaussian branch.

  Also extend the docstring at the top of `engine.ts` (the "RNG Draw Order" comment from step 13) to add: `(e') Gaussian success: rng.nextFloat() — one draw, only when config.successPolicy.kind === 'gaussian'`. This keeps the determinism-contract documentation accurate.

- `lib/sim/engine.test.ts` — append 8 new tests (enumerated in section 9). Existing tests must remain unchanged and continue to pass — they all use the default `successPolicy: { kind: 'deterministic' }` so they exercise zero new code paths.

- `lib/sim/similarity.test.ts` — append 4 new tests for `euclideanDistanceSq` (enumerated in section 9). Existing `cosineSimilarity` tests untouched.

- `CLAUDE.md` — see section 11.

No other files modified. Worker file (`workers/simulation.worker.ts`), metrics, UI, db schema, auth, scripts: untouched.

## 7. Implementation approach

The work is ordered so the schema lands first (downstream code can typecheck against it), then the pure helper, then the engine modification, then the tests.

**Slice 1 — Write `lib/schema/success.ts`.** Define the discriminated union exactly as in section 5. Verify with `npm run typecheck` that the file compiles in isolation. Verify `SuccessPolicyConfig.parse({ kind: 'deterministic' })` succeeds and `SuccessPolicyConfig.parse({ kind: 'gaussian', sigma: 0.5 })` succeeds (sigma supplied → default not used; gaussianTopK defaults to 10). Verify `SuccessPolicyConfig.parse({ kind: 'gaussian', sigma: -1 })` throws (sigma must be positive).

**Slice 2 — Append `successPolicy` to `ExperimentConfig`.** Edit `lib/schema/experiment.ts` to add the field with `.default(defaultSuccessPolicyConfig)`. Add the import. Verify `ExperimentConfig.parse({})` (or whatever the minimal valid config is) returns an object with `successPolicy: { kind: 'deterministic' }`. Verify the existing-config-fixture tests in `lib/schema/experiment.test.ts` (if they exist) still pass — they should, because the new field defaults to the v1 behavior and adds zero observable change.

**Slice 3 — Write `euclideanDistanceSq` in `lib/sim/similarity.ts`.** Single-pass over the union of keys, mirroring the structure of `cosineSimilarity`. Add a thorough docstring covering: range `[0, ∞)`, returns 0 for identical vectors, returns 0 for two empty vectors, symmetric in arguments, no allocations beyond the iterator state. Run `npm test -- lib/sim/similarity` to confirm existing tests still pass.

**Slice 4 — Write the 4 `euclideanDistanceSq` tests** in `lib/sim/similarity.test.ts` (section 9 tests 1–4). All four are pure-arithmetic, deterministic, no RNG. Confirm green.

**Slice 5 — Modify the success branch in `lib/sim/engine.ts`.** Apply the switch from section 6. Add the `successProbability: number | null` field to the `InteractionEvent` type definition. Update the engine's RNG-draw-order docstring. Update the per-tick state immutability discipline docstring if it explicitly enumerated which fields were mutated (nothing about success-determination changed in that respect, but worth a one-line audit). Run `npm test -- lib/sim/engine` to confirm all step-13 tests still pass under the deterministic default.

**Slice 6 — Determinism audit.** Run `git stash` to revert the engine change temporarily. Run `npx tsx scripts/sim-smoke.ts` (or whatever the existing smoke script is) and capture the output. Restore the stash, run the smoke script again. Output must be **byte-identical** — the deterministic path is unchanged. If outputs differ, the switch fell through to the gaussian arm somewhere or the field-order changed in `InteractionEvent` (which would change `JSON.stringify` output). Fix before proceeding.

**Slice 7 — Write the 8 engine tests** in `lib/sim/engine.test.ts` or `lib/sim/engine/success-policy.test.ts` (section 9 tests 5–12). Use pinned seeds for the gaussian-mode tests; assert hand-computed Ps values for hand-built two-agent fixtures. The "one RNG draw per interaction" invariant test compares the post-tick `rng.state` (or equivalent) between deterministic and gaussian modes for the same input — gaussian must have advanced exactly N more draws where N = number of interactions. The "immutable input" test compares `JSON.stringify(speaker.inventory)` before and after a tick under gaussian mode and asserts unchanged.

**Slice 8 — Backwards-compatibility regression check.** Find any v1 test that has a "frozen" config-hash (step 32's e2e fixtures may include one). Verify the hash is unchanged after step 33's modifications — the SHA-256 of the canonical config JSON should be identical because the new field has a default and Zod's parse-with-defaults preserves missing-field semantics. If any frozen hash changes, step 33 has a regression.

**Slice 9 — CLAUDE.md update.** Append the bullet from section 11. Stay under the 30-lines-per-section cap.

**Slice 10 — Format and lint.** `npm run format`, `npm run lint`, `npm run typecheck`, `npm test`. All must pass. Squash any intermediate commits via `git reset --soft HEAD~N && git commit -m "step 33: gaussian success policy"`.

## 8. Library choices

**None new.** Step 33 uses only:

- `zod` (from step 01) for the new `SuccessPolicyConfig` schema.
- `vitest` (from step 00) for the test files.
- The step 09–14 `lib/sim/` modules (RNG, similarity, engine) as first-class dependencies.
- `Math.exp` from the standard library for the kernel evaluation.

**Out of scope for this step** (documented to prevent scope creep):

- Calibration metrics ("Ps was 0.7, did the interaction succeed 70% of the time?"). Add as a future scalar metric in a step 36+; the `successProbability` field on `InteractionEvent` is the raw signal that future step will read.
- Sigmoid, exponential, or rational success kernels. The Zod discriminated union allows adding `'sigmoid'` etc. as new arms without breaking step 33's contract — defer until research demand is concrete.
- Coupling sigma with the partner-selection temperature. Defer per path-not-taken 6.
- Per-(language, referent) sub-vector distances rather than full top-K. Defer until research demand is concrete; the top-K vector is the simpler primitive and matches step 14's convention.

## 9. Unit tests

Two test files, all deterministic, all running under Vitest's default `node` environment.

**`lib/sim/similarity.test.ts` — append 4 tests:**

1. **`euclideanDistanceSq` returns 0 for identical vectors.** Build `a = b = new Map([['L1:red', 1.0], ['L1:yellow', 0.5]])`. Assert `euclideanDistanceSq(a, b) === 0`.
2. **`euclideanDistanceSq` is symmetric.** For two non-trivial vectors `a` and `b`, assert `euclideanDistanceSq(a, b) === euclideanDistanceSq(b, a)` (exact equality, not approximate — the formula has no floating-point order dependence at this scale).
3. **`euclideanDistanceSq` handles missing keys correctly.** Build `a = new Map([['L1:red', 1.0]])`, `b = new Map([['L1:yellow', 1.0]])`. Distance squared = `(1-0)² + (0-1)² = 2`. Assert `euclideanDistanceSq(a, b) === 2`.
4. **`euclideanDistanceSq` returns 0 for two empty vectors.** Assert `euclideanDistanceSq(new Map(), new Map()) === 0`. (Edge case — must not divide by zero or NaN-out.)

**`lib/sim/engine.test.ts` (or `lib/sim/engine/success-policy.test.ts`) — append 8 tests:**

5. **Deterministic mode is byte-identical to pre-step-33.** Build a `SimulationState` with `successPolicy: { kind: 'deterministic' }`, run 50 ticks with seed 42, capture the full `interactions[]` and final agent states. Repeat with seed 42 a second time. Assert `JSON.stringify` equality. (Tests reproducibility within step 33; the cross-step regression is enforced by slice 6's smoke audit.)
6. **Gaussian mode is deterministic given a seed.** Build a `SimulationState` with `successPolicy: { kind: 'gaussian', sigma: 1.0, gaussianTopK: 10 }`, run 50 ticks with seed 42 twice. Assert `JSON.stringify(interactions)` equality. The single new `rng.nextFloat()` per interaction must be reproducible.
7. **Hand-computed Ps for a two-agent fixture.** Build two agents with hand-crafted inventories such that `topKTokenVector` produces known vectors `vA = {red: 1.0, yellow: 0.0}` and `vB = {red: 0.5, yellow: 0.5}`. Hand-compute: `‖vA - vB‖² = (0.5)² + (0.5)² = 0.5`. With `sigma = 1.0`, `Ps = exp(-0.5 / 2) = exp(-0.25) ≈ 0.7788`. Force a single interaction (smallest possible config: 1 speaker + 1 hearer in a well-mixed world) and assert the emitted `InteractionEvent.successProbability` equals `0.7788` to within `1e-9`.
8. **Limit: sigma → ∞ implies Ps → 1.** With `sigma = 1e9`, run 100 ticks with any non-trivial fixture, assert every emitted `successProbability` is within `1e-6` of `1.0`. (Sanity: arbitrarily wide kernel means almost every interaction is successful.)
9. **Limit: sigma → 0 implies Ps → 0 unless vectors identical.** With `sigma = 1e-9` and two agents whose vectors differ in any component, assert all emitted `successProbability` values are below `1e-100` (effectively zero). With identical vectors, `successProbability` must be exactly `1.0` (because `distSq = 0` exactly, so `exp(0) = 1`).
10. **`successProbability` field is `null` in deterministic mode.** Run a tick under deterministic mode, assert every emitted `InteractionEvent.successProbability === null`.
11. **`successProbability` field is non-null in gaussian mode.** Run a tick under gaussian mode with non-trivial fixtures, assert every emitted `InteractionEvent.successProbability` is a number in `[0, 1]`.
12. **One-RNG-draw-per-interaction invariant.** Build identical fixtures, run a tick under deterministic mode, count interactions `N_det` (`= interactions.length`). Run a tick under gaussian mode with the same fixtures and the same starting RNG state; the gaussian RNG must have advanced exactly `N_det` more `nextFloat` calls than the deterministic RNG (`pure-rand` exposes the underlying state; otherwise compare a downstream `nextFloat()` after the tick — gaussian's would be the deterministic's `(N_det)`-th subsequent draw). This invariant is the contract the determinism audit in slice 6 depends on.

All 12 tests run in under 1 second total on a development laptop.

## 10. Acceptance criteria

- `npm test -- lib/sim/similarity lib/sim/engine` exits 0 with all tests in section 9 passing (12 new + all existing).
- `npm run typecheck` exits 0. `SuccessPolicyConfig`, `SuccessPolicyKind`, the new `InteractionEvent.successProbability` field, and the new `euclideanDistanceSq` export all resolve end-to-end with no type errors.
- `npm run lint` exits 0 against the new file (`lib/schema/success.ts`) and the modified files (`lib/schema/experiment.ts`, `lib/sim/similarity.ts`, `lib/sim/engine.ts`, the test files).
- `npm run build` exits 0. Confirms the new schema and engine code do not break the Next.js production build (Turbopack must be able to bundle the modified `lib/sim/engine.ts` into both server and worker chunks).
- **Backwards-compatibility regression check passes**: `npx tsx scripts/sim-smoke.ts` (or equivalent v1 smoke entrypoint) produces byte-identical output before and after step 33's commit, when run with the default config (no `successPolicy` field supplied → defaults to deterministic). This is the load-bearing v1-preservation invariant.
- `grep -R "Math\.random\|Date\.now" lib/sim/engine.ts lib/sim/similarity.ts` returns zero matches — the engine still uses only the injected `RNG` for entropy.
- `grep -R "topology\.kind" lib/sim/engine.ts` returns zero matches — step 33 does not introduce a topology branch in the engine (the topology-agnostic invariant from step 10 is preserved).
- A single commit is produced with the subject `step 33: gaussian success policy`. Any intermediate commits during development are squashed before advancing.
- No UI verification harness — `ui: false`. `scripts/run-plan.ts` does not spin up a dev server for this step.

## 11. CLAUDE.md updates

Append **at most one bullet** to `CLAUDE.md` "Known gotchas" (≤ 4 lines):

> - The `successPolicy: 'gaussian'` mode in `lib/sim/engine.ts` adds **exactly one `rng.nextFloat()` draw per interaction** in the success-determination sub-step. The default `'deterministic'` mode adds zero new draws, preserving bit-identical determinism with all pre-step-33 runs and config-hashes. Adding a third success-policy kind in the future must follow the same discipline: per-mode RNG accounting documented in the engine's RNG draw-order comment, and a "deterministic mode unchanged" backwards-compat test in `lib/sim/engine.test.ts`.

Do not touch any other `CLAUDE.md` section. The "Directory layout" already covers `lib/schema/` and `lib/sim/`. The "Schemas" pattern is already established. If during implementation a new failure mode emerges that warrants documentation, add at most one additional bullet (total append ≤ 8 lines).

## 12. Commit message

```
step 33: gaussian success policy
```

Exactly this string, no conventional-commit prefix, no trailing text, no body. `scripts/run-plan.ts` greps `git log` for this marker. If intermediate commits appear during implementation, they must be squashed via `git reset --soft HEAD~N && git commit -m "step 33: gaussian success policy"` before advancing.

## 13. Rollback notes

If step 33 must be undone (e.g. step 34's linguistic migration reveals a contract bug in the new `SuccessPolicyConfig` shape that's cheaper to redo than to patch):

1. Identify the prior commit SHA via `git log --oneline --grep='step '`. Expect `step 32: polish and e2e smoke`.
2. `git reset --hard <prior-sha>` — discards `lib/schema/success.ts`, the modifications to `lib/schema/experiment.ts`, the modifications to `lib/sim/similarity.ts`, the modifications to `lib/sim/engine.ts`, the test additions, and the CLAUDE.md bullet.
3. No dependencies were added; `package.json` and `package-lock.json` unchanged.
4. Verify `npm run typecheck && npm run lint && npm test` on the rolled-back tree — should be all green because step 32 was the last green state.
5. Re-run the pipeline from step 33 with an adjusted plan that captures whatever contract change step 34 surfaced. Step 34 imports `SuccessPolicyConfig` only as a type reference (it does not depend on gaussian-mode behavior at runtime), so a contract rewrite of step 33 likely does not require step 34 to be re-derived from scratch.
