// Preferential attachment partner-selection strategy.
// Per docs/spec.md §4.1 F6 and §11 OQ7.
//
// After a warm-up period, partner choice is biased toward candidates whose
// top-weighted token vectors are most similar to the speaker's, using softmax
// over cosine similarity with a temperature knob.
//
// This module is client-safe, server-safe, and worker-safe — it deliberately
// does NOT carry `import 'server-only'`.

import type { PreferentialAttachmentConfig } from '@/lib/schema/preferential';
import type { AgentState } from './types';
import type { RNG } from './rng';
import { cosineSimilarity, topKTokenVector } from './similarity';

// ─── softmaxWithTemperature ───────────────────────────────────────────────────

/**
 * Numerically-stable softmax with temperature parameter.
 *
 * Formula: p_i = exp((z_i - max_z) / T) / Σ_j exp((z_j - max_z) / T)
 * The log-sum-exp trick (subtracting max before exponentiation) prevents
 * overflow when T → 0⁺, where naive exp(z_i / T) would yield Infinity.
 *
 * Behavior at limits:
 *   T → 0⁺  : approaches a Dirac delta on the argmax (near-deterministic).
 *   T → ∞   : approaches the uniform distribution (maximum exploration).
 *
 * Throws if `temperature <= 0` (a valid config must have temperature > 0;
 * Zod enforces this at the validation boundary, but the runtime check guards
 * against direct object construction in tests or internal callers).
 *
 * Returns [] for an empty `scores` array.
 */
export function softmaxWithTemperature(scores: readonly number[], temperature: number): number[] {
  if (temperature <= 0) {
    throw new RangeError(`softmaxWithTemperature: temperature must be > 0, got ${temperature}`);
  }
  if (scores.length === 0) return [];

  const max = Math.max(...scores);
  const shifted = scores.map((s) => Math.exp((s - max) / temperature));
  const total = shifted.reduce((acc, v) => acc + v, 0);
  return shifted.map((v) => v / total);
}

// ─── preferentialSelectPartner ────────────────────────────────────────────────

/**
 * Pick a partner from `candidates` biased toward similar token inventories.
 *
 * Algorithm:
 *   (a) Empty candidates → null.
 *   (b) currentTick < config.warmUpTicks → uniform random pick (rng.pick).
 *   (c) Otherwise:
 *       1. Compute speaker's top-K token vector.
 *       2. Compute each candidate's top-K token vector.
 *       3. Compute cosine similarities.
 *       4. Apply softmax-with-temperature to get selection probabilities.
 *       5. Sample via rng.pickWeighted.
 *
 * When all cosine similarities are 0 (e.g., speaker has an empty inventory or
 * all candidates have orthogonal inventories), softmax collapses to the uniform
 * distribution — a clean degenerate behavior matching the warm-up intuition.
 *
 * Determinism: same RNG state + same candidates + same inventories → same result.
 * No Math.random. No Date.now.
 */
export function preferentialSelectPartner(
  speaker: AgentState,
  candidates: readonly AgentState[],
  rng: RNG,
  config: PreferentialAttachmentConfig,
  currentTick: number,
): AgentState | null {
  if (candidates.length === 0) return null;

  // Warm-up: fall back to uniform random selection.
  if (currentTick < config.warmUpTicks) {
    return rng.pick(candidates as AgentState[]);
  }

  // Compute speaker's top-K token vector once.
  const speakerVec = topKTokenVector(speaker.inventory, config.topK);

  // Compute cosine similarity to each candidate.
  const similarities = candidates.map((c) =>
    cosineSimilarity(speakerVec, topKTokenVector(c.inventory, config.topK)),
  );

  // Convert to selection probabilities via softmax.
  const probabilities = softmaxWithTemperature(similarities, config.temperature);

  return rng.pickWeighted(candidates as AgentState[], probabilities);
}
