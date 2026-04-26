'use client';

// app/(auth)/playground/controls-panel.tsx — F10 interactive controls for the live playground.
//
// Stateless aside from its own draft values for debounced sliders and the seed input.
// The simulation shell (simulation-shell.tsx) is the authoritative owner of tick, seed,
// config, and isRunning state; the controls panel reads those via props and propagates
// changes back via callback props.
//
// Debounce pattern: each slider keeps a draft state (updated instantly on drag) plus a
// useEffect that schedules a 300ms setTimeout. The cleanup clears the timer on every
// re-render, so rapid drags only fire the side effect once after the drag stabilizes.
// useDeferredValue is NOT used here — React docs confirm it defers rendering only, not
// side effects like postMessage; see CLAUDE.md "Known gotchas".

import { useState, useEffect, useCallback } from 'react';

import type { ExperimentConfig } from '@/lib/schema/experiment';
import { HelpTip } from '../components/help-tip';

const DEBOUNCE_MS = 300;

export interface ControlsPanelProps {
  tick: number;
  isRunning: boolean;
  ready: boolean;
  seed: number;
  config: ExperimentConfig;
  configHashShort: string;
  tickRate: 1 | 10 | 100 | 1000;
  onPlay: () => void;
  onPause: () => void;
  onStep: () => void;
  onReset: () => void;
  onSeedChange: (newSeed: number) => void;
  onTickRateChange: (rate: 1 | 10 | 100 | 1000) => void;
  /** Called for live-safe parameter changes (deltaPositive, deltaNegative, interactionProbability, preferentialAttachment). */
  onConfigUpdate: (partial: Partial<ExperimentConfig>) => void;
  /** Called for reset-required parameter changes (monolingualBilingualRatio). */
  onRebootstrap: (partial: Partial<ExperimentConfig>) => void;
}

export function ControlsPanel({
  tick,
  isRunning,
  ready,
  seed,
  config,
  configHashShort,
  tickRate,
  onPlay,
  onPause,
  onStep,
  onReset,
  onSeedChange,
  onTickRateChange,
  onConfigUpdate,
  onRebootstrap,
}: ControlsPanelProps) {
  // ─── Seed input state ───────────────────────────────────────────────────────
  const [seedDraft, setSeedDraft] = useState(String(seed));
  const [seedError, setSeedError] = useState<string | null>(null);

  // Sync seedDraft when the authoritative seed changes (e.g. after a reset).
  useEffect(() => {
    setSeedDraft(String(seed));
    setSeedError(null);
  }, [seed]);

  const handleReseed = useCallback(() => {
    const parsed = Number(seedDraft);
    if (!Number.isInteger(parsed) || parsed < 0) {
      setSeedError('Seed must be a non-negative integer. 0 is valid.');
      return;
    }
    setSeedError(null);
    onSeedChange(parsed);
  }, [seedDraft, onSeedChange]);

  // ─── Slider draft states ────────────────────────────────────────────────────
  // Each slider keeps a draft value so dragging is instant.
  // The useEffect below each slider fires the debounced side effect.

  const [deltaPlusDraft, setDeltaPlusDraft] = useState(config.deltaPositive);
  const [deltaMinusDraft, setDeltaMinusDraft] = useState(config.deltaNegative);
  const [interactionProbDraft, setInteractionProbDraft] = useState(config.interactionProbability);
  const [ratioDraft, setRatioDraft] = useState(config.world1.monolingualBilingualRatio);
  const [prefTempDraft, setPrefTempDraft] = useState(config.preferentialAttachment.temperature);
  // Step 33/34 live-safe knobs. Defaults read from config when present; otherwise neutral.
  const gaussianSigmaInitial =
    config.successPolicy.kind === 'gaussian' ? config.successPolicy.sigma : 1.0;
  const [gaussianSigmaDraft, setGaussianSigmaDraft] = useState(gaussianSigmaInitial);
  const [attractThresholdDraft, setAttractThresholdDraft] = useState(
    config.movement.attractThreshold,
  );

  // Sync drafts when config changes from above (e.g. after rebootstrap).
  useEffect(() => {
    setDeltaPlusDraft(config.deltaPositive);
  }, [config.deltaPositive]);
  useEffect(() => {
    setDeltaMinusDraft(config.deltaNegative);
  }, [config.deltaNegative]);
  useEffect(() => {
    setInteractionProbDraft(config.interactionProbability);
  }, [config.interactionProbability]);
  useEffect(() => {
    setRatioDraft(config.world1.monolingualBilingualRatio);
  }, [config.world1.monolingualBilingualRatio]);
  useEffect(() => {
    setPrefTempDraft(config.preferentialAttachment.temperature);
  }, [config.preferentialAttachment.temperature]);
  useEffect(() => {
    if (config.successPolicy.kind === 'gaussian') {
      setGaussianSigmaDraft(config.successPolicy.sigma);
    }
  }, [config.successPolicy]);
  useEffect(() => {
    setAttractThresholdDraft(config.movement.attractThreshold);
  }, [config.movement.attractThreshold]);

  // ─── Debounced slider effects ───────────────────────────────────────────────
  // Live-safe: deltaPositive, deltaNegative, interactionProbability, prefAttach temperature.
  // Reset-required: monolingualBilingualRatio (changes initial conditions).

  useEffect(() => {
    const timer = setTimeout(() => {
      onConfigUpdate({ deltaPositive: deltaPlusDraft });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [deltaPlusDraft, onConfigUpdate]);

  useEffect(() => {
    const timer = setTimeout(() => {
      onConfigUpdate({ deltaNegative: deltaMinusDraft });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [deltaMinusDraft, onConfigUpdate]);

  useEffect(() => {
    const timer = setTimeout(() => {
      onConfigUpdate({ interactionProbability: interactionProbDraft });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [interactionProbDraft, onConfigUpdate]);

  useEffect(() => {
    const timer = setTimeout(() => {
      onRebootstrap({
        world1: { ...config.world1, monolingualBilingualRatio: ratioDraft },
        world2: { ...config.world2, monolingualBilingualRatio: ratioDraft },
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ratioDraft]);

  useEffect(() => {
    const timer = setTimeout(() => {
      onConfigUpdate({
        preferentialAttachment: { ...config.preferentialAttachment, temperature: prefTempDraft },
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [prefTempDraft, onConfigUpdate, config.preferentialAttachment]);

  // Gaussian σ — live-safe; only meaningful when kind === 'gaussian'.
  // The conditional render below means the slider isn't visible (and so the draft
  // can't change) while kind is 'deterministic', so this effect is inert in that case.
  useEffect(() => {
    const policy = config.successPolicy;
    if (policy.kind !== 'gaussian') return;
    const timer = setTimeout(() => {
      onConfigUpdate({
        successPolicy: {
          kind: 'gaussian',
          sigma: gaussianSigmaDraft,
          gaussianTopK: policy.gaussianTopK,
        },
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [gaussianSigmaDraft, onConfigUpdate, config.successPolicy]);

  // Migration attract threshold — live-safe; gated on movement.enabled below.
  useEffect(() => {
    if (!config.movement.enabled) return;
    const timer = setTimeout(() => {
      onConfigUpdate({
        movement: { ...config.movement, attractThreshold: attractThresholdDraft },
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [attractThresholdDraft, onConfigUpdate, config.movement]);

  // ─── JSX ────────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-slate-700 bg-slate-800/50 p-4">
      {/* Transport row */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          data-testid="play-pause-button"
          onClick={isRunning ? onPause : onPlay}
          disabled={!ready}
          className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40"
        >
          {isRunning ? 'Pause' : 'Play'}
        </button>
        <button
          data-testid="step-button"
          onClick={onStep}
          disabled={isRunning || !ready}
          className="rounded bg-slate-700 px-4 py-1.5 text-sm font-medium text-gray-200 hover:bg-slate-600 disabled:opacity-40"
        >
          Step
        </button>
        <button
          data-testid="reset-button"
          onClick={onReset}
          disabled={!ready}
          className="rounded bg-slate-700 px-4 py-1.5 text-sm font-medium text-gray-200 hover:bg-slate-600 disabled:opacity-40"
        >
          Reset
        </button>
        <span data-testid="tick-counter" className="ml-2 text-sm text-gray-200">
          Tick: {tick}
        </span>
      </div>

      {/* Tick-rate row */}
      <div className="flex items-center gap-2">
        <label htmlFor="tick-rate-select" className="text-sm text-gray-200">
          Speed:
          <HelpTip helpKey="playground.tickRate" variant="dark" />
        </label>
        <select
          id="tick-rate-select"
          data-testid="tick-rate-select"
          value={tickRate}
          onChange={(e) => onTickRateChange(Number(e.target.value) as 1 | 10 | 100 | 1000)}
          className="rounded border border-slate-600 bg-slate-700 px-2 py-1 text-sm text-gray-200"
        >
          <option value={1}>1×</option>
          <option value={10}>10×</option>
          <option value={100}>100×</option>
          <option value={1000}>1000×</option>
        </select>
        <span className="text-xs text-gray-400">ticks/frame</span>
      </div>

      {/* Seed row + reproducibility banner */}
      <div className="flex flex-wrap items-start gap-2">
        <div className="flex items-center gap-2">
          <label htmlFor="seed-input" className="text-sm text-gray-200">
            Seed:
            <HelpTip helpKey="playground.seed" variant="dark" />
          </label>
          <input
            id="seed-input"
            data-testid="seed-input"
            type="number"
            min={0}
            step={1}
            value={seedDraft}
            onChange={(e) => {
              setSeedDraft(e.target.value);
              setSeedError(null);
            }}
            className="w-24 rounded border border-slate-600 bg-slate-700 px-2 py-1 text-sm text-gray-200"
          />
          <button
            data-testid="reseed-button"
            onClick={handleReseed}
            disabled={!ready}
            className="rounded bg-slate-700 px-3 py-1 text-sm text-gray-200 hover:bg-slate-600 disabled:opacity-40"
          >
            Reseed &amp; Reset
          </button>
        </div>
        <div
          data-testid="config-hash-display"
          className="rounded bg-slate-900 px-2 py-1 font-mono text-xs text-gray-300"
        >
          seed={seed} config={configHashShort}
        </div>
      </div>
      {seedError && <p className="text-xs text-red-400">{seedError}</p>}

      {/* Sliders */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {/* Δ⁺ (deltaPositive) — live */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <label className="text-xs text-gray-200">
              Δ⁺ (weight on success)
              <HelpTip helpKey="playground.deltaPositive" variant="dark" />
            </label>
            <span data-testid="delta-plus-value" className="text-xs font-mono text-gray-300">
              {deltaPlusDraft.toFixed(2)}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={5}
            step={0.01}
            value={deltaPlusDraft}
            onChange={(e) => setDeltaPlusDraft(Number(e.target.value))}
            className="w-full accent-blue-500"
          />
        </div>

        {/* Δ⁻ (deltaNegative) — live */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <label className="text-xs text-gray-200">
              Δ⁻ (weight on failure)
              <HelpTip helpKey="playground.deltaNegative" variant="dark" />
            </label>
            <span data-testid="delta-minus-value" className="text-xs font-mono text-gray-300">
              {deltaMinusDraft.toFixed(2)}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={5}
            step={0.01}
            value={deltaMinusDraft}
            onChange={(e) => setDeltaMinusDraft(Number(e.target.value))}
            className="w-full accent-blue-500"
          />
        </div>

        {/* Interaction probability — live */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <label className="text-xs text-gray-200">
              Interaction probability
              <HelpTip helpKey="playground.interactionProbability" variant="dark" />
            </label>
            <span
              data-testid="interaction-probability-value"
              className="text-xs font-mono text-gray-300"
            >
              {interactionProbDraft.toFixed(2)}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={interactionProbDraft}
            onChange={(e) => setInteractionProbDraft(Number(e.target.value))}
            className="w-full accent-blue-500"
          />
        </div>

        {/* Pref. attachment temperature — live */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <label className="text-xs text-gray-200">
              Pref. attachment temp.
              <HelpTip helpKey="playground.prefAttachTemp" variant="dark" />
            </label>
            <span data-testid="prefattach-temp-value" className="text-xs font-mono text-gray-300">
              {prefTempDraft.toFixed(2)}
            </span>
          </div>
          <input
            type="range"
            min={0.01}
            max={10}
            step={0.01}
            value={prefTempDraft}
            onChange={(e) => setPrefTempDraft(Number(e.target.value))}
            className="w-full accent-blue-500"
          />
        </div>

        {/* Gaussian σ — live; rendered only when successPolicy.kind === 'gaussian' */}
        {config.successPolicy.kind === 'gaussian' && (
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <label className="text-xs text-gray-200">
                Gaussian σ
                <HelpTip helpKey="playground.gaussianSigma" variant="dark" />
              </label>
              <span data-testid="gaussian-sigma-value" className="text-xs font-mono text-gray-300">
                {gaussianSigmaDraft.toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              min={0.01}
              max={5}
              step={0.01}
              value={gaussianSigmaDraft}
              onChange={(e) => setGaussianSigmaDraft(Number(e.target.value))}
              className="w-full accent-blue-500"
              data-testid="gaussian-sigma-slider"
            />
          </div>
        )}

        {/* Migration attract threshold — live; rendered only when movement.enabled */}
        {config.movement.enabled && (
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <label className="text-xs text-gray-200">
                Attract threshold
                <HelpTip helpKey="playground.attractThreshold" variant="dark" />
              </label>
              <span
                data-testid="attract-threshold-value"
                className="text-xs font-mono text-gray-300"
              >
                {attractThresholdDraft.toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={attractThresholdDraft}
              onChange={(e) => setAttractThresholdDraft(Number(e.target.value))}
              className="w-full accent-blue-500"
              data-testid="attract-threshold-slider"
            />
          </div>
        )}

        {/* Mono/bi ratio — reset-required */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <label className="text-xs text-gray-200">
              Mono:Bi ratio{' '}
              <span className="text-yellow-500" title="Changing this will reset the run">
                ↺
              </span>
              <HelpTip helpKey="playground.monoBiRatio" variant="dark" />
            </label>
            <span data-testid="ratio-value" className="text-xs font-mono text-gray-300">
              {ratioDraft.toFixed(2)}
            </span>
          </div>
          <input
            type="range"
            min={0.1}
            max={10}
            step={0.05}
            value={ratioDraft}
            onChange={(e) => setRatioDraft(Number(e.target.value))}
            className="w-full accent-yellow-500"
          />
          <p className="text-xs text-yellow-400">Changing this will reset the run</p>
        </div>
      </div>
    </div>
  );
}
