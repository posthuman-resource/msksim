import { z } from 'zod';

// per docs/plan/34-linguistic-migration.md — opt-in linguistic-similarity-driven
// agent migration on lattice topologies. With `enabled: false` (the default), the
// engine short-circuits applyMovement to a no-op so every pre-step-34 run remains
// bit-identical and consumes zero new RNG draws.
//
// `latticeOnly: true` is a documentation marker, not a behavior knob — the engine
// gates movement on the topology's `spatial` capability, never on `topology.kind`,
// preserving the topology-agnostic-engine invariant from step 10.
//
// No `import 'server-only'` — this schema crosses the worker boundary and is
// consumed by tests under the default Vitest `node` environment.

export const CollisionPolicy = z.enum(['swap', 'skip']);
export type CollisionPolicy = z.infer<typeof CollisionPolicy>;

export const MovementConfig = z.object({
  enabled: z.boolean().default(false),
  // Cosine-similarity threshold separating attract (>=) from repel (<). Per the
  // collaborator PDF page 3: cos in [0.5, 1] => attract; cos in [0, 0.5) => repel.
  attractThreshold: z.number().min(0).max(1).default(0.5),
  // Step counts per successful interaction. Asymmetric defaults (1 forward, 2 back)
  // are direct transcriptions of the PDF prescription; both are knobs so the
  // researcher can ablate symmetric vs asymmetric variants.
  attractStep: z.number().int().nonnegative().default(1),
  repelStep: z.number().int().nonnegative().default(2),
  collisionPolicy: CollisionPolicy.default('swap'),
  // Top-K token vector dimensions used for the cosine-similarity decision.
  // Default mirrors step 14's preferential-attachment topK and step 33's
  // gaussianTopK so a single notion of "linguistic identity" is shared.
  topK: z.number().int().positive().default(10),
  // Documentation marker; future arms can ablate by adding more capability checks.
  latticeOnly: z.literal(true).default(true),
});
export type MovementConfig = z.infer<typeof MovementConfig>;

// Pre-computed full default — Zod 4's .default() does not re-parse through the
// schema, so consumers needing the literal default value import this directly.
export const defaultMovementConfig: MovementConfig = {
  enabled: false,
  attractThreshold: 0.5,
  attractStep: 1,
  repelStep: 2,
  collisionPolicy: 'swap',
  topK: 10,
  latticeOnly: true,
};
