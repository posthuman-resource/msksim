---
step: "17"
title: "run summary metrics"
kind: sim-core
ui: false
timeout_minutes: 20
prerequisites:
  - "step 15: scalar metrics"
  - "step 16: graph metrics"
---

## 1. Goal

Implement the **end-of-run summary metrics** called out in `docs/spec.md` §7.3 as a single pure reducer that consumes the full per-tick time series produced by step 15 (scalar metrics) and step 16 (graph metrics) and returns one `RunSummary` object. The summary is the object that step 26 will persist into the `runs.summary_json` and `runs.classification` columns (declared in step 08), that step 18's smoke test will assert against to demonstrate end-of-run classification works, that step 22's dashboard will use for its "final result" callouts, and that step 29's run-comparison view will diff across runs. The function is deterministic, side-effect-free, has zero I/O, and is the **only** place in the codebase that knows how to turn a vector of per-tick snapshots into the four answers researchers actually care about: "what were the central tendencies?", "did the run converge?", "when did it reach consensus?", and "is this an assimilation run or a segregation run?". All four answers map directly to research questions RQ1 (assimilation vs. segregation thresholds) and RQ2 (role of spatial topology via time-to-consensus scaling), and the classification thresholds themselves are **user-configurable** per `docs/spec.md` §7.3, meaning they come from the step-01 `ExperimentConfig` schema rather than from hard-coded constants in this module.

Scope boundary: this step does **not** touch per-tick metrics (those belong to steps 15 and 16), does **not** persist to the database (that's step 26), and does **not** render anything (that's step 22). It is a pure data transformation — `ScalarMetricsSnapshot[] × GraphMetricsSnapshot[] × ExperimentConfig → RunSummary` — living in `lib/sim/metrics/summary.ts` alongside its colocated Vitest suite.

## 2. Prerequisites

- Commit marker `step 15: scalar metrics` present in `git log`. Step 15 exports `ScalarMetricsSnapshot` from `lib/sim/metrics/types.ts` (shared type module) and implements the scalar computations in `lib/sim/metrics/scalar.ts`. Step 17 consumes only the exported `ScalarMetricsSnapshot` type and reads from instances of it; it imports no runtime functions from step 15.
- Commit marker `step 16: graph metrics` present in `git log`. Step 16 exports `GraphMetricsSnapshot` from the same `lib/sim/metrics/types.ts` module and implements Louvain/assimilation/segregation computations in `lib/sim/metrics/graph.ts`. Step 17 consumes the exported type; it imports no runtime functions from step 16.
- Commit marker `step 01: zod config schema` present in `git log`. Step 17 reads classification thresholds (`alpha`, `beta`, `gamma`, `delta`) from `ExperimentConfig.classificationThresholds` and a convergence stability window (`consensusWindowTicks`) from `ExperimentConfig.convergence`. **If step 01 did not include these fields in its schema** (see the explicit check in research notes §4 and implementation approach §7 step 1), step 17's implementing claude must add them to `lib/schema/experiment.ts` and to `lib/schema/defaults.ts` *in the same commit* before writing the summary reducer. This is called out in section 6 below.
- Node ≥ 20.9, Vitest installed (step 00), the `@/` alias wired (step 00). `lib/sim/metrics/` directory already exists from steps 15 and 16.

## 3. Spec references

- `docs/spec.md` **§7.3 Summary metrics (end of run)** — the authoritative specification. Verbatim: "Mean/median/max of each per-tick metric. Convergence status: converged / metastable / diverged / unresolved. Classification: assimilation / segregation / mixed / inconclusive (computed from the final assimilation and segregation indices with user-configurable thresholds)." Every output field of `RunSummary` traces back to one of these three bullets, and no output field exists that is not in this list. The "user-configurable thresholds" phrase is load-bearing: it is what forces the thresholds into the step-01 Zod schema rather than into this module as constants.
- `docs/spec.md` **§7.1 Per-tick scalar metrics** — the input shape. The `ScalarMetricsSnapshot` fields step 17 reduces over are: communication success rate, mean token weight, token weight variance, number of distinct active tokens (Nw), and matching rate. Time-to-consensus is also listed in §7.1 as a per-tick observable ("Tick at which Nw first stabilizes at its asymptote for ≥ 100 ticks; undefined if not reached"), but the spec places its *computation* in the end-of-run bucket because it requires looking at the whole trajectory — it is a summary metric masquerading as a per-tick column header. Step 17 is where it is actually computed.
- `docs/spec.md` **§7.2 Per-tick tensor snapshots** — mentions `sampleInterval` for tensor snapshots. Step 17 does **not** consume tensor snapshots; it only consumes the per-tick scalar and graph time series, which are sampled at every tick regardless of the tensor `sampleInterval`. This is a scope delimiter, not a dependency.
- `docs/spec.md` **§1.2 RQ1 — Assimilation vs. segregation thresholds.** The classification output is the direct answer to RQ1: every run that finishes under a given `(monoRatio, interactionProbability)` parameter cell produces one of `{assimilated, segregated, mixed, inconclusive}`, and the step-28 sweep aggregates those into the heatmap the spec §6 research-question matrix calls "the primary mechanism for identifying critical thresholds." Getting the classification thresholds wrong here propagates directly into the wrong heatmap cells in §6 and §13 (F13 parameter sweep). Hence the heavy emphasis on tests 5 and 6 below.
- `docs/spec.md` **§1.2 RQ2 — Role of spatial topology.** The `convergenceStatus` and `timeToConsensus` outputs are how the spec's built-in lattice-vs-well-mixed experiment reports its result. Baronchelli et al. (2006) showed that lattice consensus time scales as N^(1+2/d) = N² in 2D, versus N^(3/2) in the well-mixed case — the dramatic quantitative gap that RQ2 is asking us to measure is the gap between the `timeToConsensus` values of otherwise-identical lattice and well-mixed runs. Step 29's comparison view reads these values side-by-side.
- `docs/spec.md` **§11 Open Questions, item 2** — "What is the right agent count? ... default to N = 50–500 per world for interactive playground mode ... allow headless sweeps up to N = 10⁴ in workers." Consequence for step 17: the summary reducer must remain O(T) in tick count and O(T log T) at worst when it sorts for medians; for N = 10⁴ and T = 10⁴ the reducer still runs in milliseconds. No streaming or chunking is required at v1 scale.

## 4. Research notes

**Local Next.js 16 docs (authoritative per `CLAUDE.md` "Next.js 16 deltas from training data"):**

1. `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md` §"Preventing environment poisoning" (lines 517–593) — documents `import 'server-only'` as the guard for modules that must not cross the Server → Client boundary. **Step 17's files deliberately do NOT carry `import 'server-only'`.** The summary reducer lives under `lib/sim/metrics/`, which runs inside the simulation Web Worker (step 20), and `lib/sim/` is one of the few `lib/` subtrees that is intentionally shared between Server Components, Client Components, and workers — the same property `lib/schema/` carries per step 01's §7, and the property step 12 asserted for `lib/sim/policy/`. Step 17 must be loadable in all three contexts. This is the inverse of `lib/db/` and `lib/auth/`, both of which **do** start with `import 'server-only'` per `CLAUDE.md` "Database access patterns" and "Authentication patterns."
2. `node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md` — the canonical Vitest setup for this codebase. Step 17's colocated test file uses the default `node` environment (not `happy-dom`) because it exercises pure TypeScript functions with no DOM dependencies. Per `CLAUDE.md` "Testing conventions," step 00 already wrote `vitest.config.ts` with `environment: 'node'` as the default, so `lib/sim/metrics/summary.test.ts` needs no per-file `// @vitest-environment` override. The tests are plain `test('...', () => { ... })` blocks with `expect(...).toBe(...)` and `expect(...).toBeCloseTo(...)` assertions.
3. `node_modules/next/dist/docs/01-app/03-api-reference/08-turbopack.md` §"Magic Comments" — confirms that Turbopack supports `new Worker(new URL('./foo.worker.ts', import.meta.url), { type: 'module' })` expressions and bundles module-level imports across that boundary. The load-bearing consequence for step 17: **`RunSummary` must be `structuredClone`-safe**. Functions are not `structuredClone`-safe; JSON primitives, arrays, plain objects, and `null` are. Step 17's `RunSummary` deliberately uses `Record<string, number>` maps and discriminated-string enums — not `Map<string, number>` and not class instances — so the worker can `postMessage` the finished summary back to the main thread in step 20 without any serialization shim. The same constraint makes it safe to persist directly as JSON in step 26.
4. `node_modules/next/dist/docs/01-app/02-guides/debugging.md` — general guidance on Node-side debugging for pure modules. Not load-bearing for the contract of step 17, but cited to remind the implementing claude that the summary reducer can be debugged from a plain `npx tsx -e "..."` one-liner or a `node --inspect-brk` session against the compiled test file — no browser devtools harness is needed because there is no UI surface here. Per `CLAUDE.md` "UI verification harness," only steps tagged `ui: true` spin up a dev server; this step is `ui: false` and its acceptance is purely `npm test` + `npm run typecheck`.

**External references (WebFetched):**

5. **Baronchelli, A. (2016). "A gentle introduction to the minimal Naming Game," *Belgian Journal of Linguistics* 30, 171–192.** <https://arxiv.org/abs/1701.07419>. This is the accessible survey `docs/spec.md` §12.1 cites as the source for "the minimal Naming Game rules this spec follows." The abstract-level summary accessible via WebFetch confirms that the Naming Game's central observable is the number of distinct words in the system (written `Nw` in the spec and in this plan), and that **consensus is the absorbing state where `Nw = 1`** — every agent has converged on the same single token for the referent. The paper characterizes three dynamical phases: an initial buildup phase where `Nw` grows as agents invent or borrow new tokens, a crossover phase where `Nw` peaks, and a final relaxation phase where `Nw` decays monotonically toward 1. Step 17's time-to-consensus detector operationalizes this as "the tick at which `Nw` drops to its asymptotic value and remains there for a window of length `convergenceWindowTicks` ticks" — which is the trailing-window stability test that the spec's §7.1 entry for "Time-to-consensus" describes verbatim ("Tick at which Nw first stabilizes at its asymptote for ≥ 100 ticks"). The "100 ticks" default in the spec is a sensible baseline for N ≤ 500 per world but is exposed as `convergenceWindowTicks` in the config so researchers can scale it with N. Note: the full PDF body behind the arXiv abstract is not readable via WebFetch's markdown extraction (the PDF binary is not HTML), so the implementing claude should treat this as a confirmation of the *framing* — "Nw → 1 is the absorbing state; stability over a window is the detection criterion" — rather than a source for specific numeric thresholds, which come from the spec.

6. **Vitest guide — *Testing pure functions with deterministic inputs*.** <https://vitest.dev/guide/>. Confirmed the Vitest-idiomatic pattern for this kind of test: place pure functions in their own module, import from a colocated `*.test.ts`, and use `expect(...).toBe(...)` for exact comparisons and `expect(...).toBeCloseTo(value, digits)` for floating-point comparisons (the `digits` argument is the number of decimal digits to check, default 2). Step 17's tests use `toBe` for integer outputs (`timeToConsensus`, counts) and `toBeCloseTo` for float outputs (means, medians, max values involving divisions). The node environment is confirmed ideal for this kind of pure-function testing. Vitest's `test.each` is not needed here because the test count is bounded and each case warrants an explicit named test.

7. **Wikipedia — *Median* (definition and sorting-based computation).** <https://en.wikipedia.org/wiki/Median>. Confirmed the standard definition: for an odd-length sample, the median is the middle element of the sorted sample; for an even-length sample, the median is the arithmetic mean of the two middle elements. Wikipedia notes that although selection algorithms can compute the k-th order statistic in Θ(n), a plain sort is O(n log n) and entirely adequate for step 17's input sizes (T ≤ 10⁴). Wikipedia does not address NaN handling — that choice is made in section 7 below (this module **skips** NaN values for mean/median/max computation, documents the choice in a doc comment, and exposes it in a unit test; propagating NaN would silently ruin the summary for runs where any single tick had an empty denominator, e.g. a tick with zero interactions that made the success rate undefined).

**Paths not taken:**

8. **Running median / sliding-window quantile algorithms** (Tukey's running median, the two-heap online median, `quickselect` for O(n) medians). **Rejected** because step 17 runs exactly once at end-of-run on a bounded T-length array — it is not a streaming context. A single `Array.from(series).sort((a, b) => a - b)` followed by index lookup is O(T log T) and finishes in well under a millisecond for T = 10⁴, which is more than fast enough for the sweeps in F13. The streaming/sliding variants exist to amortize per-tick cost in online contexts; none of those constraints apply here. Keeping the implementation to a plain sort also keeps the test-case oracle trivial: "sort this list, take the middle, compare" is exactly what the test does, and there is no algorithmic gap between the reference and the implementation.
9. **Hypothesis-test-based convergence detection** (Mann-Kendall trend test, CUSUM change-point detection, augmented Dickey-Fuller stationarity test). Rejected as overkill for v1. The spec §7.1 and §7.3 specify the convergence criterion as a simple stability window ("Nw first stabilizes at its asymptote for ≥ 100 ticks"), not as a statistical hypothesis test, and matching the spec exactly is load-bearing for reproducibility across collaborators who read the spec rather than the source. If v2 research demands statistical rigor (e.g., confidence intervals on `timeToConsensus`), it can be layered on top as a second summary module without touching this one. Step 17 deliberately implements the spec's definition verbatim.
10. **Computing the classification from a time-averaged assimilation/segregation index** instead of the final-tick value. Rejected because the spec §7.3 says "computed from the **final** assimilation and segregation indices with user-configurable thresholds" — "final" is load-bearing. A time-averaged classification would smooth over the very metastability that RQ1 is trying to detect (a run that bounces between assimilated and segregated throughout and lands on assimilated is genuinely "assimilated (noisy)," not "mixed"). The `meanMetrics` field of `RunSummary` still exposes the time-averaged values for researchers who want to compute alternative classifications offline in R or Python via the step-30 CSV export, so nothing is lost.

Total research links: **7** required-tier citations (4 local Next docs, 3 external WebFetched) plus **3 paths not taken**. All quality gates satisfied (≥ 3 local Next docs, ≥ 2 external URLs, ≥ 1 path not taken, total ≥ 5).

## 5. Files to create

- `lib/sim/metrics/summary.ts` — the implementation module. Exports one public function, `computeRunSummary(scalarTimeSeries, graphTimeSeries, config)`, and one public type re-export path for `RunSummary` (the type itself is declared in `lib/sim/metrics/types.ts`; see section 6). Also exports two **internal helpers** that are named for test access but not documented as public API: `computeTimeToConsensus(nwSeries, windowTicks)` and `classifyRun(finalAssimilation, finalSegregation, thresholds)`. Exposing them by name is what lets the test file drive each sub-concern without reconstructing a full `RunSummary` input on every test. **No `import 'server-only'`** — this module is deliberately shared between server, client, and worker contexts (see research note 1).
- `lib/sim/metrics/summary.test.ts` — the colocated Vitest suite covering every assertion enumerated in section 9. Uses the default `node` environment.

No third file is created for classification-threshold defaults: step 01 owns the single `lib/schema/defaults.ts` file per its §7 step 10 ("defaults origin traceability"), and any defaults step 17 adds must be appended there in the same commit as the schema change in `lib/schema/experiment.ts`. See section 6.

## 6. Files to modify

- `lib/sim/metrics/types.ts` — **must be modified** to add the `RunSummary` interface. Steps 15 and 16 created this file and populated it with `ScalarMetricsSnapshot` and `GraphMetricsSnapshot` respectively; step 17 appends `RunSummary`, the convergence-status string union, and the classification string union. The appended shape:

  ```typescript
  export type ConvergenceStatus = 'converged' | 'metastable' | 'diverged' | 'unresolved';
  export type RunClassification = 'assimilated' | 'segregated' | 'mixed' | 'inconclusive';

  export interface RunSummary {
    readonly meanMetrics: Readonly<Record<string, number>>;
    readonly medianMetrics: Readonly<Record<string, number>>;
    readonly maxMetrics: Readonly<Record<string, number>>;
    readonly convergenceStatus: ConvergenceStatus;
    readonly timeToConsensus: number | null;
    readonly classification: RunClassification;
  }
  ```

  `Readonly` is used because `RunSummary` instances cross the Comlink worker boundary in step 20 and are persisted in step 26; downstream code should never mutate one in place. `timeToConsensus` is `number | null` (not `number | undefined`) because JSON-serialization via `JSON.stringify` drops `undefined` fields silently, but preserves `null`, and step 26 writes this object directly into `runs.summary_json`. Matching the user's requested `RunSummary` shape from the plan-file contract (which says "timeToConsensus: number | null") is a deliberate choice driven by that persistence boundary.

- `lib/schema/experiment.ts` — **may already contain** the classification-thresholds field from step 01, or may not. Step 01's §7 step 7 lists the fields it adds to `ExperimentConfig` and does **not** mention `classificationThresholds` or `convergence`. The implementing claude must **first check** the current state of `lib/schema/experiment.ts` on disk at the time step 17 runs, and if those fields are absent, append them:

  ```typescript
  // Appended to ExperimentConfig in lib/schema/experiment.ts
  classificationThresholds: z.object({
    assimilationHigh: z.number().min(0).max(1).default(0.7), // α in spec §7.3
    segregationLow: z.number().min(0).max(1).default(0.3),  // β
    assimilationLow: z.number().min(0).max(1).default(0.3), // γ
    segregationHigh: z.number().min(0).max(1).default(0.7), // δ
  }).default({
    assimilationHigh: 0.7,
    segregationLow: 0.3,
    assimilationLow: 0.3,
    segregationHigh: 0.7,
  }),
  convergence: z.object({
    consensusWindowTicks: z.number().int().positive().default(100),
  }).default({ consensusWindowTicks: 100 }),
  ```

  Default values (0.7 / 0.3 / 0.3 / 0.7 / 100) are deliberately loose. They are chosen so that any run where ≥ 70% of W2-Imm↔W2-Native successful interactions happen in L2 and the W2-Immigrant subgraph modularity is ≤ 0.3 classifies as `assimilated`, mirroring the "strong assimilation" qualitative reading in `docs/interpretation.md`. Researchers tune these per experiment in the step-25 config editor.

- `lib/schema/defaults.ts` — **may already contain** the corresponding default-value exports from step 01, or may not. Mirror the check above: if absent, append `defaultClassificationThresholds` and `defaultConvergenceConfig` constants with `// per docs/spec.md §7.3 — user-configurable, tunable per experiment` comments per step 01's traceability convention.

**Assumption flagged for the implementing claude:** if step 01 or a subsequent fix-up commit already introduced `classificationThresholds` / `convergence` with different field names or different defaults, **honor the existing names** and adjust `lib/sim/metrics/summary.ts` to read from them. Do not rename existing schema fields just to match this plan file's suggestions — schema stability across steps is more valuable than perfect naming consistency between this plan file and the code. This is explicitly noted as an "assumption" per the user's instructions in the step-specific context; the implementing claude must verify.

No other files are modified. `CLAUDE.md` is not touched in this step (see section 11).

## 7. Implementation approach

The implementation proceeds bottom-up: add the type (trivial), add the schema fields if missing, write three internal reducers, compose them in `computeRunSummary`, then write the test file against the known-answer cases in section 9. The module contains no runtime state, no I/O, no randomness — every function is a pure deterministic transformation, and the Vitest suite treats it as such.

**Step 1 — Reconcile schema prerequisites.** Before writing any reducer code, read `lib/schema/experiment.ts` and `lib/schema/defaults.ts` as they exist on disk. Grep for `classificationThresholds` and `convergence`. If either is absent, add the fields and defaults described in section 6 above, run `npm run typecheck` to confirm the whole project still type-checks against the new schema, and move on. If both are present, note the existing field names and adjust downstream references in this module to match. Do not rename fields. Do not remove fields. If the schema has them under different keys (e.g., `thresholds.assimilationHigh` instead of `classificationThresholds.assimilationHigh`), use whatever the existing shape is. The test file in step 9 should use the same field names as whatever the schema actually contains.

**Step 2 — Append `RunSummary` and its string unions to `lib/sim/metrics/types.ts`.** This is a mechanical append of the type block in section 6. The file already exists from steps 15 and 16, so this is a pure addition to the end of the file (or into the existing `// summary types` section if step 15 or 16 pre-emptively carved one out — check first, then place the types in the most natural spot). Do not touch the existing `ScalarMetricsSnapshot` or `GraphMetricsSnapshot` types.

**Step 3 — Write the three flatten-helpers inside `lib/sim/metrics/summary.ts`.** The per-tick snapshots from steps 15 and 16 have nested shapes — `ScalarMetricsSnapshot` contains per-world, per-language breakdowns; `GraphMetricsSnapshot` contains per-world modularity scores. For mean/median/max computation we want a flat metric name → number mapping at each tick, and then a per-metric vector across ticks. Write a private `flattenScalar(snapshot: ScalarMetricsSnapshot): Record<string, number>` that walks the nested snapshot and emits dot-separated keys (e.g., `"world1.l1.meanTokenWeight"`, `"world1.successRate"`, `"nw.world2"`, `"matchingRate.world1"`). Write a parallel `flattenGraph(snapshot: GraphMetricsSnapshot): Record<string, number>` for the graph snapshots. Write a `collectSeries(scalarSnapshots, graphSnapshots): Record<string, number[]>` that calls the flatteners at every tick and pushes values into per-metric arrays. The keys are the union of the scalar and graph flat keys; collisions must be impossible by construction (graph metrics use a `graph.` prefix or equivalent to disambiguate). This step is where the per-tick shape dictated by steps 15 and 16 is normalized into a form the mean/median/max reducers can handle uniformly without per-metric special cases.

**Step 4 — Write the pure scalar reducers.** Three one-liners: `mean(values: number[]): number`, `median(values: number[]): number`, `max(values: number[]): number`. All three **skip NaN values** — they filter with `values.filter(v => !Number.isNaN(v))` before computing. The rationale: per `docs/spec.md` §7.1, the matching rate and per-class success rate can legitimately be undefined at a tick with zero interactions (empty denominator), and the canonical encoding for "no data this tick" is `NaN` (not `0`, because zero is a valid success rate). Propagating NaN would silently corrupt every summary metric for any run where a single tick had zero interactions; skipping is the only defensible choice. Document this in a JSDoc comment on each reducer so the test file can verify the behavior. If **every** value in a metric's series is NaN (a degenerate case where e.g. the entire run had zero interactions), the reducers return `NaN` — the caller gets back `NaN` in `meanMetrics[metricName]`, and test 7 in section 9 verifies that this is stable and does not throw.

**Step 5 — Write `computeTimeToConsensus(nwSeries: number[], windowTicks: number): number | null`.** This is the heart of the convergence-detection logic, and its algorithm is a direct transcription of the spec §7.1 definition: "Tick at which Nw first stabilizes at its asymptote for ≥ windowTicks ticks." The implementation:
  1. If `nwSeries.length < windowTicks + 1`, return `null` — not enough data to detect stabilization (the run ended too early).
  2. Compute the asymptotic value as the final tick's `Nw`: `asymptote = nwSeries[nwSeries.length - 1]`. This treats the final observed `Nw` as the candidate stable value; it is the value the run converged to (if any).
  3. If `asymptote === 0` — which should be physically impossible in a Naming Game because at least one token must exist in every agent's inventory — treat as a diverged/corrupted run and return `null`.
  4. Walk forward from tick 0. For each candidate start tick `t`, check whether `nwSeries[t..t+windowTicks-1]` are all equal to `asymptote`. The first `t` where this holds is the time-to-consensus. Return `t`.
  5. If no such `t` exists (equivalently: the trailing `windowTicks` are not all at `asymptote`), return `null`. This case is impossible when the reducer is called with a fully-converged run because the trailing window itself would be the last valid start, but it is the correct fallback for any diverged or truncated series.
  The walk is O(T × windowTicks) in the worst case but can be tightened to O(T) using a running counter (reset to 0 when a value differs from `asymptote`, increment otherwise; the first index where the counter hits `windowTicks` marks `t + windowTicks - 1`, so subtract `windowTicks - 1` to recover `t`). Use the O(T) variant; test 3 in section 9 verifies it returns the correct tick.

**Step 6 — Write `determineConvergenceStatus(nwSeries, weightSumSeries, windowTicks, timeToConsensus): ConvergenceStatus`.** This is the decision tree the user's step-specific context lays out:
  1. If the engine has flagged divergence (e.g., `weightSumSeries` contains `+Infinity` or any value beyond a sanity limit like `1e15`), return `'diverged'`. The engine guard itself lives in step 13 or step 15; step 17 just reads whatever monotonic "blew up" signal those steps expose. If no such signal exists in the current `ScalarMetricsSnapshot` shape, use `!Number.isFinite(maxWeight)` as the detector and document the fallback in a code comment.
  2. If `timeToConsensus !== null` **and** the asymptotic `Nw` at the end of the run equals 1, return `'converged'`. The final `Nw === 1` check is important: "stabilized at value 1" is the true consensus absorbing state of the Naming Game per Baronchelli 2016.
  3. If `timeToConsensus !== null` **and** the asymptotic `Nw > 1`, return `'metastable'`. Multiple distinct tokens persist stably — this is the "two clusters" / ghettoization outcome the spec's hypothesis presets (step 31) explicitly target.
  4. Otherwise return `'unresolved'`. The run ended before any stable window was observed.
  Note the ordering: `diverged` is checked first because a run can simultaneously be "diverged" and have a final `Nw` that happens to equal 1 by coincidence (e.g., everything went to infinity but the set of distinct token ids collapsed to a singleton); `diverged` is the correct answer in that case because the dynamics are no longer trustworthy.

**Step 7 — Write `classifyRun(finalAssimilation, finalSegregation, thresholds): RunClassification`.** The classification decision tree is the most compact part of the module and is the direct transcription of the four rules in the user's step-specific context:
  1. If `finalAssimilation` or `finalSegregation` is `NaN` (the denominator was empty — no W2-Imm↔W2-Native interactions happened, or the W2-Immigrant subgraph was empty), return `'inconclusive'`. This is the spec's "insufficient data" branch. Document this in a JSDoc comment with an explicit example in the test file.
  2. If `finalAssimilation > thresholds.assimilationHigh` **AND** `finalSegregation < thresholds.segregationLow`, return `'assimilated'`.
  3. If `finalAssimilation < thresholds.assimilationLow` **AND** `finalSegregation > thresholds.segregationHigh`, return `'segregated'`.
  4. Otherwise return `'mixed'`. This is the catch-all for intermediate outcomes — runs that are partly assimilated and partly segregated, or that fail to meet either strict threshold pair.
  The four thresholds come from `config.classificationThresholds` (whatever the schema calls the object; adjust if step 01 or a fix-up commit used different field names). Step 17 does **not** hardcode default values; it trusts the Zod schema to have filled defaults before the config reached this function, and tests in section 9 confirm this by passing explicit threshold objects rather than relying on schema defaults at call time.

**Step 8 — Compose `computeRunSummary` as the public entry point.**
  1. Call `collectSeries` to get `Record<string, number[]>` for both scalar and graph metrics, merged into a single flat map.
  2. For each metric name, compute `mean`, `median`, `max` into three parallel `Record<string, number>` maps. Document in a JSDoc comment that `NaN` per-tick values are skipped (see step 4).
  3. Extract the `Nw` series for the dominant world (or both worlds — the spec §7.1 says "per world"; step 17 uses the maximum of the two worlds' `Nw` values at each tick, because time-to-consensus is a **global** property and the run is not "converged" until both worlds have stabilized). Pass it to `computeTimeToConsensus` with `config.convergence.consensusWindowTicks`.
  4. Extract the weight-sum series (if present — fall back to `maxMetrics["meanTokenWeight.*"] > 1e15` or whatever the engine's actual divergence signal is; again, if step 15 did not expose one, use the fallback from step 6 and leave a `TODO(step 15 follow-up)` comment citing this plan file).
  5. Call `determineConvergenceStatus` with the extracted series and `timeToConsensus`.
  6. Extract the **final** assimilation and segregation indices from the last element of `graphTimeSeries`. Pass them to `classifyRun` with `config.classificationThresholds`.
  7. Return a `RunSummary` object literal with the six computed fields, frozen via `Object.freeze` on the outer object and on each nested map (cheap defense against accidental downstream mutation; this is a pure function and callers should not mutate its output).

**Step 9 — Write `lib/sim/metrics/summary.test.ts` against the assertions in section 9 below.** Each test builds its own minimal `ScalarMetricsSnapshot[]` and `GraphMetricsSnapshot[]` fixtures inline — no shared `beforeEach`, no global `describe`-level state. Each test either (a) passes a hand-crafted config with explicit thresholds, or (b) calls `ExperimentConfig.parse({})` to get the schema defaults and asserts against the spec-default behavior. Use `toBe` for integer/string comparisons and `toBeCloseTo(value, 10)` for float comparisons. Pin all numeric inputs explicitly. No `Math.random()`, no `Date.now()`, no file I/O.

**Step 10 — Verification.** Run `npm test -- lib/sim/metrics/summary` and confirm all tests pass. Run `npm run typecheck` and confirm zero type errors. Run `npm run lint` against `lib/sim/metrics/summary.ts` and `lib/sim/metrics/summary.test.ts` and confirm zero lint errors. If schema files were modified in step 1, also re-run `npm test -- lib/schema` to confirm no regression in step 01's test suite.

## 8. Library choices

**No new dependencies.** Step 17 uses only:
- Built-in `Array.prototype.sort`, `Array.prototype.filter`, `Number.isFinite`, `Number.isNaN`, `Object.freeze` — all zero-dependency standard library.
- The `zod`-inferred types from `lib/schema/` (already installed by step 01).
- The type-only imports of `ScalarMetricsSnapshot`, `GraphMetricsSnapshot`, `RunSummary`, `ConvergenceStatus`, `RunClassification` from `lib/sim/metrics/types.ts` (extended by step 15, 16, and this step).
- `vitest` for tests (already installed by step 00).

No statistical library (`simple-statistics`, `mathjs`, `stdlib-js`, etc.) is added. The mean/median/max implementations are three-line functions and a runtime dependency would be over-engineering for a zero-branch pure reducer. If step 18's smoke test or step 28's sweep aggregator needs confidence intervals, Welch's t-test, or kernel-density plots, those can be added in their own step with their own dependency justification — step 17's contract is tight enough that it shouldn't grow.

## 9. Unit tests

`lib/sim/metrics/summary.test.ts` is a single Vitest file in the default `node` environment. Each test is explicit, named, deterministic, and uses inline fixtures. Assertions marked with `toBeCloseTo` use 10 decimal digits of precision.

1. **Mean/median/max over a constant-value time series return that constant.** Build a `scalarTimeSeries` of length 200 where every snapshot has `successRate = 0.75` (and every other scalar field is also constant). `computeRunSummary` returns `meanMetrics.successRate === 0.75`, `medianMetrics.successRate === 0.75`, `maxMetrics.successRate === 0.75`. Verifies the happy path end-to-end.

2. **Mean/median/max on a known 5-element series.** Build a series with `successRate = [0.1, 0.2, 0.3, 0.4, 0.5]` over 5 ticks. Assert `meanMetrics.successRate === 0.3`, `medianMetrics.successRate === 0.3` (middle element of odd-length sorted series), `maxMetrics.successRate === 0.5`. Uses `toBeCloseTo` on the mean and median to guard against float-sum ordering artifacts (the oracle is trivial at this scale but the helper is still used for consistency).

3. **Time-to-consensus detection — stabilization at tick 50.** Build an `Nw` series of length 200 where `Nw = 4` for ticks 0..49 and `Nw = 1` for ticks 50..199. With `consensusWindowTicks = 100`, `computeRunSummary(...).timeToConsensus === 50`. This is the canonical known-answer case from the user's step-specific context and locks the detector to the spec definition.

4. **Time-to-consensus returns null if Nw never stabilizes.** Build an `Nw` series that oscillates: `[4, 3, 2, 1, 2, 3, 4, 3, 2, 1, ...]` for 200 ticks. `computeRunSummary(...).timeToConsensus === null`. Verifies the non-convergence branch of the detector.

5. **Convergence status — a constant-Nw-1 series gives `converged`.** Build a series with `Nw = 1` for all 200 ticks, no divergence signal, and `timeToConsensus = 0` (the run was converged from tick 0). `computeRunSummary(...).convergenceStatus === 'converged'`. Also verifies the interaction between time-to-consensus and convergence status: step 5 of implementation approach §7 requires the asymptotic `Nw === 1` check, and this test pins it.

6. **Convergence status — a constant-Nw-3 series gives `metastable`.** Same as test 5 but with `Nw = 3` for all 200 ticks. `convergenceStatus === 'metastable'` and `timeToConsensus === 0`. This is the ghettoization / two-clusters-plus-one outcome the spec highlights in §2.

7. **Mean metrics handles NaN values — skip, not propagate.** Build a series with `matchingRate = [0.8, NaN, 0.6, NaN, 0.4]` (ticks 1 and 3 had no interactions). Assert `meanMetrics.matchingRate === 0.6` (mean of `[0.8, 0.6, 0.4]`), `medianMetrics.matchingRate === 0.6`, `maxMetrics.matchingRate === 0.8`. Documents the "skip NaN" choice explicitly and makes it part of the test-verified contract. A second sub-case: if the entire series is NaN (`[NaN, NaN, NaN]`), `meanMetrics.matchingRate` returns `NaN` without throwing — test asserts `Number.isNaN(result.meanMetrics.matchingRate)`.

8. **Classification — high assimilation + low segregation → `assimilated`.** Pass `finalAssimilation = 0.9`, `finalSegregation = 0.1`, and the default thresholds (`{assimilationHigh: 0.7, segregationLow: 0.3, assimilationLow: 0.3, segregationHigh: 0.7}`). `classification === 'assimilated'`. This test exercises `classifyRun` via the public entry point by constructing a minimal graph time series whose last snapshot has those final-index values.

9. **Classification — low assimilation + high segregation → `segregated`.** Pass `finalAssimilation = 0.15`, `finalSegregation = 0.85`, same thresholds. `classification === 'segregated'`.

10. **Classification — middling values → `mixed`.** Pass `finalAssimilation = 0.5`, `finalSegregation = 0.5`. `classification === 'mixed'`. Verifies the catch-all branch.

11. **Classification — NaN inputs → `inconclusive`.** Pass `finalAssimilation = NaN` (no W2-Imm↔W2-Native interactions occurred during the run). `classification === 'inconclusive'`. Verifies the "insufficient data" branch.

12. **Divergence detection — a weight-sum spike → `diverged`.** Build a series where at some tick the max weight becomes `Infinity` (or exceeds `1e15`). `convergenceStatus === 'diverged'` regardless of what `Nw` looks like. This pins the ordering in step 6 of implementation approach §7: `diverged` is checked before `converged` / `metastable`.

13. **Truncated run shorter than the consensus window → `unresolved`.** Build a series of length 50 with `consensusWindowTicks = 100`. `timeToConsensus === null`, `convergenceStatus === 'unresolved'`. Verifies the fallback branch of the detector and locks in the definition of "the tick count ended before any of the above."

14. **Round-trip JSON-serialization.** Call `computeRunSummary(...)` on a non-trivial series, `JSON.stringify` the result, `JSON.parse` it back, and assert deep-equality of the fields that survive JSON encoding (everything except any methods or `undefined` fields, of which there should be none). Verifies the `structuredClone`-safe / JSON-safe contract from research note 3; step 26 persistence depends on it.

15. **`ExperimentConfig.parse({})` produces thresholds that resolve.** Call `ExperimentConfig.parse({})` from `lib/schema/config`, pass the resulting config to `computeRunSummary` with a minimal series, and assert the classification field is one of the four valid strings. This is the schema-integration smoke test: it catches the case where step 17's field names drift from step 01's schema names (or where step 01 lacks the fields entirely and step 17 forgot to add them).

All 15 tests run in under one second on a modern laptop (T ≤ 200, no I/O, no async).

## 10. Acceptance criteria

- `npm test -- lib/sim/metrics/summary` exits 0 with all 15 tests in §9 passing.
- `npm run typecheck` (the alias step 00 establishes, effectively `tsc --noEmit`) exits 0 — every downstream file that imports `RunSummary`, `ConvergenceStatus`, or `RunClassification` must resolve without errors, and every field read from `config.classificationThresholds` / `config.convergence` must type-check against whatever shape `lib/schema/experiment.ts` actually has at commit time.
- `npm run lint` exits 0 against the new and modified files (ESLint flat config from step 00).
- If `lib/schema/experiment.ts` and `lib/schema/defaults.ts` were modified to add the classification-thresholds fields, `npm test -- lib/schema` still exits 0. Schema tests from step 01 must not regress.
- A one-off `npx tsx -e "import('./lib/sim/metrics/summary.ts').then(m => console.log(JSON.stringify(m.computeRunSummary([], [], ExperimentConfig.parse({})), null, 2)))"` sanity run (uncommitted; interactive only) prints a populated `RunSummary` to stdout without throwing on an empty time series. The empty-series case should return: mean/median/max maps are empty `{}`, `timeToConsensus = null`, `convergenceStatus = 'unresolved'`, `classification = 'inconclusive'`. Test 15 above codifies this.
- No UI verification harness run — this step is `ui: false` per the frontmatter and does **not** invoke chrome-devtools MCP. Per `CLAUDE.md` "UI verification harness," only steps tagged `ui: true` spin up a dev server.
- A single commit is produced with the subject `step 17: run summary metrics` (see section 12).

## 11. CLAUDE.md updates

**No sections updated.** Step 17 adds no new known gotchas, no new directory-layout entries (`lib/sim/metrics/` was already declared by steps 15 and 16 if they ran first, or will be declared by them), no new testing conventions beyond what `CLAUDE.md` "Testing conventions" already establishes, and no new worker-lifecycle or auth patterns. Per `CLAUDE.md` "Living-document rules," leaving the file unchanged is an acceptable outcome when the step has nothing surprising to note. If the step encounters a non-obvious pitfall during implementation (e.g., a subtle NaN propagation bug in the TypeScript `number` type's interaction with `JSON.stringify`), the implementing claude may add a single bullet to "Known gotchas" but should keep the append strictly ≤ 2 lines and cite the specific test that would catch it.

## 12. Commit message

```
step 17: run summary metrics
```

Exactly this string, no conventional-commit prefix, no trailing text, no `Co-Authored-By` footer (plan-step commits are detected purely by this marker per `CLAUDE.md` "Commit-message convention"). `scripts/run-plan.ts` greps for this marker to track pipeline progress. If intermediate commits appear during implementation, they are squashed via `git reset --soft HEAD~N && git commit` before advancing.

## 13. Rollback notes

If step 17 must be undone (e.g., step 18's smoke test reveals that the summary reducer's convergence detector disagrees with the researchers' intuition and needs a rework, and a forward-fix commit is more expensive than a reset-and-retry):

1. Identify the commit SHA immediately prior to `step 17: run summary metrics` via `git log --oneline | grep "step 1[67]:"`. The prior SHA is whatever comes before the `step 17: ...` line (typically `step 16: graph metrics`).
2. `git reset --hard <prior-sha>` — this discards `lib/sim/metrics/summary.ts`, `lib/sim/metrics/summary.test.ts`, any appended fields in `lib/sim/metrics/types.ts`, and any appended fields in `lib/schema/experiment.ts` / `lib/schema/defaults.ts` in one go.
3. Run `npm test` and `npm run typecheck` on the rolled-back tree to confirm no downstream step has silently started importing from `summary.ts` — if step 18 has already landed and depends on step 17, the reset cascade must also drop step 18. Prefer a forward-fix commit in that case rather than a multi-step unwind.
4. Verify `git status` is clean.
5. Re-run the pipeline from step 17 with an adjusted plan file.
