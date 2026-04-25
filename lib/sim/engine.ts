// Interaction engine for the Naming Game — the per-tick speaker/hearer loop.
// Per docs/spec.md §3.3 and §4.1 F3.
//
// Implements feature F3: deterministic tick function, configurable Δ⁺/Δ⁻/retry
// limit, three scheduler modes, and the partner-selection seam for step 14.
//
// ── Immutability discipline ──────────────────────────────────────────────────
// AgentState.inventory and AgentState.interactionMemory are updated in-place
// within the tick body via the mutateInventory / mutateMemory helpers below.
// The AgentState type declares these fields readonly (by-convention), but the
// engine owns the simulation state during a tick and must update them. The
// Inventory values themselves remain immutable: inventorySet / inventoryIncrement
// return new Maps on every write. The tick returns the same SimulationState
// reference with tickNumber incremented; callers must not hold references to
// agent fields across a tick boundary.
//
// This module is client-safe, server-safe, and worker-safe — it deliberately
// does NOT carry `import 'server-only'`. The engine is imported by the step-20
// Web Worker entrypoint; adding server-only would break Turbopack's worker bundle.
// See CLAUDE.md "Next.js 16 deltas" and the Research Notes in plan §4 (item 2).

import type { Language, Referent, TokenLexeme } from '@/lib/schema/primitives';
import type { ExperimentConfig } from '@/lib/schema/experiment';
import type { AgentId, AgentState, Inventory, InteractionRecord } from './types';
import type { RNG } from './rng';
import type { World, WorldId } from './world';
import type { LanguagePolicy, PolicyConfig } from './policy';
import { findAgentByPosition } from './world';
import { createPolicy } from './policy/registry';
import { updateWeight } from './engine/weight-update';
import { createPartnerSelector } from './partner-selector';
import { euclideanDistanceSq, topKTokenVector } from './similarity';
import { applyMovement } from './movement';

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * Partner-selection strategy.
 *   "uniform"      — uniform random pick from topology neighbors (ablation baseline).
 *   "preferential" — softmax-biased pick toward similar-inventory neighbors (F6).
 */
export type PartnerStrategy = 'uniform' | 'preferential';

/** Top-level mutable snapshot of a simulation at a given tick boundary. */
export type SimulationState = {
  world1: World;
  world2: World;
  /** Current tick counter. Starts at 0; incremented by tick() after each call. */
  tickNumber: number;
  config: ExperimentConfig;
};

/**
 * One completed speaker→hearer interaction in a single tick.
 * worldId is explicit so metric consumers (steps 15-17) can partition events
 * by world without a per-agent lookup.
 * speakerClass/hearerClass are denormalised here so step-16 graph metrics can
 * filter by agent class without a world lookup on the hot path.
 */
export type InteractionEvent = {
  tick: number;
  worldId: WorldId;
  speakerId: AgentId;
  hearerId: AgentId;
  speakerClass: import('@/lib/schema/primitives').AgentClass;
  hearerClass: import('@/lib/schema/primitives').AgentClass;
  language: Language;
  referent: Referent;
  token: TokenLexeme;
  success: boolean;
  /**
   * Success probability `Ps` for this interaction under the configured success policy.
   *   - `null` when `config.successPolicy.kind === 'deterministic'` (the v1 default).
   *   - A number in `[0, 1]` when `config.successPolicy.kind === 'gaussian'`.
   * Step 33 emits this raw signal so future calibration metrics can verify that
   * Ps≈p interactions succeed at rate p in the long run.
   */
  successProbability: number | null;
};

/**
 * Return value of tick(). Contains the (mutated-in-place) state, the full list
 * of interactions that occurred, and a convenience duplicate of state.tickNumber.
 */
export type TickResult = {
  state: SimulationState;
  interactions: InteractionEvent[];
  /** The new tick counter after this tick ran (= state.tickNumber). */
  tickNumber: number;
};

// ─── Partner selection (seam for step 14) ────────────────────────────────────

/**
 * Resolve one partner for `speaker` in `world` using `strategy`.
 *
 * In the `"uniform"` strategy, delegates to `world.topology.pickNeighbor` and
 * resolves the returned position index via `findAgentByPosition`.
 *
 * In the `"preferential"` strategy, enumerates ALL topology neighbors, resolves
 * them to AgentStates, then delegates to `preferentialSelectPartner` (via
 * `createPartnerSelector`) for the softmax-biased pick. This overload accepts
 * a pre-built `PartnerSelectorFn` to avoid re-creating the closure on every call.
 * Pass the result of `createPartnerSelector(config, tickNumber)` here.
 *
 * Returns `null` when no partner is reachable:
 *   - `pickNeighbor` returns `null` (isolated node, size-1 well-mixed world, etc.)
 *   - `findAgentByPosition` returns `undefined` (sparse lattice, empty neighbor cell).
 *   - All topology neighbors resolve to empty cells.
 */
export function selectPartner(
  speaker: AgentState,
  world: World,
  rng: RNG,
  strategy: PartnerStrategy,
): AgentState | null {
  switch (strategy) {
    case 'uniform': {
      const positionIndex = world.topology.pickNeighbor(speaker.position, rng);
      if (positionIndex === null) {
        return null;
      }
      const partner = findAgentByPosition(world, positionIndex);
      // A sparse lattice can return a cell that has no agent — treat as null (no partner).
      return partner ?? null;
    }
    case 'preferential': {
      // Enumerate all neighbors and let createPartnerSelector handle the biased pick.
      // The selector is constructed fresh per-tick by the tick() function below;
      // calling it here with a dummy tick=0 config is only for the exported selectPartner seam.
      // Callers that need preferential attachment should use createPartnerSelector directly.
      // This case exists so the PartnerStrategy union is exhaustive and type-safe.
      const neighborPositions = Array.from(world.topology.neighbors(speaker.position, rng));
      if (neighborPositions.length === 0) return null;
      const candidates = neighborPositions
        .map((pos) => findAgentByPosition(world, pos))
        .filter((a): a is AgentState => a !== undefined);
      if (candidates.length === 0) return null;
      // With no config context here, fall back to a uniform pick over materialized neighbors.
      // The tick() function below uses createPartnerSelector for the real biased behavior.
      return rng.pick(candidates);
    }
  }
  const _exhaustive: never = strategy;
  throw new Error(`Unknown partner strategy: ${_exhaustive as string}`);
}

// ─── Scheduler helper (private) ──────────────────────────────────────────────

/**
 * Return the list of speaker agents for one world in the activation order for
 * this tick. Always returns a fresh array (shallow copy or shuffle output) so
 * callers may mutate it without affecting world.agents.
 */
function getActivationOrder(
  world: World,
  rng: RNG,
  mode: ExperimentConfig['schedulerMode'],
): AgentState[] {
  switch (mode) {
    case 'sequential':
      // Shallow copy; step 11 guarantees agents are in id-lexicographic order.
      return world.agents.slice();
    case 'random':
      return rng.shuffle(world.agents);
    case 'priority':
      // priority mode placeholder for future activation-rate weighting;
      // defaults to random for v1 per plan §7.
      return rng.shuffle(world.agents);
  }
  const _exhaustive: never = mode;
  throw new Error(`Unknown scheduler mode: ${_exhaustive as string}`);
}

// ─── Tick entrypoint ──────────────────────────────────────────────────────────

/**
 * Advance the simulation by one tick.
 *
 * Mutates `state.world1.agents`, `state.world2.agents` (inventory and
 * interactionMemory fields), and `state.tickNumber` in place. Returns the
 * same `state` reference plus the per-tick `InteractionEvent[]`.
 *
 * Determinism contract: calling `tick(state, rng)` with two independently
 * seeded RNGs (same seed) and two separately bootstrapped states (same seed)
 * must produce byte-identical `TickResult[]` sequences indefinitely.
 *
 * RNG draw order per tick:
 *   For each world (world1 first, world2 second):
 *     1. getActivationOrder (one rng.shuffle call, or zero for "sequential")
 *     2. For each speaker in activation order:
 *        a. selectPartnerFn → rng draw(s) for neighbor selection / softmax pick
 *        b. policy call → rng draw (only for coin-flip rules)
 *        c. rng.pick(referentKeys) → one rng draw
 *        d. rng.pickWeighted(lexemes, weights) → one rng draw
 *        e'. Gaussian success: rng.nextFloat() — exactly one draw, only when
 *            config.successPolicy.kind === 'gaussian'. The 'deterministic' arm
 *            (the v1 default) consumes zero new draws, preserving bit-identical
 *            determinism with all pre-step-33 runs and config-hashes.
 *        (retry loop repeats b–e' up to retryLimit times on failure)
 *        g.  Movement (step 34): zero RNG draws (deterministic tiebreaks).
 *            Fires only after a successful interaction and only when
 *            config.movement.enabled === true AND world.topology.spatial is
 *            populated. With movement.enabled=false (the v1 default), this
 *            sub-step is a no-op and pre-step-34 runs remain bit-identical.
 */
export function tick(state: SimulationState, rng: RNG): TickResult {
  const { world1, world2, tickNumber, config } = state;

  // Build a PolicyConfig from the experiment config + world language labels.
  // l1Label and l2Label are derived from world1's sorted language list.
  // Both worlds share the same language namespace (L1/L2 are global labels).
  const l1Label = (world1.languages[0] ?? world2.languages[0]) as Language;
  const l2Label = (world1.languages[1] ?? world2.languages[1] ?? world1.languages[0]) as Language;
  const policyConfig: PolicyConfig = {
    policyName: 'default',
    entries: config.languagePolicies,
    l1Label,
    l2Label,
  };
  const policy: LanguagePolicy = createPolicy(policyConfig);

  // Resolve partner-selection strategy for this tick (F6 preferential attachment).
  // createPartnerSelector reads config.preferentialAttachment.enabled and tickNumber
  // once at tick-init time; the returned closure is called for every speaker.
  const selectPartnerFn = createPartnerSelector(config, tickNumber);

  const events: InteractionEvent[] = [];
  const {
    interactionMemorySize,
    weightUpdateRule,
    deltaPositive,
    deltaNegative,
    retryLimit,
    interactionProbability,
  } = config;

  // Process world1 then world2 (ordering is part of the determinism contract).
  const worlds: [World, WorldId][] = [
    [world1, 'world1'],
    [world2, 'world2'],
  ];

  for (const [world, worldId] of worlds) {
    const speakerList = getActivationOrder(world, rng, config.schedulerMode);

    for (const speaker of speakerList) {
      // Skip this speaker's activation based on interaction probability.
      // interactionProbability=1.0 means all agents attempt interactions every tick;
      // lower values stochastically gate activations before any partner selection.
      if (interactionProbability < 1.0 && rng.nextFloat() >= interactionProbability) {
        continue;
      }

      let retries = 0;

      // retryLimit = N means the speaker gets at most N+1 total attempts.
      // The while-loop bound `retries <= retryLimit` enforces this:
      //   retries=0 → first attempt, retries=1 → first retry, ... retries=N → Nth retry.
      while (retries <= retryLimit) {
        // ── (a) Partner selection (uniform or preferential per F6 config) ──
        const hearer = selectPartnerFn(speaker, world, rng);
        if (hearer === null) {
          // Isolated node or empty neighboring cell — not a retry; move on.
          break;
        }

        // ── (b) Language selection via step 12's policy ────────────────────
        const language = policy({ speaker, hearer, rng });

        // ── (c) Referent selection ─────────────────────────────────────────
        const languageMap = speaker.inventory.get(language);
        if (!languageMap || languageMap.size === 0) {
          // Speaker has no referents in the chosen language.
          // Skip the interaction — not a retry (policy committed to an unknown language).
          // A future step could add a policy-aware pre-filter here.
          break;
        }
        const referentKeys = Array.from(languageMap.keys());
        // NOTE: Array.from(Map.keys()) materializes keys each call; acceptable for
        // typical referent counts (2–5). Documented as a micro-optimization candidate.
        const referent = rng.pick(referentKeys);

        // ── (d) Token utterance ────────────────────────────────────────────
        const tokenMap = languageMap.get(referent);
        if (!tokenMap || tokenMap.size === 0) {
          // Degenerate: referent key exists but has no token sub-map.
          break;
        }
        const lexemes = Array.from(tokenMap.keys());
        const weights = Array.from(tokenMap.values()) as number[];
        const totalWeight = weights.reduce((s, w) => s + w, 0);
        if (totalWeight <= 0) {
          // All weights are zero — no utterance possible.
          break;
        }
        const token = rng.pickWeighted(lexemes, weights);

        // ── (e) Hearer guess / success determination ───────────────────────
        // The success rule is configurable per `config.successPolicy.kind`:
        //   - 'deterministic' (default, v1): success iff hearer holds a positive
        //     weight for (language, referent, token). Consumes zero RNG draws.
        //   - 'gaussian' (step 33, opt-in): success ~ Bernoulli(Ps) where
        //     Ps = exp(-‖vS - vH‖² / (2σ²)) over top-K token-weight vectors.
        //     Consumes exactly one rng.nextFloat() draw, called at this fixed
        //     point in the sub-step order (the determinism contract relies on this).
        //
        // NOTE: Spec §11 OQ4 mishearing belongs strictly between the token lookup
        // and the success branch — it would corrupt the (referent, token) pair en
        // route to the hearer. The gaussian rule is NOT noise; it replaces the
        // success branch entirely. A future noise step must NOT be bolted into
        // the gaussian arm.
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
            // Single rng draw per gaussian-mode interaction — see RNG draw-order docstring.
            success = rng.nextFloat() < successProbability;
            break;
          }
          default: {
            const _exhaustive: never = config.successPolicy;
            throw new Error(`Unknown success policy: ${JSON.stringify(_exhaustive)}`);
          }
        }

        // Emit the interaction event (uses pre-increment tickNumber per convention).
        events.push({
          tick: tickNumber,
          worldId,
          speakerId: speaker.id,
          hearerId: hearer.id,
          speakerClass: speaker.class,
          hearerClass: hearer.class,
          language,
          referent,
          token,
          success,
          successProbability,
        });

        // ── (f) Weight update ──────────────────────────────────────────────
        if (success) {
          mutateInventory(
            speaker,
            updateWeight(
              speaker.inventory,
              language,
              referent,
              token,
              deltaPositive,
              weightUpdateRule,
            ),
          );
          mutateInventory(
            hearer,
            updateWeight(
              hearer.inventory,
              language,
              referent,
              token,
              deltaPositive,
              weightUpdateRule,
            ),
          );
        } else if (deltaNegative > 0) {
          // Optional Δ⁻ penalty (default 0 in the minimal Naming Game).
          // deltaNegative is stored as a positive number; negate here.
          // inventoryIncrement's floor at 0 prevents weights from going negative.
          mutateInventory(
            speaker,
            updateWeight(
              speaker.inventory,
              language,
              referent,
              token,
              -deltaNegative,
              weightUpdateRule,
            ),
          );
          // NOTE: spec §3.3 minimal variant does NOT penalize the hearer on failure.
          // Hearer update on failure is intentionally absent here.
        }

        // Update bounded FIFO interaction memory for both participants.
        const speakerRecord: InteractionRecord = {
          tick: tickNumber,
          partnerId: hearer.id,
          language,
          referent,
          token,
          success,
        };
        const hearerRecord: InteractionRecord = {
          tick: tickNumber,
          partnerId: speaker.id,
          language,
          referent,
          token,
          success,
        };
        mutateMemory(speaker, speakerRecord, interactionMemorySize);
        mutateMemory(hearer, hearerRecord, interactionMemorySize);

        if (success) {
          // ── (g) Movement (step 34) ─────────────────────────────────────
          // No-op when config.movement.enabled === false or the topology lacks
          // the `spatial` capability (well-mixed, network). Consumes no RNG.
          applyMovement({ speaker, hearer, world, config: config.movement });
          // Successful interaction: this speaker's activation is done.
          break;
        } else {
          // Failed interaction: retry if budget allows (increment then re-check bound).
          retries++;
        }
      }
      // If retries > retryLimit, the while-loop condition fails and we fall through
      // naturally — retry exhaustion is expected and not an error.
    }
  }

  // Advance the tick counter (events are tagged with the pre-increment value).
  state.tickNumber = tickNumber + 1;

  return { state, interactions: events, tickNumber: state.tickNumber };
}

// ─── Internal mutation helpers ────────────────────────────────────────────────

/**
 * Assign a new inventory to an AgentState in place.
 * AgentState.inventory is typed as readonly to prevent accidental external
 * mutation; the engine deliberately bypasses that via a type cast because it
 * owns the simulation state during a tick.
 */
function mutateInventory(agent: AgentState, newInventory: Inventory): void {
  (agent as { inventory: Inventory }).inventory = newInventory;
}

/**
 * Append a record to an agent's bounded FIFO interaction memory in place.
 * Drops the oldest entry when the memory is at capacity.
 * Uses a fresh array on every update to preserve the immutable-array contract
 * visible to external readers (step 14's preferential-attachment code).
 */
function mutateMemory(agent: AgentState, record: InteractionRecord, maxSize: number): void {
  const current = agent.interactionMemory;
  const trimmed = current.length >= maxSize ? current.slice(-(maxSize - 1)) : current;
  (agent as { interactionMemory: readonly InteractionRecord[] }).interactionMemory = [
    ...trimmed,
    record,
  ];
}

/**
 * Assign a new position to an AgentState in place. Step 34 extends the
 * "readonly-by-type, mutable-by-discipline" pattern to AgentState.position so
 * that lib/sim/movement.ts can update positions without a public mutable API.
 *
 * Exported (rather than module-private) so applyMovement in lib/sim/movement.ts
 * can call it without re-implementing the cast. Not part of the lib/sim/index
 * public barrel — internal to the engine/movement boundary.
 */
export function mutatePosition(agent: AgentState, newPosition: number): void {
  (agent as { position: number }).position = newPosition;
}
