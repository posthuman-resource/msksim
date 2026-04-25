/**
 * lib/sim/metrics/scalar.ts — pure scalar metric computations for the Naming Game.
 *
 * Five metrics per tick (docs/spec.md §7.1):
 *   1. Communication success rate  — O(events) per call
 *   2. Mean token weight           — O(N) per call (N = agents per world)
 *   3. Token weight variance       — O(N) two-pass naive, divisor n−1
 *   4. Distinct active tokens (Nw) — O(N) per call
 *   5. Matching rate               — O(N² × R) per call (R = |referents|)
 *
 * PURE FUNCTION CONTRACT: no RNG, no wall clock, no mutation, no persistence.
 * Step 20 (worker) stamps the tick number and persists the snapshot via step 26.
 *
 * SCOPE BOUNDARY: graph metrics (step 16) and run-summary classifiers (step 17)
 * are NOT implemented here.
 *
 * COST NOTE: matching rate uses the naive pairwise O(N²×R) formulation.
 * Acceptable at N ≤ 500 per world (≤ 250k comparisons; < 1ms in V8).
 * NOT acceptable at N = 10⁴ per world (50M comparisons).
 * See the commented-out O(N) histogram alternative in computeMatchingRate.
 *
 * NO `import 'server-only'` — this module must bundle into the step-20 Web Worker
 * (client-context chunk in Turbopack). See CLAUDE.md "Next.js 16 deltas".
 */

import type { AgentClass, AgentId, Language, Referent, TokenLexeme } from '../types';
import type { World } from '../world';
import { findAgentByPosition } from '../world';
import type { InteractionEvent } from '../engine';
import { cosineSimilarity, topKTokenVector } from '../similarity';
import type { RNG } from '../rng';
import type {
  ScalarMetricsSnapshot,
  PerWorldScalarMetrics,
  PerLanguageScalarMetrics,
  SuccessRate,
  SuccessRateByClassPair,
  ClassPairKey,
} from './types';

/**
 * Default top-K for computeSpatialHomophily. Coupled to MovementConfig.topK's
 * default (10) and step 33's gaussianTopK so a single notion of "linguistic
 * identity" governs all three features. Hardcoded here rather than threaded
 * through the metric signature to keep the per-tick metrics pass fully pure
 * (no MovementConfig dependency).
 */
const SPATIAL_HOMOPHILY_TOPK = 10;

/**
 * No-op RNG sentinel for topology.neighbors() calls that don't need randomness.
 * The lattice implementation ignores the rng argument; well-mixed and network
 * never reach this code path because spatialHomophily is gated on `spatial`.
 */
const NO_RNG: RNG = {
  nextInt: () => 0,
  nextFloat: () => 0,
  pick: <T>(a: T[]) => a[0],
  pickWeighted: <T>(a: T[]) => a[0],
  shuffle: <T>(a: readonly T[]) => [...a],
};

// ─── Class-pair key enumeration ───────────────────────────────────────────────

const AGENT_CLASSES: AgentClass[] = ['W1-Mono', 'W1-Bi', 'W2-Native', 'W2-Immigrant'];

/** All 16 (speakerClass)__(hearerClass) keys, computed once at module load. */
const ALL_CLASS_PAIR_KEYS: ClassPairKey[] = AGENT_CLASSES.flatMap((s) =>
  AGENT_CLASSES.map((h) => `${s}__${h}` as ClassPairKey),
);

// ─── Communication success rate ───────────────────────────────────────────────

/**
 * Compute the communication success rate from tick interaction events.
 *
 * Returns NaN rate (not 0) when total === 0. NaN is the canonical "undefined"
 * marker in JS numeric pipelines: Recharts/d3 skip it as a time-series gap,
 * whereas 0 would plot as a misleading "100% failure" data point.
 */
export function computeCommunicationSuccessRate(
  tickInteractions: readonly InteractionEvent[],
  worldId: 'world1' | 'world2' | 'overall',
): SuccessRate {
  let successful = 0;
  let total = 0;
  for (const event of tickInteractions) {
    if (worldId !== 'overall' && event.worldId !== worldId) continue;
    total++;
    if (event.success) successful++;
  }
  return { successful, total, rate: total === 0 ? NaN : successful / total };
}

/**
 * Compute success rate broken down by (speakerClass, hearerClass) pair.
 *
 * All 16 cells are always present in the returned record, even when total === 0
 * for a cell (rate: NaN in that case). This guards against downstream consumers
 * crashing when they expect a fixed shape.
 *
 * Requires world1 and world2 to resolve agent class from agent id. The
 * InteractionEvent type does not carry class fields; worlds are the source of truth.
 * If worldId is provided, only events for that world are counted.
 */
export function computeSuccessRateByClassPair(
  tickInteractions: readonly InteractionEvent[],
  world1: World,
  world2: World,
  worldId?: 'world1' | 'world2',
): SuccessRateByClassPair {
  // Build a fast AgentId → AgentClass lookup covering both worlds.
  const classMap = new Map<AgentId, AgentClass>();
  for (const agent of world1.agents) classMap.set(agent.id, agent.class);
  for (const agent of world2.agents) classMap.set(agent.id, agent.class);

  // Pre-populate all 16 cells with zero counts.
  const counts = {} as Record<ClassPairKey, { successful: number; total: number }>;
  for (const key of ALL_CLASS_PAIR_KEYS) {
    counts[key] = { successful: 0, total: 0 };
  }

  for (const event of tickInteractions) {
    if (worldId !== undefined && event.worldId !== worldId) continue;
    const speakerClass = classMap.get(event.speakerId);
    const hearerClass = classMap.get(event.hearerId);
    if (speakerClass === undefined || hearerClass === undefined) continue;
    const key: ClassPairKey = `${speakerClass}__${hearerClass}`;
    counts[key].total++;
    if (event.success) counts[key].successful++;
  }

  // Compute rates in a second pass.
  const result = {} as Record<ClassPairKey, SuccessRate>;
  for (const key of ALL_CLASS_PAIR_KEYS) {
    const { successful, total } = counts[key];
    result[key] = { successful, total, rate: total === 0 ? NaN : successful / total };
  }
  return result as SuccessRateByClassPair;
}

// ─── Token weight helpers ─────────────────────────────────────────────────────

/**
 * Collect all strictly-positive weights for a given language across all agents
 * in the world. Returns a flat array (enables two-pass variance computation).
 * O(N × R × L_max).
 */
function collectPositiveWeights(world: World, language: Language): number[] {
  const values: number[] = [];
  for (const agent of world.agents) {
    const langMap = agent.inventory.get(language);
    if (!langMap) continue;
    for (const tokenMap of langMap.values()) {
      for (const weight of tokenMap.values()) {
        if (weight > 0) values.push(weight);
      }
    }
  }
  return values;
}

/**
 * Mean of all strictly-positive token weights for a given language.
 * Returns NaN when no positive weights exist (canonical "undefined" marker).
 */
export function computeMeanTokenWeight(world: World, language: Language): number {
  const values = collectPositiveWeights(world, language);
  if (values.length === 0) return NaN;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/**
 * Sample variance (divisor n−1) of strictly-positive token weights for a given
 * language. Returns NaN when fewer than 2 positive weights exist.
 *
 * Divisor n−1 matches R's var() default — the expected CSV export consumer.
 * Two-pass naive formulation: stable for Naming Game token weights (bounded
 * values, short run lengths). See docs/plan/15-scalar-metrics.md §4 for the
 * Welford one-pass alternative (rejected for v1 simplicity).
 */
export function computeTokenWeightVariance(world: World, language: Language): number {
  const values = collectPositiveWeights(world, language);
  if (values.length < 2) return NaN;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const sumSqDiff = values.reduce((s, v) => s + (v - mean) ** 2, 0);
  return sumSqDiff / (values.length - 1);
  /* Welford one-pass alternative (drop-in swap if numerical issues arise):
  let n = 0, wMean = 0, M2 = 0;
  for (const v of values) {
    n++;
    const delta = v - wMean;
    wMean += delta / n;
    M2 += delta * (v - wMean);
  }
  return n < 2 ? NaN : M2 / (n - 1);
  */
}

// ─── Distinct active tokens (Nw) ──────────────────────────────────────────────

/**
 * Count of distinct (language, lexeme) pairs with any weight > 0 across the
 * entire agent population of the given world. This is Nw, the canonical Naming
 * Game observable per Dall'Asta et al. 2008 (arXiv:0803.0398).
 *
 * A token (L1, "yellow") that is positively weighted for referent A AND referent B
 * counts as ONE distinct token — Dall'Asta's Nw counts labels, not label-meaning
 * pairs. Key format: `${language}:${lexeme}` (not `${language}:${referent}:${lexeme}`).
 *
 * O(N × L × R × lexemes) = O(N) for bounded constants.
 */
export function computeDistinctActiveTokens(world: World): number {
  const seen = new Set<string>();
  for (const agent of world.agents) {
    for (const [lang, langMap] of agent.inventory) {
      for (const tokenMap of langMap.values()) {
        for (const [lex, weight] of tokenMap) {
          if (weight > 0) {
            seen.add(`${lang}:${lex}`);
          }
        }
      }
    }
  }
  return seen.size;
}

// ─── Matching rate ────────────────────────────────────────────────────────────

/**
 * Build a Map<AgentId, Map<Referent, TokenLexeme | null>> for the given world.
 *
 * For each (agent, referent) pair, finds the lexeme with the maximum strictly-
 * positive weight across ALL languages. Ties broken deterministically by
 * lexicographic order on `${language}:${lexeme}` (the composite key). Returns null
 * for an (agent, referent) pair when no positive-weight token exists anywhere.
 *
 * TIE-BREAK RATIONALE: the composite key is used for tie-breaking only; the
 * returned value is the bare TokenLexeme. A cross-language tie (L1:"x" and L2:"x"
 * with equal weight) resolves to the lexicographically smaller composite, which
 * is the same lexeme "x" in both cases — no information is lost.
 *
 * This is a private helper computed once at the top of computeScalarMetrics.
 * Step 16's graph metrics may optionally reuse it via the argmaxCache parameter
 * on computeMatchingRate.
 */
function topTokenPerAgentPerReferent(
  world: World,
): Map<AgentId, Map<Referent, TokenLexeme | null>> {
  const result = new Map<AgentId, Map<Referent, TokenLexeme | null>>();

  for (const agent of world.agents) {
    const referentMap = new Map<Referent, TokenLexeme | null>();

    for (const referent of world.referents) {
      let bestKey: string | null = null;
      let bestToken: TokenLexeme | null = null;
      let bestWeight = 0;

      for (const [lang, langMap] of agent.inventory) {
        const tokenMap = langMap.get(referent);
        if (!tokenMap) continue;
        for (const [lex, weight] of tokenMap) {
          if (weight <= 0) continue;
          const key = `${lang}:${lex}`;
          // Higher weight wins; ties broken lexicographically on composite key.
          if (weight > bestWeight || (weight === bestWeight && bestKey !== null && key < bestKey)) {
            bestWeight = weight;
            bestKey = key;
            bestToken = lex;
          }
        }
      }

      referentMap.set(referent, bestToken);
    }

    result.set(agent.id, referentMap);
  }

  return result;
}

/**
 * Fraction of unordered agent pairs whose top-weighted token for a given referent
 * agrees, averaged over referents. Per docs/spec.md §7.1.
 *
 * DENOMINATOR: all N×(N−1)/2 unordered pairs, not just pairs where both agents
 * have a non-null top token. A null top token means "no utterance for this
 * referent" and counts as a non-match — matching the spec's literal phrasing.
 *
 * O(N² × R) per call — acceptable at N ≤ 500 per world (docs/spec.md §11 Q2).
 * NOT acceptable at N = 10⁴. Drop-in O(N) histogram alternative:
 *   For each referent r, build freq: Map<TokenLexeme, count>. Then:
 *   agreed_r = Σ c*(c−1)/2 over freq.values()
 *   matchRate_r = agreed_r / (N*(N−1)/2)
 *   (Mathematically equivalent; O(N) per referent instead of O(N²).)
 *
 * Accepts an optional precomputed argmax cache (topTokenPerAgentPerReferent output)
 * to avoid double-computation when step 16's graph metrics also need the argmax.
 */
export function computeMatchingRate(
  world: World,
  argmaxCache?: Map<AgentId, Map<Referent, TokenLexeme | null>>,
): number {
  const cache = argmaxCache ?? topTokenPerAgentPerReferent(world);
  const agents = world.agents;
  const n = agents.length;
  if (n < 2) return NaN;

  const totalPairs = (n * (n - 1)) / 2;
  const perReferentRates: number[] = [];

  for (const referent of world.referents) {
    let agreed = 0;
    for (let i = 0; i < n; i++) {
      const tokI = cache.get(agents[i].id)?.get(referent) ?? null;
      for (let j = i + 1; j < n; j++) {
        const tokJ = cache.get(agents[j].id)?.get(referent) ?? null;
        if (tokI !== null && tokJ !== null && tokI === tokJ) agreed++;
      }
    }
    perReferentRates.push(agreed / totalPairs);
  }

  /* Sampled approximation (commented-out stub for future headless-sweep use):
  const K = 1000;
  for (const referent of world.referents) {
    let agreed = 0;
    for (let k = 0; k < K; k++) {
      // NOTE: would need an RNG parameter; violates the no-RNG contract.
      // This stub documents the approach only.
      const i = 0; // placeholder
      const j = 1; // placeholder
      const tokI = cache.get(agents[i].id)?.get(referent) ?? null;
      const tokJ = cache.get(agents[j].id)?.get(referent) ?? null;
      if (tokI !== null && tokJ !== null && tokI === tokJ) agreed++;
    }
    perReferentRates.push(agreed / K);
  }
  */

  const validRates = perReferentRates.filter((r) => !isNaN(r));
  if (validRates.length === 0) return NaN;
  return validRates.reduce((s, r) => s + r, 0) / validRates.length;
}

// ─── Spatial homophily (step 34) ──────────────────────────────────────────────

/**
 * Average cosine similarity between an agent and its lattice neighbors,
 * over top-K token-weight vectors.
 *
 *   spatialHomophily(world) = mean_{(a,n) ∈ neighborPairs} cos(a, n)
 *
 * The summation walks each agent's topology neighbors and resolves them via
 * findAgentByPosition; empty cells are skipped. Each ordered (agent, neighbor)
 * pair contributes once — the sum effectively double-counts each undirected
 * edge, but since both directions contribute the same cosine value, the
 * resulting average is unchanged.
 *
 * Returns NaN when:
 *   - the topology has no spatial capability (well-mixed, network), OR
 *   - no neighbor pairs exist (size-1 lattice or all cells empty).
 *
 * Computed every tick regardless of config.movement.enabled — useful as a
 * baseline observable even without migration. Cost: O(N × |neighborhood|).
 */
export function computeSpatialHomophily(world: World): number {
  if (!world.topology.spatial) return Number.NaN;

  let sum = 0;
  let pairCount = 0;
  for (const agent of world.agents) {
    const agentVec = topKTokenVector(agent.inventory, SPATIAL_HOMOPHILY_TOPK);
    for (const neighborPos of world.topology.neighbors(agent.position, NO_RNG)) {
      const neighbor = findAgentByPosition(world, neighborPos);
      if (!neighbor) continue;
      const neighborVec = topKTokenVector(neighbor.inventory, SPATIAL_HOMOPHILY_TOPK);
      sum += cosineSimilarity(agentVec, neighborVec);
      pairCount++;
    }
  }
  if (pairCount === 0) return Number.NaN;
  return sum / pairCount;
}

// ─── Composite entrypoint ─────────────────────────────────────────────────────

/**
 * Compute all five per-tick scalar observables for both worlds.
 *
 * PURE FUNCTION: no RNG, no wall clock, no mutation, no I/O.
 * Returns tick: null — the step-20 worker stamps the tick number into the snapshot.
 *
 * Cost: O(N² × R) dominated by matching rate; O(N) for all other metrics.
 * Acceptable at N ≤ 500 per world (docs/spec.md §11 Q2).
 *
 * The argmax cache (topTokenPerAgentPerReferent) is computed once per world at
 * the top of this function. computeMatchingRate and any future step-16 graph
 * metrics that also need the argmax share this single precomputation per world.
 */
export function computeScalarMetrics(
  world1: World,
  world2: World,
  tickInteractions: readonly InteractionEvent[],
): ScalarMetricsSnapshot {
  // Precompute argmax caches once per world (reused by matching rate).
  const argmax1 = topTokenPerAgentPerReferent(world1);
  const argmax2 = topTokenPerAgentPerReferent(world2);

  function buildWorldMetrics(
    world: World,
    worldId: 'world1' | 'world2',
    argmax: Map<AgentId, Map<Referent, TokenLexeme | null>>,
  ): PerWorldScalarMetrics {
    const perLanguage = {} as Record<Language, PerLanguageScalarMetrics>;
    for (const lang of world.languages) {
      perLanguage[lang] = {
        meanTokenWeight: computeMeanTokenWeight(world, lang),
        tokenWeightVariance: computeTokenWeightVariance(world, lang),
      };
    }

    return {
      successRate: computeCommunicationSuccessRate(tickInteractions, worldId),
      successRateByClassPair: computeSuccessRateByClassPair(
        tickInteractions,
        world1,
        world2,
        worldId,
      ),
      distinctActiveTokens: computeDistinctActiveTokens(world),
      matchingRate: computeMatchingRate(world, argmax),
      spatialHomophily: computeSpatialHomophily(world),
      perLanguage,
    };
  }

  return {
    tick: null,
    world1: buildWorldMetrics(world1, 'world1', argmax1),
    world2: buildWorldMetrics(world2, 'world2', argmax2),
    overall: {
      successRate: computeCommunicationSuccessRate(tickInteractions, 'overall'),
      successRateByClassPair: computeSuccessRateByClassPair(tickInteractions, world1, world2),
    },
  };
}
