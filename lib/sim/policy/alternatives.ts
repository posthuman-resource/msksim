// Named alternative language-selection policies for ablation experiments.
// Per docs/spec.md §4.1 F5 and CLAUDE.md "Known gotchas" (policy registry).
//
// Each alternative is a zero-config LanguagePolicy function: no factory, no
// per-call config access. This makes them directly usable in RQ5 sweeps where
// the researcher swaps in an alternative with all other parameters fixed.
//
// Language labels: alternatives use the module-private constants L1_DEFAULT
// and L2_DEFAULT ("L1", "L2"). This is acceptable because ablation experiments
// stay on default labels; a researcher who renames languages in the UI will
// use the 'default' policy instead. See docs/plan/12-language-selection-policies.md §5.

import type { Language } from "@/lib/schema/primitives";
import type { LanguagePolicy } from "../policy";

// ─── Module-private label constants ───────────────────────────────────────────

// NOTE: These are the hardcoded default language labels. Alternative policies
// do NOT read l1Label/l2Label from a config because they take no config
// argument. A regression here means alternatives silently use the wrong labels
// if a researcher renames the languages — documented in CLAUDE.md Known gotchas.
const L1_DEFAULT = "L1" as Language;
const L2_DEFAULT = "L2" as Language;

// ─── Alternative policies ─────────────────────────────────────────────────────

/**
 * Every speaker always uses L1 regardless of their class, the hearer, or RNG.
 * Ablation: disables all L2 propagation; measures "what if L2 never spreads?"
 */
export const alwaysL1: LanguagePolicy = () => L1_DEFAULT;

/**
 * Every speaker always uses L2 regardless of their class, the hearer, or RNG.
 * Ablation: symmetric to alwaysL1.
 */
export const alwaysL2: LanguagePolicy = () => L2_DEFAULT;

/**
 * Uniform 50/50 coin flip between L1 and L2 on every interaction.
 * Does not inspect the speaker's inventory — v1 is strictly bilingual
 * (only L1 and L2 per docs/spec.md §10).
 */
export const random: LanguagePolicy = ({ rng }) =>
  rng.nextFloat() < 0.5 ? L1_DEFAULT : L2_DEFAULT;

/**
 * Speaker mirrors the hearer's dominant language: whichever of {L1, L2} has
 * higher total weight summed across the hearer's entire inventory is returned.
 * Ties (equal sums or both zero) break deterministically toward L1_DEFAULT.
 *
 * No RNG touch — the tie-breaker is a pure lexicographic rule.
 *
 * Encodes the Baronchelli 2010 "consensus engineering" intervention:
 * speakers adapt to the hearer's dominant language.
 * See docs/plan/12-language-selection-policies.md §4.
 */
export const mirrorHearer: LanguagePolicy = ({ hearer }) => {
  let sumL1 = 0;
  let sumL2 = 0;

  // Inventory shape: Language → Referent → TokenLexeme → Weight
  const l1RefMap = hearer.inventory.get(L1_DEFAULT);
  if (l1RefMap) {
    for (const lexMap of l1RefMap.values()) {
      for (const weight of lexMap.values()) {
        sumL1 += weight;
      }
    }
  }

  const l2RefMap = hearer.inventory.get(L2_DEFAULT);
  if (l2RefMap) {
    for (const lexMap of l2RefMap.values()) {
      for (const weight of lexMap.values()) {
        sumL2 += weight;
      }
    }
  }

  return sumL1 >= sumL2 ? L1_DEFAULT : L2_DEFAULT;
};
