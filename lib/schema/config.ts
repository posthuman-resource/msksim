// lib/schema/config.ts — root re-export for the msksim configuration schema.
//
// This module is deliberately NOT marked `import 'server-only'`.
// Zod has no Node built-ins, so these schemas are safe to import from:
//   - Server Components and Server Actions (lib/auth/dal.ts, step 08 drizzle layer)
//   - Client Components (step 25 config editor form)
//   - Web Workers (step 20 simulation worker RPC boundary)
//
// Downstream code uses only `z.infer<typeof Schema>` types — no hand-written interfaces.

export {
  AgentClass,
  Language,
  Referent,
  TokenLexeme,
  Weight,
  WeightUpdateRule,
} from "./primitives.js";
export type {
  AgentClass as AgentClassType,
  Language as LanguageType,
  Referent as ReferentType,
  TokenLexeme as TokenLexemeType,
  Weight as WeightType,
  WeightUpdateRule as WeightUpdateRuleType,
} from "./primitives.js";

export { NeighborhoodType, TopologyConfig } from "./topology.js";
export type {
  NeighborhoodType as NeighborhoodTypeType,
  TopologyConfig as TopologyConfigType,
  LatticeTopology,
  WellMixedTopology,
  NetworkTopology,
} from "./topology.js";

export { LanguagePolicyRuleId, LanguageBias, LanguagePolicyEntry, LanguagePolicySet } from "./policy.js";
export type {
  LanguagePolicyRuleId as LanguagePolicyRuleIdType,
  LanguageBias as LanguageBiasType,
  LanguagePolicyEntry as LanguagePolicyEntryType,
  LanguagePolicySet as LanguagePolicySetType,
} from "./policy.js";

export { VocabularySeed, WorldConfig } from "./world.js";
export type {
  VocabularySeed as VocabularySeedType,
  WorldConfig as WorldConfigType,
} from "./world.js";

export { PreferentialAttachmentConfig } from "./preferential.js";
export type { PreferentialAttachmentConfig as PreferentialAttachmentConfigType } from "./preferential.js";

export { SchedulerMode, ExperimentConfig } from "./experiment.js";
export type {
  SchedulerMode as SchedulerModeType,
  ExperimentConfig as ExperimentConfigType,
} from "./experiment.js";

export { BatchConfig, SweepConfig } from "./batch.js";
export type {
  BatchConfig as BatchConfigType,
  SweepConfig as SweepConfigType,
} from "./batch.js";

export {
  defaultLanguagePolicies,
  defaultVocabularySeed,
  DEFAULT_AGENT_COUNT,
  DEFAULT_MONO_BI_RATIO,
  DEFAULT_REFERENTS,
  DEFAULT_L1,
  DEFAULT_L2,
  DEFAULT_L1_YELLOW,
  DEFAULT_L1_RED,
  DEFAULT_L2_YELLOW,
  DEFAULT_L2_RED,
  DEFAULT_DELTA_POSITIVE,
  DEFAULT_DELTA_NEGATIVE,
  DEFAULT_TICK_COUNT,
  DEFAULT_SEED,
  DEFAULT_SAMPLE_INTERVAL,
  DEFAULT_INTERACTION_MEMORY_SIZE,
} from "./defaults.js";
