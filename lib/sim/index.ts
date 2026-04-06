export * from './bootstrap';
export * from './rng';
export * from './types';
export * from './world';

// Step 12: language-selection policy public API
export type {
  LanguagePolicy,
  LanguagePolicyArgs,
  LanguagePolicyFactory,
  PolicyConfig,
  PolicyName,
} from './policy';
export { createPolicy, listPolicies, POLICY_NAMES } from './policy/registry';

// Step 13: interaction engine public API
export type { InteractionEvent, PartnerStrategy, SimulationState, TickResult } from './engine';
export { selectPartner, tick } from './engine';
export { updateWeight } from './engine/weight-update';

// Step 14: preferential attachment public API
export { cosineSimilarity, topKTokenVector, type TokenVector } from './similarity';
export { preferentialSelectPartner, softmaxWithTemperature } from './preferential-attachment';
export { createPartnerSelector, type PartnerSelectorFn } from './partner-selector';

// Step 15: scalar metrics public API
export type {
  ClassPairKey,
  PerLanguageScalarMetrics,
  PerWorldScalarMetrics,
  ScalarMetricsSnapshot,
  SuccessRate,
  SuccessRateByClassPair,
} from './metrics/types';
export {
  computeCommunicationSuccessRate,
  computeDistinctActiveTokens,
  computeMatchingRate,
  computeMeanTokenWeight,
  computeScalarMetrics,
  computeSuccessRateByClassPair,
  computeTokenWeightVariance,
} from './metrics/scalar';
