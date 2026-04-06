// Canonical default values for the msksim configuration schemas.
// Every .default(...) in the schema files imports from here so that
// the origin of each numeric is traceable back to the spec.
//
// All values are plain JSON-serializable objects — no Zod types here.

import type { LanguagePolicyEntry } from './policy.js';

// per docs/spec.md §3.4 — default lattice dimensions (20×20 = 400 cells, supports 50 agents with room)
export const DEFAULT_LATTICE_WIDTH = 20;
export const DEFAULT_LATTICE_HEIGHT = 20;

// per docs/spec.md §3.4 — 3:2 monolingual:bilingual ratio expressed as a float (3/2 = 1.5)
export const DEFAULT_MONO_BI_RATIO = 1.5;

// per docs/spec.md §3.4 — default agent count per world
export const DEFAULT_AGENT_COUNT = 50;

// per docs/spec.md §3.4 — two color referents, matching the PDF's examples
export const DEFAULT_REFERENTS = ['yellow-like', 'red-like'] as const;

// per docs/spec.md §3.4, Slide 3 — default language identifiers
export const DEFAULT_L1 = 'L1';
export const DEFAULT_L2 = 'L2';

// per docs/spec.md §3.4, Slide 3 — default L1 color-term lexemes
export const DEFAULT_L1_YELLOW = 'yellow';
export const DEFAULT_L1_RED = 'red';

// per docs/spec.md §3.4, Slide 4 — default L2 color-term lexemes
export const DEFAULT_L2_YELLOW = 'jaune';
export const DEFAULT_L2_RED = 'rouge';

// per docs/spec.md §3.4 — initial token weight for all seeded entries
export const DEFAULT_INITIAL_WEIGHT = 1.0;

// per docs/spec.md §3.3 — Δ⁺ (weight increment on successful interaction)
export const DEFAULT_DELTA_POSITIVE = 0.1;

// per docs/spec.md §3.3 — Δ⁻ defaults to 0 in the minimal Naming Game (no penalty on failure)
export const DEFAULT_DELTA_NEGATIVE = 0;

// per docs/spec.md §3.3 — bounded retry limit to avoid runaway tick cost
export const DEFAULT_RETRY_LIMIT = 3;

// per docs/spec.md §7.2 — snapshot sampling cadence in ticks
export const DEFAULT_SAMPLE_INTERVAL = 10;

// per docs/spec.md §4.1 F3 — default tick count for a full run
export const DEFAULT_TICK_COUNT = 5000;

// per docs/spec.md §4.1 F10 — seed 0 is explicitly supported
export const DEFAULT_SEED = 0;

// per docs/spec.md §4.1 F6 — preferential attachment warm-up before bias kicks in
export const DEFAULT_WARMUP_TICKS = 100;

// per docs/spec.md §4.1 F6 — softmax temperature for similarity-weighted partner selection
export const DEFAULT_PA_TEMPERATURE = 1.0;

// per docs/spec.md §3.3 — bounded FIFO memory per agent for preferential attachment (step 14)
export const DEFAULT_INTERACTION_MEMORY_SIZE = 50;

// per docs/spec.md §4.3 F12 — default batch replicate count and concurrency
export const DEFAULT_REPLICATE_COUNT = 10;
export const DEFAULT_BATCH_CONCURRENCY = 1;

// per docs/spec.md §4.3 F13 — default replicates per sweep cell
export const DEFAULT_REPLICATES_PER_CELL = 10;

// per docs/spec.md §7.1 — stability window for time-to-consensus detection
export const DEFAULT_CONSENSUS_WINDOW_TICKS = 100;

// per docs/spec.md §7.3 — user-configurable classification thresholds
export const defaultClassificationThresholds = {
  assimilationHigh: 0.7, // α: finalAssimilation must exceed this to classify as assimilated
  segregationLow: 0.3, // β: finalSegregation must be below this to classify as assimilated
  assimilationLow: 0.3, // γ: finalAssimilation must be below this to classify as segregated
  segregationHigh: 0.7, // δ: finalSegregation must exceed this to classify as segregated
} as const;

// per docs/spec.md §7.3 — convergence stability window (user-configurable per experiment)
export const defaultConvergenceConfig = {
  consensusWindowTicks: DEFAULT_CONSENSUS_WINDOW_TICKS,
} as const;

// per docs/spec.md §3.3 — full 4×4 language policy matrix.
// Pairs not explicitly stated by the PDF get a defensive fallback (always-l1 or always-l2).
export const defaultLanguagePolicies: LanguagePolicyEntry[] = [
  // W1-Mono (monolingual L1): always speaks L1 regardless of hearer
  { speakerClass: 'W1-Mono', hearerClass: 'W1-Mono', ruleId: 'always-l1' },
  { speakerClass: 'W1-Mono', hearerClass: 'W1-Bi', ruleId: 'always-l1' },
  { speakerClass: 'W1-Mono', hearerClass: 'W2-Native', ruleId: 'always-l1' },
  { speakerClass: 'W1-Mono', hearerClass: 'W2-Immigrant', ruleId: 'always-l1' },

  // W1-Bi (bilingual in World 1): per PDF — always L1 to monolinguals; configurable to other bilinguals
  { speakerClass: 'W1-Bi', hearerClass: 'W1-Mono', ruleId: 'w1bi-to-w1mono-always-l1' },
  { speakerClass: 'W1-Bi', hearerClass: 'W1-Bi', ruleId: 'w1bi-to-w1bi-configurable' },
  { speakerClass: 'W1-Bi', hearerClass: 'W2-Native', ruleId: 'always-l1' }, // cross-world default
  { speakerClass: 'W1-Bi', hearerClass: 'W2-Immigrant', ruleId: 'always-l1' }, // cross-world default

  // W2-Native (monolingual L2): always speaks L2
  { speakerClass: 'W2-Native', hearerClass: 'W1-Mono', ruleId: 'always-l2' },
  { speakerClass: 'W2-Native', hearerClass: 'W1-Bi', ruleId: 'always-l2' },
  { speakerClass: 'W2-Native', hearerClass: 'W2-Native', ruleId: 'always-l2' },
  { speakerClass: 'W2-Native', hearerClass: 'W2-Immigrant', ruleId: 'always-l2' },

  // W2-Immigrant: per PDF — uses both languages with natives and other immigrants
  { speakerClass: 'W2-Immigrant', hearerClass: 'W1-Mono', ruleId: 'always-l1' }, // cross-world default
  { speakerClass: 'W2-Immigrant', hearerClass: 'W1-Bi', ruleId: 'always-l1' }, // cross-world default
  { speakerClass: 'W2-Immigrant', hearerClass: 'W2-Native', ruleId: 'w2imm-to-w2native-both' },
  { speakerClass: 'W2-Immigrant', hearerClass: 'W2-Immigrant', ruleId: 'w2imm-to-w2imm-both' },
];

// per docs/spec.md §3.4, Slides 3-4 — vocabulary seed matching the PDF canonical setup.
// Structure: AgentClass → Language → Referent → [{lexeme, initialWeight}]
// Declared before defaultWorldConfig to avoid initialization order errors.
export const defaultVocabularySeed = {
  'W1-Mono': {
    L1: {
      'yellow-like': [{ lexeme: DEFAULT_L1_YELLOW, initialWeight: DEFAULT_INITIAL_WEIGHT }],
      'red-like': [{ lexeme: DEFAULT_L1_RED, initialWeight: DEFAULT_INITIAL_WEIGHT }],
    },
  },
  'W1-Bi': {
    L1: {
      'yellow-like': [{ lexeme: DEFAULT_L1_YELLOW, initialWeight: DEFAULT_INITIAL_WEIGHT }],
      'red-like': [{ lexeme: DEFAULT_L1_RED, initialWeight: DEFAULT_INITIAL_WEIGHT }],
    },
    L2: {
      'yellow-like': [{ lexeme: DEFAULT_L2_YELLOW, initialWeight: DEFAULT_INITIAL_WEIGHT }],
      'red-like': [{ lexeme: DEFAULT_L2_RED, initialWeight: DEFAULT_INITIAL_WEIGHT }],
    },
  },
  'W2-Native': {
    L2: {
      'yellow-like': [{ lexeme: DEFAULT_L2_YELLOW, initialWeight: DEFAULT_INITIAL_WEIGHT }],
      'red-like': [{ lexeme: DEFAULT_L2_RED, initialWeight: DEFAULT_INITIAL_WEIGHT }],
    },
  },
  'W2-Immigrant': {
    L1: {
      'yellow-like': [{ lexeme: DEFAULT_L1_YELLOW, initialWeight: DEFAULT_INITIAL_WEIGHT }],
      'red-like': [{ lexeme: DEFAULT_L1_RED, initialWeight: DEFAULT_INITIAL_WEIGHT }],
    },
    L2: {
      'yellow-like': [{ lexeme: DEFAULT_L2_YELLOW, initialWeight: DEFAULT_INITIAL_WEIGHT }],
      'red-like': [{ lexeme: DEFAULT_L2_RED, initialWeight: DEFAULT_INITIAL_WEIGHT }],
    },
  },
} as const;

// Pre-computed full default for WorldConfig.
// Required because Zod 4 does not re-parse the default value through the schema —
// using .default({}) would return {} as-is instead of applying inner field defaults.
// The call sites in world.ts/experiment.ts cast this to `any` to satisfy branded key types.
export const defaultWorldConfig = {
  agentCount: DEFAULT_AGENT_COUNT,
  monolingualBilingualRatio: DEFAULT_MONO_BI_RATIO,
  topology: {
    type: 'lattice' as const,
    width: DEFAULT_LATTICE_WIDTH,
    height: DEFAULT_LATTICE_HEIGHT,
    neighborhood: 'moore' as const,
  },
  referents: [...DEFAULT_REFERENTS],
  vocabularySeed: defaultVocabularySeed,
};

// Pre-computed full default for PreferentialAttachmentConfig (same Zod 4 reason).
export const defaultPreferentialAttachmentConfig = {
  enabled: true,
  warmUpTicks: DEFAULT_WARMUP_TICKS,
  temperature: DEFAULT_PA_TEMPERATURE,
  similarityMetric: 'cosine' as const,
  topK: 10,
};
