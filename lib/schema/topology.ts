import { z } from "zod";

// per docs/spec.md §4.1 F1 — Moore (8-cell) or Von Neumann (4-cell) neighborhoods
export const NeighborhoodType = z.enum(["moore", "von-neumann"]);
export type NeighborhoodType = z.infer<typeof NeighborhoodType>;

// per docs/spec.md §4.1 F4 — 2D lattice topology
const LatticeTopology = z.object({
  type: z.literal("lattice"),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  neighborhood: NeighborhoodType.default("moore"),
});

// per docs/spec.md §4.1 F4 — well-mixed (mean-field) topology; no extra fields
const WellMixedTopology = z.object({
  type: z.literal("well-mixed"),
});

// per docs/spec.md §4.1 F4 — network topology; placeholder fields for v2 evolution
const NetworkTopology = z.object({
  type: z.literal("network"),
  kind: z
    .enum(["small-world", "scale-free", "user-supplied"])
    .default("small-world"),
  // generic parameter bag for future graph-generation algorithms
  parameters: z.record(z.string(), z.unknown()).default({}),
});

// per docs/spec.md §4.1 F4 — discriminated union on "type"
export const TopologyConfig = z.discriminatedUnion("type", [
  LatticeTopology,
  WellMixedTopology,
  NetworkTopology,
]);
export type TopologyConfig = z.infer<typeof TopologyConfig>;

// Export individual variant types for narrowing in downstream code
export type LatticeTopology = z.infer<typeof LatticeTopology>;
export type WellMixedTopology = z.infer<typeof WellMixedTopology>;
export type NetworkTopology = z.infer<typeof NetworkTopology>;
