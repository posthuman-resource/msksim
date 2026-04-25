import { describe, expect, it } from 'vitest';
import type { AgentClass, AgentId, Language, Referent, TokenLexeme } from '@/lib/sim/types';
import { emptyInventory, inventorySet, makeAgentId } from '@/lib/sim/types';
import type { AgentState, Inventory } from '@/lib/sim/types';
import type { World, WorldId } from '@/lib/sim/world';
import type { Topology } from '@/lib/sim/topology';
import type { InteractionEvent } from '@/lib/sim/engine';
import {
  Language as LSchema,
  Referent as RSchema,
  TokenLexeme as TLSchema,
} from '@/lib/schema/primitives';
import {
  computeCommunicationSuccessRate,
  computeDistinctActiveTokens,
  computeMatchingRate,
  computeMeanTokenWeight,
  computeScalarMetrics,
  computeSuccessRateByClassPair,
  computeTokenWeightVariance,
} from './scalar';

// ─── Branded-type constants ───────────────────────────────────────────────────

const L1 = LSchema.parse('L1');
const L2 = LSchema.parse('L2');
const yellowRef = RSchema.parse('yellow-ref');
const redRef = RSchema.parse('red-ref');
const yellowLex = TLSchema.parse('yellow');
const redLex = TLSchema.parse('red');
const jauneLex = TLSchema.parse('jaune');
const rougeLex = TLSchema.parse('rouge');
const goldenrodLex = TLSchema.parse('goldenrod');

// ─── Stub topology ────────────────────────────────────────────────────────────

/** Scalar metrics do not call topology methods; a no-op stub is sufficient. */
const stubTopology: Topology = {
  kind: 'well-mixed',
  size: 100,
  neighbors: () => [],
  pickNeighbor: () => null,
};

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function makeInv(entries: Array<[Language, Referent, TokenLexeme, number]>): Inventory {
  let inv = emptyInventory();
  for (const [lang, ref, lex, w] of entries) {
    inv = inventorySet(inv, lang, ref, lex, w);
  }
  return inv;
}

function makeAgent(id: string, cls: AgentClass, inv: Inventory, position = 0): AgentState {
  return {
    id: makeAgentId(id),
    class: cls,
    position,
    inventory: inv,
    interactionMemory: [],
  };
}

function makeWorld(
  id: WorldId,
  agents: AgentState[],
  languages: Language[],
  referents: Referent[],
): World {
  return { id, agents, topology: stubTopology, languages, referents };
}

function makeEvent(
  speakerId: AgentId,
  hearerId: AgentId,
  worldId: 'world1' | 'world2',
  success: boolean,
  language: Language = L1,
  referent: Referent = yellowRef,
  token: TokenLexeme = yellowLex,
): InteractionEvent {
  return {
    tick: 0,
    worldId,
    speakerId,
    hearerId,
    speakerClass: 'W1-Mono',
    hearerClass: 'W1-Mono',
    language,
    referent,
    token,
    success,
    successProbability: null,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('computeCommunicationSuccessRate', () => {
  // Test 1 — known-answer integer ratio, per-world filtering
  it('returns correct success rate for world1 events, NaN for empty world2', () => {
    const a1 = makeAgentId('a1');
    const a2 = makeAgentId('a2');
    // 7 success + 3 failure = 10 total, all world1
    const events: InteractionEvent[] = [
      ...Array.from({ length: 7 }, () => makeEvent(a1, a2, 'world1', true)),
      ...Array.from({ length: 3 }, () => makeEvent(a1, a2, 'world1', false)),
    ];
    const r1 = computeCommunicationSuccessRate(events, 'world1');
    expect(r1.successful).toBe(7);
    expect(r1.total).toBe(10);
    expect(r1.rate).toBeCloseTo(0.7, 10);

    const r2 = computeCommunicationSuccessRate(events, 'world2');
    expect(r2.successful).toBe(0);
    expect(r2.total).toBe(0);
    expect(r2.rate).toBeNaN();
  });

  // Test 2 — overall aggregates both worlds
  it('overall aggregates events from both worlds', () => {
    const a1 = makeAgentId('a1');
    const a2 = makeAgentId('a2');
    // world1: 4 events (3 success), world2: 6 events (2 success) → overall: 5/10
    const events: InteractionEvent[] = [
      ...Array.from({ length: 3 }, () => makeEvent(a1, a2, 'world1', true)),
      makeEvent(a1, a2, 'world1', false),
      ...Array.from({ length: 2 }, () => makeEvent(a1, a2, 'world2', true)),
      ...Array.from({ length: 4 }, () => makeEvent(a1, a2, 'world2', false)),
    ];
    const r = computeCommunicationSuccessRate(events, 'overall');
    expect(r.successful).toBe(5);
    expect(r.total).toBe(10);
    expect(r.rate).toBeCloseTo(0.5, 10);
  });

  // Test 3 — empty list yields NaN rate, not 0
  // NaN is the canonical "undefined" marker: Recharts/d3 skip it as a time-series
  // gap, whereas 0 would plot as a misleading "100% failure" data point.
  it('empty interaction list yields NaN rate, not 0', () => {
    const r = computeCommunicationSuccessRate([], 'overall');
    expect(r.successful).toBe(0);
    expect(r.total).toBe(0);
    expect(r.rate).toBeNaN();
  });
});

describe('computeSuccessRateByClassPair', () => {
  // Test 4 — 16 keys always present, correct counts and NaN for empty cells
  it('returns all 16 keys; correct counts for observed pairs; NaN for unobserved', () => {
    // World 1: two agents of W1-Mono class + one W1-Bi agent
    const monoA = makeAgent('monoA', 'W1-Mono', emptyInventory(), 0);
    const monoB = makeAgent('monoB', 'W1-Mono', emptyInventory(), 1);
    const biA = makeAgent('biA', 'W1-Bi', emptyInventory(), 2);
    const w1 = makeWorld('world1', [monoA, monoB, biA], [L1], [yellowRef]);

    // World 2: one W2-Immigrant + one W2-Native agent
    const immA = makeAgent('immA', 'W2-Immigrant', emptyInventory(), 0);
    const natA = makeAgent('natA', 'W2-Native', emptyInventory(), 1);
    const w2 = makeWorld('world2', [immA, natA], [L2], [yellowRef]);

    const events: InteractionEvent[] = [
      // W1-Mono → W1-Mono success
      makeEvent(monoA.id, monoB.id, 'world1', true),
      // W1-Bi → W1-Mono failure
      makeEvent(biA.id, monoA.id, 'world1', false),
      // W2-Immigrant → W2-Native success
      makeEvent(immA.id, natA.id, 'world2', true),
    ];

    const result = computeSuccessRateByClassPair(events, w1, w2);

    // Must have exactly 16 keys
    expect(Object.keys(result).length).toBe(16);

    // Observed cells
    expect(result['W1-Mono__W1-Mono']).toEqual({ successful: 1, total: 1, rate: 1 });
    expect(result['W1-Bi__W1-Mono']).toEqual({ successful: 0, total: 1, rate: 0 });
    expect(result['W2-Immigrant__W2-Native']).toEqual({ successful: 1, total: 1, rate: 1 });

    // Unobserved cells should have NaN rate (not 0)
    expect(result['W1-Mono__W1-Bi'].rate).toBeNaN();
    expect(result['W2-Native__W2-Immigrant'].rate).toBeNaN();
    expect(result['W1-Mono__W2-Native'].rate).toBeNaN();
  });
});

describe('computeMeanTokenWeight / computeTokenWeightVariance', () => {
  // Test 5 — mean: known-answer 3-agent hand computation
  it('computes mean of non-zero weights; NaN for absent language', () => {
    const inv1 = makeInv([[L1, yellowRef, yellowLex, 1.0]]);
    const inv2 = makeInv([[L1, yellowRef, yellowLex, 2.0]]);
    const inv3 = makeInv([[L1, yellowRef, yellowLex, 3.0]]);
    const agents = [
      makeAgent('a1', 'W1-Mono', inv1, 0),
      makeAgent('a2', 'W1-Mono', inv2, 1),
      makeAgent('a3', 'W1-Mono', inv3, 2),
    ];
    const world = makeWorld('world1', agents, [L1, L2], [yellowRef]);

    // Mean of [1.0, 2.0, 3.0] = 2.0
    expect(computeMeanTokenWeight(world, L1)).toBeCloseTo(2.0, 10);
    // No L2 entries → NaN
    expect(computeMeanTokenWeight(world, L2)).toBeNaN();
  });

  // Test 6 — variance: known-answer + single-agent NaN guard
  it('computes sample variance (n−1); NaN for fewer than 2 observations', () => {
    const inv1 = makeInv([[L1, yellowRef, yellowLex, 1.0]]);
    const inv2 = makeInv([[L1, yellowRef, yellowLex, 2.0]]);
    const inv3 = makeInv([[L1, yellowRef, yellowLex, 3.0]]);
    const agents = [
      makeAgent('a1', 'W1-Mono', inv1, 0),
      makeAgent('a2', 'W1-Mono', inv2, 1),
      makeAgent('a3', 'W1-Mono', inv3, 2),
    ];
    const world = makeWorld('world1', agents, [L1, L2], [yellowRef]);

    // Sample variance of [1.0, 2.0, 3.0] with n−1=2:
    // ((1−2)² + (2−2)² + (3−2)²) / 2 = (1 + 0 + 1) / 2 = 1.0
    expect(computeTokenWeightVariance(world, L1)).toBeCloseTo(1.0, 10);
    // No L2 entries → NaN
    expect(computeTokenWeightVariance(world, L2)).toBeNaN();

    // Single-agent world: fewer than 2 observations → NaN
    const singleWorld = makeWorld(
      'world1',
      [makeAgent('s1', 'W1-Mono', inv1, 0)],
      [L1],
      [yellowRef],
    );
    expect(computeTokenWeightVariance(singleWorld, L1)).toBeNaN();
  });
});

describe('computeDistinctActiveTokens', () => {
  // Build the canonical 10-agent fixture: all identical L1 inventories.
  // Re-used across tests 7, 8, and 9.
  function makeIdenticalInventory(): Inventory {
    return makeInv([
      [L1, yellowRef, yellowLex, 1.0],
      [L1, redRef, redLex, 1.0],
    ]);
  }

  function makeTenAgentWorld(): World {
    const agents = Array.from({ length: 10 }, (_, i) =>
      makeAgent(`agent-${i}`, 'W1-Mono', makeIdenticalInventory(), i),
    );
    return makeWorld('world1', agents, [L1], [yellowRef, redRef]);
  }

  // Test 7 — full consensus: Nw = 2 (one yellow + one red)
  it('full consensus: 10 agents all with (L1,yellow) and (L1,red) have Nw = 2', () => {
    expect(computeDistinctActiveTokens(makeTenAgentWorld())).toBe(2);
  });

  // Test 8 — Nw increments when a new token is introduced
  it('Nw increments by 1 when a new token is added to one agent', () => {
    const base = makeTenAgentWorld();
    // Clone the agents array; give agent 0 an extra (L1, goldenrod) token.
    const newInv = inventorySet(base.agents[0].inventory, L1, yellowRef, goldenrodLex, 0.5);
    const newAgents = [makeAgent(base.agents[0].id, 'W1-Mono', newInv, 0), ...base.agents.slice(1)];
    const newWorld = makeWorld('world1', newAgents, [L1], [yellowRef, redRef]);
    expect(computeDistinctActiveTokens(newWorld)).toBe(3);
  });
});

describe('computeMatchingRate', () => {
  function makeIdenticalInventory(): Inventory {
    return makeInv([
      [L1, yellowRef, yellowLex, 1.0],
      [L1, redRef, redLex, 1.0],
    ]);
  }

  function makeTenAgentWorld(): World {
    const agents = Array.from({ length: 10 }, (_, i) =>
      makeAgent(`agent-${i}`, 'W1-Mono', makeIdenticalInventory(), i),
    );
    return makeWorld('world1', agents, [L1], [yellowRef, redRef]);
  }

  // Test 9 — full consensus: matching rate = 1.0
  it('all-identical inventories: matching rate = 1.0; all-success interactions: rate = 1.0', () => {
    const world = makeTenAgentWorld();
    expect(computeMatchingRate(world)).toBeCloseTo(1.0, 10);

    // Verify success rate = 1.0 for a synthetic all-success tick on the same world.
    const a0 = world.agents[0].id;
    const a1 = world.agents[1].id;
    const events: InteractionEvent[] = Array.from({ length: 5 }, () =>
      makeEvent(a0, a1, 'world1', true),
    );
    expect(computeCommunicationSuccessRate(events, 'world1').rate).toBeCloseTo(1.0, 10);
  });

  // Test 10 — two disjoint subpopulations: matching rate = 20/45, Nw = 4
  //
  // Agents 0-4: L1 with {yellow-ref: yellow, red-ref: red}
  // Agents 5-9: L2 with {yellow-ref: jaune, red-ref: rouge}
  //
  // For each referent:
  //   Total pairs:            10 × 9 / 2 = 45
  //   Within group 1 (0-4):   5 × 4 / 2 = 10  (all agree)
  //   Within group 2 (5-9):   5 × 4 / 2 = 10  (all agree)
  //   Cross-group (0-4 × 5-9): 5 × 5   = 25  (all disagree)
  //   agreed = 20, rate_per_referent = 20/45
  //
  // Overall matching rate = (20/45 + 20/45) / 2 = 20/45 ≈ 0.4444
  // The task brief's informal "≈ 0.5" is a rounding approximation;
  // the mathematically exact answer is 20/45.
  it('two disjoint subpopulations: matching rate = 20/45, Nw = 4', () => {
    const l1Inv = makeInv([
      [L1, yellowRef, yellowLex, 1.0],
      [L1, redRef, redLex, 1.0],
    ]);
    const l2Inv = makeInv([
      [L2, yellowRef, jauneLex, 1.0],
      [L2, redRef, rougeLex, 1.0],
    ]);
    const agents = [
      ...Array.from({ length: 5 }, (_, i) => makeAgent(`g1-${i}`, 'W1-Mono', l1Inv, i)),
      ...Array.from({ length: 5 }, (_, i) => makeAgent(`g2-${i}`, 'W2-Native', l2Inv, 5 + i)),
    ];
    const world = makeWorld('world1', agents, [L1, L2], [yellowRef, redRef]);

    // Nw = 4 distinct (language, lexeme) pairs
    expect(computeDistinctActiveTokens(world)).toBe(4);

    // Matching rate = 20/45
    expect(computeMatchingRate(world)).toBeCloseTo(20 / 45, 10);
  });
});

describe('computeScalarMetrics', () => {
  function makeSimpleWorld(worldId: WorldId, agentCount: number): World {
    const inv = makeInv([[L1, yellowRef, yellowLex, 1.0]]);
    const agents = Array.from({ length: agentCount }, (_, i) =>
      makeAgent(`${worldId}-${i}`, 'W1-Mono', inv, i),
    );
    return makeWorld(worldId, agents, [L1], [yellowRef]);
  }

  // Test 11 — integration: per-world and overall success rates are correct
  it('per-world and overall success rates are computed independently', () => {
    const w1 = makeSimpleWorld('world1', 5);
    const w2 = makeSimpleWorld('world2', 3);

    const a1 = w1.agents[0].id;
    const a2 = w1.agents[1].id;
    const b1 = w2.agents[0].id;
    const b2 = w2.agents[1].id;

    const events: InteractionEvent[] = [
      // world1: 4 events, 2 successful
      makeEvent(a1, a2, 'world1', true),
      makeEvent(a1, a2, 'world1', true),
      makeEvent(a1, a2, 'world1', false),
      makeEvent(a1, a2, 'world1', false),
      // world2: 2 events, 2 successful
      makeEvent(b1, b2, 'world2', true),
      makeEvent(b1, b2, 'world2', true),
    ];

    const result = computeScalarMetrics(w1, w2, events);

    expect(result.world1.successRate.rate).toBeCloseTo(0.5, 10);
    expect(result.world2.successRate.rate).toBeCloseTo(1.0, 10);
    // overall = 4/6 (2 world1 success + 2 world2 success out of 6 total events)
    expect(result.overall.successRate.rate).toBeCloseTo(4 / 6, 10);
    // overall must differ from both per-world rates
    expect(result.overall.successRate.rate).not.toBeCloseTo(0.5, 5);
    expect(result.overall.successRate.rate).not.toBeCloseTo(1.0, 5);
  });

  // Test 12 — key shape contract for downstream consumers (steps 17, 20, 22, 30)
  it('returns the expected key shape at all nesting levels', () => {
    const w1 = makeSimpleWorld('world1', 2);
    const w2 = makeSimpleWorld('world2', 2);
    const result = computeScalarMetrics(w1, w2, []);

    // Top-level keys
    expect(Object.keys(result).sort()).toEqual(['overall', 'tick', 'world1', 'world2']);

    // Per-world keys (symmetric)
    const worldKeys = [
      'distinctActiveTokens',
      'matchingRate',
      'perLanguage',
      'successRate',
      'successRateByClassPair',
    ];
    expect(Object.keys(result.world1).sort()).toEqual(worldKeys);
    expect(Object.keys(result.world2).sort()).toEqual(worldKeys);

    // overall keys
    expect(Object.keys(result.overall).sort()).toEqual(['successRate', 'successRateByClassPair']);

    // tick is null (stamped by step-20 worker)
    expect(result.tick).toBeNull();
  });
});
