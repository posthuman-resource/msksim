// Single-RNG discipline: bootstrapExperiment creates exactly ONE RNG from the
// caller-supplied seed and returns it to the caller (step-13 tick loop).
// No downstream code should create a parallel RNG for the same experiment —
// doing so silently breaks the deterministic draw sequence that makes replay
// and snapshot diffing possible.

import type { ExperimentConfig } from "@/lib/schema/experiment";
import type { WorldConfig, VocabularySeed } from "@/lib/schema/world";
import type { AgentClass, Language, Referent, TokenLexeme, Weight } from "@/lib/schema/primitives";
import { createRNG, type RNG } from "./rng";
import { makeAgentId, type AgentId, type AgentState, type Inventory } from "./types";
import { createTopology } from "./topology/factory";
import type { World, WorldId } from "./world";

// ─── Private helpers ──────────────────────────────────────────────────────────

/** Construct an AgentState with an empty interaction memory. */
function createAgent(
  id: AgentId,
  agentClass: AgentClass,
  position: number,
  inventory: Inventory,
): AgentState {
  return {
    id,
    class: agentClass,
    position,
    inventory,
    interactionMemory: [],
  };
}

/**
 * Build a fresh Inventory for a single agent from the vocabulary seed matrix.
 * Every Map instance is a new allocation — callers must never share Inventory
 * references across agents (step 13 mutates weights in place via inventorySet).
 *
 * Pure function: no RNG draws. Identical inputs always produce identical output.
 */
function inventoryFromSeed(
  seedMatrix: VocabularySeed,
  classKey: AgentClass,
  languages: Language[],
  referents: Referent[],
): Inventory {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const classSeed = (seedMatrix as any)[classKey] as
    | Record<string, Record<string, { lexeme: TokenLexeme; initialWeight: Weight }[]>>
    | undefined;

  if (!classSeed) {
    return new Map() as Inventory;
  }

  const outerMap = new Map<Language, ReadonlyMap<Referent, ReadonlyMap<TokenLexeme, Weight>>>();

  for (const lang of languages) {
    const langSeed = classSeed[lang];
    if (!langSeed) continue;

    const midMap = new Map<Referent, ReadonlyMap<TokenLexeme, Weight>>();

    for (const ref of referents) {
      const entries = langSeed[ref];
      if (!entries || entries.length === 0) continue;

      const innerMap = new Map<TokenLexeme, Weight>();
      for (const { lexeme, initialWeight } of entries) {
        innerMap.set(lexeme, initialWeight);
      }
      midMap.set(ref, innerMap as ReadonlyMap<TokenLexeme, Weight>);
    }

    if (midMap.size > 0) {
      outerMap.set(lang, midMap as ReadonlyMap<Referent, ReadonlyMap<TokenLexeme, Weight>>);
    }
  }

  return outerMap as Inventory;
}

/**
 * Split agentCount into monolingual and bilingual counts.
 * ratio = monolinguals per bilingual (e.g. 1.5 for the PDF's 3:2 default).
 * Math.round ties break toward mono.
 * Edge cases: agentCount === 0 → {0, 0}; ratio === 0 → all bilingual.
 */
function countMonoBi(
  agentCount: number,
  ratio: number,
): { mono: number; bi: number } {
  if (agentCount === 0) return { mono: 0, bi: 0 };
  if (ratio === 0) return { mono: 0, bi: agentCount };
  const mono = Math.round((agentCount * ratio) / (ratio + 1));
  const bi = agentCount - mono;
  return { mono, bi };
}

/**
 * Derive the sorted set of languages referenced in any class's seed.
 * Sorted alphabetically for stable, seed-independent ordering.
 */
function deriveLanguages(seed: VocabularySeed): Language[] {
  const set = new Set<string>();
  for (const classRecord of Object.values(seed)) {
    for (const lang of Object.keys(classRecord ?? {})) {
      set.add(lang);
    }
  }
  return Array.from(set).sort() as Language[];
}

/**
 * Build one World from a WorldConfig.
 * RNG draw order (determinism contract):
 *   1. createTopology (lattice/well-mixed consume zero draws; future network generators may consume some)
 *   2. rng.shuffle for lattice position assignment
 * inventoryFromSeed is pure (no RNG draws) so does not affect the sequence.
 */
function buildWorld(worldId: WorldId, worldConfig: WorldConfig, rng: RNG): World {
  // 1. Create topology.
  const topology = createTopology(worldConfig.topology, rng, worldConfig.agentCount);

  // 2. Mono / bi split.
  const { mono, bi } = countMonoBi(
    worldConfig.agentCount,
    worldConfig.monolingualBilingualRatio,
  );

  // 3. Class assignment array (ordinal order, independent of position).
  const monoClass: AgentClass = worldId === "world1" ? "W1-Mono" : "W2-Native";
  const biClass: AgentClass = worldId === "world1" ? "W1-Bi" : "W2-Immigrant";
  const classes: AgentClass[] = [
    ...Array<AgentClass>(mono).fill(monoClass),
    ...Array<AgentClass>(bi).fill(biClass),
  ];

  // 4. Position assignment.
  //    Lattice: random collision-free placement — shuffle all cell indices and
  //      take the first agentCount (satisfies F1: no two agents share a cell).
  //    Well-mixed / network: sequential indices (no spatial cells to permute;
  //      the topology is already fully connected, so order is irrelevant).
  let positions: number[];
  if (topology.kind === "lattice") {
    const all = Array.from({ length: topology.size }, (_, i) => i);
    positions = rng.shuffle(all).slice(0, worldConfig.agentCount);
  } else {
    positions = Array.from({ length: worldConfig.agentCount }, (_, i) => i);
  }

  // 5. Derive language list once per world (not per agent).
  const languages = deriveLanguages(worldConfig.vocabularySeed);

  // 6. Build agents.
  const prefix = worldId === "world1" ? "w1" : "w2";
  const agents: AgentState[] = [];

  for (let i = 0; i < worldConfig.agentCount; i++) {
    const id = makeAgentId(`${prefix}-${String(i).padStart(3, "0")}`);
    const agentClass = classes[i];
    const inventory = inventoryFromSeed(
      worldConfig.vocabularySeed,
      agentClass,
      languages,
      worldConfig.referents,
    );
    agents.push(createAgent(id, agentClass, positions[i], inventory));
  }

  return {
    id: worldId,
    agents,
    topology,
    referents: worldConfig.referents,
    languages,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Turn a validated ExperimentConfig + numeric seed into two fully populated
 * Worlds and an RNG ready for the step-13 tick loop.
 *
 * World1 is fully bootstrapped before World2 consumes any RNG draws, so a
 * config change that affects only world2 leaves world1 byte-identical.
 */
export function bootstrapExperiment(
  config: ExperimentConfig,
  seed: number,
): { world1: World; world2: World; rng: RNG } {
  const rng = createRNG(seed);
  const world1 = buildWorld("world1", config.world1, rng);
  const world2 = buildWorld("world2", config.world2, rng);
  return { world1, world2, rng };
}
