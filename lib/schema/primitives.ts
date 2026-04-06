import { z } from 'zod';

// per docs/spec.md §3.5 — four agent classes corresponding to the two-world structure
export const AgentClass = z.enum(['W1-Mono', 'W1-Bi', 'W2-Native', 'W2-Immigrant']);
export type AgentClass = z.infer<typeof AgentClass>;

// per docs/spec.md §3.5 — opaque branded strings, not enums.
// Do NOT tighten to z.enum(["L1","L2"]) — researchers rename them via the UI.
export const Language = z.string().min(1).brand('Language');
export type Language = z.infer<typeof Language>;

// per docs/spec.md §3.5 — opaque referent identifier (e.g. "yellow-like", "red-like")
export const Referent = z.string().min(1).brand('Referent');
export type Referent = z.infer<typeof Referent>;

// per docs/spec.md §3.5 — opaque surface-form token (e.g. "yellow", "rouge")
export const TokenLexeme = z.string().min(1).brand('TokenLexeme');
export type TokenLexeme = z.infer<typeof TokenLexeme>;

// Non-negative weight for token inventory entries
export const Weight = z.number().nonnegative();
export type Weight = z.infer<typeof Weight>;

// per docs/spec.md §3.5 — weight-update rule; additive is the minimal Naming Game default
export const WeightUpdateRule = z.enum(['additive', 'l1-normalized']);
export type WeightUpdateRule = z.infer<typeof WeightUpdateRule>;
