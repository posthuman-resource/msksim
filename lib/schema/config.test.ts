import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  ExperimentConfig,
  TopologyConfig,
  BatchConfig,
  SweepConfig,
  AgentClass,
  LanguagePolicyRuleId,
  defaultLanguagePolicies,
  DEFAULT_MONO_BI_RATIO,
  DEFAULT_AGENT_COUNT,
  DEFAULT_DELTA_POSITIVE,
  DEFAULT_DELTA_NEGATIVE,
  DEFAULT_L1_YELLOW,
  DEFAULT_L1_RED,
  DEFAULT_L2_YELLOW,
  DEFAULT_L2_RED,
} from './config.js';

describe('ExperimentConfig', () => {
  it('parse({}) returns a valid config with all fields populated', () => {
    const result = ExperimentConfig.safeParse({});
    expect(result.success).toBe(true);
    if (!result.success) return;

    const config = result.data;
    // No undefined anywhere at the top level
    expect(config.world1).toBeDefined();
    expect(config.world2).toBeDefined();
    expect(config.tickCount).toBeDefined();
    expect(config.deltaPositive).toBeDefined();
    expect(config.deltaNegative).toBeDefined();
    expect(config.retryLimit).toBeDefined();
    expect(config.weightUpdateRule).toBeDefined();
    expect(config.schedulerMode).toBeDefined();
    expect(config.languagePolicies).toBeDefined();
    expect(config.preferentialAttachment).toBeDefined();
    expect(config.seed).toBeDefined();
    expect(config.sampleInterval).toBeDefined();
  });

  it('default config matches the PDF canonical setup', () => {
    const config = ExperimentConfig.parse({});

    // per docs/spec.md §3.4 — 3:2 ratio
    expect(config.world1.monolingualBilingualRatio).toBe(DEFAULT_MONO_BI_RATIO);
    expect(config.world1.agentCount).toBe(DEFAULT_AGENT_COUNT);
    expect(config.world2.monolingualBilingualRatio).toBe(DEFAULT_MONO_BI_RATIO);
    expect(config.world2.agentCount).toBe(DEFAULT_AGENT_COUNT);

    // per docs/spec.md §3.3 — Δ⁺ > 0, Δ⁻ = 0
    expect(config.deltaPositive).toBe(DEFAULT_DELTA_POSITIVE);
    expect(config.deltaPositive).toBeGreaterThan(0);
    expect(config.deltaNegative).toBe(DEFAULT_DELTA_NEGATIVE);
    expect(config.deltaNegative).toBe(0);

    // per docs/spec.md §3.4, Slides 3-4 — canonical color terms.
    // Cast to `any` for nested access: branded-string keys (Language, Referent) cannot be
    // indexed by plain string literals at the TypeScript type level, only at runtime.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const seed = config.world1.vocabularySeed as any;
    expect(seed['W1-Mono']['L1']['yellow-like'][0].lexeme).toBe(DEFAULT_L1_YELLOW);
    expect(seed['W1-Mono']['L1']['yellow-like'][0].initialWeight).toBe(1.0);
    expect(seed['W1-Mono']['L1']['red-like'][0].lexeme).toBe(DEFAULT_L1_RED);
    expect(seed['W1-Mono']['L1']['red-like'][0].initialWeight).toBe(1.0);

    // W1-Bi should have L2 terms as well
    expect(seed['W1-Bi']['L2']['yellow-like'][0].lexeme).toBe(DEFAULT_L2_YELLOW);
    expect(seed['W1-Bi']['L2']['red-like'][0].lexeme).toBe(DEFAULT_L2_RED);
  });

  it('tickCount: 0 fails validation with error path [tickCount]', () => {
    const result = ExperimentConfig.safeParse({ tickCount: 0 });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = result.error.issues.map((i) => i.path);
    expect(paths.some((p) => p.includes('tickCount'))).toBe(true);
  });

  it('deltaPositive: -1 fails validation', () => {
    const result = ExperimentConfig.safeParse({ deltaPositive: -1 });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = result.error.issues.map((i) => i.path);
    expect(paths.some((p) => p.includes('deltaPositive'))).toBe(true);
  });

  it('agentCount: 0 in world1 fails validation', () => {
    const result = ExperimentConfig.safeParse({ world1: { agentCount: 0 } });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = result.error.issues.map((i) => i.path);
    expect(paths.some((p) => p.includes('agentCount'))).toBe(true);
  });

  it('agentCount: 0 in world2 fails validation', () => {
    const result = ExperimentConfig.safeParse({ world2: { agentCount: 0 } });
    expect(result.success).toBe(false);
  });

  it('monolingualBilingualRatio: 0 fails validation', () => {
    const result = ExperimentConfig.safeParse({
      world1: { monolingualBilingualRatio: 0 },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = result.error.issues.map((i) => i.path);
    expect(paths.some((p) => p.includes('monolingualBilingualRatio'))).toBe(true);
  });
});

describe('TopologyConfig discriminated union', () => {
  it('lattice variant parses and narrows correctly', () => {
    const result = TopologyConfig.safeParse({
      type: 'lattice',
      width: 30,
      height: 30,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    // TypeScript narrowing check
    const parsed = result.data;
    if (parsed.type === 'lattice') {
      // width is accessible on the narrowed type
      expect(parsed.width).toBe(30);
      expect(parsed.height).toBe(30);
      expect(parsed.neighborhood).toBe('moore'); // default applied
    } else {
      throw new Error('Expected lattice variant');
    }
  });

  it('well-mixed variant parses and has no width field', () => {
    const result = TopologyConfig.safeParse({ type: 'well-mixed' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const parsed = result.data;
    expect(parsed.type).toBe('well-mixed');
    // 'width' should not exist on well-mixed
    expect('width' in parsed).toBe(false);
  });

  it('lattice with negative width fails', () => {
    const result = TopologyConfig.safeParse({
      type: 'lattice',
      width: -1,
      height: 10,
    });
    expect(result.success).toBe(false);
  });

  it('network topology placeholder shape parses', () => {
    const result = TopologyConfig.safeParse({
      type: 'network',
      kind: 'small-world',
      parameters: { k: 4 },
    });
    expect(result.success).toBe(true);
  });

  it('network topology with invalid kind fails', () => {
    const result = TopologyConfig.safeParse({
      type: 'network',
      kind: 'not-a-kind',
    });
    expect(result.success).toBe(false);
  });
});

describe('JSON roundtrip', () => {
  it('serialize → deserialize → parse is identity', () => {
    const original = ExperimentConfig.parse({
      seed: 42,
      tickCount: 1000,
      world1: { topology: { type: 'well-mixed' } },
      world2: { topology: { type: 'well-mixed' } },
    });
    const json = JSON.stringify(original);
    const reparsed = ExperimentConfig.parse(JSON.parse(json));
    // Deep equality confirms no functions, Maps, or Sets leaked in
    expect(reparsed).toEqual(original);
  });
});

describe('Language policy matrix', () => {
  it('defaultLanguagePolicies covers all 4×4 (speakerClass, hearerClass) pairs', () => {
    const classes = AgentClass.options;
    const ruleIds = new Set(LanguagePolicyRuleId.options);

    for (const speaker of classes) {
      for (const hearer of classes) {
        const entry = defaultLanguagePolicies.find(
          (e) => e.speakerClass === speaker && e.hearerClass === hearer,
        );
        expect(entry, `Missing policy for ${speaker} → ${hearer}`).toBeDefined();
        expect(
          ruleIds.has(entry!.ruleId as z.infer<typeof LanguagePolicyRuleId>),
          `Invalid ruleId ${entry?.ruleId} for ${speaker} → ${hearer}`,
        ).toBe(true);
      }
    }
  });
});

describe('BatchConfig', () => {
  it('BatchConfig.parse({ experiment: {} }) produces a runnable batch', () => {
    const result = BatchConfig.safeParse({ experiment: {} });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const batch = result.data;
    expect(batch.replicateCount).toBeGreaterThan(0);
    expect(batch.concurrency).toBeGreaterThan(0);
    expect(batch.experiment.tickCount).toBeGreaterThan(0);
  });
});

describe('SweepConfig', () => {
  it('SweepConfig with baseExperiment:{} and axes succeeds and preserves values order', () => {
    const values = [0.5, 1.0, 1.5, 2.0];
    const result = SweepConfig.safeParse({
      baseExperiment: {},
      axes: [
        {
          paramPath: 'world1.monolingualBilingualRatio',
          values,
        },
      ],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.axes[0]?.values).toEqual(values);
  });
});

describe('TypeScript inferred type compatibility', () => {
  it('ExperimentConfig output is assignable to ExperimentConfig type', () => {
    const config = ExperimentConfig.parse({});
    // This is both a compile-time and runtime check
    const _: z.infer<typeof ExperimentConfig> = config;
    expect(_).toBeDefined();
  });
});
