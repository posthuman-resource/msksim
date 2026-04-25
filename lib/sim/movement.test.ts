import { describe, it, expect } from 'vitest';
import { applyMovement } from './movement';
import { LatticeTopology } from './topology/lattice';
import { WellMixedTopology } from './topology/well-mixed';
import {
  emptyInventory,
  inventorySet,
  makeAgentId,
  type AgentState,
  type Inventory,
} from './types';
import type { World } from './world';
import type { Language, Referent, TokenLexeme } from '@/lib/schema/primitives';
import {
  Language as LSchema,
  Referent as RSchema,
  TokenLexeme as TLSchema,
} from '@/lib/schema/primitives';
import { defaultMovementConfig, type MovementConfig } from '@/lib/schema/movement';

const L1 = LSchema.parse('L1');
const yellowRef = RSchema.parse('yellow-ref');
const yellowLex = TLSchema.parse('yellow');
const otherLex = TLSchema.parse('other');

function makeAgent(idStr: string, position: number, inv: Inventory): AgentState {
  return {
    id: makeAgentId(idStr),
    class: 'W1-Mono',
    position,
    inventory: inv,
    interactionMemory: [],
  };
}

function singletonInventory(lex: TokenLexeme, weight: number, lang: Language = L1): Inventory {
  return inventorySet(emptyInventory(), lang, yellowRef, lex, weight);
}

function makeLatticeWorld(width: number, height: number, agents: AgentState[]): World {
  return {
    id: 'world1',
    agents,
    topology: new LatticeTopology(width, height, 'moore'),
    referents: [yellowRef as Referent],
    languages: [L1 as Language],
  };
}

function makeWellMixedWorld(agents: AgentState[]): World {
  return {
    id: 'world1',
    agents,
    topology: new WellMixedTopology(Math.max(2, agents.length)),
    referents: [yellowRef as Referent],
    languages: [L1 as Language],
  };
}

function withConfig(over: Partial<MovementConfig>): MovementConfig {
  return { ...defaultMovementConfig, ...over };
}

describe('applyMovement', () => {
  // Test 1: disabled is no-op.
  it('is a no-op when config.enabled is false', () => {
    const speaker = makeAgent('s', 0, singletonInventory(yellowLex, 1));
    const hearer = makeAgent('h', 24, singletonInventory(yellowLex, 1));
    const world = makeLatticeWorld(5, 5, [speaker, hearer]);

    applyMovement({ speaker, hearer, world, config: defaultMovementConfig });
    expect(speaker.position).toBe(0);
    expect(hearer.position).toBe(24);
  });

  // Test 2: non-spatial topology is no-op.
  it('is a no-op when topology has no spatial capability (well-mixed)', () => {
    const speaker = makeAgent('s', 0, singletonInventory(yellowLex, 1));
    const hearer = makeAgent('h', 1, singletonInventory(yellowLex, 1));
    const world = makeWellMixedWorld([speaker, hearer]);

    applyMovement({ speaker, hearer, world, config: withConfig({ enabled: true }) });
    expect(speaker.position).toBe(0);
    expect(hearer.position).toBe(1);
  });

  // Test 3: attract step moves toward partner, lex-first neighbor.
  it('moves speaker east one cell toward hearer when cosine >= attractThreshold', () => {
    const speaker = makeAgent('s', 0, singletonInventory(yellowLex, 1));
    const hearer = makeAgent('h', 24, singletonInventory(yellowLex, 1));
    const world = makeLatticeWorld(5, 5, [speaker, hearer]);

    applyMovement({
      speaker,
      hearer,
      world,
      config: withConfig({ enabled: true, attractStep: 1 }),
    });
    // From (0,0) toward (4,4): N out-of-bounds, E (1,0)=1 in-bounds and decreases.
    expect(speaker.position).toBe(1);
    expect(hearer.position).toBe(24);
  });

  // Test 4: repel step moves away from partner.
  it('moves speaker two cells west away from hearer when cosine < attractThreshold', () => {
    // Speaker at (2,2)=12, hearer at (3,2)=13. Disjoint inventories => cos=0.
    const speaker = makeAgent('s', 12, singletonInventory(yellowLex, 1));
    const hearer = makeAgent('h', 13, singletonInventory(otherLex, 1));
    const world = makeLatticeWorld(5, 5, [speaker, hearer]);

    applyMovement({
      speaker,
      hearer,
      world,
      config: withConfig({ enabled: true, repelStep: 2 }),
    });
    // (2,2) → away from (3,2) prefers axial -dx = west: (1,2)=11.
    // From (1,2) → away from (3,2): again west, (0,2)=10.
    expect(speaker.position).toBe(10);
    expect(hearer.position).toBe(13);
  });

  // Test 5: collision swap.
  it("swaps positions with the occupant when collisionPolicy is 'swap'", () => {
    // Speaker at (0,0)=0, hearer at (1,0)=1 (the cell speaker would step into).
    const speaker = makeAgent('s', 0, singletonInventory(yellowLex, 1));
    const hearer = makeAgent('h', 1, singletonInventory(yellowLex, 1));
    const world = makeLatticeWorld(5, 5, [speaker, hearer]);

    applyMovement({
      speaker,
      hearer,
      world,
      config: withConfig({ enabled: true, attractStep: 1, collisionPolicy: 'swap' }),
    });
    expect(speaker.position).toBe(1);
    expect(hearer.position).toBe(0);
  });

  // Test 6: collision skip.
  it("leaves positions unchanged on collision when collisionPolicy is 'skip'", () => {
    const speaker = makeAgent('s', 0, singletonInventory(yellowLex, 1));
    const hearer = makeAgent('h', 1, singletonInventory(yellowLex, 1));
    const world = makeLatticeWorld(5, 5, [speaker, hearer]);

    applyMovement({
      speaker,
      hearer,
      world,
      config: withConfig({ enabled: true, attractStep: 1, collisionPolicy: 'skip' }),
    });
    expect(speaker.position).toBe(0);
    expect(hearer.position).toBe(1);
  });
});
