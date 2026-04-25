---
step: '35'
title: 'research extensions ui'
kind: ui
ui: true
timeout_minutes: 45
prerequisites:
  - 'step 22: metrics dashboard'
  - 'step 24: interactive controls'
  - 'step 25: experiment config ui'
  - 'step 33: gaussian success policy'
  - 'step 34: linguistic migration'
---

## 1. Goal

Surface the two new post-v1 research features (gaussian success policy from step 33, linguistic migration from step 34) in the user-facing application. Concretely, this step delivers: (1) two new collapsible `<details>` sections in the experiment config form (`app/(auth)/experiments/ConfigEditor.tsx`) — "Gaussian success" with kind dropdown + sigma + topK fields, and "Linguistic migration" with enabled toggle + threshold slider + step counts + collision policy; (2) two new live-adjustable sliders in the playground controls panel (`app/(auth)/playground/controls-panel.tsx`) for `gaussianSigma` and `attractThreshold` (debounced 300ms, same pattern as the existing `deltaPositive` slider); (3) a new spatial-homophily chart in the metrics dashboard (`app/(auth)/playground/metrics-dashboard.tsx`); (4) ~12 new help-text entries in `lib/help-text.ts` covering every new knob and the new chart; (5) two new sections in the guide page (`app/(auth)/guide/page.tsx`) explaining the conceptual model and offering use-case prompts; (6) a new "Recent additions" subsection in the README documenting the two features for first-time users; (7) one CLAUDE.md bullet about the live-safe-vs-reset-required seam for the new sliders; (8) two MCP-verified screenshots — one of the config editor with both new sections expanded, one of the playground showing the new chart populated. The research value of this step is that the engine extensions from steps 33 and 34 are useless to Meissa without UI surfaces — she does not edit JSON config files; she clicks toggles and drags sliders. This step is the bridge from "the engine supports it" to "Meissa can run experiments with it tomorrow." This is also the step where the conceptual model of each feature becomes legible to anyone using the app — the help text and guide sections are the operative documentation, in keeping with the project's principle that the README points at the spec but the running app explains itself in plain English. The single load-bearing invariant is **default-off behavior is preserved end-to-end**: opening the config editor on a v1 config produces a form where both new sections show their default-disabled values and no UI element is visually broken; saving and re-loading the config produces an unchanged JSON; running a simulation with movement and gaussian both disabled produces results identical to v1.

## 2. Prerequisites

- Commit marker `step 22: metrics dashboard` — exports the `MetricsDashboard` component, the `ChartConfig` type, and the `ChartPanel` Recharts wrapper. Step 35 adds one new `ChartConfig` entry for spatial homophily.
- Commit marker `step 24: interactive controls` — establishes the controls-panel pattern: live-adjustable sliders with 300ms debounce, separated from reset-required reinit fields. Step 35 adds two new live sliders following this exact pattern.
- Commit marker `step 25: experiment config ui` — establishes the `ConfigEditor` component, the react-hook-form + Zod resolver wiring, the `<details>`-based collapsible section pattern, and the `NumberField` / `HelpTip` components. Step 35 adds two new `<details>` sections following this exact pattern.
- Commit marker `step 33: gaussian success policy` — provides `SuccessPolicyConfig`, `SuccessPolicyKind`, `defaultSuccessPolicyConfig` from `lib/schema/success.ts`. Step 35 imports these and renders form fields against them.
- Commit marker `step 34: linguistic migration` — provides `MovementConfig`, `CollisionPolicy`, `defaultMovementConfig` from `lib/schema/movement.ts`, plus the `spatialHomophily: number` field on `PerWorldScalarMetrics`. Step 35 imports these and renders fields and the new chart.
- Node ≥ 20.9, Next.js 16, React 19, Tailwind 4, react-hook-form, @hookform/resolvers/zod, Recharts — all from earlier steps. No new deps.
- The existing user-seeding mechanism (`scripts/users.ts`) and the env vars `MSKSIM_BASE_URL`, `MSKSIM_SEED_USER`, `MSKSIM_SEED_PASS` (set by `run-plan.ts` per `CLAUDE.md` "UI verification harness") for the MCP harness.

## 3. Spec references

- `docs/Gaussian Communication Success and (1).pdf` — the user-facing semantics for the gaussian success policy and the migration rule. The help text and guide sections in this step are the _plain-English distillation_ of this PDF; together they should let a researcher who has not read the PDF understand what knob does what and why.
- `docs/spec.md` **F2 (UI shell, configuration editor)** — the spec wording for the configuration UI: "Form-based editor backed by Zod validation; live errors; per-section collapsible groups; import/export JSON." Step 35 extends the editor with two new collapsible groups; the validation, error-rendering, and import/export flows are unchanged (they read from the Zod schema, which now includes the two new fields automatically).
- `docs/spec.md` **F4 (Metrics dashboard)** — "Per-tick line charts for success rate, mean weight, modularity, etc." Step 35 adds spatial homophily to this list.
- `docs/spec.md` **§7.1 Per-tick observables** — gains one new entry: spatial homophily (mean cosine similarity of agent vs lattice neighbors). NaN for non-spatial topologies; documented in help text.
- `CLAUDE.md` "UI verification harness" — defines the MCP screenshot conventions, the Phase A–E enumeration pattern for the acceptance-criteria section, the console-error and network-status triage rules. Step 35 follows this conventions verbatim.

## 4. Research notes

**Local Next.js 16 docs:**

1. `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md` — confirms the `'use client'` directive rules. The new sections in `ConfigEditor.tsx` and the new slider widgets in `controls-panel.tsx` add no new client components (both files are already client components from steps 24/25); they extend existing client-component JSX. The new chart panel in `metrics-dashboard.tsx` is also already a client component (Recharts requires client). The guide page sections are added inline to `app/(auth)/guide/page.tsx`, which is a Server Component — they are pure JSX and consume `helpText` (a synchronous module-level constant), no client-side interactivity needed beyond what the page already has.
2. `node_modules/next/dist/docs/01-app/03-api-reference/02-file-conventions/page.md` — confirms async page-component conventions in Next 16. The guide page is unchanged structurally; we only add new JSX content. No new route segment, no new dynamic params.
3. `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md` — reminds us that custom webpack config breaks Turbopack. Relevant because the new Recharts chart import path must follow the existing pattern in `metrics-dashboard.tsx` (already proven Turbopack-safe by step 22). No new bundler configuration is required.

**External references (WebFetched at execution time):**

4. **MDN — `<details>` element** — `https://developer.mozilla.org/en-US/docs/Web/HTML/Element/details` (must be WebFetched). Load-bearing facts: (a) `<details>` toggles via `open` attribute; (b) the `<summary>` child is the always-visible header; (c) state is preserved across re-renders if the element identity is stable. Consequence: the two new collapsible sections in `ConfigEditor.tsx` will preserve their open/closed state across react-hook-form re-renders without any extra state management — same pattern step 25 uses for the existing sections.
5. **React Hook Form — `useFormContext` / `useWatch`** — `https://react-hook-form.com/docs/useformcontext` and `https://react-hook-form.com/docs/usewatch` (must be WebFetched at least one of these). Load-bearing: `useWatch` re-renders on a specific field change without re-rendering the whole form; `form.watch('field')` does the same but inside the parent component. The existing `ConfigEditor.tsx` uses `form.watch(...)` for conditional rendering (e.g. topology-type dropdown). Step 35's gaussian section follows the same pattern: `form.watch('successPolicy.kind') === 'gaussian'` gates the conditional sigma + topK fields. The migration section: `form.watch('movement.enabled') === true` gates the conditional threshold + step + collision-policy fields.

**Paths not taken:**

6. **A new "Research extensions" top-level navigation page.** Considered: dedicate a new route to gaussian + migration controls separately from the main config editor. **Rejected** because (a) the existing config editor is _the_ place users go to set experimental parameters; splitting it would create two sources of truth; (b) the two new features are first-class config knobs, not a separate "advanced" mode; (c) the help text + guide sections already differentiate the new features within the main editor by giving them dedicated `<details>` headers and dedicated guide sections. Adding a new route would also require a new auth-gated layout, new navigation entry, and new MCP coverage — disproportionate cost for the same end result.
7. **Real-time animated lattice overlay showing agent migration trails.** Considered: when movement is enabled, draw arrows on the lattice canvas showing where each agent moved each tick. **Rejected** for v1 of step 35 because (a) the existing lattice canvas in `app/(auth)/playground/lattice-canvas.tsx` already redraws each tick from `getLatticeProjection()`, so positional changes ARE visible — the agent appears in its new cell; (b) animated trails require a per-tick history of positions and an alpha-blended trail-rendering pass, both of which would change the renderer's complexity meaningfully; (c) the new spatial-homophily chart is the quantitative observable that lets the researcher _see_ spatial clustering forming in time-series form, which is more useful for research than visual trails. Defer animated trails to a future "playground polish" step if user demand emerges.
8. **A "preset" button to enable both features at once with PDF-recommended defaults.** Considered: add a "Meissa's PDF defaults" button that sets `successPolicy.kind = 'gaussian'`, `sigma = 1.0`, `movement.enabled = true`, `attractThreshold = 0.5`, etc., in one click. **Rejected** because step 31 (hypothesis presets) already has the preset infrastructure; adding a new preset is a step-31-style change that should land in its own step (step 36+) once the researcher has run the new features for a few weeks and has empirical defaults. Premature presets risk locking in suboptimal values.

**Total: 3 local Next docs + 2 external WebFetched (MDN `<details>`, React Hook Form `useWatch`) + 3 paths not taken = 8 citations**, satisfying the ≥ 5 floor.

## 5. Files to create

None. Step 35 is purely additive modifications to existing UI files plus screenshot artifacts. The screenshots are not source code per se, but they are committed to the repo:

- `docs/screenshots/step-35-config.png` — config editor with both new `<details>` sections expanded, default values visible.
- `docs/screenshots/step-35-playground.png` — playground showing the new spatial-homophily chart populated after a 100-tick run with movement enabled.

The MCP harness produces both files; they are committed as part of the step.

## 6. Files to modify

- `lib/help-text.ts` — append the following entries (12 new keys). Tone matches existing entries: plain English, brief default note, mention research use cases. Drafts:
  - `'config.successPolicy.kind'`: "Communication success rule. **Deterministic** (default): success requires the hearer to know the speaker's exact token for the same referent — sharp binary outcome. **Gaussian**: success is a smooth probability based on how similar the two agents' overall token-weight vectors are. Use deterministic for the canonical Naming Game; use Gaussian to study how vocabulary tolerance affects consensus."
  - `'config.successPolicy.sigma'`: "Kernel width σ for the Gaussian success rule. The success probability is `Ps = exp(-‖xi - xj‖² / (2σ²))`. **Higher σ** widens the curve — agents tolerate larger linguistic differences before communication fails. **Lower σ** sharpens the curve — only very similar token weights succeed. Try sweeping σ from 0.1 to 5.0. Default: 1.0."
  - `'config.successPolicy.gaussianTopK'`: "Number of top-weighted tokens used to build each agent's linguistic state vector for the Gaussian distance computation. Higher K = more nuanced similarity; lower K = focuses only on agents' dominant vocabulary. Default: 10 (matches preferential attachment)."
  - `'config.movement.enabled'`: "Enable Schelling-style spatial migration. After each successful interaction, agents on a lattice may step toward (high vocabulary similarity) or away from (low similarity) their interaction partner. Default: off (preserves canonical Naming Game). Lattice topology only — has no effect on well-mixed or network worlds."
  - `'config.movement.attractThreshold'`: "Cosine-similarity threshold (between 0 and 1) above which agents move _toward_ each other after an interaction, and below which they move _away_. Default: 0.5 — borderline indifferent. Lower thresholds (e.g. 0.3) make agents more eager to cluster; higher thresholds (e.g. 0.7) make them more eager to disperse."
  - `'config.movement.attractStep'`: "Number of lattice cells to step _toward_ the partner when the cosine similarity is above the attract threshold. Default: 1 (one cell). Set to 0 to disable attractive movement entirely."
  - `'config.movement.repelStep'`: "Number of lattice cells to step _away from_ the partner when the cosine similarity is below the attract threshold. Default: 2 (two cells, asymmetric — repulsion is stronger than attraction, matching the original PDF prescription). Set to 0 to disable repulsive movement."
  - `'config.movement.collisionPolicy'`: "What happens when an agent tries to step into a cell already occupied. **Swap**: trade positions with the occupant (preserves cell-occupancy, produces clean Schelling dynamics). **Skip**: cancel the move (silently reduces migration rate when the lattice is dense). Default: swap."
  - `'config.movement.topK'`: "Number of top-weighted tokens used to build each agent's vector for the cosine-similarity computation that drives movement decisions. Default: 10 (matches preferential attachment and the gaussian success policy)."
  - `'playground.gaussianSigma'`: "Live-adjustable Gaussian kernel width. Effective on the next tick — drag the slider during a running simulation to see the success-probability surface change in real time. Only applies when the success policy is set to 'gaussian' in the config editor."
  - `'playground.attractThreshold'`: "Live-adjustable migration threshold. Effective on the next tick. Only applies when migration is enabled in the config editor. Try lowering the threshold mid-run to watch agents start clustering, or raising it to watch them disperse."
  - `'chart.spatialHomophily'`: "Mean cosine similarity between each agent and its lattice neighbors, averaged across the world. **High** = neighbors talk like each other (linguistic clustering, possibly driven by migration); **low** = neighbors talk differently (well-mixed vocabulary). Always computed (regardless of whether migration is enabled), so it serves as a baseline for ablation. NaN for non-lattice topologies."

- `app/(auth)/experiments/ConfigEditor.tsx` — add two new `<details>` sections. Insertion point: directly after the existing "Preferential attachment" section, before the "Convergence" / "Sampling" sections (or wherever the bottom-of-form lives). Pattern (mirroring lines 428–475 of the existing preferential-attachment section):

  Section A (Gaussian success):

  ```tsx
  <details className="rounded-lg border border-zinc-200 bg-white">
    <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-zinc-800 hover:bg-zinc-50">
      Gaussian success policy <HelpTip helpKey="config.successPolicy.kind" />
    </summary>
    <div className="space-y-4 p-4">
      <label className="flex flex-col gap-1 text-sm text-zinc-700">
        <span>Success rule kind</span>
        <select
          {...form.register('successPolicy.kind')}
          className="rounded border border-zinc-300 px-2 py-1"
        >
          <option value="deterministic">Deterministic (canonical Naming Game)</option>
          <option value="gaussian">Gaussian (probabilistic)</option>
        </select>
      </label>
      {form.watch('successPolicy.kind') === 'gaussian' && (
        <>
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
        </>
      )}
    </div>
  </details>
  ```

  Section B (Linguistic migration):

  ```tsx
  <details className="rounded-lg border border-zinc-200 bg-white">
    <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-zinc-800 hover:bg-zinc-50">
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
          <label className="flex flex-col gap-1 text-sm text-zinc-700">
            <span>
              Collision policy <HelpTip helpKey="config.movement.collisionPolicy" />
            </span>
            <select
              {...form.register('movement.collisionPolicy')}
              className="rounded border border-zinc-300 px-2 py-1"
            >
              <option value="swap">Swap (Schelling-style)</option>
              <option value="skip">Skip (cancel move)</option>
            </select>
          </label>
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
  ```

  Both sections render their default-disabled state cleanly: Gaussian section shows the kind dropdown set to "Deterministic" and no other fields visible; Migration section shows the unchecked enabled box and no other fields visible. Default-off configs produce no visual clutter.

- `app/(auth)/playground/controls-panel.tsx` — add two new live-adjustable sliders following the existing `deltaPositive` pattern (debounced 300ms `useEffect`, draft state synced from props, dark-variant `<HelpTip>`). Insertion point: in the "Live parameters" group of sliders alongside `deltaPositive`, `deltaNegative`, `interactionProbability`, `temperature`. Conditionally rendered:
  - Show `gaussianSigma` slider only when `config.successPolicy.kind === 'gaussian'`.
  - Show `attractThreshold` slider only when `config.movement.enabled === true`.

  Both sliders pass partial-update objects to `onConfigUpdate`:

  ```typescript
  onConfigUpdate({
    successPolicy: {
      kind: 'gaussian',
      sigma: gaussianSigmaDraft,
      gaussianTopK: config.successPolicy.gaussianTopK,
    },
  });
  ```

  ```typescript
  onConfigUpdate({
    movement: { ...config.movement, attractThreshold: attractThresholdDraft },
  });
  ```

  Range bounds: `gaussianSigma` slider min=0.01, max=5.0, step=0.01; `attractThreshold` slider min=0.0, max=1.0, step=0.01.

- `app/(auth)/playground/metrics-dashboard.tsx` — append one new entry to the `CHART_CONFIGS` array:

  ```typescript
  {
    id: 'spatial-homophily',
    title: 'Spatial homophily',
    helpKey: 'chart.spatialHomophily',
    defaultYAxisMode: 'fixed',
    yAxisRange: [0, 1],
    series: [
      { dataKey: 'world1', name: 'World 1', color: COLORS.skyBlue },
      { dataKey: 'world2', name: 'World 2', color: COLORS.vermillion },
    ],
    shaper: (r: TickReport) => ({
      tick: r.tick,
      world1: Number.isNaN(r.scalar.world1.spatialHomophily) ? null : r.scalar.world1.spatialHomophily,
      world2: Number.isNaN(r.scalar.world2.spatialHomophily) ? null : r.scalar.world2.spatialHomophily,
    }),
  }
  ```

  The `null` substitution for NaN values lets Recharts handle the gap cleanly (the line breaks at NaN points). Add a one-line unit test for the shaper helper (section 9) to confirm NaN handling.

- `app/(auth)/guide/page.tsx` — add two new sections. Insertion point: after the existing "Metrics" section, before "Glossary" (or wherever the post-v1 extensions section makes sense). Patterns:

  Section "Gaussian success policy" — ~150 words explaining: what the binary success rule is, what the gaussian rule replaces it with, the formula (display the kernel inline), the σ knob's effect on the success curve, when to use which (research-question framing). Include a "Try this:" prompt: "Set kind=gaussian, sigma=1.0, run 200 ticks, then sweep sigma from 0.1 to 5.0 with the same seed and compare consensus times."

  Section "Linguistic migration" — ~150 words explaining: the Schelling analogy, the attract/repel mechanic with the asymmetric step counts, the lattice-only constraint, the collision policy choice, what `spatialHomophily` measures and how to read its time-series. Include a "Try this:" prompt: "Enable migration with attractThreshold=0.5, then run with movement disabled for comparison — both runs produce the spatialHomophily metric, so you can see whether migration accelerates spatial clustering or just produces it deterministically."

  Add `MetricEntry` for the new chart at the appropriate spot in the existing metrics list:

  ```tsx
  <MetricEntry title="Spatial homophily" helpKey="chart.spatialHomophily" />
  ```

- `README.md` — add a new subsection "Recent additions (post-v1)" under the existing "What you can do with it" section:

  ```markdown
  ### Recent additions (post-v1)

  - **Gaussian success policy** (configurable in the experiment editor): replace the binary "hearer-knows-the-token" success rule with a smooth probability `Ps = exp(-‖xi - xj‖² / (2σ²))`. Lets you study how vocabulary tolerance affects consensus dynamics. See the in-app guide for details.
  - **Linguistic migration** (configurable; lattice topology only): after each successful interaction, agents step toward (high vocabulary similarity) or away from (low similarity) their partner — a Schelling-style segregation dynamic specific to language. The new "Spatial homophily" chart in the playground tracks the result. See the in-app guide.
  ```

  Both features are off by default. Existing experiment configs continue to behave identically to v1.

- `CLAUDE.md` — see section 11.

No other files modified. No new routes, no new API endpoints, no new server actions, no DB schema changes, no worker changes.

## 7. Implementation approach

**Slice 1 — Help text first.** Edit `lib/help-text.ts` to add the 12 new entries. Run `npm run typecheck` to confirm the dictionary stays well-typed. Spot-check a few entries by rendering them in a unit test or by reading them back via a script — but this is overkill; visual review suffices.

**Slice 2 — Config editor: gaussian section.** Edit `ConfigEditor.tsx` to add the Gaussian `<details>` block after the preferential-attachment section. Render the page via `npm run dev` and visually verify: (a) section appears collapsed by default; (b) expanding it shows the kind dropdown set to "Deterministic"; (c) selecting "Gaussian" reveals the sigma + topK fields; (d) reverting to "Deterministic" hides them; (e) saving a config with gaussian kind round-trips through import/export without data loss.

**Slice 3 — Config editor: migration section.** Same as slice 2 but for the migration `<details>` block. Verify (a)–(e) for the migration toggle and conditional fields. Verify the `latticeOnly` literal field is preserved on round-trip (it's invisible in the UI but present in the JSON).

**Slice 4 — Playground sliders.** Edit `controls-panel.tsx` to add the two new live sliders. The conditional-render pattern: wrap each slider in `{config.successPolicy.kind === 'gaussian' && ...}` and `{config.movement.enabled && ...}`. Verify visually that the sliders appear/disappear when the underlying config changes (e.g. saving a config from the editor and re-loading the playground should show or hide the sliders correctly).

**Slice 5 — Spatial-homophily chart.** Edit `metrics-dashboard.tsx` to add the new `ChartConfig` entry. Verify the chart renders without errors (NaN values are common before a tick has run; the shaper returns `null` for NaN). Run a 50-tick simulation with movement disabled — chart should populate with non-NaN values (the metric is computed regardless of movement). Run with a well-mixed topology — chart should show no line (NaN→null→Recharts renders a gap).

**Slice 6 — Guide page.** Edit `guide/page.tsx` to add the two new sections and the `MetricEntry`. Verify the table-of-contents updates automatically (if it's auto-generated from headings) or update the sticky sidebar manually. Visual review.

**Slice 7 — README.** Edit `README.md` to add the "Recent additions" subsection. Verify the markdown renders correctly on GitHub by previewing the raw markdown if possible. Cross-link to the in-app guide page route (`/guide`).

**Slice 8 — Spatial-homophily shaper unit test.** Add a 1-test file (or append to an existing test file) verifying the shaper returns `{ tick, world1: null, world2: null }` for a `TickReport` with NaN values, and `{ tick, world1: 0.42, world2: 0.55 }` for non-NaN values. This is the only unit test added by step 35.

**Slice 9 — Backwards-compatibility check.** Open the experiment editor on an existing v1 config (or a hardcoded fixture). Both new sections must render their default-disabled state cleanly. The save → reload roundtrip must produce a JSON identical to the input plus the new `successPolicy` and `movement` keys with their default values. This is the contract that "default-off behavior is preserved end-to-end."

**Slice 10 — CLAUDE.md update.** Append the bullet from section 11.

**Slice 11 — Format, lint, typecheck, build.** All green.

**Slice 12 — MCP harness.** This is the load-bearing acceptance step. The MCP script (in section 10) runs the full Phase A–E flow, taking both screenshots and verifying the new chart populates. Save the screenshots to the paths in section 5. Commit them as part of the step.

**Slice 13 — Final commit.** `step 35: research extensions ui`.

## 8. Library choices

**None new.** Step 35 uses only:

- React 19, react-hook-form, @hookform/resolvers/zod, Recharts, Tailwind 4 — all from earlier steps.
- The Zod schemas from steps 33 and 34 as type sources for the form fields.
- The MCP playwright-style harness from step 19 / `CLAUDE.md` "UI verification harness" for the screenshot acceptance.

**Out of scope:**

- Animated migration trails on the lattice canvas (path-not-taken 7).
- A "Meissa's PDF defaults" preset (path-not-taken 8) — defer to a later step.
- A dedicated "Research extensions" route (path-not-taken 6).
- Recharts custom tooltips for the new chart beyond what `ChartPanel` already provides.
- A "compare two runs" overlay specifically for the new chart — the existing run-comparison UI from step 29 will pick up the new metric automatically (it iterates over `PerWorldScalarMetrics` keys).

## 9. Unit tests

Step 35 is a UI step. Per `CLAUDE.md` "Testing conventions" (`*.dom.test.ts` for component tests is allowed but not required), the bulk of verification is the MCP harness in section 10. One small unit test is added:

1. **Spatial-homophily chart shaper handles NaN correctly.** Located in `app/(auth)/playground/metrics-dashboard.test.ts` (new file or appended to existing). Build a synthetic `TickReport` with `scalar.world1.spatialHomophily = Number.NaN, scalar.world2.spatialHomophily = 0.42`. Call the shaper; assert the result is `{ tick: <input tick>, world1: null, world2: 0.42 }`. Build a second `TickReport` with both worlds non-NaN. Assert both values pass through unchanged.

That is the only unit test required. All other UI verification happens via MCP (section 10).

## 10. Acceptance criteria

This step is `ui: true`, so `scripts/run-plan.ts` spins up `next build && next start` on a random port, seeds a test user, and invokes `claude -p` with the `MSKSIM_BASE_URL`, `MSKSIM_SEED_USER`, `MSKSIM_SEED_PASS` env vars set per `CLAUDE.md` "UI verification harness." The MCP script must complete every phase below.

**Phase A — Setup and authenticate:**

1. Open `[MSKSIM_BASE_URL]/login`. Verify page title contains "login" or "sign in".
2. Console must have zero errors at this point.
3. Fill the email field with the value of `[MSKSIM_SEED_USER]`.
4. Fill the password field with the value of `[MSKSIM_SEED_PASS]`.
5. Click the "Sign in" button.
6. Verify the page redirects (303 from a Server Action, then 307 from the proxy is normal). Final destination: a route inside the `(auth)` group.
7. Console still zero errors. Network must show no 4xx/5xx (except possibly 401/403 if auth was misconfigured — fix and retry).

**Phase B — Open the experiment config editor and verify both new sections:**

8. Navigate to `/experiments` (or the route where configs are managed).
9. Click "New config" (or open an existing config — whichever path exists). Verify the config editor form renders.
10. Scroll to the "Gaussian success policy" `<details>` section. Click to expand it.
11. Verify the section reveals: a "Success rule kind" `<select>` with options "Deterministic" and "Gaussian"; default selected = "Deterministic"; no σ or topK fields visible (they are conditionally rendered).
12. Change the dropdown to "Gaussian". Verify σ and topK `<input type="number">` fields appear with their default values (1.0 and 10).
13. Scroll to the "Linguistic migration" `<details>` section. Click to expand.
14. Verify the section reveals a checkbox labeled "Enabled" (default unchecked) and the label text "lattice topology only — no effect on well-mixed or network".
15. Click the checkbox. Verify the additional fields appear: attractThreshold, attractStep, repelStep, collisionPolicy `<select>`, topK.
16. Take screenshot to `docs/screenshots/step-35-config.png` showing both sections expanded with their conditional fields visible.
17. Save the config (click "Save"). Verify the page redirects to the configs list (or stays on the edit page with a success toast — match whatever step 25 established). Console zero errors.

**Phase C — Run a simulation with the new features and verify the new chart:**

18. Navigate to `/playground` with the saved config loaded (URL path likely includes the config id, per step 26 conventions).
19. Verify the playground renders: lattice canvas, controls panel, metrics dashboard tab is reachable.
20. Verify the controls panel shows the live sliders for "Gaussian σ" and "Attract threshold" (because the saved config has both features enabled).
21. Click the "Play" button. Verify the simulation runs (lattice updates, tick counter advances).
22. Click the "Metrics" tab (or scroll to the metrics dashboard).
23. Verify all existing charts (success rate, modularity, etc.) populate as expected.
24. Verify the new "Spatial homophily" chart is present and populated (line chart with two series for world1 and world2; values in [0, 1]).
25. Run for ~100 ticks total (either let Play continue or click Step 100 times — whichever is faster).
26. Click "Pause".
27. Take screenshot to `docs/screenshots/step-35-playground.png` showing the metrics dashboard with the new spatial-homophily chart visible and populated.

**Phase D — Verify backwards compatibility:**

28. Navigate back to `/experiments`. Open a v1-style config (one that does NOT have the new sections enabled — either an existing one or create a new one with both features disabled).
29. Verify the form renders without errors. Both new `<details>` sections appear collapsed; expanding them shows the disabled defaults.
30. Save the config; reload the page. Verify the JSON round-trips correctly (the saved config has `successPolicy: { kind: 'deterministic' }` and `movement: { enabled: false, ... }` populated by Zod defaults).

**Phase E — Cleanup:**

31. Log out (click the logout button).
32. Verify the page redirects to `/login`.
33. Final console check: zero errors throughout the entire MCP run.
34. Final network check: no 4xx (except 401 on protected routes after logout, which is expected) and no 5xx anywhere.

**Console triage:**

- Ignore React 19 hydration warnings (per `CLAUDE.md` "UI verification harness").
- Fail on any "Error:", "Uncaught", "TypeError", or React-rendering errors.

**Network triage:**

- Expected: 200 (GET/HEAD), 303/307 (redirects from Server Actions and the proxy), 201 (POST creates).
- Fail on any 4xx other than 401/403 on logout-protected routes.
- Fail on any 5xx.

**Final acceptance:**

- Both screenshots committed to `docs/screenshots/step-35-{config,playground}.png`.
- `npm run typecheck && npm run lint && npm run build && npm test` all exit 0.
- Single commit with subject `step 35: research extensions ui`.

## 11. CLAUDE.md updates

Append to "Known gotchas" (≤ 6 lines):

> - The playground's live-slider seam (`app/(auth)/playground/controls-panel.tsx`) splits config knobs into **live-safe** (debounced 300ms, applied without reset) and **reset-required** (only mutable via reinit). Step 35 added `gaussianSigma` and `attractThreshold` as live-safe; their corresponding `enabled` toggles and integer step counts (`attractStep`, `repelStep`, `gaussianTopK`) stay in the config editor because changing them mid-run produces conceptually confusing dynamics. When adding a new live-safe slider, follow the existing pattern: draft state via `useState`, sync from props via `useEffect`, debounced commit via `setTimeout` in another `useEffect`, conditional render gated on the corresponding `enabled` config field.

If a new failure mode emerges during MCP execution, add at most one further bullet (total append ≤ 10 lines).

## 12. Commit message

```
step 35: research extensions ui
```

Exactly this string. Squash intermediate commits before advancing. Final pipeline state: every step from 00 through 35 has a matching `step NN: <title>` commit in `git log`, and `npx tsx scripts/run-plan.ts --list` reports all 36 steps as complete.

## 13. Rollback notes

If step 35 must be undone (e.g. an unforeseen MCP-harness incompatibility):

1. Identify the prior SHA via `git log --oneline --grep='step '`. Expect `step 34: linguistic migration`.
2. `git reset --hard <prior-sha>` — discards the modifications to `lib/help-text.ts`, `app/(auth)/experiments/ConfigEditor.tsx`, `app/(auth)/playground/controls-panel.tsx`, `app/(auth)/playground/metrics-dashboard.tsx`, `app/(auth)/guide/page.tsx`, `README.md`, `CLAUDE.md`, plus the test addition and the two screenshots.
3. No deps changed. `package.json` and `package-lock.json` unchanged.
4. Verify `npm run typecheck && npm run lint && npm test && npm run build` on the rolled-back tree — should be all green (step 34 was the last green state).
5. The engine extensions from steps 33 and 34 remain present after rollback (they are sim-core, not UI). The features are still usable via direct config-JSON editing or via the API — only the form-based and slider-based access is removed. This is a graceful degradation; step 35 can be re-implemented with a different UI design without re-doing the engine work.
