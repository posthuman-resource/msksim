import { describe, expect, it } from "vitest";
import { ExperimentConfig } from "@/lib/schema/experiment";
import { Language as LSchema, Referent as RSchema, TokenLexeme as TLSchema } from "@/lib/schema/primitives";
import type { TokenLexeme, Weight } from "@/lib/schema/primitives";
import { createRNG } from "./rng";
import { makeAgentId } from "./types";
import type { Inventory } from "./types";
import { bootstrapExperiment } from "./bootstrap";
import { findAgentById, findAgentByPosition } from "./world";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Serialize an Inventory to a sorted flat array for deep equality checks. */
function flattenInventory(inv: Inventory): [string, string, string, number][] {
  const out: [string, string, string, number][] = [];
  for (const [lang, byRef] of inv) {
    for (const [ref, byLex] of byRef) {
      for (const [lex, w] of byLex) {
        out.push([lang, ref, lex, w]);
      }
    }
  }
  return out.sort((a, b) =>
    `${a[0]}|${a[1]}|${a[2]}`.localeCompare(`${b[0]}|${b[1]}|${b[2]}`)
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("bootstrapExperiment", () => {
  // Test 1 — determinism
  it("is deterministic across two calls with the same seed", () => {
    const config = ExperimentConfig.parse({});
    const r1 = bootstrapExperiment(config, 42);
    const r2 = bootstrapExperiment(config, 42);

    expect(r1.world1.agents.length).toBe(r2.world1.agents.length);
    expect(r1.world2.agents.length).toBe(r2.world2.agents.length);

    // Ids, classes, and positions must match in order.
    expect(r1.world1.agents.map((a) => a.id)).toEqual(r2.world1.agents.map((a) => a.id));
    expect(r1.world1.agents.map((a) => a.class)).toEqual(r2.world1.agents.map((a) => a.class));
    expect(r1.world1.agents.map((a) => a.position)).toEqual(r2.world1.agents.map((a) => a.position));

    // Inventories must also match.
    const inv1 = r1.world1.agents.map((a) => flattenInventory(a.inventory));
    const inv2 = r2.world1.agents.map((a) => flattenInventory(a.inventory));
    expect(inv1).toEqual(inv2);

    // Repeat for world2.
    expect(r1.world2.agents.map((a) => a.position)).toEqual(r2.world2.agents.map((a) => a.position));
  });

  // Test 2 — different seeds produce different worlds
  it("changing the seed changes the world", () => {
    const config = ExperimentConfig.parse({});
    const r0 = bootstrapExperiment(config, 0);
    const r1 = bootstrapExperiment(config, 1);

    // Compare the full position array to avoid false negatives on any single position.
    const pos0 = r0.world1.agents.map((a) => a.position).join(",");
    const pos1 = r1.world1.agents.map((a) => a.position).join(",");
    expect(pos0).not.toBe(pos1);
  });

  // Test 3 — W1-Mono has only L1
  it("W1-Mono agents have only L1 in their inventory", () => {
    const config = ExperimentConfig.parse({});
    const { world1 } = bootstrapExperiment(config, 0);

    const monoAgents = world1.agents.filter((a) => a.class === "W1-Mono");
    expect(monoAgents.length).toBeGreaterThan(0);

    for (const agent of monoAgents) {
      const keys = Array.from(agent.inventory.keys());
      expect(keys).toHaveLength(1);
      expect(keys[0]).toBe(LSchema.parse("L1"));
    }
  });

  // Test 4 — W1-Bi has both L1 and L2
  it("W1-Bi agents have both L1 and L2 in their inventory", () => {
    const config = ExperimentConfig.parse({});
    const { world1 } = bootstrapExperiment(config, 0);

    const biAgents = world1.agents.filter((a) => a.class === "W1-Bi");
    expect(biAgents.length).toBeGreaterThan(0);

    for (const agent of biAgents) {
      const keys = new Set(agent.inventory.keys());
      expect(keys.has(LSchema.parse("L1"))).toBe(true);
      expect(keys.has(LSchema.parse("L2"))).toBe(true);
      // Both sub-maps must be non-empty.
      expect(agent.inventory.get(LSchema.parse("L1"))!.size).toBeGreaterThan(0);
      expect(agent.inventory.get(LSchema.parse("L2"))!.size).toBeGreaterThan(0);
    }
  });

  // Test 5 — W2-Native has only L2
  it("W2-Native agents have only L2 in their inventory", () => {
    const config = ExperimentConfig.parse({});
    const { world2 } = bootstrapExperiment(config, 0);

    const nativeAgents = world2.agents.filter((a) => a.class === "W2-Native");
    expect(nativeAgents.length).toBeGreaterThan(0);

    for (const agent of nativeAgents) {
      const keys = Array.from(agent.inventory.keys());
      expect(keys).toHaveLength(1);
      expect(keys[0]).toBe(LSchema.parse("L2"));
    }
  });

  // Test 6 — W2-Immigrant matches W1-Bi structure ("carry their inventory with them")
  it("W2-Immigrant inventory is structurally identical to W1-Bi", () => {
    const config = ExperimentConfig.parse({});
    const { world1, world2 } = bootstrapExperiment(config, 0);

    const biAgent = world1.agents.find((a) => a.class === "W1-Bi")!;
    const immAgent = world2.agents.find((a) => a.class === "W2-Immigrant")!;

    expect(biAgent).toBeDefined();
    expect(immAgent).toBeDefined();

    // Same language keys.
    const biLangs = Array.from(biAgent.inventory.keys()).sort();
    const immLangs = Array.from(immAgent.inventory.keys()).sort();
    expect(immLangs).toEqual(biLangs);

    // For each language, same referents, same lexemes, same initial weights.
    for (const lang of biAgent.inventory.keys()) {
      const biRefMap = biAgent.inventory.get(lang)!;
      const immRefMap = immAgent.inventory.get(lang)!;
      expect(immRefMap).toBeDefined();

      const biRefs = Array.from(biRefMap.keys()).sort();
      const immRefs = Array.from(immRefMap.keys()).sort();
      expect(immRefs).toEqual(biRefs);

      for (const ref of biRefMap.keys()) {
        const biLexMap = biRefMap.get(ref)!;
        const immLexMap = immRefMap.get(ref)!;

        const biLexes = Array.from(biLexMap.keys()).sort();
        const immLexes = Array.from(immLexMap.keys()).sort();
        expect(immLexes).toEqual(biLexes);

        for (const lex of biLexMap.keys()) {
          expect(immLexMap.get(lex)).toBe(biLexMap.get(lex));
        }
      }
    }
  });

  // Test 7 — default 3:2 ratio → 30 mono + 20 bi for agentCount=50
  it("default 3:2 ratio produces 30 mono and 20 bi agents per world", () => {
    const config = ExperimentConfig.parse({});
    const { world1, world2 } = bootstrapExperiment(config, 0);

    expect(world1.agents.filter((a) => a.class === "W1-Mono").length).toBe(30);
    expect(world1.agents.filter((a) => a.class === "W1-Bi").length).toBe(20);

    expect(world2.agents.filter((a) => a.class === "W2-Native").length).toBe(30);
    expect(world2.agents.filter((a) => a.class === "W2-Immigrant").length).toBe(20);
  });

  // Test 8 — 5 agents + 3:2 ratio → exactly 3 mono + 2 bi (pins rounding rule)
  it("5-agent world with 3:2 ratio gives exactly 3 mono and 2 bi", () => {
    const config = ExperimentConfig.parse({
      world1: {
        agentCount: 5,
        topology: { type: "well-mixed" },
      },
      world2: {
        agentCount: 5,
        topology: { type: "well-mixed" },
      },
    });
    const { world1 } = bootstrapExperiment(config, 0);

    expect(world1.agents.filter((a) => a.class === "W1-Mono").length).toBe(3);
    expect(world1.agents.filter((a) => a.class === "W1-Bi").length).toBe(2);
  });

  // Test 9 — agent ids are unique and have the expected prefix + padStart format
  it("agent ids are unique within each world and follow the expected format", () => {
    const config = ExperimentConfig.parse({});
    const { world1, world2 } = bootstrapExperiment(config, 0);

    const ids1 = world1.agents.map((a) => a.id);
    expect(new Set(ids1).size).toBe(ids1.length);
    expect(ids1.every((id) => id.startsWith("w1-"))).toBe(true);
    // Default agentCount=50: ids should be w1-000 through w1-049.
    expect(ids1[0]).toBe("w1-000");
    expect(ids1[49]).toBe("w1-049");

    const ids2 = world2.agents.map((a) => a.id);
    expect(new Set(ids2).size).toBe(ids2.length);
    expect(ids2.every((id) => id.startsWith("w2-"))).toBe(true);
    expect(ids2[0]).toBe("w2-000");
    expect(ids2[49]).toBe("w2-049");
  });

  // Test 10 — lattice placement uses distinct positions within [0, size)
  it("lattice placement uses distinct positions within [0, width*height)", () => {
    const config = ExperimentConfig.parse({
      world1: {
        agentCount: 50,
        topology: { type: "lattice", width: 10, height: 10 },
      },
      world2: {
        agentCount: 50,
        topology: { type: "lattice", width: 10, height: 10 },
      },
    });
    const { world1 } = bootstrapExperiment(config, 0);

    const positions = world1.agents.map((a) => a.position);
    expect(new Set(positions).size).toBe(50);
    expect(positions.every((p) => p >= 0 && p < 100)).toBe(true);
  });

  // Test 11 — well-mixed placement uses sequential positions
  it("well-mixed placement uses sequential positions [0, agentCount)", () => {
    const config = ExperimentConfig.parse({
      world1: {
        agentCount: 10,
        topology: { type: "well-mixed" },
      },
      world2: {
        agentCount: 10,
        topology: { type: "well-mixed" },
      },
    });
    const { world1 } = bootstrapExperiment(config, 0);

    const positions = world1.agents.map((a) => a.position);
    expect(positions).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  // Test 12 — inventory carries the initialWeight from the config
  it("inventory entries carry the initialWeight specified in the vocabulary seed", () => {
    const CUSTOM_WEIGHT = 0.42;
    const config = ExperimentConfig.parse({
      world1: {
        vocabularySeed: {
          "W1-Mono": {
            L1: {
              "yellow-like": [{ lexeme: "yellow", initialWeight: CUSTOM_WEIGHT }],
              "red-like": [{ lexeme: "red", initialWeight: 1.0 }],
            },
          },
          "W1-Bi": {
            L1: {
              "yellow-like": [{ lexeme: "yellow", initialWeight: 1.0 }],
              "red-like": [{ lexeme: "red", initialWeight: 1.0 }],
            },
            L2: {
              "yellow-like": [{ lexeme: "jaune", initialWeight: 1.0 }],
              "red-like": [{ lexeme: "rouge", initialWeight: 1.0 }],
            },
          },
          "W2-Native": {
            L2: {
              "yellow-like": [{ lexeme: "jaune", initialWeight: 1.0 }],
              "red-like": [{ lexeme: "rouge", initialWeight: 1.0 }],
            },
          },
          "W2-Immigrant": {
            L1: {
              "yellow-like": [{ lexeme: "yellow", initialWeight: 1.0 }],
              "red-like": [{ lexeme: "red", initialWeight: 1.0 }],
            },
            L2: {
              "yellow-like": [{ lexeme: "jaune", initialWeight: 1.0 }],
              "red-like": [{ lexeme: "rouge", initialWeight: 1.0 }],
            },
          },
        },
      },
      world2: {},
    });
    const { world1 } = bootstrapExperiment(config, 0);

    const monoAgents = world1.agents.filter((a) => a.class === "W1-Mono");
    expect(monoAgents.length).toBeGreaterThan(0);

    for (const agent of monoAgents) {
      const weight = agent.inventory
        .get(LSchema.parse("L1"))
        ?.get(RSchema.parse("yellow-like"))
        ?.get(TLSchema.parse("yellow"));
      expect(weight).toBe(CUSTOM_WEIGHT);
    }
  });

  // Test 13 — inventory maps are not shared across agents
  it("mutating one agent's inventory does not affect another agent", () => {
    const config = ExperimentConfig.parse({
      world1: {
        agentCount: 5,
        topology: { type: "well-mixed" },
      },
      world2: {
        agentCount: 5,
        topology: { type: "well-mixed" },
      },
    });
    const { world1 } = bootstrapExperiment(config, 0);

    const monoAgents = world1.agents.filter((a) => a.class === "W1-Mono");
    expect(monoAgents.length).toBeGreaterThan(1);

    const lang = LSchema.parse("L1");
    const ref = RSchema.parse("yellow-like");
    const lex = TLSchema.parse("yellow");

    const originalWeight = monoAgents[0].inventory.get(lang)!.get(ref)!.get(lex)!;

    // Cast to mutable Map to perform the mutation test.
    const innerMap = monoAgents[0].inventory.get(lang)!.get(ref)! as unknown as Map<
      TokenLexeme,
      Weight
    >;
    innerMap.set(lex, 999 as Weight);

    // Agent 1's inventory must be completely unaffected.
    const agent1Weight = monoAgents[1].inventory.get(lang)?.get(ref)?.get(lex);
    expect(agent1Weight).toBe(originalWeight);
    expect(agent1Weight).not.toBe(999);
  });

  // Test 14 — returned RNG has advanced past bootstrap draws
  it("returned RNG has advanced past bootstrap draws", () => {
    const config = ExperimentConfig.parse({});
    const { rng: advancedRng } = bootstrapExperiment(config, 0);

    // A fresh RNG at seed 0 is at draw position 0; the returned rng has consumed
    // all bootstrap draws (e.g. 399 draws for the lattice shuffle of 400 cells).
    const freshRng = createRNG(0);

    const advancedDraw = advancedRng.nextInt(0, 1_000_000);
    const freshDraw = freshRng.nextInt(0, 1_000_000);

    expect(advancedDraw).not.toBe(freshDraw);
  });

  // Test 15 — findAgentById
  it("findAgentById returns the matching agent or undefined", () => {
    const config = ExperimentConfig.parse({});
    const { world1 } = bootstrapExperiment(config, 0);

    const first = world1.agents[0];
    expect(findAgentById(world1, first.id)).toBe(first);
    expect(findAgentById(world1, makeAgentId("w1-999"))).toBeUndefined();
  });

  // Test 16 — findAgentByPosition
  it("findAgentByPosition returns the matching agent or undefined", () => {
    const config = ExperimentConfig.parse({
      world1: {
        agentCount: 10,
        topology: { type: "well-mixed" },
      },
      world2: {
        agentCount: 10,
        topology: { type: "well-mixed" },
      },
    });
    const { world1 } = bootstrapExperiment(config, 0);

    // Well-mixed: positions are sequential [0..9].
    const agent0 = world1.agents.find((a) => a.position === 0)!;
    expect(findAgentByPosition(world1, 0)).toBe(agent0);
    expect(findAgentByPosition(world1, 999)).toBeUndefined();
  });

  // Test 17 — agentCount: 0 is rejected by the schema
  it("agentCount: 0 in world1 is rejected by ExperimentConfig schema", () => {
    // WorldConfig.agentCount uses z.number().int().positive() which excludes 0.
    // Bootstrap-level handling of 0 is therefore defensive only.
    const result = ExperimentConfig.safeParse({ world1: { agentCount: 0 } });
    expect(result.success).toBe(false);
  });
});

