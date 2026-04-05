import { z } from "zod";
import { WeightUpdateRule } from "./primitives.js";
import { WorldConfig } from "./world.js";
import { LanguagePolicySet } from "./policy.js";
import { PreferentialAttachmentConfig } from "./preferential.js";
import { defaultLanguagePolicies, defaultWorldConfig, defaultPreferentialAttachmentConfig } from "./defaults.js";
import {
  DEFAULT_TICK_COUNT,
  DEFAULT_DELTA_POSITIVE,
  DEFAULT_DELTA_NEGATIVE,
  DEFAULT_RETRY_LIMIT,
  DEFAULT_SEED,
  DEFAULT_SAMPLE_INTERVAL,
} from "./defaults.js";

// per docs/spec.md §4.1 F3 — scheduler mode for agent activation order
export const SchedulerMode = z.enum(["sequential", "random", "priority"]);
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

  // per docs/spec.md §3.5 — how token weights are updated on success
  weightUpdateRule: WeightUpdateRule.default("additive"),

  // per docs/spec.md §4.1 F3 — scheduler mode
  schedulerMode: SchedulerMode.default("random"),

  // per docs/spec.md §4.1 F5 — full 4×4 (speakerClass, hearerClass) → rule matrix
  languagePolicies: LanguagePolicySet.default(defaultLanguagePolicies),

  // per docs/spec.md §4.1 F6 — preferential attachment rule
  preferentialAttachment: PreferentialAttachmentConfig.default(defaultPreferentialAttachmentConfig),

  // per docs/spec.md §4.1 F10 — RNG seed; 0 is explicitly supported
  seed: z.number().int().default(DEFAULT_SEED),

  // per docs/spec.md §7.2 — tick interval between full agent-inventory snapshots
  sampleInterval: z.number().int().positive().default(DEFAULT_SAMPLE_INTERVAL),
});
export type ExperimentConfig = z.infer<typeof ExperimentConfig>;
