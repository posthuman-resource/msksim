// Policy registry: maps PolicyName strings to LanguagePolicy functions.
// Per docs/spec.md §4.1 F5.
//
// String identifiers (not function closures) are used so that PolicyConfig
// remains JSON-serializable for postMessage into the simulation worker (step 20)
// and for persistence in the drizzle configs table (step 08).
// See CLAUDE.md "Known gotchas" for the structuredClone/DataCloneError risk.

import { createDefaultPolicy } from './default';
import { alwaysL1, alwaysL2, random, mirrorHearer } from './alternatives';
import type { LanguagePolicy, PolicyConfig, PolicyName } from '../policy';

// ─── Policy name registry ─────────────────────────────────────────────────────

/**
 * All supported policy names, in canonical order.
 * Step 24's UI dropdown and step 28's parameter sweep iterate over this tuple.
 * If step 01's schema references these via z.enum(...), it should import this
 * constant rather than duplicating the strings.
 */
export const POLICY_NAMES = [
  'default',
  'always-l1',
  'always-l2',
  'random',
  'mirror-hearer',
] as const satisfies readonly PolicyName[];

// Map from non-default policy names to their zero-config implementations.
const ALTERNATIVE_MAP = new Map<Exclude<PolicyName, 'default'>, LanguagePolicy>([
  ['always-l1', alwaysL1],
  ['always-l2', alwaysL2],
  ['random', random],
  ['mirror-hearer', mirrorHearer],
]);

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Build a LanguagePolicy from a PolicyConfig.
 *
 * If `config.policyName === 'default'`, delegates to createDefaultPolicy which
 * builds a per-pair lookup from `config.entries` (the LanguagePolicySet from
 * ExperimentConfig.languagePolicies).
 *
 * Otherwise, looks up the named alternative and returns it directly. Throws
 * with a self-diagnosing message (listing valid names) if the name is unknown —
 * a config typo is immediately identifiable.
 */
export function createPolicy(config: PolicyConfig): LanguagePolicy {
  if (config.policyName === 'default') {
    return createDefaultPolicy(config);
  }

  const policy = ALTERNATIVE_MAP.get(config.policyName);
  if (policy === undefined) {
    throw new Error(
      `Unknown policy name: "${config.policyName}". Known policies: ${POLICY_NAMES.join(', ')}`,
    );
  }
  return policy;
}

/**
 * Return the list of all supported policy names.
 * Used by step 24's UI dropdown and step 28's parameter sweep planner.
 */
export function listPolicies(): readonly PolicyName[] {
  return POLICY_NAMES;
}
