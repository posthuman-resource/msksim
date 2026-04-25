---
step: '34'
title: 'linguistic migration'
kind: sim-core
ui: false
timeout_minutes: 30
prerequisites:
  - 'step 09: seeded rng and core types'
  - 'step 10: topology implementations'
  - 'step 11: agent bootstrapping'
  - 'step 13: interaction engine'
  - 'step 14: preferential attachment'
  - 'step 15: scalar metrics'
  - 'step 33: gaussian success policy'
---

## 1. Goal

Implement **linguistic-similarity-driven agent migration** on lattice topologies: after each interaction, agents may step toward (high cosine similarity) or away from (low cosine similarity) their interaction partner, producing Schelling-style spatial segregation driven by language rather than identity. Concretely, this step delivers a new opt-in `movement` field on `ExperimentConfig`, an optional `SpatialOps` capability on the `Topology` interface (implemented by lattice, absent on well-mixed and network), a new `lib/sim/movement.ts` pure module with `applyMovement(speaker, hearer, world, config): void`, a new `mutatePosition` discipline helper in `lib/sim/engine.ts` (extending the existing `mutateInventory`/`mutateMemory` pattern from step 13), a new tick-loop hook that calls `applyMovement` after the weight-update sub-step, and a new `computeSpatialHomophily(world): number` scalar metric. This step is motivated by the second proposal in `docs/Gaussian Communication Success and (1).pdf` (pages 3–4) and by Meissa's 4/11 chat note about wanting "to observe segregation in the social level denoted by 'class' in your simulation… agent W2 immigrants stepping back or adding distance when the communication success rate with the W2 natives fails." The research value is twofold: (1) the simulation gains the ability to study **whether linguistic similarity alone is sufficient to produce spatial clustering** — Schelling 1971 showed identity-based preferences produce segregation at surprisingly low thresholds; this step asks whether the same is true for _linguistic_ similarity in a Naming-Game model where there is no fixed identity, only emergent vocabulary alignment; (2) the new `spatialHomophily` metric gives the researcher a continuous quantitative signal — the average cosine similarity between an agent and its lattice neighbors — that is interpretable both as a function of time within a single run and as a sweep variable across configurations. The single load-bearing invariant for this step is **default-off backwards compatibility plus topology-agnostic-engine preservation**: with `movement: { enabled: false }` (the default), every existing test, every existing committed config-hash, and every existing run snapshot must remain bit-identical; and the engine must gate movement on the `world.topology.spatial` capability check, never on `world.topology.kind`, so the topology-agnostic invariant from step 10 continues to hold.

## 2. Prerequisites

- Commit marker `step 09: seeded rng and core types` — exports the `AgentState` type with `position: number` (declared `readonly` by type, mutated by discipline). Step 34 extends the discipline to include `position` alongside the existing `inventory` and `interactionMemory` fields. The `RNG` interface is unchanged; movement consumes zero RNG draws (deterministic-without-RNG tiebreaks).
- Commit marker `step 10: topology implementations` — exports the `Topology` interface and the lattice/well-mixed/network implementations under `lib/sim/topology/`. Step 34 extends `Topology` with an optional `spatial?: SpatialOps` field. Lattice gets a populated `spatial` implementation; well-mixed and network leave it `undefined`. The topology-agnostic-engine invariant ("only `topology/factory.ts` may branch on `topology.kind`") is preserved by gating movement on `world.topology.spatial !== undefined` instead.
- Commit marker `step 11: agent bootstrapping` — exports `bootstrapExperiment`, `World`, `findAgentByPosition`. Step 34 needs the position lookup to resolve "the agent currently occupying cell N" for collision detection during a move.
- Commit marker `step 13: interaction engine` — exports `tick`, `selectPartner`, `InteractionEvent`. Step 34 adds a single new sub-step (g) — apply movement — between the existing weight-update and the activation-loop break. The retry-loop semantics are unchanged: a successful speaker moves at most once per activation, regardless of retries.
- Commit marker `step 14: preferential attachment` — exports `cosineSimilarity` and `topKTokenVector` from `lib/sim/similarity.ts`. Step 34 reuses both for the move-decision computation. The same `topK` parameter (default 10) is used both here and in step 33's gaussian success policy, so a single notion of "linguistic identity" is shared across the two new features.
- Commit marker `step 15: scalar metrics` — exports `computeScalarMetrics`. Step 34 extends `PerWorldScalarMetrics` with a new `spatialHomophily: number` field (NaN for non-spatial topologies) and adds `computeSpatialHomophily` to the per-tick metrics pass.
- Commit marker `step 33: gaussian success policy` — establishes the precedent for adding an opt-in feature behind a default-off config flag with bit-identical backwards compatibility. Step 34 follows the same pattern.

## 3. Spec references

- `docs/Gaussian Communication Success and (1).pdf` pages 3–4 (collaborator-supplied). Page 3 ("Agents move rule"): "Agents move after the cosine similarity index reaches between [1;0]. at [1;0.5] cosine is high, agents sharing this similarity should move one step forward or closer toward each other." Page 4: "at [0.5;0] cosine is low, agents sharing this similarity should move two steps backward or farther away from each other." The default values from this step (`attractThreshold: 0.5`, `attractStep: 1`, `repelStep: 2`) are direct transcriptions of the PDF's prescription. The asymmetric step counts (1 forward, 2 back) are unusual but explicitly what the PDF asks for; both are exposed as configurable knobs so the researcher can ablate symmetric vs asymmetric variants.
- Meissa's chat message 4/11 22:13 (in the conversation log Mike pasted into the user prompt): "the logic would be to have agent W2 immigrants stepping back or adding distance when the communication success rate with the W2 natives fails (or with their own peers W2 immigrants). if the communication success is good they would cluster together or stepping closer." Step 34's per-interaction movement rule (rather than per-tick aggregated success-rate-based movement) is closer to the PDF's framing than to this chat message; the chat message reads more like a Schelling-style "tolerance threshold over recent interactions" rule. Mike's design judgment: implement the per-interaction PDF version first because it is simpler to reason about and produces the same qualitative dynamics; defer the success-rate-windowed variant to a future step if the researcher confirms she prefers it.
- `docs/spec.md` **§3.1 Agents and worlds** — the spec describes agents as "located on a topology (a lattice cell or a node in a graph)." Step 34 keeps positions discrete and lattice-bound; movement is constrained to neighboring cells, one cell per move (sub-stepping the configured `attractStep` / `repelStep` count over multiple internal evaluations within the same activation).
- `docs/spec.md` **§3.2 Topology** — explicitly enumerates lattice (Moore/Von Neumann), well-mixed, and network. Step 34's lattice-only constraint is consistent with this taxonomy: well-mixed is a complete graph with no spatial meaning (every agent is "adjacent" to every other), and network topologies treat positions as graph nodes rather than spatial coordinates. Movement on a graph would be "step along edge to a neighbor," which is conceptually different from "step closer in 2D space" and is deferred to a future step with a separate config.
- `docs/spec.md` **§4.1 F1 (Topology)** acceptance criterion: "Lattice supports neighborhood configuration; topology agnostic engine." Step 34 preserves the second clause via the capability-check approach (`world.topology.spatial`).
- `docs/spec.md` **§1.2 RQ1, RQ4** — the research questions this step extends. RQ1 (assimilation/segregation thresholds) gains a new spatial-segregation channel: with movement enabled, segregation can manifest as both vocabulary divergence (existing) and physical clustering (new). RQ4 (emergent social cohesion) gains a new observable: the `spatialHomophily` metric is the spatial analogue of the existing `largestClusterSize` metric, but defined over physical proximity rather than over the token-agreement graph.

## 4. Research notes

**Local Next.js 16 docs:**

1. `node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md` — confirms Vitest's default `node` environment and the manual-setup shape from step 00. Step 34's tests live in `lib/sim/movement.test.ts` (new file), `lib/sim/topology/lattice.test.ts` (extended), `lib/sim/engine.test.ts` (extended), and `lib/sim/metrics/scalar.test.ts` (extended). All run in `node` — no DOM, no React. Load-bearing for this step.
2. `node_modules/next/dist/docs/01-app/03-api-reference/08-turbopack.md` — confirms pure-TypeScript modules under `lib/sim/` bundle identically into server and worker contexts. The new `lib/sim/movement.ts` and the modified `lib/sim/topology/lattice.ts` are both pure-TS, no DOM, no Node built-ins. They must NOT carry `import 'server-only'` (worker-bundling would fail).
3. `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md` §"Preventing environment poisoning" — the same inverted-guard pattern as step 13: `lib/sim/` deliberately crosses the worker boundary, so the imports must stay framework-free. Step 34's `applyMovement` consumes only `@/lib/sim/types`, `@/lib/sim/world`, `@/lib/sim/topology`, `@/lib/sim/similarity`, and `@/lib/schema/movement` — no Next, no React, no fs, no crypto.

**External references (WebFetched at execution time):**

4. **Schelling, T. C. (1971), "Dynamic Models of Segregation"** — `https://www.tandfonline.com/doi/abs/10.1080/0022250X.1971.9989794` (must be WebFetched). Load-bearing facts to confirm: (a) Schelling's tipping-point result that even very mild same-group preferences (~30%) produce strong macro-level segregation; (b) the original model uses a "tolerance threshold" — agents move if the fraction of same-group neighbors falls below the threshold; (c) the model uses discrete moves on a 2D lattice with empty cells. Consequences for step 34: the asymmetric attract/repel step counts and the explicit `attractThreshold` parameter are direct analogues of Schelling's tolerance threshold. Citing this paper anchors the research framing for the metrics interpretation step (researchers familiar with Schelling will know how to read `spatialHomophily` curves).
5. **Centola, D. (2010), "The Spread of Behavior in an Online Social Network Experiment" / Loreto et al. on Naming Game on lattices** — `https://arxiv.org/abs/1002.0739` or `https://arxiv.org/abs/cond-mat/0611063` (the implementing agent should pick a Naming-Game-on-lattice paper that is currently retrievable; either Loreto/Baronchelli on lattice Naming Games or a comparable spatial-Naming-Game treatment is fine). Load-bearing: the Naming Game on a fixed lattice (without movement) has been studied extensively and has known consensus-time scaling. Adding movement is an extension to that literature, not a replacement of it. Citing a baseline paper establishes the comparison: with movement disabled, our simulation should reproduce the known fixed-lattice scaling; with movement enabled, the consensus dynamics qualitatively change. The `spatialHomophily` metric is the diagnostic for that change.

**Paths not taken:**

6. **Per-tick success-rate-windowed movement (the Schelling chat-message variant).** Considered: aggregate the speaker's last N interactions, compute the fraction with success, move only if that fraction crosses a threshold. **Rejected** as the primary v1 implementation because (a) it requires deciding on N (window size), threshold, and whether to weight recent interactions more heavily — three new knobs the PDF doesn't specify; (b) the per-interaction rule is what the PDF actually describes, and shipping the literal PDF semantics is the lowest-risk first step; (c) the per-interaction rule is a strict subset of the per-tick variant — extending to a windowed version later is a one-step refactor that swaps the cosine-similarity input from "this interaction's partner" to "average over recent partners." Documented as out of scope for this step in section 8.

7. **Movement on well-mixed and network topologies.** Considered: define "step closer" on a graph as "move to a node closer in graph distance." **Rejected** because (a) well-mixed has no graph distance — every node is at distance 1 from every other, so movement is structurally meaningless; (b) network topologies use graph nodes as positions but the _interpretation_ of position is not spatial (a node in a small-world network is not a "place" in the way a lattice cell is); (c) implementing movement on networks would conflate two different semantic operations (rewiring the graph vs migrating across the graph) and obscure the research question. Lattice-only constraint is documented in `MovementConfig.latticeOnly: true` (a literal that signals intent — future arms can be added if research demand emerges).

8. **Implementing the topology check as `world.topology.kind === 'lattice'` in the engine.** Considered: simpler than adding a new capability interface. **Rejected** because it violates the topology-agnostic-engine invariant from step 10's CLAUDE.md gotcha: "only `topology/factory.ts` may branch on `topology.kind`." Extending `Topology` with an optional `spatial?: SpatialOps` field is the canonical TypeScript pattern for per-implementation capability — the engine writes `if (world.topology.spatial)` and gets compile-time-safe access to the spatial methods inside the branch. Adds zero overhead for non-spatial topologies and zero risk of forgetting to add a new `kind` to a future check.

9. **Storing position as a 2D `[x, y]` tuple instead of a linearized index.** Considered: would make Manhattan distance a one-line subtraction. **Rejected** because positions throughout the codebase are linearized integers (see `findAgentByPosition`, the lattice-canvas renderer at `app/(auth)/playground/lattice-canvas.tsx` which computes `cx = position % latticeWidth`, the snapshot/persistence layer in `db/schema/`). Changing the on-the-wire shape would ripple into the worker payload, the projection cache, the snapshot blob, and the run-comparison code. The cost of converting via `indexToXY` at the rare distance-computation sites is negligible.

10. **Computing all pairwise distances eagerly each tick for `spatialHomophily`.** Considered: `O(N²)` pre-computation, then look up in `O(1)` for the metric. **Rejected** because the metric only sums over agent-to-immediate-neighbor pairs, which is `O(N × |neighborhood|) = O(N × 8)` for Moore lattices — already linear. The per-pair Map-walk for `cosineSimilarity` dominates; eager pairwise pre-computation would add work without removing any.

**Total research items: 3 local Next docs + 2 external WebFetched (Schelling 1971, Loreto/Baronchelli on lattice NG) + 5 paths not taken = 10 citations**, comfortably above the ≥ 5 floor.

## 5. Files to create

- `lib/schema/movement.ts` — **the schema for the new movement field**. Exports:
  - `export const CollisionPolicy = z.enum(['swap', 'skip']);`
  - `export const MovementConfig = z.object({ enabled: z.boolean().default(false), attractThreshold: z.number().min(0).max(1).default(0.5), attractStep: z.number().int().nonnegative().default(1), repelStep: z.number().int().nonnegative().default(2), collisionPolicy: CollisionPolicy.default('swap'), topK: z.number().int().positive().default(10), latticeOnly: z.literal(true).default(true) });`
  - `export type MovementConfig = z.infer<typeof MovementConfig>;`
  - `export const defaultMovementConfig: MovementConfig = { enabled: false, attractThreshold: 0.5, attractStep: 1, repelStep: 2, collisionPolicy: 'swap', topK: 10, latticeOnly: true };`

  The `latticeOnly: true` literal is a documentation marker, not a behavior knob — it makes the lattice-only constraint visible in any serialized config and prevents future additions of "movement on networks" from silently inheriting this config. No `import 'server-only'`. Bare relative imports.

- `lib/sim/movement.ts` — **the pure movement module**. Exports:
  - `export function applyMovement(args: { speaker: AgentState; hearer: AgentState; world: World; config: MovementConfig }): void` — mutates `speaker.position` and possibly `hearer.position` (collision swap) in place via the engine's `mutatePosition` helper. Returns nothing. Does no I/O, no RNG, no async.

  Internally:
  1. If `!config.enabled` → return (no-op).
  2. If `!world.topology.spatial` → return (no-op; lattice-only).
  3. Compute `cos = cosineSimilarity(topKTokenVector(speaker.inventory, config.topK), topKTokenVector(hearer.inventory, config.topK))`.
  4. Determine direction: `attract = cos >= config.attractThreshold`.
  5. Determine step count: `steps = attract ? config.attractStep : config.repelStep`.
  6. For `i in 0..steps`:
     - Compute `nextPos = attract ? world.topology.spatial.stepToward(speaker.position, hearer.position) : world.topology.spatial.stepAwayFrom(speaker.position, hearer.position)`.
     - If `nextPos === null` → break (no improving move).
     - If `findAgentByPosition(world, nextPos)` returns an agent (collision):
       - `if (config.collisionPolicy === 'skip')` → break.
       - `if (config.collisionPolicy === 'swap')` → swap positions: `mutatePosition(otherAgent, speaker.position); mutatePosition(speaker, nextPos);` then break (swap completes the move; further steps would shuffle other agents around in ways the PDF doesn't describe).
     - Else (cell empty): `mutatePosition(speaker, nextPos)`.

  Notes: the loop body re-evaluates `stepToward(speaker.position, hearer.position)` each iteration with the speaker's _new_ position — the path traced is the greedy Manhattan-distance-minimizing walk. This is deterministic without RNG (the lexicographic tiebreak in `lattice.stepToward` is pure). The hearer never moves except in the swap case (speaker swaps with whoever happens to be at the target cell, which may or may not be the hearer).

- `lib/sim/movement.test.ts` — **focused movement tests**. Section 9 enumerates 6 test cases. Pure TS, default Vitest `node` environment.

All other changes are modifications, not new files.

## 6. Files to modify

- `lib/schema/experiment.ts` — append `movement: MovementConfig.default(defaultMovementConfig)` to the `ExperimentConfig` Zod object. Add the import. Total diff: ≤ 5 lines.

- `lib/schema/index.ts` (or appropriate barrel) — re-export `MovementConfig`, `CollisionPolicy`, `defaultMovementConfig`.

- `lib/sim/topology.ts` — extend the `Topology` interface with an optional `spatial?: SpatialOps` field. Add the `SpatialOps` type:

  ```typescript
  export interface SpatialOps {
    distance(a: number, b: number): number;
    stepToward(from: number, target: number): number | null;
    stepAwayFrom(from: number, target: number): number | null;
  }
  ```

  Append after the existing `Topology` interface. The optional `?:` is critical — every existing topology compiles without modification; only lattice gets the new field populated.

- `lib/sim/topology/lattice.ts` — implement the `spatial` field on the lattice topology object. Add three pure helper functions:
  - `function distance(a: number, b: number): number` — Manhattan distance via `indexToXY`. Open boundaries (no toroidal wrap-around).
  - `function stepToward(from: number, target: number): number | null` — convert both to `(x, y)`. Compute `dx = sign(target.x - from.x)`, `dy = sign(target.y - from.y)`. Try moves in lexicographic direction order: north (y-1), east (x+1), south (y+1), west (x-1). Return the first move that (a) is in-bounds and (b) decreases Manhattan distance to target. Return `null` if no such move exists (already at target, or at corner with no improving direction). Diagonal Moore moves are sub-stepped — a diagonal request becomes one axis-aligned move in the dominant direction (lexicographic tiebreak when both axes have equal magnitude).
  - `function stepAwayFrom(from: number, target: number): number | null` — same shape, but pick the in-bounds neighbor that _increases_ Manhattan distance. Returns `null` at a corner where every in-bounds neighbor is closer to (or equidistant to) target.

  Attach these to the lattice topology object's `spatial` field at construction time. Document open-boundary behavior in a JSDoc comment (consistent with the existing CLAUDE.md "Lattice topologies default to open (non-toroidal) boundaries" gotcha).

- `lib/sim/engine.ts` — three modifications:
  1. Add the `mutatePosition` helper (private, alongside `mutateInventory` and `mutateMemory`):
     ```typescript
     function mutatePosition(agent: AgentState, newPosition: number): void {
       (agent as { position: number }).position = newPosition;
     }
     ```
     Export it as a module-private symbol that `lib/sim/movement.ts` imports (use a `// @internal` JSDoc tag if a marker is wanted; TypeScript does not enforce it, but the convention signals intent).
  2. In the tick body, after the weight-update sub-step (currently sub-step (f) per step 13), add a new sub-step (g):
     ```typescript
     // (g) Apply movement (post-success only, no-op if movement disabled or topology non-spatial)
     if (success) {
       applyMovement({ speaker, hearer, world, config: config.movement });
     }
     ```
     Movement fires only on successful interactions (the PDF's "agents sharing this similarity should move" phrasing implies a successful exchange has occurred). On failure, no move. This also keeps the failure/retry semantics simple — a speaker who fails and retries does not partially-move between retries.
  3. Update the engine's RNG-draw-order docstring: append `(g) Movement: zero RNG draws (deterministic tiebreaks)`.

- `lib/sim/metrics/scalar.ts` — append `computeSpatialHomophily(world: World): number`:

  ```typescript
  export function computeSpatialHomophily(world: World): number {
    if (!world.topology.spatial) return Number.NaN;
    let sum = 0;
    let pairCount = 0;
    const k = 10; // hardcoded; matches MovementConfig.topK default. Document this coupling.
    for (const agent of world.agents) {
      const agentVec = topKTokenVector(agent.inventory, k);
      for (const neighborPos of world.topology.neighbors(
        agent.position,
        /* rng unused */ neverRNG(),
      )) {
        const neighbor = findAgentByPosition(world, neighborPos);
        if (!neighbor) continue;
        const neighborVec = topKTokenVector(neighbor.inventory, k);
        sum += cosineSimilarity(agentVec, neighborVec);
        pairCount++;
      }
    }
    if (pairCount === 0) return Number.NaN;
    return sum / pairCount;
  }
  ```

  The `neverRNG()` placeholder is whatever the existing convention is for "I don't actually need RNG here" — if `topology.neighbors` requires an RNG, pass a no-op stub or refactor the signature to make RNG optional. The canonical fix: `Topology.neighbors` already accepts an `rng` for shuffling-on-demand, but the lattice implementation does not actually consume it (it just yields cells in deterministic order); make `rng` optional in the interface and pass `undefined` here. Document the API change in a CLAUDE.md note if it's a contract break.

  Add to `computeScalarMetrics` so the new metric is included in `PerWorldScalarMetrics.spatialHomophily`. The metric is computed every tick regardless of `config.movement.enabled` — it's a baseline observable that's interesting even without migration (it measures spontaneous spatial clustering arising from interaction patterns alone).

- `lib/sim/metrics/types.ts` — extend `PerWorldScalarMetrics` with `readonly spatialHomophily: number;`. NaN values for non-spatial topologies are explicitly allowed and downstream chart rendering (step 35) handles NaN by rendering a flat baseline.

- `lib/sim/engine.test.ts` — append 3 new tests (section 9 tests 7, 8, 9).

- `lib/sim/movement.test.ts` — write the file with 6 tests (section 9 tests 1–6).

- `lib/sim/topology/lattice.test.ts` — append 3 new tests (section 9 tests 10–12).

- `lib/sim/metrics/scalar.test.ts` — append 2 new tests for `computeSpatialHomophily` (section 9 tests 13–14).

- `workers/simulation.worker.ts` — verify the new metric flows through to `TickReport`. Likely zero changes needed — the worker's `getMetrics()` already returns `ScalarMetricsSnapshot` whole, and the new field will appear automatically. Confirm by reading the worker file and checking that no metric field is destructured by name in a way that would drop the new field.

- `CLAUDE.md` — see section 11.

No other files modified. UI files are untouched (step 35 covers them).

## 7. Implementation approach

**Slice 1 — Write `lib/schema/movement.ts`.** Section 5 has the full schema. Verify the discriminated default behavior: `MovementConfig.parse({})` returns the full default with all fields populated. Verify negative `attractStep` rejected; verify `attractThreshold > 1` rejected; verify `collisionPolicy` enum rejects unknown strings.

**Slice 2 — Append `movement` to `ExperimentConfig`.** Edit `lib/schema/experiment.ts`. Confirm `ExperimentConfig.parse({})` produces an object with `movement: { enabled: false, ... }`. Confirm v1 fixture configs in any existing test file still parse and produce identical hashes (the new field has a default, so the canonical SHA-256 of the _output_ of `ExperimentConfig.parse(legacyConfig)` will change — but that's expected and acceptable; the _input_ config remains unchanged, and the hash is computed on the canonical output JSON. Verify with a quick eyeball of any frozen-hash test).

**Slice 3 — Extend the `Topology` interface.** Edit `lib/sim/topology.ts` to add `spatial?: SpatialOps` and the `SpatialOps` type. Run `npm run typecheck` — every existing topology implementation continues to compile because the field is optional. Run existing topology tests — should be all green.

**Slice 4 — Implement `spatial` on lattice.** Edit `lib/sim/topology/lattice.ts` to add `distance`, `stepToward`, `stepAwayFrom` and attach them to the topology object's `spatial` field. Add JSDoc covering: open boundaries, lexicographic tiebreak order `[N, E, S, W]`, returns `null` for no-improving-move and at-target cases. Run typecheck.

**Slice 5 — Write the 3 lattice spatial tests** (section 9 tests 10–12). Verify `distance` matches hand-computed Manhattan distances; verify `stepToward` traces the expected greedy path on a small 5×5 grid; verify `stepAwayFrom` returns `null` from a corner cell with target placed adjacent. Confirm green.

**Slice 6 — Add `mutatePosition` helper to `lib/sim/engine.ts`.** Single-line type-cast helper, alongside the existing `mutateInventory` and `mutateMemory`. Make it module-internal — `lib/sim/movement.ts` imports it via a sibling-folder relative import (`from './engine'` is fine; the function is exported but not in the public barrel).

**Slice 7 — Write `lib/sim/movement.ts`.** Section 5 has the algorithm. Pure function, no async, no RNG. Add a comprehensive JSDoc covering: pre-conditions, mutation surface (which agents may have positions changed), no-op cases (disabled, non-spatial topology, no-improving-move, both-at-target), collision handling.

**Slice 8 — Write the 6 movement tests** (section 9 tests 1–6). Hand-construct 5×5 lattices with two agents in known positions and known inventories. Verify attract steps, repel steps, collision swap, collision skip, no-op cases, lattice-only gating.

**Slice 9 — Wire `applyMovement` into the engine tick.** Edit `lib/sim/engine.ts` to call `applyMovement` after the weight-update sub-step, gated on `success`. Update the RNG-draw-order docstring. Run all existing engine tests — they must all still pass because the default `movement.enabled = false` short-circuits `applyMovement` to a no-op.

**Slice 10 — Write the 3 engine integration tests** (section 9 tests 7–9). One test verifies movement-disabled is bit-identical to pre-step-34 (determinism regression). One verifies movement applies after weight update (check that `successProbability` and weight-vector values are unchanged by movement). One verifies position changes match a hand-computed scenario for a 5×5 lattice with attract step = 1 over 10 ticks.

**Slice 11 — Add `computeSpatialHomophily` to scalar metrics.** Edit `lib/sim/metrics/scalar.ts`. Add the function; wire into `computeScalarMetrics`. If `Topology.neighbors` requires an RNG and the lattice impl doesn't use it, refactor the signature to make `rng` optional (or pass a sentinel; adopt whatever is cleanest). Update `PerWorldScalarMetrics` in `metrics/types.ts`. Run existing scalar-metrics tests.

**Slice 12 — Write the 2 spatial-homophily tests** (section 9 tests 13–14). One verifies NaN for well-mixed topology. One verifies hand-computed average for a small lattice with two agents in known positions and known inventories.

**Slice 13 — Worker thread-through.** Read `workers/simulation.worker.ts` — confirm the new metric flows through automatically (it should; the worker returns the whole `ScalarMetricsSnapshot`). If any field-destructuring drops it, fix.

**Slice 14 — Determinism audit.** Run any v1 smoke entrypoint (`npx tsx scripts/sim-smoke.ts`) before and after step 34's commit with the default config. Output must be byte-identical. If `spatialHomophily` appears in the output (it will, as a new field on the metrics snapshot), the snapshot SHA changes — this is acceptable; the per-tick events and inventory contents are what must remain identical. Document the snapshot-shape change as a known one-time delta.

**Slice 15 — CLAUDE.md update.** Append the bullets from section 11. Stay within line budget.

**Slice 16 — Format, lint, test, build, commit.** `npm run format && npm run lint && npm run typecheck && npm test && npm run build`. Squash to single commit `step 34: linguistic migration`.

## 8. Library choices

**None new.** Step 34 uses:

- `zod` for `MovementConfig`.
- `vitest` for tests.
- The step 09–14 `lib/sim/` modules and the new step-33 `successPolicy` (referenced only as a type, not at runtime).
- The standard library `Math.sign`, `Math.abs` for direction arithmetic.

**Out of scope:**

- Per-tick success-rate-windowed movement variant (path-not-taken 6).
- Movement on well-mixed and network topologies (path-not-taken 7).
- Movement on failure (PDF only describes movement after success).
- Multi-agent-displacement collision policies (e.g. "push the occupant one cell further"). The `'skip'` and `'swap'` policies cover the simple cases; defer "push" to a future step if research demand emerges.
- Continuous-position / off-lattice movement. Defer; would require a major topology overhaul.
- Pre-allocating distance lookup tables. Trivially under O(N) per metric pass; not a hotspot.

## 9. Unit tests

**`lib/sim/movement.test.ts` — 6 tests:**

1. **Disabled config is a no-op.** Build a 5×5 lattice with two agents at positions 0 and 24. With `movement.enabled = false`, call `applyMovement(...)`. Assert positions unchanged.
2. **Non-spatial topology is a no-op.** Build a well-mixed world with two agents. With `movement.enabled = true`, call `applyMovement(...)`. Assert positions unchanged.
3. **Attract step moves toward partner.** 5×5 lattice, speaker at (0,0)=0, hearer at (4,4)=24, identical inventories (cos = 1.0 ≥ 0.5 threshold), `attractStep = 1`. After one call, speaker should be at the lex-first neighbor toward (4,4) — east is (1,0)=1 (north would be (0,-1) which is out-of-bounds). Assert speaker at position 1.
4. **Repel step moves away from partner.** 5×5 lattice, speaker at (2,2)=12, hearer at (3,2)=13, disjoint inventories (cos = 0 < 0.5 threshold), `repelStep = 2`. After one call, speaker should be 2 cells west: (1,2)=11 → (0,2)=10. Assert speaker at position 10.
5. **Collision swap.** 5×5 lattice, speaker at (0,0)=0, hearer at (1,0)=1 (speaker's east neighbor), high cosine. Third agent at (1,0)=1 (= hearer's position). `collisionPolicy = 'swap'`. After call, speaker at position 1 and hearer at position 0 (swapped). Assert.
6. **Collision skip.** Same fixture as test 5 but `collisionPolicy = 'skip'`. After call, speaker still at position 0 (skipped because target was occupied). Assert.

**`lib/sim/topology/lattice.test.ts` — 3 tests:**

10. **`distance` is Manhattan.** On a 5×5 lattice, assert `distance(0, 24) === 8` (4 + 4), `distance(0, 4) === 4`, `distance(12, 12) === 0`.
11. **`stepToward` traces lex-greedy path.** From position 0=(0,0) toward 24=(4,4), `stepToward` returns 1=(1,0) (east; north out-of-bounds, west out-of-bounds, south is (0,1)=5 which equals east in distance — east wins by lex order). Walk 8 steps and verify final position is 24.
12. **`stepAwayFrom` returns `null` at corner with no farther neighbor.** At position 0=(0,0), with target at position 24=(4,4), the only in-bounds neighbors are east (closer in y) and south (closer in x) — wait, both increase distance from (0,0) toward (4,4)? Re-think: from (0,0), east (1,0) decreases x-distance to (4,4); north out-of-bounds; west out-of-bounds; south (0,1) decreases y-distance. So `stepAwayFrom` from (0,0) toward (4,4) returns `null` (every in-bounds neighbor is closer to or equidistant to target). Assert `null`. Verify a non-corner case: from (2,2)=12 toward (3,3)=18, `stepAwayFrom` returns the lex-first neighbor that increases distance → west (1,2)=11 (or north (2,1)=7 — lex-first by direction order is north). Assert.

**`lib/sim/engine.test.ts` — 3 tests:**

7. **Movement-disabled is bit-identical to pre-step-34 (determinism regression).** Run 50 ticks with default config (`movement.enabled = false`). Capture `interactions[]` and final agent state via `JSON.stringify`. Confirm matches the snapshot from before step 34 (or, equivalently, run the sim-smoke comparison from slice 14 in the test).
8. **Movement applies after weight update.** With movement enabled, attract threshold low enough to fire, run a single tick. Capture the speaker's `inventory` immediately after the tick. Assert the inventory's weights for the (language, referent, token) of the interaction reflect the post-weight-update value (i.e. movement did not roll back the weight update). Assert the speaker's `position` differs from the pre-tick position.
9. **Position-after-tick matches hand-computed scenario.** 5×5 lattice, two agents, identical inventories (forces cos = 1), attract step = 1. Run 4 ticks. Assert speaker has moved exactly 4 cells along the greedy path toward the hearer (or fewer if collision/swap occurred — handle the collision case explicitly in the assertion).

**`lib/sim/metrics/scalar.test.ts` — 2 tests:**

13. **`computeSpatialHomophily` returns NaN for well-mixed.** Build a well-mixed world. Assert `Number.isNaN(computeSpatialHomophily(world))`.
14. **`computeSpatialHomophily` is hand-computed for small lattice.** 3×3 lattice with three agents at known positions and known inventories. Hand-compute the expected average cosine similarity over neighbor pairs. Assert the function returns the expected value within `1e-9`.

All 14 tests deterministic, synchronous, run under default `node` env, total runtime < 2 seconds.

## 10. Acceptance criteria

- `npm test -- lib/sim/movement lib/sim/topology lib/sim/engine lib/sim/metrics` exits 0 with all new tests passing.
- `npm run typecheck` exits 0. The new `SpatialOps` interface, `MovementConfig`, `applyMovement`, `mutatePosition`, `computeSpatialHomophily`, and the new `PerWorldScalarMetrics.spatialHomophily` field all resolve.
- `npm run lint` exits 0.
- `npm run build` exits 0.
- **Backwards-compatibility regression check passes**: v1 smoke produces byte-identical per-tick interaction events (the snapshot SHA may change due to the new `spatialHomophily` metric field, but the underlying simulation behavior is unchanged).
- `grep -R "topology\.kind" lib/sim/movement.ts lib/sim/engine.ts lib/sim/metrics/` returns zero matches in the new code paths — capability check via `topology.spatial`, not kind branching.
- `grep -R "Math\.random\|Date\.now" lib/sim/movement.ts lib/sim/topology/lattice.ts` returns zero matches.
- A single commit with subject `step 34: linguistic migration`. Intermediate commits squashed.
- No UI verification harness — `ui: false`.

## 11. CLAUDE.md updates

Append to `CLAUDE.md` "Known gotchas" (≤ 8 lines total):

> - Movement (`lib/sim/movement.ts`, step 34) is gated by the **capability check** `world.topology.spatial !== undefined`, never by `world.topology.kind`. This preserves the topology-agnostic-engine invariant from step 10 — adding a new spatial topology in the future only requires implementing the `SpatialOps` interface; the engine and movement code do not need a new branch. Lattice implements `spatial`; well-mixed and network do not. The `MovementConfig.latticeOnly: true` literal in the schema documents this constraint at the config level.
> - The engine's `mutatePosition` helper (private, alongside `mutateInventory` and `mutateMemory`) extends the "readonly-by-type, mutable-by-discipline" pattern from step 13 to the `position` field of `AgentState`. Movement applies once per successful interaction, inside the activation loop after the weight update — a successful speaker therefore moves at most once per activation regardless of the retry budget. Document this if the activation-loop structure is ever refactored.

Update the existing "Engine retry resets per speaker activation" bullet to mention movement: append "Movement (step 34, when enabled) applies after weight update inside the same activation, not on retries — a speaker who fails-then-succeeds moves once, on the success."

If during implementation a new failure mode emerges, add at most one further bullet (total append ≤ 12 lines).

## 12. Commit message

```
step 34: linguistic migration
```

Exactly this string, no prefix, no body. Squash intermediate commits before advancing.

## 13. Rollback notes

If step 34 must be undone:

1. Identify prior SHA via `git log --oneline --grep='step '`. Expect `step 33: gaussian success policy`.
2. `git reset --hard <prior-sha>` — discards `lib/schema/movement.ts`, `lib/sim/movement.ts`, `lib/sim/movement.test.ts`, the modifications to `lib/schema/experiment.ts`, `lib/sim/topology.ts`, `lib/sim/topology/lattice.ts`, `lib/sim/engine.ts`, `lib/sim/metrics/scalar.ts`, `lib/sim/metrics/types.ts`, the test additions, and the CLAUDE.md updates.
3. No deps changed. `package.json` and `package-lock.json` unchanged.
4. Verify `npm run typecheck && npm run lint && npm test` on the rolled-back tree — should be all green (step 33 was the last green state; step 35 has not yet been written).
5. Step 35 imports `MovementConfig` as a type and renders movement-related form fields. If step 34 is rolled back after step 35 is in flight, step 35's UI work must also be reverted or rebased.
