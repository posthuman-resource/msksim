import { describe, it, expect } from "vitest";
import { softmaxWithTemperature, preferentialSelectPartner } from "./preferential-attachment";
import { createPartnerSelector } from "./partner-selector";
import { createRNG } from "./rng";
import { emptyInventory, inventorySet, makeAgentId } from "./types";
import type { AgentState, Inventory } from "./types";
import type { PreferentialAttachmentConfig } from "@/lib/schema/preferential";
import { ExperimentConfig } from "@/lib/schema/experiment";

// ─── Test helpers ─────────────────────────────────────────────────────────────

/** Build a minimal AgentState for testing (no interactionMemory). */
function makeAgent(
  id: string,
  position: number,
  inventory: Inventory,
): AgentState {
  return {
    id: makeAgentId(id),
    class: "W1-Mono",
    position,
    inventory,
    interactionMemory: [],
  };
}

/** Build a single-language inventory with one referent. */
function inv(language: string, referent: string, tokens: Record<string, number>): Inventory {
  let inventory = emptyInventory();
  for (const [lex, weight] of Object.entries(tokens)) {
    inventory = inventorySet(
      inventory,
      language as Parameters<typeof inventorySet>[1],
      referent as Parameters<typeof inventorySet>[2],
      lex as Parameters<typeof inventorySet>[3],
      weight as Parameters<typeof inventorySet>[4],
    );
  }
  return inventory;
}

/**
 * Default PA config for tests: preferential attachment on, no warm-up.
 * Tests that need warm-up or disabled pass their own config.
 */
function paConfig(overrides: Partial<PreferentialAttachmentConfig> = {}): PreferentialAttachmentConfig {
  return {
    enabled: true,
    warmUpTicks: 0,
    temperature: 1.0,
    similarityMetric: "cosine",
    topK: 10,
    ...overrides,
  };
}

// ─── softmaxWithTemperature tests ─────────────────────────────────────────────

describe("softmaxWithTemperature", () => {
  // Test 1: output sums to 1
  it("output sums to 1.0 for various temperatures", () => {
    const scores = [1, 2, 3];
    for (const temperature of [0.1, 1.0, 10.0]) {
      const result = softmaxWithTemperature(scores, temperature);
      const sum = result.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1.0, 10);
    }
  });

  // Test 2: all outputs are non-negative
  it("all output values are >= 0", () => {
    const result = softmaxWithTemperature([1, 2, 3], 1.0);
    for (const p of result) {
      expect(p).toBeGreaterThanOrEqual(0);
    }
  });

  // Test 3: low temperature → delta on max (numerical stability check)
  it("T=0.001 approaches delta on max — stable (no Infinity)", () => {
    const scores = [1, 2, 3];
    const result = softmaxWithTemperature(scores, 0.001);
    // Third entry (score=3) should dominate
    expect(result[2]).toBeGreaterThan(0.999);
    expect(result[0]).toBeLessThan(0.001);
    expect(result[1]).toBeLessThan(0.001);
    // Must not produce NaN or Infinity
    for (const p of result) {
      expect(Number.isFinite(p)).toBe(true);
    }
  });

  // Test 4: high temperature → approaches uniform
  it("T=1000 approaches uniform distribution", () => {
    const scores = [1, 2, 3];
    const result = softmaxWithTemperature(scores, 1000.0);
    const target = 1 / 3;
    for (const p of result) {
      expect(Math.abs(p - target)).toBeLessThan(0.05);
    }
  });

  // Throws on invalid temperature
  it("throws RangeError for temperature <= 0", () => {
    expect(() => softmaxWithTemperature([1, 2], 0)).toThrow(RangeError);
    expect(() => softmaxWithTemperature([1, 2], -1)).toThrow(RangeError);
  });

  // Returns [] for empty input
  it("returns [] for empty scores array", () => {
    expect(softmaxWithTemperature([], 1.0)).toEqual([]);
  });

  // Test 12 (sanity check): known numerical values at T=1.0
  it("produces expected probabilities for scores [1.0, 0.5, 0.0] at T=1.0", () => {
    // Manual: exp([1, 0.5, 0]) / sum = [e, sqrt(e), 1] / (e + sqrt(e) + 1)
    // e ≈ 2.71828, sqrt(e) ≈ 1.64872, 1 ≈ 1
    // total ≈ 5.367
    // p ≈ [0.5063, 0.3072, 0.1865] — per plan spec ≈ [0.506, 0.307, 0.187]
    const result = softmaxWithTemperature([1.0, 0.5, 0.0], 1.0);
    expect(result[0]).toBeCloseTo(0.506, 2);
    expect(result[1]).toBeCloseTo(0.307, 2);
    expect(result[2]).toBeCloseTo(0.187, 2);
  });
});

// ─── preferentialSelectPartner tests ─────────────────────────────────────────

describe("preferentialSelectPartner", () => {
  const speakerInv = inv("L1", "ref", { yellow: 1.0, red: 1.0 });
  const identicalInv = inv("L1", "ref", { yellow: 1.0, red: 1.0 });
  const orthogonalInv = inv("L2", "ref", { jaune: 1.0, rouge: 1.0 });

  const speaker = makeAgent("speaker", 0, speakerInv);
  const candA = makeAgent("candA", 1, identicalInv);
  const candB = makeAgent("candB", 2, identicalInv);
  const candC = makeAgent("candC", 3, orthogonalInv);

  // Test 9: empty candidate list → null
  it("empty candidates → null", () => {
    const rng = createRNG(1);
    const result = preferentialSelectPartner(speaker, [], rng, paConfig(), 0);
    expect(result).toBeNull();
  });

  // Test 5 (warm-up part): during warm-up yields approximately uniform selection
  it("warm-up period: ticks < warmUpTicks → approximately uniform selection", () => {
    const cfg = paConfig({ warmUpTicks: 10 });
    const candidates = [candA, candB, candC];
    const counts = { candA: 0, candB: 0, candC: 0 };
    const rng = createRNG(777);

    for (let i = 0; i < 3000; i++) {
      const result = preferentialSelectPartner(speaker, candidates, rng, cfg, 5); // tick < 10
      if (result?.id === candA.id) counts.candA++;
      else if (result?.id === candB.id) counts.candB++;
      else if (result?.id === candC.id) counts.candC++;
    }

    // Each candidate should get roughly 1000 picks (uniform). Allow ±200.
    expect(counts.candA).toBeGreaterThan(800);
    expect(counts.candA).toBeLessThan(1200);
    expect(counts.candB).toBeGreaterThan(800);
    expect(counts.candB).toBeLessThan(1200);
    expect(counts.candC).toBeGreaterThan(800);
    expect(counts.candC).toBeLessThan(1200);
  });

  // Test 7: statistical preference for similar candidates (1000-trial test)
  it("after warm-up: identical-inventory candidates are preferentially selected", () => {
    // Speaker: L1:yellow=1, L1:red=1
    // candA, candB: cosine=1.0 vs speaker
    // candC: cosine=0.0 vs speaker (orthogonal keys)
    //
    // softmax([1, 1, 0], T=1): exp([0, 0, -1]) = [1, 1, 0.3679], total=2.3679
    // probs ≈ [0.4223, 0.4223, 0.1554]
    // Over 1000 trials: A+B expected ≈ 845, C ≈ 155
    // ±3σ for A+B sum: σ(A+B) ≈ 11.5, so 3σ ≈ 35 → range [810, 880]
    // Use wider window [750, 950] for robustness.
    const cfg = paConfig({ warmUpTicks: 0, temperature: 1.0, topK: 10 });
    const candidates = [candA, candB, candC];
    let similarCount = 0;
    let orthogonalCount = 0;
    const rng = createRNG(42);

    for (let i = 0; i < 1000; i++) {
      const result = preferentialSelectPartner(speaker, candidates, rng, cfg, 0);
      if (result?.id === candA.id || result?.id === candB.id) similarCount++;
      else if (result?.id === candC.id) orthogonalCount++;
    }

    expect(similarCount).toBeGreaterThan(750);
    expect(similarCount).toBeLessThan(950);
    expect(orthogonalCount).toBeGreaterThan(50);
    expect(orthogonalCount).toBeLessThan(250);
  });

  // Test 8: determinism — same RNG seed + same candidates → same selections
  it("determinism: two createRNG(42) instances produce identical selections", () => {
    const cfg = paConfig({ warmUpTicks: 0 });
    const candidates = [candA, candB, candC];

    const rng1 = createRNG(42);
    const rng2 = createRNG(42);
    const results1: (AgentState | null)[] = [];
    const results2: (AgentState | null)[] = [];

    for (let i = 0; i < 100; i++) {
      results1.push(preferentialSelectPartner(speaker, candidates, rng1, cfg, 0));
      results2.push(preferentialSelectPartner(speaker, candidates, rng2, cfg, 0));
    }

    for (let i = 0; i < 100; i++) {
      expect(results1[i]?.id).toBe(results2[i]?.id);
    }
  });

  // Test 11: zero-weight speaker inventory → effectively uniform selection
  it("zero-weight speaker inventory → approximately uniform selection", () => {
    // Speaker with no learned preferences: all cosine similarities = 0,
    // softmax collapses to uniform.
    const emptySpk = makeAgent("empty-speaker", 0, emptyInventory());
    const cfg = paConfig({ warmUpTicks: 0 });
    const candidates = [candA, candB, candC];
    const counts = { candA: 0, candB: 0, candC: 0 };
    const rng = createRNG(99);

    for (let i = 0; i < 3000; i++) {
      const result = preferentialSelectPartner(emptySpk, candidates, rng, cfg, 50);
      if (result?.id === candA.id) counts.candA++;
      else if (result?.id === candB.id) counts.candB++;
      else if (result?.id === candC.id) counts.candC++;
    }

    // With all similarities = 0, softmax yields uniform → each ~1000 picks (±200)
    expect(counts.candA).toBeGreaterThan(800);
    expect(counts.candA).toBeLessThan(1200);
    expect(counts.candB).toBeGreaterThan(800);
    expect(counts.candB).toBeLessThan(1200);
    expect(counts.candC).toBeGreaterThan(800);
    expect(counts.candC).toBeLessThan(1200);
  });
});

// ─── createPartnerSelector tests ──────────────────────────────────────────────

describe("createPartnerSelector", () => {
  // Build a minimal World for the selector tests.
  // Uses a mock topology that returns a fixed neighbor list.
  const speaker = makeAgent("speaker", 0, inv("L1", "ref", { yellow: 1.0 }));
  const candA = makeAgent("candA", 1, inv("L1", "ref", { yellow: 1.0 }));
  const candB = makeAgent("candB", 2, inv("L2", "ref", { jaune: 1.0 }));

  function makeWorld(agents: AgentState[], neighborPositions: number[]) {
    return {
      id: "world1" as const,
      agents,
      topology: {
        kind: "well-mixed" as const,
        size: agents.length,
        neighbors: () => neighborPositions,
        pickNeighbor: (pos: number, rng: ReturnType<typeof createRNG>) =>
          rng.pick(neighborPositions),
        adjacency: () => [],
      },
      referents: ["ref"] as Parameters<typeof inventorySet>[2][],
      languages: ["L1"] as Parameters<typeof inventorySet>[1][],
    };
  }

  const world = makeWorld([speaker, candA, candB], [1, 2]);

  // Test 6: enabled:false → uniform selection (ablation toggle)
  it("enabled:false → approximately uniform selection", () => {
    const config = ExperimentConfig.parse({
      preferentialAttachment: {
        enabled: false,
        warmUpTicks: 0,
        temperature: 1.0,
        topK: 10,
      },
      world1: { agentCount: 3, topology: { type: "well-mixed" } },
      world2: { agentCount: 2, topology: { type: "well-mixed" } },
    });

    let candACount = 0;
    let candBCount = 0;
    const rng = createRNG(111);

    for (let i = 0; i < 3000; i++) {
      const selectPartner = createPartnerSelector(config, 500); // after any warm-up
      const result = selectPartner(speaker, world, rng);
      if (result?.id === candA.id) candACount++;
      else if (result?.id === candB.id) candBCount++;
    }

    // Uniform: each candidate ~1500 picks (±300)
    expect(candACount).toBeGreaterThan(1200);
    expect(candACount).toBeLessThan(1800);
    expect(candBCount).toBeGreaterThan(1200);
    expect(candBCount).toBeLessThan(1800);
  });

  // Test 10: disabled path never reads speaker.inventory
  it("enabled:false never reads speaker.inventory (fast path verification)", () => {
    const config = ExperimentConfig.parse({
      preferentialAttachment: { enabled: false, warmUpTicks: 0, temperature: 1.0, topK: 10 },
      world1: { agentCount: 3, topology: { type: "well-mixed" } },
      world2: { agentCount: 2, topology: { type: "well-mixed" } },
    });

    let inventoryAccessCount = 0;
    const inventoryProxy = new Proxy(speaker.inventory, {
      get(target, prop) {
        inventoryAccessCount++;
        return Reflect.get(target, prop);
      },
    });
    const speakerWithProxy = { ...speaker, inventory: inventoryProxy };

    const selectPartner = createPartnerSelector(config, 0);
    const rng = createRNG(1);
    selectPartner(speakerWithProxy, world, rng);

    // The disabled fast-path calls topology.pickNeighbor only — no inventory access
    expect(inventoryAccessCount).toBe(0);
  });

  // Test 9 (via createPartnerSelector): empty candidates → null
  it("returns null when all topology neighbors are empty cells", () => {
    const emptyWorld = makeWorld([speaker], []); // no neighbors
    const config = ExperimentConfig.parse({
      preferentialAttachment: { enabled: true, warmUpTicks: 0, temperature: 1.0, topK: 10 },
      world1: { agentCount: 1, topology: { type: "well-mixed" } },
      world2: { agentCount: 2, topology: { type: "well-mixed" } },
    });

    const selectPartner = createPartnerSelector(config, 0);
    const rng = createRNG(1);
    expect(selectPartner(speaker, emptyWorld, rng)).toBeNull();
  });

  // Test 5 transition: selector after warmUpTicks biases toward similar candidates
  it("enabled:true after warmUpTicks: biases toward similar candidate", () => {
    const config = ExperimentConfig.parse({
      preferentialAttachment: { enabled: true, warmUpTicks: 10, temperature: 1.0, topK: 10 },
      world1: { agentCount: 3, topology: { type: "well-mixed" } },
      world2: { agentCount: 2, topology: { type: "well-mixed" } },
    });

    // Speaker has L1:yellow; candA has L1:yellow (similar), candB has L2:jaune (orthogonal)
    let candACount = 0;
    let candBCount = 0;
    const rng = createRNG(55);

    for (let i = 0; i < 3000; i++) {
      // tick=50, past warmUpTicks=10
      const selectPartner = createPartnerSelector(config, 50);
      const result = selectPartner(speaker, world, rng);
      if (result?.id === candA.id) candACount++;
      else if (result?.id === candB.id) candBCount++;
    }

    // candA (similar) should be selected significantly more often.
    // With cosine(speaker, candA)=1.0 and cosine(speaker, candB)=0.0:
    // softmax([1, 0], T=1) = [e/(e+1), 1/(e+1)] ≈ [0.731, 0.269]
    // Expected A picks ≈ 2193, B picks ≈ 807
    expect(candACount).toBeGreaterThan(1800);
    expect(candBCount).toBeLessThan(1200);
  });
});
