import { z } from 'zod';

// per docs/plan/33-gaussian-success-policy.md — opt-in probabilistic
// communication-success policy. The default 'deterministic' kind preserves
// v1 behavior bit-identically (zero new RNG draws). The 'gaussian' kind
// applies an RBF kernel to the Euclidean distance between top-K token-weight
// vectors of the speaker and hearer:
//   Ps(i, j) = exp(-‖x_i - x_j‖² / (2σ²))
// and rolls one rng.nextFloat() per interaction against Ps to decide success.
//
// Discriminated union by `kind` keeps Zod parsing strict and leaves room for
// future arms (e.g. 'sigmoid') without breaking the contract for callers.
//
// No `import 'server-only'` — this schema crosses the worker boundary and is
// also consumed in tests under the default Vitest `node` environment.

export const SuccessPolicyKind = z.enum(['deterministic', 'gaussian']);
export type SuccessPolicyKind = z.infer<typeof SuccessPolicyKind>;

export const DeterministicSuccessPolicy = z.object({
  kind: z.literal('deterministic'),
});
export type DeterministicSuccessPolicy = z.infer<typeof DeterministicSuccessPolicy>;

export const GaussianSuccessPolicy = z.object({
  kind: z.literal('gaussian'),
  // Kernel width / bandwidth — wider σ ⇒ more forgiving communication.
  // Per the collaborator PDF (page 2). Mike's design decision keeps σ separate
  // from preferentialAttachment.temperature; see plan §3 and path-not-taken 6.
  sigma: z.number().positive().default(1.0),
  // Top-K token vector dimensions used for distance — mirrors step 14's default.
  gaussianTopK: z.number().int().positive().default(10),
});
export type GaussianSuccessPolicy = z.infer<typeof GaussianSuccessPolicy>;

export const SuccessPolicyConfig = z.discriminatedUnion('kind', [
  DeterministicSuccessPolicy,
  GaussianSuccessPolicy,
]);
export type SuccessPolicyConfig = z.infer<typeof SuccessPolicyConfig>;

// Pre-computed full default — Zod 4's .default() does not re-parse through the
// schema, so consumers needing the literal default value import this directly.
export const defaultSuccessPolicyConfig: SuccessPolicyConfig = { kind: 'deterministic' };
