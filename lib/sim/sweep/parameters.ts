// Hand-maintained catalog of sweepable ExperimentConfig fields. Each entry has
// a dot-path into the parsed default config plus type metadata for the form.
//
// Why hand-maintained vs. Zod introspection: see docs/plan/28-parameter-sweep.md
// §4 path-not-taken 7. Every entry is verified at module load by walking
// `ExperimentConfig.parse({})` for the path; schema drift surfaces as a loud
// throw at import time.
//
// Pure module — no React, no server-only imports. Imported from the Client
// Component sweep-form.tsx, so the assertion runs in the browser too.

import { ExperimentConfig } from '@/lib/schema/experiment';
import { getByPath } from './aggregate';

export type SweepParameterKind =
  | { kind: 'number'; min?: number; max?: number; step?: number }
  | { kind: 'boolean' }
  | { kind: 'enum'; values: readonly string[] };

export interface SweepParameterEntry {
  /** Dot-path into the parsed ExperimentConfig. Walked by setByPath at sweep time. */
  path: string;
  /** Short human-readable label for the picker. */
  label: string;
  /** One-sentence description for tooltips. */
  description: string;
  /** Type metadata for the per-parameter grid editor. */
  kind: SweepParameterKind;
}

export const sweepParameters: readonly SweepParameterEntry[] = [
  {
    path: 'world1.monolingualBilingualRatio',
    label: 'World 1 mono:bi ratio',
    description:
      'Ratio of monolingual to bilingual agents in World 1. Spec default 1.5 (3:2 per PDF).',
    kind: { kind: 'number', min: 0.1, max: 10, step: 0.1 },
  },
  {
    path: 'world2.monolingualBilingualRatio',
    label: 'World 2 mono:bi ratio',
    description: 'Ratio of monolingual to bilingual agents in World 2 (RQ1 host-world axis).',
    kind: { kind: 'number', min: 0.1, max: 10, step: 0.1 },
  },
  {
    path: 'deltaPositive',
    label: 'Δ⁺ (weight bonus on success)',
    description: 'Weight increment on successful interaction. Spec default 0.1.',
    kind: { kind: 'number', min: 0.01, max: 1, step: 0.01 },
  },
  {
    path: 'deltaNegative',
    label: 'Δ⁻ (weight penalty on failure)',
    description: 'Weight decrement on failed interaction. Spec default 0 (minimal Naming Game).',
    kind: { kind: 'number', min: 0, max: 1, step: 0.01 },
  },
  {
    path: 'interactionProbability',
    label: 'Interaction probability',
    description: 'Per-tick probability that an activated agent attempts an interaction.',
    kind: { kind: 'number', min: 0, max: 1, step: 0.05 },
  },
  {
    path: 'retryLimit',
    label: 'Interaction retry limit',
    description: 'Max partner retries per tick on failure.',
    kind: { kind: 'number', min: 0, max: 10, step: 1 },
  },
  {
    path: 'preferentialAttachment.enabled',
    label: 'Preferential attachment enabled',
    description: 'F6 toggle. Use for ablation experiments.',
    kind: { kind: 'boolean' },
  },
  {
    path: 'preferentialAttachment.temperature',
    label: 'PA softmax temperature',
    description: 'Higher temperature = closer to uniform partner selection.',
    kind: { kind: 'number', min: 0.1, max: 10, step: 0.1 },
  },
  {
    path: 'preferentialAttachment.warmUpTicks',
    label: 'PA warm-up ticks',
    description: 'Ticks before similarity bias engages.',
    kind: { kind: 'number', min: 0, max: 1000, step: 10 },
  },
  {
    path: 'preferentialAttachment.topK',
    label: 'PA topK dimensions',
    description: 'Top-K token dimensions used for cosine similarity.',
    kind: { kind: 'number', min: 1, max: 50, step: 1 },
  },
  {
    path: 'weightUpdateRule',
    label: 'Weight update rule',
    description: 'Additive vs L1-normalized weight updates (spec §3.5).',
    kind: { kind: 'enum', values: ['additive', 'l1-normalized'] },
  },
  {
    path: 'schedulerMode',
    label: 'Scheduler mode',
    description: 'Sequential / random / priority agent activation order.',
    kind: { kind: 'enum', values: ['sequential', 'random', 'priority'] },
  },
  {
    path: 'sampleInterval',
    label: 'Snapshot sampling interval',
    description: 'Every N ticks. Lower = larger persisted records.',
    kind: { kind: 'number', min: 1, max: 100, step: 1 },
  },
];

// Module-load-time runtime assertion. Walks every catalog path through the
// parsed default config; throws if any path is missing. This is the only test
// the catalog needs — schema drift is fail-fast at import time.
{
  const defaultConfig = ExperimentConfig.parse({}) as unknown as Record<string, unknown>;
  for (const entry of sweepParameters) {
    const resolved = getByPath(defaultConfig, entry.path);
    if (resolved === undefined) {
      throw new Error(
        `sweep parameter catalog: path "${entry.path}" does not resolve in ` +
          `the default ExperimentConfig. Schema drift? Update lib/sim/sweep/parameters.ts ` +
          `or lib/schema/experiment.ts.`,
      );
    }
  }
}

/** Find a catalog entry by dot-path. Returns null when no entry matches. */
export function findParameter(path: string): SweepParameterEntry | null {
  return sweepParameters.find((p) => p.path === path) ?? null;
}

/**
 * Outcome metric options for the heatmap dropdown. Metric values are MetricSelector
 * strings as defined in `aggregate.ts`. The selector format is `<bucket>:<innerKey>`
 * (or the literal token `timeToConsensus`).
 */
export interface OutcomeMetricOption {
  selector: string;
  label: string;
}

export const outcomeMetricOptions: readonly OutcomeMetricOption[] = [
  { selector: 'mean:graph.assimilation', label: 'Assimilation index (mean)' },
  { selector: 'mean:graph.segregation', label: 'Segregation index (mean)' },
  { selector: 'mean:overall.successRate', label: 'Communication success rate (mean)' },
  { selector: 'mean:world1.matchingRate', label: 'World 1 matching rate (mean)' },
  { selector: 'mean:world2.matchingRate', label: 'World 2 matching rate (mean)' },
  { selector: 'mean:world1.nw', label: 'World 1 Nw (mean distinct active tokens)' },
  { selector: 'mean:world2.nw', label: 'World 2 Nw (mean distinct active tokens)' },
  { selector: 'mean:graph.modularity', label: 'Interaction graph modularity (mean)' },
  { selector: 'timeToConsensus', label: 'Time to consensus (ticks)' },
];
