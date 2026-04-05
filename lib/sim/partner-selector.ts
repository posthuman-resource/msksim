// Factory that resolves a partner-selection function from the experiment config.
// This is the integration point that the engine's tick loop uses:
//
//   const selectPartner = createPartnerSelector(config, tickNumber);
//   // … in the inner loop:
//   const hearer = selectPartner(speaker, world, rng);
//
// Keeping this in its own module lets workers and tests construct a selector
// without depending on the full engine module.
//
// This module is client-safe, server-safe, and worker-safe — no `import 'server-only'`.

import type { ExperimentConfig } from '@/lib/schema/experiment';
import type { AgentState } from './types';
import type { World } from './world';
import type { RNG } from './rng';
import { findAgentByPosition } from './world';
import { preferentialSelectPartner } from './preferential-attachment';

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * Functional partner-selection strategy.
 * The engine calls this once per speaker activation; it returns either
 * an AgentState (the chosen partner) or null (no reachable partner).
 */
export type PartnerSelectorFn = (speaker: AgentState, world: World, rng: RNG) => AgentState | null;

// ─── createPartnerSelector ────────────────────────────────────────────────────

/**
 * Resolve a partner-selection function from the experiment config.
 *
 * @param config       The validated experiment config.
 * @param currentTick  The tick number for this invocation (used for warm-up gating).
 *
 * When `config.preferentialAttachment.enabled` is false, returns the uniform
 * fast-path (a single `topology.pickNeighbor` call) — zero cost for ablation baselines.
 *
 * When enabled, returns a biased selector that:
 *   1. Enumerates ALL topology neighbors via `topology.neighbors()`.
 *   2. Resolves each position to an AgentState (filtering empty cells).
 *   3. Delegates to `preferentialSelectPartner` for the softmax-weighted pick.
 *
 * Both branches guard against an empty candidate list and return null.
 */
export function createPartnerSelector(
  config: ExperimentConfig,
  currentTick: number,
): PartnerSelectorFn {
  if (!config.preferentialAttachment.enabled) {
    // Fast path: uniform random neighbor selection (ablation baseline).
    // Never reads speaker.inventory — verified by test 10 in preferential-attachment.test.ts.
    return (speaker, world, rng) => {
      const pos = world.topology.pickNeighbor(speaker.position, rng);
      if (pos === null) return null;
      return findAgentByPosition(world, pos) ?? null;
    };
  }

  // Preferential attachment: biased toward similar agents.
  const paConfig = config.preferentialAttachment;
  return (speaker, world, rng) => {
    // Enumerate all neighbors (topology.neighbors returns Iterable<number>).
    // rng is passed for API symmetry; most topology implementations do not use it.
    const neighborPositions = Array.from(world.topology.neighbors(speaker.position, rng));
    if (neighborPositions.length === 0) return null;

    // Resolve positions to agent states, skipping empty cells (sparse lattice).
    const candidates = neighborPositions
      .map((pos) => findAgentByPosition(world, pos))
      .filter((a): a is AgentState => a !== undefined);

    return preferentialSelectPartner(speaker, candidates, rng, paConfig, currentTick);
  };
}
