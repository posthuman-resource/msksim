import type { TopologyConfig } from '@/lib/schema/topology';
import type { RNG } from '../rng';
import type { Topology } from '../topology';
import { LatticeTopology } from './lattice';
import { WellMixedTopology } from './well-mixed';

/**
 * Create the appropriate Topology implementation from a TopologyConfig.
 *
 * @param config - the discriminated-union topology config from lib/schema/topology
 * @param rng    - RNG instance; accepted for API symmetry (v2 generators may consume it)
 * @param size   - population count; required for 'well-mixed' (where the topology config
 *                 carries no inherent size — that comes from WorldConfig.agentCount)
 */
export function createTopology(config: TopologyConfig, rng: RNG, size?: number): Topology {
  switch (config.type) {
    case 'lattice':
      return new LatticeTopology(config.width, config.height, config.neighborhood);

    case 'well-mixed': {
      if (size === undefined || size === null) {
        throw new Error(
          "createTopology: 'well-mixed' topology requires a size argument " +
            '(pass WorldConfig.agentCount as the third parameter)',
        );
      }
      return new WellMixedTopology(size);
    }

    case 'network':
      throw new Error(
        'createTopology: network topology v1 requires a pre-built graphology Graph; ' +
          'use NetworkTopology.fromAdjacencyMap() or NetworkTopology directly. ' +
          'Config-driven small-world/scale-free generators are deferred to v2.',
      );

    default: {
      // Exhaustiveness check: adding a new variant to TopologyConfig without
      // handling it here will cause a compile error (config narrows to never).
      const _exhaustive: never = config;
      throw new Error(`createTopology: unknown topology type: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
