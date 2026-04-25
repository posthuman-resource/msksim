// Linguistic-similarity-driven agent movement on lattice topologies.
// Per docs/plan/34-linguistic-migration.md and the collaborator PDF pages 3–4.
//
// applyMovement runs after a successful interaction. It computes the cosine
// similarity between speaker and hearer over their top-K token-weight vectors
// and either steps the speaker toward (high cosine) or away from (low cosine)
// the hearer. Movement is a no-op when:
//   - config.enabled === false (default), OR
//   - world.topology.spatial is undefined (well-mixed, network).
//
// The capability check on `world.topology.spatial` (rather than branching on
// `topology.kind`) preserves the topology-agnostic-engine invariant from
// step 10: only lib/sim/topology/factory.ts may branch on kind.
//
// Determinism: this module consumes ZERO RNG draws. All tiebreaks are
// implemented in lattice.stepToward / lattice.stepAwayFrom and are pure.
//
// Client-safe, server-safe, worker-safe — no `import 'server-only'`.

import type { MovementConfig } from '@/lib/schema/movement';
import type { AgentState } from './types';
import type { World } from './world';
import { findAgentByPosition } from './world';
import { cosineSimilarity, topKTokenVector } from './similarity';
import { mutatePosition } from './engine';

export type ApplyMovementArgs = {
  speaker: AgentState;
  hearer: AgentState;
  world: World;
  config: MovementConfig;
};

/**
 * Apply at most one movement decision after a successful interaction.
 *
 * Mutation surface:
 *   - speaker.position may change (toward/away).
 *   - In the 'swap' collision branch, the agent currently occupying the target
 *     cell also has its position updated (swapped with speaker).
 *   - The hearer's position is only changed when the hearer happens to occupy
 *     the cell speaker tries to step into.
 *
 * No-op cases:
 *   - config.enabled === false
 *   - world.topology.spatial === undefined (lattice-only constraint)
 *   - stepToward / stepAwayFrom return null (no improving move from corner)
 *   - Collision with collisionPolicy === 'skip'
 *
 * The loop sub-steps the configured attractStep / repelStep count, re-evaluating
 * stepToward / stepAwayFrom from the speaker's NEW position each iteration, so
 * the path traced is the greedy distance-{decreasing,increasing} walk.
 */
export function applyMovement(args: ApplyMovementArgs): void {
  const { speaker, hearer, world, config } = args;
  if (!config.enabled) return;

  const spatial = world.topology.spatial;
  if (!spatial) return;

  const speakerVec = topKTokenVector(speaker.inventory, config.topK);
  const hearerVec = topKTokenVector(hearer.inventory, config.topK);
  const cos = cosineSimilarity(speakerVec, hearerVec);
  const attract = cos >= config.attractThreshold;
  const steps = attract ? config.attractStep : config.repelStep;

  for (let i = 0; i < steps; i++) {
    const nextPos = attract
      ? spatial.stepToward(speaker.position, hearer.position)
      : spatial.stepAwayFrom(speaker.position, hearer.position);
    if (nextPos === null) {
      // No improving move available (already at target / corner with no
      // farther neighbor) — terminate the walk early.
      break;
    }
    const occupant = findAgentByPosition(world, nextPos);
    if (occupant !== undefined && occupant.id !== speaker.id) {
      if (config.collisionPolicy === 'skip') {
        break;
      }
      // 'swap': exchange positions with the occupant. Further sub-steps would
      // shuffle other agents around in ways the PDF doesn't describe; stop
      // the walk after the swap completes.
      const speakerOldPos = speaker.position;
      mutatePosition(speaker, nextPos);
      mutatePosition(occupant, speakerOldPos);
      break;
    }
    mutatePosition(speaker, nextPos);
  }
}
