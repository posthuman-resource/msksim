import { z } from 'zod';
import { DEFAULT_WARMUP_TICKS, DEFAULT_PA_TEMPERATURE } from './defaults.js';

// per docs/spec.md §4.1 F6 — preferential attachment configuration.
// After warm-up, partner selection biases toward agents with similar token-weight profiles.
export const PreferentialAttachmentConfig = z.object({
  // Toggle for ablation experiments per docs/spec.md §4.1 F6
  enabled: z.boolean().default(true),

  // per docs/spec.md §4.1 F6 — ticks before similarity bias engages
  warmUpTicks: z.number().int().nonnegative().default(DEFAULT_WARMUP_TICKS),

  // per docs/spec.md §4.1 F6 — softmax temperature for similarity-weighted selection
  temperature: z.number().positive().default(DEFAULT_PA_TEMPERATURE),

  // Single-element enum intentionally; leaves room for "jaccard"/"dot-product" in v2
  similarityMetric: z.enum(['cosine']).default('cosine'),

  // per docs/spec.md §11 OQ7 — top-K token dimensions used for cosine similarity
  topK: z.number().int().positive().default(10),
});
export type PreferentialAttachmentConfig = z.infer<typeof PreferentialAttachmentConfig>;
