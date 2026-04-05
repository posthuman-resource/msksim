import { describe, expect, it } from "vitest";
import { createRNG } from "@/lib/sim/rng";
import { makeAgentId, emptyInventory, inventorySet } from "@/lib/sim/types";
import type { AgentState } from "@/lib/sim/types";
import type { AgentClass, Language, Referent, TokenLexeme, Weight } from "@/lib/schema/primitives";
import type { LanguagePolicyEntry } from "@/lib/schema/policy";
import type { PolicyConfig, PolicyName } from "@/lib/sim/policy";
import { POLICY_NAMES, createPolicy, listPolicies } from "./registry";
import { createDefaultPolicy } from "./default";
import { alwaysL1, alwaysL2, random, mirrorHearer } from "./alternatives";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const L1 = "L1" as Language;
const L2 = "L2" as Language;

function makeAgent(agentClass: AgentClass): AgentState {
  return {
    id: makeAgentId(`test-${agentClass}`),
    class: agentClass,
    position: 0,
    inventory: emptyInventory(),
    interactionMemory: [],
  };
}

/** Full 4×4 default entries — sufficient for any (speakerClass, hearerClass) pair. */
const FULL_ENTRIES: LanguagePolicyEntry[] = [
  { speakerClass: "W1-Mono", hearerClass: "W1-Mono", ruleId: "always-l1" },
  { speakerClass: "W1-Mono", hearerClass: "W1-Bi", ruleId: "always-l1" },
  { speakerClass: "W1-Mono", hearerClass: "W2-Native", ruleId: "always-l1" },
  { speakerClass: "W1-Mono", hearerClass: "W2-Immigrant", ruleId: "always-l1" },
  { speakerClass: "W1-Bi", hearerClass: "W1-Mono", ruleId: "w1bi-to-w1mono-always-l1" },
  { speakerClass: "W1-Bi", hearerClass: "W1-Bi", ruleId: "w1bi-to-w1bi-configurable", languageBias: { L1: 0.5, L2: 0.5 } },
  { speakerClass: "W1-Bi", hearerClass: "W2-Native", ruleId: "always-l1" },
  { speakerClass: "W1-Bi", hearerClass: "W2-Immigrant", ruleId: "always-l1" },
  { speakerClass: "W2-Native", hearerClass: "W1-Mono", ruleId: "always-l2" },
  { speakerClass: "W2-Native", hearerClass: "W1-Bi", ruleId: "always-l2" },
  { speakerClass: "W2-Native", hearerClass: "W2-Native", ruleId: "always-l2" },
  { speakerClass: "W2-Native", hearerClass: "W2-Immigrant", ruleId: "always-l2" },
  { speakerClass: "W2-Immigrant", hearerClass: "W1-Mono", ruleId: "always-l1" },
  { speakerClass: "W2-Immigrant", hearerClass: "W1-Bi", ruleId: "always-l1" },
  { speakerClass: "W2-Immigrant", hearerClass: "W2-Native", ruleId: "w2imm-to-w2native-both", languageBias: { L1: 0.5, L2: 0.5 } },
  { speakerClass: "W2-Immigrant", hearerClass: "W2-Immigrant", ruleId: "w2imm-to-w2imm-both", languageBias: { L1: 0.5, L2: 0.5 } },
];

function makeDefaultConfig(policyName: PolicyName = "default"): PolicyConfig {
  return {
    policyName,
    entries: FULL_ENTRIES,
    l1Label: L1,
    l2Label: L2,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("policy registry", () => {
  // ─── Test 10: All named policies resolve to callable functions ─────────────
  it("resolves each of the 5 named policies to a callable function", () => {
    for (const name of POLICY_NAMES) {
      const policy = createPolicy(makeDefaultConfig(name));
      expect(typeof policy).toBe("function");
    }
  });

  // ─── Test 11: createPolicy('default') matches createDefaultPolicy directly ─
  it("createPolicy with 'default' matches createDefaultPolicy invoked directly", () => {
    const config = makeDefaultConfig("default");
    const policyViaRegistry = createPolicy(config);
    const policyDirect = createDefaultPolicy(config);

    const speaker = makeAgent("W1-Bi");
    const hearer = makeAgent("W1-Bi");

    // Call each policy 100 times against freshly seeded RNGs to confirm
    // the registry's 'default' dispatch does not drop any config bindings.
    const rngA = createRNG(42);
    const rngB = createRNG(42);
    const seqRegistry = Array.from({ length: 100 }, () =>
      policyViaRegistry({ speaker, hearer, rng: rngA }),
    );
    const seqDirect = Array.from({ length: 100 }, () =>
      policyDirect({ speaker, hearer, rng: rngB }),
    );
    expect(seqRegistry).toEqual(seqDirect);
  });

  // ─── Test 12: Unknown policy name throws a clear error ─────────────────────
  it("throws a self-diagnosing error for an unknown policy name", () => {
    const badConfig = {
      ...makeDefaultConfig(),
      policyName: "not-a-real-policy" as PolicyName,
    };
    expect(() => createPolicy(badConfig)).toThrow();

    let message = "";
    try {
      createPolicy(badConfig);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("not-a-real-policy");
    expect(message).toContain("default"); // known-names list included
  });

  // ─── Test 13: listPolicies() returns exactly the five names ────────────────
  it("listPolicies returns exactly the five canonical policy names", () => {
    const names = listPolicies();
    expect([...names].sort()).toEqual(
      ["always-l1", "always-l2", "default", "mirror-hearer", "random"],
    );
    expect(names.length).toBe(5);
  });

  // ─── Test 14: alwaysL1 returns L1 for every class pair ────────────────────
  it("alwaysL1 returns L1 for all 16 (speakerClass × hearerClass) combinations", () => {
    const classes: AgentClass[] = ["W1-Mono", "W1-Bi", "W2-Native", "W2-Immigrant"];
    const rng = createRNG(0);
    for (const sc of classes) {
      for (const hc of classes) {
        const result = alwaysL1({
          speaker: makeAgent(sc),
          hearer: makeAgent(hc),
          rng,
        });
        expect(result).toBe(L1);
      }
    }
  });

  // ─── Test 15: alwaysL2 returns L2 for every class pair ────────────────────
  it("alwaysL2 returns L2 for all 16 (speakerClass × hearerClass) combinations", () => {
    const classes: AgentClass[] = ["W1-Mono", "W1-Bi", "W2-Native", "W2-Immigrant"];
    const rng = createRNG(0);
    for (const sc of classes) {
      for (const hc of classes) {
        const result = alwaysL2({
          speaker: makeAgent(sc),
          hearer: makeAgent(hc),
          rng,
        });
        expect(result).toBe(L2);
      }
    }
  });

  // ─── Test 16: random is a ~50/50 coin ─────────────────────────────────────
  it("random yields L1 in ~50% of 10,000 trials", () => {
    const speaker = makeAgent("W1-Bi");
    const hearer = makeAgent("W1-Bi");
    const rng = createRNG(123);

    let l1Count = 0;
    const N = 10_000;
    for (let i = 0; i < N; i++) {
      if (random({ speaker, hearer, rng }) === L1) l1Count++;
    }

    // 3σ binomial interval: p=0.5, n=10000 → σ≈50, 3σ=150
    expect(l1Count).toBeGreaterThanOrEqual(5000 - 150);
    expect(l1Count).toBeLessThanOrEqual(5000 + 150);
    expect(l1Count).toBeGreaterThan(0);
    expect(l1Count).toBeLessThan(N);
  });

  // ─── Test 17: mirrorHearer returns hearer's dominant language ──────────────
  it("mirrorHearer returns the language with higher total weight in hearer's inventory", () => {
    const ref = "yellow-like" as Referent;
    const lex = "yellow" as TokenLexeme;

    // Hearer whose L1 weight dominates
    const l1HeavyInventory = inventorySet(
      inventorySet(emptyInventory(), L1, ref, lex, 3.0 as Weight),
      L2,
      ref,
      "jaune" as TokenLexeme,
      1.0 as Weight,
    );
    const l1HeavyHearer: AgentState = {
      id: makeAgentId("hearer-l1-heavy"),
      class: "W1-Bi",
      position: 0,
      inventory: l1HeavyInventory,
      interactionMemory: [],
    };

    // Hearer whose L2 weight dominates
    const l2HeavyInventory = inventorySet(
      inventorySet(emptyInventory(), L1, ref, lex, 1.0 as Weight),
      L2,
      ref,
      "jaune" as TokenLexeme,
      4.0 as Weight,
    );
    const l2HeavyHearer: AgentState = {
      id: makeAgentId("hearer-l2-heavy"),
      class: "W2-Immigrant",
      position: 0,
      inventory: l2HeavyInventory,
      interactionMemory: [],
    };

    // Hearer with exactly equal weights → tie-break to L1
    const equalInventory = inventorySet(
      inventorySet(emptyInventory(), L1, ref, lex, 2.0 as Weight),
      L2,
      ref,
      "jaune" as TokenLexeme,
      2.0 as Weight,
    );
    const equalHearer: AgentState = {
      id: makeAgentId("hearer-equal"),
      class: "W1-Bi",
      position: 0,
      inventory: equalInventory,
      interactionMemory: [],
    };

    const speaker = makeAgent("W1-Bi");
    const rng = createRNG(0);

    expect(mirrorHearer({ speaker, hearer: l1HeavyHearer, rng })).toBe(L1);
    expect(mirrorHearer({ speaker, hearer: l2HeavyHearer, rng })).toBe(L2);
    expect(mirrorHearer({ speaker, hearer: equalHearer, rng })).toBe(L1); // tie → L1
  });

  // ─── Smoke: createPolicy('always-l1') via registry behaves like alwaysL1 ───
  it("createPolicy('always-l1') returns a policy that always yields L1", () => {
    const policy = createPolicy(makeDefaultConfig("always-l1"));
    const rng = createRNG(0);
    const result = policy({
      speaker: makeAgent("W2-Native"),
      hearer: makeAgent("W2-Native"),
      rng,
    });
    expect(result).toBe(L1);
  });

  // ─── Smoke: createPolicy('mirror-hearer') via registry ─────────────────────
  it("createPolicy('mirror-hearer') returns a policy consistent with mirrorHearer", () => {
    const policy = createPolicy(makeDefaultConfig("mirror-hearer"));

    const ref = "yellow-like" as Referent;
    const lex = "jaune" as TokenLexeme;
    const l2HeavyInventory = inventorySet(
      emptyInventory(),
      L2,
      ref,
      lex,
      5.0 as Weight,
    );
    const hearer: AgentState = {
      id: makeAgentId("hearer-l2"),
      class: "W2-Native",
      position: 0,
      inventory: l2HeavyInventory,
      interactionMemory: [],
    };

    const rng = createRNG(0);
    expect(policy({ speaker: makeAgent("W1-Bi"), hearer, rng })).toBe(L2);
  });
});
