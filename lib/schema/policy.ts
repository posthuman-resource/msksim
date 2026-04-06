import { z } from 'zod';
import { AgentClass } from './primitives.js';

// per docs/spec.md §3.3 — the four PDF-stated language policy rules, referenced by ID.
// Implementations live in lib/sim/policies/ (step 12); this schema only validates IDs.
export const LanguagePolicyRuleId = z.enum([
  'w1bi-to-w1mono-always-l1', // W1-Bi → W1-Mono: always L1 per the PDF
  'w1bi-to-w1bi-configurable', // W1-Bi → W1-Bi: either language (configurable bias)
  'w2imm-to-w2native-both', // W2-Immigrant → W2-Native: both languages possible
  'w2imm-to-w2imm-both', // W2-Immigrant → W2-Immigrant: both languages possible
  'always-l1', // Monolingual L1 speaker (W1-Mono)
  'always-l2', // Monolingual L2 speaker (W2-Native)
]);
export type LanguagePolicyRuleId = z.infer<typeof LanguagePolicyRuleId>;

// Optional bias between L1 and L2 used by configurable policies (must sum to 1)
export const LanguageBias = z.object({
  L1: z.number().nonnegative(),
  L2: z.number().nonnegative(),
});
export type LanguageBias = z.infer<typeof LanguageBias>;

// One row in the policy matrix: maps (speakerClass, hearerClass) → ruleId
export const LanguagePolicyEntry = z.object({
  speakerClass: AgentClass,
  hearerClass: AgentClass,
  ruleId: LanguagePolicyRuleId,
  languageBias: LanguageBias.optional(),
});
export type LanguagePolicyEntry = z.infer<typeof LanguagePolicyEntry>;

// per docs/spec.md §3.3 — full 4×4 policy matrix (all speaker×hearer pairs covered)
export const LanguagePolicySet = z.array(LanguagePolicyEntry);
export type LanguagePolicySet = z.infer<typeof LanguagePolicySet>;
