import { z } from 'zod';
import { ExperimentConfig } from './experiment';
import {
  DEFAULT_REPLICATE_COUNT,
  DEFAULT_BATCH_CONCURRENCY,
  DEFAULT_REPLICATES_PER_CELL,
  DEFAULT_SEED,
} from './defaults';

// Pre-compute full defaults once; Zod 4 does not re-parse .default({}) through the schema.
const _defaultExperiment = ExperimentConfig.parse({});

// per docs/spec.md §4.3 F12 — batch queue configuration.
// Seeds per replicate are derived at runtime as baseSeed + replicateIndex (step 27).
export const BatchConfig = z.object({
  experiment: ExperimentConfig.default(_defaultExperiment),
  replicateCount: z.number().int().positive().default(DEFAULT_REPLICATE_COUNT),
  baseSeed: z.number().int().default(DEFAULT_SEED),
  concurrency: z.number().int().positive().default(DEFAULT_BATCH_CONCURRENCY),
});
export type BatchConfig = z.infer<typeof BatchConfig>;

// per docs/spec.md §4.3 F13 — parameter sweep configuration.
// paramPath uses dot-separated JSON-pointer strings (e.g. "world1.monolingualBilingualRatio").
// Step 28 interprets these paths to generate the cartesian product of configs.
export const SweepConfig = z.object({
  baseExperiment: ExperimentConfig.default(_defaultExperiment),
  axes: z
    .array(
      z.object({
        paramPath: z.string().min(1),
        values: z.array(z.unknown()).min(1),
      }),
    )
    .min(1),
  replicatesPerCell: z.number().int().positive().default(DEFAULT_REPLICATES_PER_CELL),
});
export type SweepConfig = z.infer<typeof SweepConfig>;
