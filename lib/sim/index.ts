export * from "./bootstrap";
export * from "./rng";
export * from "./types";
export * from "./world";

// Step 12: language-selection policy public API
export type { LanguagePolicy, LanguagePolicyArgs, LanguagePolicyFactory, PolicyConfig, PolicyName } from "./policy";
export { createPolicy, listPolicies, POLICY_NAMES } from "./policy/registry";

// Step 13: interaction engine public API
export type {
  InteractionEvent,
  PartnerStrategy,
  SimulationState,
  TickResult,
} from "./engine";
export { selectPartner, tick } from "./engine";
export { updateWeight } from "./engine/weight-update";
