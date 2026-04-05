// Default language-selection policy: translates a LanguagePolicySet (array of
// per-(speakerClass, hearerClass) entries from lib/schema/policy.ts) into a
// fast Map-lookup LanguagePolicy function.
//
// Per docs/spec.md §3.3 step 2 and §4.1 F5. The four PDF rules are:
//   W1-Bi → W1-Mono : always L1
//   W1-Bi → W1-Bi   : biased coin flip (configurable)
//   W2-Immigrant → W2-Native     : biased coin flip (configurable)
//   W2-Immigrant → W2-Immigrant  : biased coin flip (configurable)
// All other pairs are handled by "always-l1" or "always-l2" fallthrough rules
// recorded in the defaultLanguagePolicies matrix (lib/schema/defaults.ts).

import type { Language } from "@/lib/schema/primitives";
import type { LanguagePolicyEntry } from "@/lib/schema/policy";
import type { LanguagePolicy, PolicyConfig } from "../policy";

/**
 * Build a LanguagePolicy from the per-pair entries in `config`.
 *
 * At factory call time:
 *   1. Language labels (l1Label, l2Label) are captured as local constants.
 *   2. A Map<string, LanguagePolicy> keyed on "${speakerClass}__${hearerClass}"
 *      is built once from the entries array.
 *   3. Each entry's ruleId + languageBias determines a pre-closed lambda.
 *
 * At call time the returned LanguagePolicy does a single Map.get and invokes
 * the lambda — no dispatch logic beyond that single lookup.
 */
export function createDefaultPolicy(config: PolicyConfig): LanguagePolicy {
  const { l1Label, l2Label, entries } = config;

  const map = new Map<string, LanguagePolicy>();

  for (const entry of entries) {
    const key = `${entry.speakerClass}__${entry.hearerClass}`;
    map.set(key, makeRulePolicy(entry, l1Label, l2Label));
  }

  return function defaultPolicy({ speaker, hearer, rng }) {
    const key = `${speaker.class}__${hearer.class}`;
    const rule = map.get(key);
    if (!rule) {
      throw new Error(`Unexpected class pair: ${key}. No policy entry found.`);
    }
    return rule({ speaker, hearer, rng });
  };
}

// ─── Private helpers ──────────────────────────────────────────────────────────

/**
 * Build a LanguagePolicy lambda for one (speakerClass, hearerClass) entry.
 *
 * For the three configurable rules the lambda performs a biased coin flip using
 * entry.languageBias.L1 as the probability of returning l1Label. When
 * languageBias is absent, bias defaults to 0.5 (uniform 50/50).
 *
 * For deterministic rules ("always-l1", "always-l2",
 * "w1bi-to-w1mono-always-l1") the lambda returns the captured label directly
 * without touching the RNG.
 */
function makeRulePolicy(
  entry: LanguagePolicyEntry,
  l1Label: Language,
  l2Label: Language,
): LanguagePolicy {
  switch (entry.ruleId) {
    case "always-l1":
    case "w1bi-to-w1mono-always-l1":
      // Deterministic: no RNG touch.
      return () => l1Label;

    case "always-l2":
      // Deterministic: no RNG touch.
      return () => l2Label;

    case "w1bi-to-w1bi-configurable":
    case "w2imm-to-w2native-both":
    case "w2imm-to-w2imm-both": {
      // Biased coin flip. L1 probability = languageBias.L1; default 0.5.
      // The schema comment states biases must sum to 1; we use L1 directly
      // as the probability rather than normalising to avoid extra arithmetic
      // on the hot path.
      const l1Prob = entry.languageBias?.L1 ?? 0.5;
      return ({ rng }) => (rng.nextFloat() < l1Prob ? l1Label : l2Label);
    }
  }
}
