import { describe, it, expect } from 'vitest';
import { tick, selectPartner } from './engine';
import type { SimulationState, InteractionEvent } from './engine';
import { bootstrapExperiment } from './bootstrap';
import { createRNG } from './rng';
import { ExperimentConfig } from '@/lib/schema/experiment';
import type { World } from './world';
import type { AgentState } from './types';
import type { Topology } from './topology';

// ─── Serialization helpers ────────────────────────────────────────────────────
// JSON.stringify cannot handle nested Maps directly; this replacer converts them.

function mapReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Map) {
    return Array.from((value as Map<unknown, unknown>).entries()).sort((a, b) =>
      String(a[0]).localeCompare(String(b[0])),
    );
  }
  return value;
}

function serializeAgents(agents: AgentState[]): string {
  return JSON.stringify(agents, mapReplacer);
}

function serializeEvents(events: InteractionEvent[]): string {
  return JSON.stringify(events);
}

// ─── Config helpers ───────────────────────────────────────────────────────────

/** Default 50-agent-per-world lattice config, parsed with Zod. */
function defaultConfig(): ExperimentConfig {
  return ExperimentConfig.parse({});
}

/**
 * Small well-mixed config for faster test runs.
 * world1: `agentCount` W1-Mono + W1-Bi agents, well-mixed topology.
 * world2: 2 agents with default (empty) vocabulary to minimise world2 noise.
 */
function smallWellMixedConfig(
  agentCount: number,
  extra: Partial<Parameters<typeof ExperimentConfig.parse>[0]> = {},
): ExperimentConfig {
  return ExperimentConfig.parse({
    world1: {
      agentCount,
      topology: { type: 'well-mixed' },
    },
    world2: {
      agentCount: 2,
      topology: { type: 'well-mixed' },
    },
    schedulerMode: 'sequential',
    ...extra,
  });
}

/**
 * Config with a custom vocabulary designed to produce a non-trivial (< 100%)
 * initial success rate that improves over time via weight reinforcement.
 *
 * W1-Mono: only "yellow" for "yellow-like" in L1.
 * W1-Bi: "yellow" (weight 1.0) AND "gul" (weight 1.0) for "yellow-like" in L1.
 *
 * Dynamics:
 *   - W1-Mono → anyone: always picks "yellow" → success (all have it).
 *   - W1-Bi → W1-Mono: 50% "yellow" (success) / 50% "gul" (failure for W1-Mono).
 *   - W1-Bi → W1-Bi: any token → success (both have both tokens).
 *
 * Over time, W1-Bi's "yellow" weight increases via successful interactions,
 * making "gul" less likely to be picked → overall success rate rises.
 * All policy entries use "always-l1" so no L2 coin flips mess with the dynamic.
 */
function convergingConfig(agentCount: number): ExperimentConfig {
  const vocabSeed = {
    'W1-Mono': {
      L1: { 'yellow-like': [{ lexeme: 'yellow', initialWeight: 1.0 }] },
    },
    'W1-Bi': {
      L1: {
        'yellow-like': [
          { lexeme: 'yellow', initialWeight: 1.0 },
          { lexeme: 'gul', initialWeight: 1.0 },
        ],
      },
    },
    'W2-Native': {},
    'W2-Immigrant': {},
  };

  // All 16 pairs: always L1 (so no L2 skips, no coin-flip noise)
  const agentClasses = ['W1-Mono', 'W1-Bi', 'W2-Native', 'W2-Immigrant'] as const;
  const alwaysL1Policies = agentClasses.flatMap((s) =>
    agentClasses.map((h) => ({
      speakerClass: s,
      hearerClass: h,
      ruleId: 'always-l1' as const,
    })),
  );

  return ExperimentConfig.parse({
    world1: {
      agentCount,
      monolingualBilingualRatio: 1.5, // ~60% W1-Mono, ~40% W1-Bi
      topology: { type: 'well-mixed' },
      referents: ['yellow-like'],
      vocabularySeed: vocabSeed,
    },
    world2: {
      agentCount: 2,
      topology: { type: 'well-mixed' },
      referents: ['yellow-like'],
      vocabularySeed: vocabSeed,
    },
    languagePolicies: alwaysL1Policies,
    schedulerMode: 'sequential',
    deltaPositive: 0.1,
    deltaNegative: 0,
  });
}

/** Build an initial SimulationState from a config + seed (both worlds). */
function buildState(config: ExperimentConfig, seed: number): SimulationState {
  const { world1, world2 } = bootstrapExperiment(config, seed);
  return { world1, world2, tickNumber: 0, config };
}

/** Run N ticks, accumulating all events. Returns final state and all events. */
function runTicks(
  state: SimulationState,
  rng: ReturnType<typeof createRNG>,
  n: number,
): { state: SimulationState; events: InteractionEvent[] } {
  const events: InteractionEvent[] = [];
  for (let i = 0; i < n; i++) {
    const result = tick(state, rng);
    state = result.state;
    events.push(...result.interactions);
  }
  return { state, events };
}

/** Compute success rate from an array of events. Returns NaN if no events. */
function successRate(events: InteractionEvent[]): number {
  if (events.length === 0) return NaN;
  return events.filter((e) => e.success).length / events.length;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('tick — determinism', () => {
  // Test 9: same seed → same final state
  it('same seed, 100 ticks → identical final agent arrays', () => {
    const config = defaultConfig();

    const state1 = buildState(config, 42);
    const rng1 = createRNG(42);
    const { state: final1 } = runTicks(state1, rng1, 100);

    const state2 = buildState(config, 42);
    const rng2 = createRNG(42);
    const { state: final2 } = runTicks(state2, rng2, 100);

    expect(serializeAgents(final1.world1.agents)).toBe(serializeAgents(final2.world1.agents));
    expect(serializeAgents(final1.world2.agents)).toBe(serializeAgents(final2.world2.agents));
  });

  // Test 10: same seed → identical event streams
  it('same seed, 100 ticks → identical InteractionEvent arrays', () => {
    const config = defaultConfig();

    const state1 = buildState(config, 42);
    const rng1 = createRNG(42);
    const { events: events1 } = runTicks(state1, rng1, 100);

    const state2 = buildState(config, 42);
    const rng2 = createRNG(42);
    const { events: events2 } = runTicks(state2, rng2, 100);

    expect(events1.length).toBe(events2.length);
    expect(serializeEvents(events1)).toBe(serializeEvents(events2));
  });
});

describe('tick — success-rate dynamics', () => {
  // Test 11: Success rate climbs over time
  it('success rate is higher in last 20 ticks than first 20 ticks (converging config)', () => {
    const config = convergingConfig(30);
    const state = buildState(config, 7);
    const rng = createRNG(7);

    const allEvents: InteractionEvent[] = [];
    for (let i = 0; i < 100; i++) {
      const result = tick(state, rng);
      allEvents.push(...result.interactions);
    }

    // Split into events from first 20 ticks (tick 0–19) and last 20 (tick 80–99)
    const first20 = allEvents.filter((e) => e.tick < 20);
    const last20 = allEvents.filter((e) => e.tick >= 80);

    // Both windows must have some events
    expect(first20.length).toBeGreaterThan(0);
    expect(last20.length).toBeGreaterThan(0);

    const firstRate = successRate(first20);
    const lastRate = successRate(last20);

    // Success rate must improve as W1-Bi agents' "yellow" weights increase
    expect(lastRate).toBeGreaterThan(firstRate);
  });

  // Test 12: Pure-L1 convergence (success rate > 0.95 after 200 ticks)
  it('success rate > 0.95 in last 20 ticks after 200 ticks (converging config)', () => {
    const config = convergingConfig(30);
    const state = buildState(config, 13);
    const rng = createRNG(13);

    const allEvents: InteractionEvent[] = [];
    for (let i = 0; i < 200; i++) {
      const result = tick(state, rng);
      allEvents.push(...result.interactions);
    }

    const last20Events = allEvents.filter((e) => e.tick >= 180);
    expect(last20Events.length).toBeGreaterThan(0);
    expect(successRate(last20Events)).toBeGreaterThan(0.95);
  });

  // Test 13: Mixed world has non-zero failure rate initially
  it('mixed world (W2-Native + W2-Immigrant) has at least one failure in first 10 ticks', () => {
    // World2 with W2-Immigrant → W2-Native interactions sometimes uses L1
    // (50/50 coin flip), but W2-Native only knows L2 → failures
    const config = ExperimentConfig.parse({
      world1: { agentCount: 2, topology: { type: 'well-mixed' } },
      world2: {
        agentCount: 30,
        topology: { type: 'well-mixed' },
        monolingualBilingualRatio: 1.5, // ~18 W2-Native + ~12 W2-Immigrant
      },
      schedulerMode: 'sequential',
    });

    const state = buildState(config, 99);
    const rng = createRNG(99);

    const allEvents: InteractionEvent[] = [];
    for (let i = 0; i < 50; i++) {
      const result = tick(state, rng);
      allEvents.push(...result.interactions);
    }

    const first10Events = allEvents.filter((e) => e.tick < 10);
    const failures = first10Events.filter((e) => !e.success);
    expect(failures.length).toBeGreaterThan(0);
  });
});

describe('tick — retry limit and edge cases', () => {
  // Test 14: Retry-limit exhaustion does not crash
  it('retry-limit exhaustion does not crash the tick function', () => {
    // W1-Bi agents with empty inventory — "skip" branch fires every activation
    const vocabSeed = {
      'W1-Mono': {},
      'W1-Bi': {},
      'W2-Native': {},
      'W2-Immigrant': {},
    };
    const config = ExperimentConfig.parse({
      world1: {
        agentCount: 2,
        topology: { type: 'well-mixed' },
        vocabularySeed: vocabSeed,
      },
      world2: {
        agentCount: 2,
        topology: { type: 'well-mixed' },
        vocabularySeed: vocabSeed,
      },
      retryLimit: 3,
      schedulerMode: 'sequential',
    });

    const state = buildState(config, 0);
    const rng = createRNG(0);

    expect(() => runTicks(state, rng, 5)).not.toThrow();
    expect(state.tickNumber).toBe(5);
  });

  // Test 19: Event tick fields match the tick counter at emission time
  it('event tick fields match the tick counter at the time of emission', () => {
    const config = smallWellMixedConfig(10);
    const state = buildState(config, 1);
    const rng = createRNG(1);

    const allEvents: InteractionEvent[] = [];
    for (let i = 0; i < 3; i++) {
      const result = tick(state, rng);
      allEvents.push(...result.interactions);
    }

    // Events from tick 0 must have tick === 0, etc.
    const tick0Events = allEvents.filter((e) => e.tick === 0);
    const tick1Events = allEvents.filter((e) => e.tick === 1);
    const tick2Events = allEvents.filter((e) => e.tick === 2);

    // All three tick windows should have some events (10 agents, well-mixed)
    expect(tick0Events.length).toBeGreaterThan(0);
    expect(tick1Events.length).toBeGreaterThan(0);
    expect(tick2Events.length).toBeGreaterThan(0);
    // No events should have tick > 2 (we ran exactly 3 ticks: 0, 1, 2)
    expect(allEvents.filter((e) => e.tick > 2)).toHaveLength(0);
  });
});

describe('tick — scheduler modes', () => {
  // Test 16: Sequential vs random scheduler produce different activation orders
  it('sequential and random schedulers produce different event orderings', () => {
    const config = smallWellMixedConfig(10);
    const seed = 42;

    const stateSeq = buildState(config, seed);
    const rngSeq = createRNG(seed);
    const configSeq = ExperimentConfig.parse({
      ...config,
      schedulerMode: 'sequential',
    });
    stateSeq.config = configSeq;
    const { events: seqEvents } = runTicks(stateSeq, rngSeq, 1);

    const stateRand = buildState(config, seed);
    const rngRand = createRNG(seed);
    const configRand = ExperimentConfig.parse({
      ...config,
      schedulerMode: 'random',
    });
    stateRand.config = configRand;
    const { events: randEvents } = runTicks(stateRand, rngRand, 1);

    // Both must produce events
    expect(seqEvents.length).toBeGreaterThan(0);
    expect(randEvents.length).toBeGreaterThan(0);

    // The speaker ordering should differ (very high probability with 10 agents)
    const seqSpeakers = seqEvents.map((e) => e.speakerId).join(',');
    const randSpeakers = randEvents.map((e) => e.speakerId).join(',');
    expect(seqSpeakers).not.toBe(randSpeakers);
  });
});

describe('tick — weight update mode', () => {
  // Test 17: Normalized weight update keeps Σ weights ≈ 1.0 across a full tick
  it('l1-normalized mode: Σ weights per (agent, lang, ref) ≈ 1.0 after 10 ticks', () => {
    const config = ExperimentConfig.parse({
      world1: {
        agentCount: 10,
        topology: { type: 'well-mixed' },
      },
      world2: {
        agentCount: 10,
        topology: { type: 'well-mixed' },
      },
      schedulerMode: 'sequential',
      weightUpdateRule: 'l1-normalized',
    });

    const state = buildState(config, 5);
    const rng = createRNG(5);
    runTicks(state, rng, 10);

    // After 10 ticks, every (agent, lang, ref) sub-map must sum to ~1.0
    for (const world of [state.world1, state.world2]) {
      for (const agent of world.agents) {
        for (const [, refMap] of agent.inventory) {
          for (const [, lexMap] of refMap) {
            if (lexMap.size > 0) {
              let sum = 0;
              for (const w of lexMap.values()) {
                sum += w;
              }
              expect(Math.abs(sum - 1.0)).toBeLessThan(1e-9);
            }
          }
        }
      }
    }
  });
});

describe('tick — interaction memory', () => {
  // Test 18: interactionMemory is bounded and FIFO-ordered
  it('agent interactionMemory stays bounded and newest entry is last', () => {
    const memorySize = 5;
    const config = ExperimentConfig.parse({
      world1: { agentCount: 10, topology: { type: 'well-mixed' } },
      world2: { agentCount: 10, topology: { type: 'well-mixed' } },
      schedulerMode: 'sequential',
      interactionMemorySize: memorySize,
    });

    const state = buildState(config, 3);
    const rng = createRNG(3);
    runTicks(state, rng, 30);

    // Check every agent's memory
    for (const world of [state.world1, state.world2]) {
      for (const agent of world.agents) {
        expect(agent.interactionMemory.length).toBeLessThanOrEqual(memorySize);

        if (agent.interactionMemory.length >= 2) {
          // FIFO: each subsequent entry has tick >= previous
          for (let i = 1; i < agent.interactionMemory.length; i++) {
            expect(agent.interactionMemory[i].tick).toBeGreaterThanOrEqual(
              agent.interactionMemory[i - 1].tick,
            );
          }
        }
      }
    }
  });
});

describe('selectPartner', () => {
  // Test 15: selectPartner('uniform') returns a non-null agent for a connected topology
  it("selectPartner with 'uniform' returns a neighbor agent deterministically", () => {
    const config = smallWellMixedConfig(5);
    const { world1 } = bootstrapExperiment(config, 10);
    const speaker = world1.agents[0];

    const rng1 = createRNG(99);
    const partner1 = selectPartner(speaker, world1, rng1, 'uniform');
    expect(partner1).not.toBeNull();
    expect(partner1!.id).not.toBe(speaker.id);

    // Same seed → same partner
    const rng2 = createRNG(99);
    const partner2 = selectPartner(speaker, world1, rng2, 'uniform');
    expect(partner2!.id).toBe(partner1!.id);
  });

  // Test 20: Isolated-node topology produces no interactions
  it('isolated-node topology produces no InteractionEvents', () => {
    const isolatedTopology: Topology = {
      kind: 'network' as const,
      size: 2,
      neighbors: () => [],
      pickNeighbor: () => null,
      adjacency: () => [],
    };

    // Bootstrap a 2-agent well-mixed world, then replace its topology
    const config = ExperimentConfig.parse({
      world1: { agentCount: 2, topology: { type: 'well-mixed' } },
      world2: { agentCount: 2, topology: { type: 'well-mixed' } },
      schedulerMode: 'sequential',
    });
    const { world1, world2 } = bootstrapExperiment(config, 0);

    const isolatedWorld1: World = { ...world1, topology: isolatedTopology };
    const isolatedWorld2: World = { ...world2, topology: isolatedTopology };
    const state: SimulationState = {
      world1: isolatedWorld1,
      world2: isolatedWorld2,
      tickNumber: 0,
      config,
    };
    const rng = createRNG(0);

    const allEvents: InteractionEvent[] = [];
    for (let i = 0; i < 5; i++) {
      const result = tick(state, rng);
      allEvents.push(...result.interactions);
    }

    // No events should be emitted — all speakers find no partner
    expect(allEvents).toHaveLength(0);
    expect(state.tickNumber).toBe(5);
  });
});

describe('tick — movement (step 34)', () => {
  // Test 7: default config (movement.enabled=false) keeps all positions stable.
  it('default config: agent positions are unchanged after 50 ticks (movement disabled)', () => {
    const config = ExperimentConfig.parse({
      world1: {
        agentCount: 9,
        topology: { type: 'lattice', width: 3, height: 3, neighborhood: 'moore' },
      },
      world2: {
        agentCount: 9,
        topology: { type: 'lattice', width: 3, height: 3, neighborhood: 'moore' },
      },
      schedulerMode: 'sequential',
    });
    const state = buildState(config, 11);
    const initialPositions = state.world1.agents.map((a) => a.position).slice();
    const rng = createRNG(11);
    runTicks(state, rng, 50);
    expect(state.world1.agents.map((a) => a.position)).toEqual(initialPositions);
  });

  // Test 8: movement applies after weight update; weights still reflect updateWeight.
  it('with movement enabled, weights reflect post-update value AND speaker position changes', () => {
    // 2x1 lattice -> exactly two cells, both agents always adjacent.
    // Identical inventories => cosine similarity = 1.0 >= attractThreshold.
    const vocabSeed = {
      'W1-Mono': {
        L1: { 'yellow-like': [{ lexeme: 'yellow', initialWeight: 1.0 }] },
      },
      'W1-Bi': {
        L1: { 'yellow-like': [{ lexeme: 'yellow', initialWeight: 1.0 }] },
      },
      'W2-Native': {
        L1: { 'yellow-like': [{ lexeme: 'yellow', initialWeight: 1.0 }] },
      },
      'W2-Immigrant': {
        L1: { 'yellow-like': [{ lexeme: 'yellow', initialWeight: 1.0 }] },
      },
    };
    const config = ExperimentConfig.parse({
      world1: {
        agentCount: 2,
        topology: { type: 'lattice', width: 2, height: 1, neighborhood: 'moore' },
        referents: ['yellow-like'],
        vocabularySeed: vocabSeed,
      },
      world2: {
        agentCount: 2,
        topology: { type: 'lattice', width: 2, height: 1, neighborhood: 'moore' },
        referents: ['yellow-like'],
        vocabularySeed: vocabSeed,
      },
      schedulerMode: 'sequential',
      deltaPositive: 0.5,
      movement: {
        enabled: true,
        attractThreshold: 0.5,
        attractStep: 1,
        repelStep: 0,
        collisionPolicy: 'swap',
        topK: 10,
        latticeOnly: true,
      },
    });
    const state = buildState(config, 1);
    const rng = createRNG(1);
    const result = tick(state, rng);

    // At least one successful interaction must have occurred.
    const w1Successes = result.interactions.filter((e) => e.success && e.worldId === 'world1');
    expect(w1Successes.length).toBeGreaterThan(0);

    // Weight update happened: at least one agent's "yellow" weight is > 1.0.
    const yellowWeights = state.world1.agents.flatMap((a) => {
      const out: number[] = [];
      for (const [, refMap] of a.inventory) {
        for (const [, lexMap] of refMap) {
          for (const w of lexMap.values()) out.push(w);
        }
      }
      return out;
    });
    expect(yellowWeights.some((w) => w > 1.0)).toBe(true);

    // Both agents still on the 2-cell lattice and at distinct positions.
    const positions = state.world1.agents.map((a) => a.position);
    expect(new Set(positions).size).toBe(2);
    for (const p of positions) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(2);
    }
  });

  // Test 9: positions remain distinct (no two agents share a cell) after several
  // ticks with movement and swap collisions enabled.
  it('keeps agent positions distinct on a small lattice across multiple ticks', () => {
    const vocabSeed = {
      'W1-Mono': {
        L1: { 'yellow-like': [{ lexeme: 'yellow', initialWeight: 1.0 }] },
      },
      'W1-Bi': {
        L1: { 'yellow-like': [{ lexeme: 'yellow', initialWeight: 1.0 }] },
      },
      'W2-Native': {
        L1: { 'yellow-like': [{ lexeme: 'yellow', initialWeight: 1.0 }] },
      },
      'W2-Immigrant': {
        L1: { 'yellow-like': [{ lexeme: 'yellow', initialWeight: 1.0 }] },
      },
    };
    const config = ExperimentConfig.parse({
      world1: {
        agentCount: 2,
        topology: { type: 'lattice', width: 2, height: 1, neighborhood: 'moore' },
        referents: ['yellow-like'],
        vocabularySeed: vocabSeed,
      },
      world2: {
        agentCount: 2,
        topology: { type: 'lattice', width: 2, height: 1, neighborhood: 'moore' },
        referents: ['yellow-like'],
        vocabularySeed: vocabSeed,
      },
      schedulerMode: 'sequential',
      retryLimit: 0,
      movement: {
        enabled: true,
        attractThreshold: 0.5,
        attractStep: 1,
        repelStep: 0,
        collisionPolicy: 'swap',
        topK: 10,
        latticeOnly: true,
      },
    });
    const state = buildState(config, 99);
    const rng = createRNG(99);
    runTicks(state, rng, 4);

    const positions = state.world1.agents.map((a) => a.position);
    expect(new Set(positions).size).toBe(positions.length);
    expect(state.tickNumber).toBe(4);
  });
});

describe('tick — tickNumber advancement', () => {
  // Verify tickNumber increments correctly across multiple ticks
  it('tickNumber advances by 1 per tick call', () => {
    const config = smallWellMixedConfig(5);
    const state = buildState(config, 0);
    const rng = createRNG(0);

    expect(state.tickNumber).toBe(0);
    tick(state, rng);
    expect(state.tickNumber).toBe(1);
    tick(state, rng);
    expect(state.tickNumber).toBe(2);
    const result = tick(state, rng);
    expect(result.tickNumber).toBe(3);
    expect(state.tickNumber).toBe(3);
  });
});
