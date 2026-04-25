import { z } from 'zod';
import { WeightUpdateRule } from './primitives';
import { WorldConfig } from './world';
import { LanguagePolicySet } from './policy';
import { PreferentialAttachmentConfig } from './preferential';
import { SuccessPolicyConfig, defaultSuccessPolicyConfig } from './success';
import {
  defaultLanguagePolicies,
  defaultWorldConfig,
  defaultPreferentialAttachmentConfig,
  defaultClassificationThresholds,
  defaultConvergenceConfig,
} from './defaults';
import {
  DEFAULT_TICK_COUNT,
  DEFAULT_DELTA_POSITIVE,
  DEFAULT_DELTA_NEGATIVE,
  DEFAULT_RETRY_LIMIT,
  DEFAULT_SEED,
  DEFAULT_SAMPLE_INTERVAL,
  DEFAULT_INTERACTION_MEMORY_SIZE,
  DEFAULT_INTERACTION_PROBABILITY,
} from './defaults';

// per docs/spec.md §4.1 F3 — scheduler mode for agent activation order
export const SchedulerMode = z.enum(['sequential', 'random', 'priority']);
export type SchedulerMode = z.infer<typeof SchedulerMode>;

// per docs/spec.md §4.1 F11 — top-level experiment configuration.
// Every field has a .default() so ExperimentConfig.parse({}) produces a runnable config.
export const ExperimentConfig = z.object({
  // per docs/spec.md §3.1 — two independent worlds running in parallel.
  // Uses pre-computed defaults because Zod 4 does not re-parse .default({}) through the schema.
  // `as any` because the plain-object default cannot satisfy branded-string key requirements.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  world1: WorldConfig.default(defaultWorldConfig as any),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  world2: WorldConfig.default(defaultWorldConfig as any),

  // per docs/spec.md §4.1 F10 — total simulation ticks
  tickCount: z.number().int().positive().default(DEFAULT_TICK_COUNT),

  // per docs/spec.md §3.3 — Δ⁺: weight increment on successful interaction
  deltaPositive: z.number().positive().default(DEFAULT_DELTA_POSITIVE),

  // per docs/spec.md §3.3 — Δ⁻: penalty on failure; 0 is the minimal Naming Game default
  deltaNegative: z.number().nonnegative().default(DEFAULT_DELTA_NEGATIVE),

  // per docs/spec.md §3.3 — max retries on failure before moving to next agent pair
  retryLimit: z.number().int().nonnegative().default(DEFAULT_RETRY_LIMIT),

  // per docs/spec.md §3.3 F10 — probability [0,1] that an activated agent attempts an interaction
  // 1.0 = all agents interact every tick; 0.5 = each agent skips ~50% of activations
  interactionProbability: z.number().min(0).max(1).default(DEFAULT_INTERACTION_PROBABILITY),

  // per docs/spec.md §3.5 — how token weights are updated on success
  weightUpdateRule: WeightUpdateRule.default('additive'),

  // per docs/spec.md §4.1 F3 — scheduler mode
  schedulerMode: SchedulerMode.default('random'),

  // per docs/spec.md §4.1 F5 — full 4×4 (speakerClass, hearerClass) → rule matrix
  languagePolicies: LanguagePolicySet.default(defaultLanguagePolicies),

  // per docs/spec.md §4.1 F6 — preferential attachment rule
  preferentialAttachment: PreferentialAttachmentConfig.default(defaultPreferentialAttachmentConfig),

  // per docs/plan/33-gaussian-success-policy.md — opt-in probabilistic success policy.
  // Default 'deterministic' is bit-identical to v1 and consumes zero new RNG draws.
  successPolicy: SuccessPolicyConfig.default(defaultSuccessPolicyConfig),

  // per docs/spec.md §4.1 F10 — RNG seed; 0 is explicitly supported
  seed: z.number().int().default(DEFAULT_SEED),

  // per docs/spec.md §3.3 — max interactions stored per agent for preferential attachment (step 14)
  interactionMemorySize: z.number().int().positive().default(DEFAULT_INTERACTION_MEMORY_SIZE),

  // per docs/spec.md §7.2 — tick interval between full agent-inventory snapshots
  sampleInterval: z.number().int().positive().default(DEFAULT_SAMPLE_INTERVAL),

  // per docs/spec.md §7.3 — user-configurable thresholds for run classification (α/β/γ/δ)
  classificationThresholds: z
    .object({
      assimilationHigh: z.number().min(0).max(1).default(0.7), // α
      segregationLow: z.number().min(0).max(1).default(0.3), // β
      assimilationLow: z.number().min(0).max(1).default(0.3), // γ
      segregationHigh: z.number().min(0).max(1).default(0.7), // δ
    })
    .default(defaultClassificationThresholds),

  // per docs/spec.md §7.1 — stability window for time-to-consensus detection
  convergence: z
    .object({
      consensusWindowTicks: z.number().int().positive().default(100),
    })
    .default(defaultConvergenceConfig),
});
export type ExperimentConfig = z.infer<typeof ExperimentConfig>;
