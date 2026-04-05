// Language-selection policy types for the Naming Game simulation.
// Per docs/spec.md §3.3 step 2 and §4.1 F5.
//
// This module is client-safe, server-safe, and worker-safe — it deliberately
// does NOT carry `import 'server-only'`. lib/sim/ is shared between Server
// Components, Client Components, and the simulation Web Worker (step 20).
//
// No runtime code lives here — this is types only. Consumers (step 13's
// interaction engine) can import LanguagePolicy without pulling in the
// alternative-policy implementations or the registry's string table.

import type { AgentState } from "./types";
import type { RNG } from "./rng";
import type { Language } from "@/lib/schema/primitives";
import type { LanguagePolicySet } from "@/lib/schema/policy";

// ─── Named policies ───────────────────────────────────────────────────────────

/**
 * The five named policy sets supported by the registry.
 *
 * 'default'     — per-pair rules derived from ExperimentConfig.languagePolicies
 *                 (docs/spec.md §3.3 PDF rules).
 * 'always-l1'   — every speaker always uses L1 regardless of class or hearer.
 * 'always-l2'   — every speaker always uses L2.
 * 'random'      — uniform 50/50 coin flip between L1 and L2 on every interaction.
 * 'mirror-hearer' — speaker uses whichever language has higher total weight in
 *                 the hearer's inventory (Baronchelli 2010 "consensus engineering").
 */
export type PolicyName =
  | "default"
  | "always-l1"
  | "always-l2"
  | "random"
  | "mirror-hearer";

// ─── Policy types ─────────────────────────────────────────────────────────────

/** Named argument object for a language-selection policy call. */
export type LanguagePolicyArgs = {
  readonly speaker: AgentState;
  readonly hearer: AgentState;
  readonly rng: RNG;
};

/**
 * A language-selection policy: a pure function (side-effect-free except for
 * the RNG threaded through as an argument) that decides which Language the
 * speaker uses when addressing the hearer.
 *
 * "Pure given its inputs" — does not close over mutable module-level state.
 * Deterministic given the same seed per docs/spec.md §4.1 F3.
 */
export type LanguagePolicy = (args: LanguagePolicyArgs) => Language;

/**
 * Configuration input for createPolicy (lib/sim/policy/registry.ts).
 *
 * Step 01's ExperimentConfig.languagePolicies is a LanguagePolicySet (array of
 * per-pair entries). Step 12 wraps it here with the language labels (derived
 * from the vocabulary seed at bootstrap time) and the named-policy selector so
 * the interaction engine has a single self-contained object to pass around.
 *
 * All fields are JSON-serializable primitives/arrays — no functions, no
 * Map/Set — satisfying the postMessage and SQLite persistence constraints
 * (CLAUDE.md "Known gotchas").
 */
export type PolicyConfig = {
  /** Which named policy to use; 'default' uses per-pair entries. */
  policyName: PolicyName;
  /** Per-pair rules from ExperimentConfig.languagePolicies (step 01). */
  entries: LanguagePolicySet;
  /** Opaque L1 label, e.g. "L1" by default; may be renamed by the researcher. */
  l1Label: Language;
  /** Opaque L2 label, e.g. "L2" by default; may be renamed by the researcher. */
  l2Label: Language;
};

/**
 * Shape of the exported factory function from lib/sim/policy/registry.ts.
 * Provided here so consumers can annotate variables without importing from
 * the implementation module.
 */
export type LanguagePolicyFactory = (config: PolicyConfig) => LanguagePolicy;
