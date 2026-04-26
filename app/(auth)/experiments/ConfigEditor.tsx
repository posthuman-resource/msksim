'use client';

import { useState, useEffect, useActionState, startTransition } from 'react';
import { useForm, Controller, useFieldArray } from 'react-hook-form';
import type { UseFormReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from 'next/link';

import { ExperimentConfig } from '@/lib/schema/experiment';
import type { ExperimentConfig as ExperimentConfigType } from '@/lib/schema/experiment';
import { saveConfigAction, deleteConfigAction, duplicateConfigAction } from './actions';
import type { SaveState } from './actions';
import { HelpTip } from '../components/help-tip';

// Extend schema to include the name field (sibling column, not in ExperimentConfig)
const FormSchema = ExperimentConfig.extend({ name: z.string().min(1, 'Name is required') });
type FormValues = z.infer<typeof FormSchema>;

// Rule IDs that allow optional languageBias editing
const CONFIGURABLE_RULES = new Set([
  'w1bi-to-w1bi-configurable',
  'w2imm-to-w2native-both',
  'w2imm-to-w2imm-both',
]);

interface ConfigEditorProps {
  mode: 'new' | 'edit';
  configId?: string;
  initialName?: string;
  initialValues: ExperimentConfigType;
}

export function ConfigEditor({
  mode,
  configId,
  initialName = '',
  initialValues,
}: ConfigEditorProps) {
  const [state, formAction, isPending] = useActionState<SaveState, FormData>(saveConfigAction, {
    ok: false,
    fieldErrors: {},
  });

  // zodResolver returns Resolver<z.input<Schema>> but useForm<FormValues> needs Resolver<FormValues>.
  // In Zod 4 the input type (with .default() fields optional) differs from the output type
  // (fully-resolved required fields). The cast is safe: zodResolver validates and transforms
  // the form state to FormValues before invoking handleSubmit callbacks.
  const form = useForm<FormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(FormSchema) as any,
    defaultValues: { ...initialValues, name: initialName },
    mode: 'onBlur',
  });

  const { fields: policyFields } = useFieldArray({
    control: form.control,
    name: 'languagePolicies',
  });

  // Watch topology type for conditional rendering
  // RHF watch drives conditional field render — see CLAUDE.md 'Known gotchas'
  const topology1 = form.watch('world1.topology.type');
  const topology2 = form.watch('world2.topology.type');

  const [importError, setImportError] = useState<string | null>(null);

  // Local string state for JSON textarea fields (parse on blur)
  const [vocabSeed1, setVocabSeed1] = useState(() =>
    JSON.stringify(initialValues.world1.vocabularySeed, null, 2),
  );
  const [vocabSeed2, setVocabSeed2] = useState(() =>
    JSON.stringify(initialValues.world2.vocabularySeed, null, 2),
  );
  const [referents1, setReferents1] = useState(() => initialValues.world1.referents.join(', '));
  const [referents2, setReferents2] = useState(() => initialValues.world2.referents.join(', '));

  // Surface server-side errors inline in the same slots as client-side errors
  useEffect(() => {
    if (!state.ok && state.fieldErrors) {
      for (const [path, messages] of Object.entries(state.fieldErrors)) {
        if (messages.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          form.setError(path as any, { type: 'server', message: messages[0] });
        }
      }
    }
  }, [state, form]);

  const onValidSubmit = (data: FormValues) => {
    const { name, ...config } = data;
    const fd = new FormData();
    fd.set('name', name);
    fd.set('payload', JSON.stringify(config));
    if (mode === 'edit' && configId) fd.set('id', configId);
    startTransition(() => formAction(fd));
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const json = JSON.parse(text) as unknown;
      const parsed = ExperimentConfig.parse(json);
      const currentName = form.getValues('name');
      form.reset({ ...parsed, name: currentName });
      setVocabSeed1(JSON.stringify(parsed.world1.vocabularySeed, null, 2));
      setVocabSeed2(JSON.stringify(parsed.world2.vocabularySeed, null, 2));
      setReferents1(parsed.world1.referents.join(', '));
      setReferents2(parsed.world2.referents.join(', '));
      setImportError(null);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Invalid JSON file');
    }
    // Reset the file input so the same file can be re-imported after a fix
    e.target.value = '';
  };

  const errors = form.formState.errors;

  return (
    <>
      {/* Edit-mode destructive actions live outside the main editor <form>:
          <form> cannot be a descendant of <form> per HTML spec, and React 19
          treats it as a hydration error. The Duplicate/Delete Server Action
          forms are siblings, not children, of the editor form. */}
      {mode === 'edit' && configId && (
        <div className="mb-6 flex gap-2 border-b border-border pb-4">
          <form action={duplicateConfigAction.bind(null, configId)}>
            <button
              type="submit"
              className="inline-flex items-center rounded-md border border-border-strong bg-surface px-3 py-1.5 text-sm font-medium text-fg hover:bg-surface-muted"
            >
              Duplicate
            </button>
          </form>
          <form
            action={deleteConfigAction.bind(null, configId)}
            onSubmit={(e) => {
              if (!confirm('Delete this configuration? This also deletes any runs it owns.')) {
                e.preventDefault();
              }
            }}
          >
            <button
              type="submit"
              className="inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium text-danger hover:bg-danger-bg"
            >
              Delete
            </button>
          </form>
        </div>
      )}

      <form onSubmit={form.handleSubmit(onValidSubmit)} className="space-y-6">
        {/* Config name */}
        <div>
          <label htmlFor="config-name" className="block text-sm font-medium text-fg">
            Configuration name <span className="text-danger">*</span>
            <HelpTip helpKey="config.name" />
          </label>
          <input
            id="config-name"
            type="text"
            {...form.register('name')}
            className="mt-1 block w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none"
            placeholder="e.g., Baseline 20×20 Lattice"
          />
          {errors.name && <p className="mt-1 text-xs text-danger">{errors.name.message}</p>}
        </div>

        {/* World configs */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <WorldSection
            prefix="world1"
            label="World 1"
            form={form}
            topology={topology1}
            vocabSeedRaw={vocabSeed1}
            onVocabSeedChange={setVocabSeed1}
            referentsRaw={referents1}
            onReferentsChange={setReferents1}
          />
          <WorldSection
            prefix="world2"
            label="World 2"
            form={form}
            topology={topology2}
            vocabSeedRaw={vocabSeed2}
            onVocabSeedChange={setVocabSeed2}
            referentsRaw={referents2}
            onReferentsChange={setReferents2}
          />
        </div>

        {/* Interaction engine */}
        <details className="rounded-md border border-border bg-surface">
          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-fg hover:bg-surface-muted">
            Interaction engine <HelpTip helpKey="config.tickCount" />
          </summary>
          <div className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-3">
            <NumberField
              label="Tick count"
              path="tickCount"
              form={form}
              min={1}
              step={1}
              helpKey="config.tickCount"
            />
            <NumberField
              label="Seed (0 is valid)"
              path="seed"
              form={form}
              step={1}
              helpKey="config.seed"
            />
            <NumberField
              label="Δ⁺ success increment"
              path="deltaPositive"
              form={form}
              min={0}
              step={0.01}
              helpKey="config.deltaPositive"
            />
            <NumberField
              label="Δ⁻ failure penalty (0 = minimal Naming Game)"
              path="deltaNegative"
              form={form}
              min={0}
              step={0.01}
              helpKey="config.deltaNegative"
            />
            <NumberField
              label="Retry limit"
              path="retryLimit"
              form={form}
              min={0}
              step={1}
              helpKey="config.retryLimit"
            />
            <NumberField
              label="Interaction probability"
              path="interactionProbability"
              form={form}
              min={0}
              max={1}
              step={0.01}
              helpKey="config.interactionProbability"
            />
            <NumberField
              label="Snapshot sampling interval"
              path="sampleInterval"
              form={form}
              min={1}
              step={1}
              helpKey="config.sampleInterval"
            />
            <NumberField
              label="Interaction memory size"
              path="interactionMemorySize"
              form={form}
              min={1}
              step={1}
              helpKey="config.interactionMemorySize"
            />
            <div>
              <label className="block text-xs font-medium text-zinc-600">
                Weight update rule
                <HelpTip helpKey="config.weightUpdateRule" />
              </label>
              <select
                {...form.register('weightUpdateRule')}
                className="mt-1 block w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
              >
                <option value="additive">Additive</option>
                <option value="l1-normalized">L1 normalized</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600">
                Scheduler mode
                <HelpTip helpKey="config.schedulerMode" />
              </label>
              <select
                {...form.register('schedulerMode')}
                className="mt-1 block w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
              >
                <option value="sequential">Sequential</option>
                <option value="random">Random</option>
                <option value="priority">Priority</option>
              </select>
            </div>
          </div>
        </details>

        {/* Classification thresholds */}
        <details className="rounded-md border border-border bg-surface">
          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-fg hover:bg-surface-muted">
            Classification thresholds (α / β / γ / δ){' '}
            <HelpTip helpKey="config.classificationThresholds" />
          </summary>
          <div className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
            <NumberField
              label="α assimilation high"
              path="classificationThresholds.assimilationHigh"
              form={form}
              min={0}
              max={1}
              step={0.01}
              helpKey="config.classificationThresholds.assimilationHigh"
            />
            <NumberField
              label="β segregation low"
              path="classificationThresholds.segregationLow"
              form={form}
              min={0}
              max={1}
              step={0.01}
              helpKey="config.classificationThresholds.segregationLow"
            />
            <NumberField
              label="γ assimilation low"
              path="classificationThresholds.assimilationLow"
              form={form}
              min={0}
              max={1}
              step={0.01}
              helpKey="config.classificationThresholds.assimilationLow"
            />
            <NumberField
              label="δ segregation high"
              path="classificationThresholds.segregationHigh"
              form={form}
              min={0}
              max={1}
              helpKey="config.classificationThresholds.segregationHigh"
              step={0.01}
            />
          </div>
        </details>

        {/* Convergence */}
        <details className="rounded-md border border-border bg-surface">
          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-fg hover:bg-surface-muted">
            Convergence detection <HelpTip helpKey="config.convergence.consensusWindowTicks" />
          </summary>
          <div className="p-4">
            <NumberField
              label="Consensus window (ticks)"
              path="convergence.consensusWindowTicks"
              form={form}
              min={1}
              step={1}
              helpKey="config.convergence.consensusWindowTicks"
            />
          </div>
        </details>

        {/* Language policies */}
        <details className="rounded-md border border-border bg-surface">
          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-fg hover:bg-surface-muted">
            Language policies ({policyFields.length} rules){' '}
            <HelpTip helpKey="config.languagePolicies" />
          </summary>
          <div className="overflow-x-auto p-4">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-zinc-500">
                  <th className="pb-2 pr-3 font-medium">Speaker</th>
                  <th className="pb-2 pr-3 font-medium">Hearer</th>
                  <th className="pb-2 pr-3 font-medium">Rule</th>
                  <th className="pb-2 pr-3 font-medium">Bias L1</th>
                  <th className="pb-2 font-medium">Bias L2</th>
                </tr>
              </thead>
              <tbody>
                {policyFields.map((field, index) => (
                  <tr key={field.id} className="border-b border-zinc-100">
                    <td className="py-1.5 pr-3 font-mono text-zinc-700">{field.speakerClass}</td>
                    <td className="py-1.5 pr-3 font-mono text-zinc-700">{field.hearerClass}</td>
                    <td className="py-1.5 pr-3 text-zinc-500">{field.ruleId}</td>
                    <td className="py-1.5 pr-3">
                      {CONFIGURABLE_RULES.has(field.ruleId) ? (
                        <input
                          type="number"
                          step={0.01}
                          min={0}
                          {...form.register(`languagePolicies.${index}.languageBias.L1`, {
                            valueAsNumber: true,
                          })}
                          className="w-16 rounded border border-zinc-300 px-1 py-0.5 text-xs"
                          placeholder="0.5"
                        />
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}
                    </td>
                    <td className="py-1.5">
                      {CONFIGURABLE_RULES.has(field.ruleId) ? (
                        <input
                          type="number"
                          step={0.01}
                          min={0}
                          {...form.register(`languagePolicies.${index}.languageBias.L2`, {
                            valueAsNumber: true,
                          })}
                          className="w-16 rounded border border-zinc-300 px-1 py-0.5 text-xs"
                          placeholder="0.5"
                        />
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>

        {/* Gaussian success policy */}
        <details className="rounded-md border border-border bg-surface">
          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-fg hover:bg-surface-muted">
            Gaussian success policy <HelpTip helpKey="config.successPolicy.kind" />
          </summary>
          <div className="space-y-4 p-4">
            <div>
              <label className="block text-xs font-medium text-zinc-600">
                Success rule kind
                <HelpTip helpKey="config.successPolicy.kind" />
              </label>
              <select
                {...form.register('successPolicy.kind', {
                  onChange: (e) => {
                    if (e.target.value === 'gaussian') {
                      // Discriminated-union seed: deterministic mode strips sigma/topK
                      // when Zod-parsed, so they may be absent on switch-to-gaussian.
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      const sp = form.getValues('successPolicy' as any) as
                        | { sigma?: number; gaussianTopK?: number }
                        | undefined;
                      if (sp?.sigma === undefined) {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        form.setValue('successPolicy.sigma' as any, 1.0);
                      }
                      if (sp?.gaussianTopK === undefined) {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        form.setValue('successPolicy.gaussianTopK' as any, 10);
                      }
                    }
                  },
                })}
                className="mt-1 block w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
              >
                <option value="deterministic">Deterministic (canonical Naming Game)</option>
                <option value="gaussian">Gaussian (probabilistic)</option>
              </select>
            </div>
            {form.watch('successPolicy.kind') === 'gaussian' && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <NumberField
                  label="σ (kernel width)"
                  path="successPolicy.sigma"
                  form={form}
                  min={0.01}
                  step={0.01}
                  helpKey="config.successPolicy.sigma"
                />
                <NumberField
                  label="Top-K tokens for distance"
                  path="successPolicy.gaussianTopK"
                  form={form}
                  min={1}
                  step={1}
                  helpKey="config.successPolicy.gaussianTopK"
                />
              </div>
            )}
          </div>
        </details>

        {/* Linguistic migration */}
        <details className="rounded-md border border-border bg-surface">
          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-fg hover:bg-surface-muted">
            Linguistic migration <HelpTip helpKey="config.movement.enabled" />
          </summary>
          <div className="space-y-4 p-4">
            <label className="flex items-center gap-2 text-sm text-zinc-700">
              <input
                type="checkbox"
                {...form.register('movement.enabled')}
                className="h-4 w-4 rounded border-zinc-300"
              />
              Enabled (lattice topology only — no effect on well-mixed or network)
            </label>
            {form.watch('movement.enabled') && (
              <div className="space-y-4">
                <NumberField
                  label="Attract threshold (cosine similarity)"
                  path="movement.attractThreshold"
                  form={form}
                  min={0}
                  max={1}
                  step={0.01}
                  helpKey="config.movement.attractThreshold"
                />
                <div className="grid grid-cols-2 gap-4">
                  <NumberField
                    label="Attract step (cells)"
                    path="movement.attractStep"
                    form={form}
                    min={0}
                    step={1}
                    helpKey="config.movement.attractStep"
                  />
                  <NumberField
                    label="Repel step (cells)"
                    path="movement.repelStep"
                    form={form}
                    min={0}
                    step={1}
                    helpKey="config.movement.repelStep"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-600">
                    Collision policy
                    <HelpTip helpKey="config.movement.collisionPolicy" />
                  </label>
                  <select
                    {...form.register('movement.collisionPolicy')}
                    className="mt-1 block w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
                  >
                    <option value="swap">Swap (Schelling-style)</option>
                    <option value="skip">Skip (cancel move)</option>
                  </select>
                </div>
                <NumberField
                  label="Top-K tokens for similarity"
                  path="movement.topK"
                  form={form}
                  min={1}
                  step={1}
                  helpKey="config.movement.topK"
                />
              </div>
            )}
          </div>
        </details>

        {/* Preferential attachment */}
        <details className="rounded-md border border-border bg-surface">
          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-fg hover:bg-surface-muted">
            Preferential attachment <HelpTip helpKey="config.preferentialAttachment.enabled" />
          </summary>
          <div className="space-y-4 p-4">
            <label className="flex items-center gap-2 text-sm text-zinc-700">
              <input
                type="checkbox"
                {...form.register('preferentialAttachment.enabled')}
                className="h-4 w-4 rounded border-zinc-300"
              />
              Enabled (uncheck to ablate preferential attachment)
            </label>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <NumberField
                label="Warm-up ticks"
                path="preferentialAttachment.warmUpTicks"
                form={form}
                min={0}
                step={1}
                helpKey="config.preferentialAttachment.warmUpTicks"
              />
              <NumberField
                label="Temperature"
                path="preferentialAttachment.temperature"
                form={form}
                min={0}
                step={0.01}
                helpKey="config.preferentialAttachment.temperature"
              />
              <NumberField
                label="Top-K dimensions"
                path="preferentialAttachment.topK"
                form={form}
                min={1}
                step={1}
                helpKey="config.preferentialAttachment.topK"
              />
              <div>
                <label className="block text-xs font-medium text-zinc-600">
                  Similarity metric
                  <HelpTip helpKey="config.preferentialAttachment.similarityMetric" />
                </label>
                <select
                  {...form.register('preferentialAttachment.similarityMetric')}
                  className="mt-1 block w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
                >
                  <option value="cosine">Cosine</option>
                </select>
              </div>
            </div>
          </div>
        </details>

        {/* Import error feedback */}
        {importError && (
          <div className="rounded-md border border-red-200 bg-danger-bg p-3 text-sm text-danger">
            Import failed: {importError}
          </div>
        )}

        {/* Server-level error feedback */}
        {!state.ok && state.fieldErrors._root && (
          <div className="rounded-md border border-red-200 bg-danger-bg p-3 text-sm text-danger">
            {state.fieldErrors._root[0]}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <button
            type="submit"
            disabled={isPending}
            className="inline-flex items-center rounded-md bg-accent px-3.5 py-1.5 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {isPending ? 'Saving…' : 'Save'}
          </button>
          <Link
            href="/experiments"
            className="inline-flex items-center rounded-md border border-border-strong bg-surface px-3.5 py-1.5 text-sm font-medium text-fg hover:bg-surface-muted"
          >
            Cancel
          </Link>
          {mode === 'edit' && configId && (
            <Link
              href={`/api/configs/${configId}/export`}
              className="inline-flex items-center rounded-md border border-border-strong bg-surface px-3.5 py-1.5 text-sm font-medium text-fg hover:bg-surface-muted"
            >
              Export JSON
            </Link>
          )}
          <label className="inline-flex cursor-pointer items-center rounded-md border border-border-strong bg-surface px-3.5 py-1.5 text-sm font-medium text-fg hover:bg-surface-muted">
            Import JSON
            <input
              type="file"
              accept="application/json"
              onChange={handleImport}
              className="sr-only"
            />
          </label>
        </div>
      </form>
    </>
  );
}

// ---- WorldSection sub-component ----

interface WorldSectionProps {
  prefix: 'world1' | 'world2';
  label: string;
  form: UseFormReturn<FormValues>;
  topology: string | undefined;
  vocabSeedRaw: string;
  onVocabSeedChange: (v: string) => void;
  referentsRaw: string;
  onReferentsChange: (v: string) => void;
}

function WorldSection({
  prefix,
  label,
  form,
  topology,
  vocabSeedRaw,
  onVocabSeedChange,
  referentsRaw,
  onReferentsChange,
}: WorldSectionProps) {
  const errors = form.formState.errors;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const worldErrors = (errors as any)[prefix] as Record<string, { message?: string }> | undefined;

  const handleVocabBlur = () => {
    try {
      const parsed = JSON.parse(vocabSeedRaw) as unknown;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      form.setValue(`${prefix}.vocabularySeed` as any, parsed, { shouldValidate: true });
    } catch {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      form.setError(`${prefix}.vocabularySeed` as any, { message: 'Invalid JSON' });
    }
  };

  const handleReferentsBlur = () => {
    const parts = referentsRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    form.setValue(`${prefix}.referents` as any, parts as any, { shouldValidate: true });
  };

  const agentCountPath = `${prefix}.agentCount` as const;
  const topologyTypePath = `${prefix}.topology.type` as const;
  const topologyWidthPath = `${prefix}.topology.width` as const;
  const topologyHeightPath = `${prefix}.topology.height` as const;
  const topologyNeighborhoodPath = `${prefix}.topology.neighborhood` as const;
  const topologyKindPath = `${prefix}.topology.kind` as const;
  const ratioPath = `${prefix}.monolingualBilingualRatio` as const;

  return (
    <section className="rounded-md border border-border bg-surface p-4">
      <h2 className="mb-4 font-serif text-lg font-semibold text-fg">{label}</h2>
      <div className="space-y-4">
        {/* Agent count */}
        <div>
          <label className="block text-xs font-medium text-zinc-600">
            Agent count
            <HelpTip helpKey="config.world.agentCount" />
          </label>
          <input
            type="number"
            min={1}
            step={1}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            {...form.register(agentCountPath as any, { valueAsNumber: true })}
            className="mt-1 block w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
          />
          {worldErrors?.agentCount && (
            <p className="mt-0.5 text-xs text-danger">{worldErrors.agentCount.message}</p>
          )}
        </div>

        {/* Mono:Bi ratio */}
        <div>
          <label className="block text-xs font-medium text-zinc-600">
            Mono:Bi ratio (monolinguals per bilingual, default 1.5 = 3:2)
            <HelpTip helpKey="config.world.monolingualBilingualRatio" />
          </label>
          <Controller
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            name={ratioPath as any}
            control={form.control}
            render={({ field, fieldState }) => (
              <>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    type="range"
                    min={0.1}
                    max={5}
                    step={0.1}
                    value={field.value as number}
                    onChange={(e) => field.onChange(parseFloat(e.target.value))}
                    onBlur={field.onBlur}
                    list={`${prefix}-ratio-ticks`}
                    className="flex-1"
                  />
                  <input
                    type="number"
                    min={0.1}
                    max={5}
                    step={0.1}
                    value={field.value as number}
                    onChange={(e) => field.onChange(parseFloat(e.target.value))}
                    onBlur={field.onBlur}
                    className="w-16 rounded border border-zinc-300 px-2 py-1 text-xs"
                  />
                </div>
                <datalist id={`${prefix}-ratio-ticks`}>
                  <option value="0.5" />
                  <option value="1" />
                  <option value="1.5" />
                  <option value="2" />
                  <option value="3" />
                </datalist>
                {fieldState.error && (
                  <p className="mt-0.5 text-xs text-danger">{fieldState.error.message}</p>
                )}
              </>
            )}
          />
        </div>

        {/* Topology */}
        <div>
          <label className="block text-xs font-medium text-zinc-600">
            Topology
            <HelpTip helpKey="config.world.topology" />
          </label>
          <div className="mt-1 flex gap-4">
            {(['lattice', 'well-mixed', 'network'] as const).map((t) => (
              <label key={t} className="flex items-center gap-1 text-xs text-zinc-700">
                <input
                  type="radio"
                  value={t}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  {...form.register(topologyTypePath as any)}
                />
                {t}
              </label>
            ))}
          </div>

          {topology === 'lattice' && (
            <div className="mt-2 grid grid-cols-3 gap-2">
              <div>
                <label className="block text-xs text-zinc-500">Width</label>
                <input
                  type="number"
                  min={1}
                  step={1}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  {...form.register(topologyWidthPath as any, { valueAsNumber: true })}
                  className="mt-0.5 block w-full rounded border border-zinc-300 px-2 py-1 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-500">Height</label>
                <input
                  type="number"
                  min={1}
                  step={1}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  {...form.register(topologyHeightPath as any, { valueAsNumber: true })}
                  className="mt-0.5 block w-full rounded border border-zinc-300 px-2 py-1 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-500">Neighborhood</label>
                <select
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  {...form.register(topologyNeighborhoodPath as any)}
                  className="mt-0.5 block w-full rounded border border-zinc-300 px-1 py-1 text-xs"
                >
                  <option value="moore">Moore (8-cell)</option>
                  <option value="von-neumann">Von Neumann (4-cell)</option>
                </select>
              </div>
            </div>
          )}

          {topology === 'network' && (
            <div className="mt-2">
              <label className="block text-xs text-zinc-500">Network kind</label>
              <select
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                {...form.register(topologyKindPath as any)}
                className="mt-0.5 block w-full rounded border border-zinc-300 px-2 py-1 text-xs"
              >
                <option value="small-world">Small world</option>
                <option value="scale-free">Scale free</option>
                <option value="user-supplied">User supplied</option>
              </select>
            </div>
          )}
        </div>

        {/* Referents */}
        <div>
          <label className="block text-xs font-medium text-zinc-600">
            Referents (comma-separated)
            <HelpTip helpKey="config.world.referents" />
          </label>
          <input
            type="text"
            value={referentsRaw}
            onChange={(e) => onReferentsChange(e.target.value)}
            onBlur={handleReferentsBlur}
            className="mt-1 block w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
            placeholder="yellow-like, red-like"
          />
          {worldErrors?.referents && (
            <p className="mt-0.5 text-xs text-danger">{worldErrors.referents.message}</p>
          )}
        </div>

        {/* Vocabulary seed (JSON textarea) */}
        <div>
          <label className="block text-xs font-medium text-zinc-600">
            Vocabulary seed (JSON)
            <HelpTip helpKey="config.world.vocabularySeed" />
          </label>
          <p className="mt-0.5 text-xs text-zinc-400">
            AgentClass → Language → Referent → {'[{lexeme, initialWeight}]'}
          </p>
          <textarea
            value={vocabSeedRaw}
            onChange={(e) => onVocabSeedChange(e.target.value)}
            onBlur={handleVocabBlur}
            rows={6}
            className="mt-1 block w-full rounded border border-zinc-300 px-2 py-1.5 font-mono text-xs"
            spellCheck={false}
          />
          {(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const vocabErr = (worldErrors as any)?.vocabularySeed as
              | { message?: string }
              | undefined;
            return vocabErr ? (
              <p className="mt-0.5 text-xs text-danger">{vocabErr.message}</p>
            ) : null;
          })()}
        </div>
      </div>
    </section>
  );
}

// ---- NumberField sub-component ----

interface NumberFieldProps {
  label: string;
  path: string;
  form: UseFormReturn<FormValues>;
  min?: number;
  max?: number;
  step?: number;
  helpKey?: string;
}

function NumberField({ label, path, form, min, max, step, helpKey }: NumberFieldProps) {
  // Traverse the errors tree by dot-path to find the error for this field
  const error = path
    .split('.')
    .reduce(
      (obj: unknown, key: string) =>
        obj && typeof obj === 'object' ? (obj as Record<string, unknown>)[key] : undefined,
      form.formState.errors as unknown,
    ) as { message?: string } | undefined;

  return (
    <div>
      <label className="block text-xs font-medium text-zinc-600">
        {label}
        {helpKey && <HelpTip helpKey={helpKey} />}
      </label>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {...form.register(path as any, { valueAsNumber: true })}
        className="mt-1 block w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
      />
      {error?.message && <p className="mt-0.5 text-xs text-danger">{error.message}</p>}
    </div>
  );
}
