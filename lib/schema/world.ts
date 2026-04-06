import { z } from 'zod';
import { AgentClass, Language, Referent, TokenLexeme, Weight } from './primitives';
import { TopologyConfig } from './topology';
import {
  DEFAULT_AGENT_COUNT,
  DEFAULT_MONO_BI_RATIO,
  DEFAULT_REFERENTS,
  defaultVocabularySeed,
} from './defaults';

// per docs/spec.md §4.1 F2 — one seeded token entry in an agent's inventory
const VocabularySeedEntry = z.object({
  lexeme: TokenLexeme,
  initialWeight: Weight,
});

// per docs/spec.md §4.1 F2 — nested record: AgentClass → Language → Referent → seed entries.
// Uses z.record with string keys because Language/Referent are branded strings at runtime.
export const VocabularySeed = z.record(
  AgentClass,
  z.record(Language, z.record(Referent, z.array(VocabularySeedEntry))),
);
export type VocabularySeed = z.infer<typeof VocabularySeed>;

// per docs/spec.md §4.1 F1 — per-world configuration
export const WorldConfig = z.object({
  // per docs/spec.md §3.4 — total agent count in this world
  agentCount: z.number().int().positive().default(DEFAULT_AGENT_COUNT),

  // per docs/spec.md §3.4 — 3:2 default expressed as float 1.5 (monolinguals per bilingual)
  monolingualBilingualRatio: z.number().positive().default(DEFAULT_MONO_BI_RATIO),

  // per docs/spec.md §4.1 F4 — spatial topology; defaults to 20×20 lattice
  topology: TopologyConfig.default({
    type: 'lattice',
    width: 20,
    height: 20,
    neighborhood: 'moore',
  }),

  // per docs/spec.md §3.5 — referents as opaque strings; default matches PDF's two color categories.
  // `as any` because branded-string array types cannot be satisfied by plain string literals.

  referents: z
    .array(Referent)
    .min(1)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .default(DEFAULT_REFERENTS as any),

  // per docs/spec.md §4.1 F2 — initial token inventory per agent class.
  // `as any` for the same branded-string record-key reason as `referents`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vocabularySeed: VocabularySeed.default(defaultVocabularySeed as any),
});
export type WorldConfig = z.infer<typeof WorldConfig>;
