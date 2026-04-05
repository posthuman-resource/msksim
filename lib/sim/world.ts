// World type and lightweight lookup helpers.
// Client-safe, server-safe, and worker-safe — no `import 'server-only'`.
// Keeping `agents` as a plain array (not Map<AgentId, AgentState>) is deliberate:
//   - The tick loop iterates more often than it looks up by id.
//   - Arrays serialize trivially to JSON for step-16 snapshots.
//   - The helpers below hide the linear scan, enabling a future O(1) index swap.

import type { AgentState, AgentId, Language, Referent } from "./types";
import type { Topology } from "./topology";

export type WorldId = "world1" | "world2";

export type World = {
  readonly id: WorldId;
  readonly agents: AgentState[];
  readonly topology: Topology;
  readonly referents: Referent[];
  readonly languages: Language[];
};

/** Linear scan by id. Returns undefined when no agent has the given id. */
export function findAgentById(world: World, id: AgentId): AgentState | undefined {
  return world.agents.find((a) => a.id === id);
}

/** Linear scan by position. Returns undefined when no agent occupies the given position. */
export function findAgentByPosition(
  world: World,
  position: number,
): AgentState | undefined {
  return world.agents.find((a) => a.position === position);
}
