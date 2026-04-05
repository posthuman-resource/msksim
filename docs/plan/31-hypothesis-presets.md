---
step: "31"
title: "hypothesis presets"
kind: workflow
ui: true
timeout_minutes: 40
prerequisites:
  - "step 25: experiment config ui"
  - "step 24: interactive controls"
---

## 1. Goal

Ship **F17 — Hypothesis presets** from `docs/spec.md` §4.4: three one-click, data-driven `ExperimentConfig` presets that a researcher or collaborator can load into the step-25 experiment editor in a single interaction. The three presets reproduce the two "possible outcomes" sketched on slides 4-5 of the source PDF (`docs/pdftext.md` "First Possible Outcome" and "Second Possible Outcome") plus a mean-field control — they are the minimum surface the app needs before it can honor `docs/spec.md` user story US-13 (*"As a collaborator reviewing a paper draft, I want the 'Outcome 1' and 'Outcome 2' presets to be one click away, so I can verify the figures match the text"*) and US-1 (*"instantiate both worlds with the 3:2 monolingual:bilingual ratio described in our presentation so I can replicate the canonical setup in one click"*). Concretely this step delivers: (a) three preset config modules at `lib/sim/presets/outcome-1-segregation.ts`, `lib/sim/presets/outcome-2-assimilation.ts`, and `lib/sim/presets/mean-field-control.ts`, each exporting a fully-populated `ExperimentConfig` object that passes `ExperimentConfig.parse(...)` from step 01 and carries a top-of-file comment citing the exact PDF slide and `docs/pdftext.md` section that justifies each parameter choice; (b) a preset index module at `lib/sim/presets/index.ts` exporting a typed `PRESETS` array of `{ id, name, description, citation, config }` entries so any UI surface that wants to render preset cards has one import and no magic strings; (c) a presets section embedded into the existing step-25 experiments list page at `app/(auth)/experiments/page.tsx` — a grid of three cards rendered above the saved-configs table with the title "Hypothesis presets" and a short explanatory paragraph (chosen over a dedicated `/experiments/presets` subpage because the step-specific context calls out "The simpler approach is a section on the existing experiments page"); (d) a **"Load preset" Server Action** at `app/(auth)/experiments/preset-actions.ts` that accepts a preset id, copies the preset's `ExperimentConfig` into a new `configs` row via the step-25 `saveConfig` helper with a well-known name (`"preset: outcome-1-segregation"`, `"preset: outcome-2-assimilation"`, `"preset: mean-field-control"`), is idempotent in the sense that clicking the same preset twice produces two rows with the same content hash (dedup is a later concern — `saveConfig` does not dedup on hash per step 08 plan §5 "Files to create"), and then `redirect('/experiments/<id>')` to the step-25 edit form with the preset pre-loaded and editable (honoring F17's acceptance clause *"clicking it populates the config form and is then editable"*); (e) a preset-card Client Component `app/(auth)/experiments/PresetCard.tsx` that renders one card per preset with name, description, citation, and a form-submit "Load" button bound via `action={loadPresetAction.bind(null, preset.id)}` (no client fetch; the form submit is the native browser path to a Server Action and integrates with the step-25 `revalidatePath('/experiments')` flow); (f) a **preset parameter-design verification** — an offline node-side harness at `lib/sim/presets/verify.ts` (plus its Vitest file `lib/sim/presets/verify.test.ts`) that loads each preset through `ExperimentConfig.parse`, hands it to the step-18 simulation core directly (bypassing the worker / UI), runs a shortened version (50 ticks for unit-test speed, enough to see qualitative divergence) with a pinned seed, and asserts the expected **qualitative** behavior per preset: outcome-1 produces a segregation index trending upward and an assimilation index staying below a conservative threshold; outcome-2 produces the inverse; mean-field-control produces monotonically decreasing Nw with no cluster persistence. The integration test is the parameter-design sanity check the step-specific context calls out explicitly (*"These configs must be carefully designed to actually reproduce the hypothesized outcomes"*), and it protects against parameter drift if future steps edit preset values without re-running the simulation.

Scope boundary is strict: this step **does not** re-architect the experiments page (step 25 owns the list and the table layout, this step adds a section above them), **does not** touch the simulation engine (steps 09-18 own the physics, this step only consumes `ExperimentConfig` as data), **does not** introduce a preset CRUD surface (presets are code, not user data — see the path-not-taken in §4 about database-backed presets), **does not** modify the step-25 `ConfigEditor` (the edit form already handles any valid `ExperimentConfig`, and presets are valid `ExperimentConfig` instances by construction), and **does not** add new Zod schema fields (the `is_preset` boolean suggested as optional in the step-specific context is **not** introduced — presets are distinguished by their `name` prefix `"preset: "` in the `configs.name` column, which the step-25 list view already renders). The invariant the step establishes: *after it lands, any researcher or collaborator who logs in and navigates to `/experiments` sees three preset cards, can click "Load" on any of them to instantiate a new editable config pre-populated with the preset's parameters, and the preset is guaranteed by unit test to reproduce its hypothesized macroscopic outcome when run for enough ticks*.

## 2. Prerequisites

- Commit marker `step 25: experiment config ui` present in `git log`. Step 25 landed the `/experiments` list page, the Server Actions module `app/(auth)/experiments/actions.ts`, the `ConfigEditor` Client Component, the `ConfigListItem` Client Component, the `app/api/configs/[id]/export/route.ts` Route Handler, and (per step 25's §6 "Files to modify") the `updateConfig` helper extension to `lib/db/configs.ts`. Step 31 **composes on top** of step 25 — it does not rewrite any of these files except for a small additive edit to `app/(auth)/experiments/page.tsx` (section 6 below). The new preset cards and the new `preset-actions.ts` module live alongside step 25's files without touching them. The `saveConfig` helper from step 08 is what the "Load preset" Server Action calls to materialize a preset into a row; step 25's elaboration of the helpers (`updateConfig`) is not needed here because preset loading always inserts a new row, never updates an existing one.
- Commit marker `step 24: interactive controls` present in `git log`. Step 24 landed the playground shell's controls panel (`app/(auth)/playground/controls-panel.tsx` or equivalent name — verify via `git show --stat` before editing) and established that the playground page reads a `configId` search param via the pattern `app/(auth)/playground/page.tsx`'s `searchParams` prop. Step 31 does **not** modify the playground — the Load button redirects to the editor, not the playground, per F17's acceptance clause *"clicking it populates the config form and is then editable"*. The playground wiring is orthogonal and is already established by step 24; a researcher who wants to run a loaded preset in the playground uses the step-25 editor's "Run" button (which points at `/playground?configId=<id>`). Step 24 is listed as a prerequisite only because the MCP script in §10 drives the playground at the end to capture the preset's qualitative simulation behavior in a screenshot; if step 24 had not landed the controls, the playground would not advance ticks and the MCP assertion would fail.
- Commit marker `step 01: zod config schema` present in `git log` (transitively required by step 25 but re-asserted here because the preset modules `import { ExperimentConfig } from '@/lib/schema/experiment'` directly to parse-and-validate their literal objects at module load time). Each preset file's body ends with `export const preset = ExperimentConfig.parse(rawObject);` so a malformed preset is caught at `next build` time via a thrown Zod error — the preset modules are **never** allowed to ship a raw object that the downstream `saveConfig` call would then reject at runtime. The `.parse` at module load doubles as the "defaults fill" pass so each preset's literal only needs to override the fields it cares about (ratio, topology, preferential attachment temperature, language policy bias) and the rest of the config is filled from the step-01 defaults. This is the step-01 plan's explicit design intent (*"ExperimentConfig.parse({}) alone produces a runnable simulation"*) and step 31 leans on it hard.
- Commit marker `step 08: run persistence schema` present in `git log`. Step 31's Server Action imports `saveConfig` from `@/lib/db/configs`. No new helpers are added; no existing helpers are modified. The `saveConfig` signature — `{ name: string; config: ExperimentConfig; createdBy?: string | null }` returning a `Config` — is the contract this step consumes unchanged.
- Commit marker `step 18: simulation smoke test` present in `git log`. Step 18 landed the node-side simulation harness (the entry point used by Vitest to run a simulation deterministically without the browser / worker boundary). Step 31's `verify.test.ts` imports the same simulation entry point to run each preset for 50 ticks and assert qualitative outcomes. If step 18 exposed the harness under a path different from what this plan assumes (e.g., `lib/sim/runner.ts` vs `lib/sim/simulate.ts`), the implementing claude greps for the exported function signature and matches whatever step 18 actually shipped.
- Commit marker `step 17: run summary metrics` present in `git log`. Step 17 exports the classification / summary function that takes per-tick metric arrays and returns `{ finalAssimilationIndex, finalSegregationIndex, classification, ... }`. The verification test asserts on the final values these functions return — it is the most stable API surface for the outcome assertions, more stable than reading tick_metrics rows by name. If the step-17 exports are named differently, the implementing claude adapts.
- Node ≥ 20.9, React 19.2.4, Next.js 16.2.2, Tailwind 4 — all established by step 00.

## 3. Spec references

- **`docs/spec.md` §4.4 Persistence and export → F17. Hypothesis presets.** The literal feature this step implements. Spec text: *"One-click configurations that reproduce the two 'possible outcomes' from the source PDF: (a) Outcome 1 — segregation/ghettoization, (b) Outcome 2 — assimilation. A third preset reproduces the mean-field control."* Acceptance clauses: *"Each preset is tagged with a short description and a citation to the PDF slide; clicking it populates the config form and is then editable; the preset config JSON is part of the shipped application."* All three clauses are load-bearing and are honored as follows: (1) each of the three preset modules in §5 exports a `citation` field whose value names the specific `docs/pdftext.md` section ("First Possible Outcome", "Second Possible Outcome") and the slide range in the source PDF; (2) the Load Server Action calls `saveConfig` to insert a fresh row and then `redirect('/experiments/<id>')` to the step-25 edit form, which is the populate-and-edit flow; (3) the preset config JSON lives in the git-tracked `lib/sim/presets/*.ts` files, so "part of the shipped application" is satisfied by construction — no DB seed migration, no build-time codegen, no runtime fetch of preset definitions from an external source. The "Supports: RQ1, RQ2" tag on F17 confirms the three-preset set is exactly right: outcome-1 and outcome-2 answer RQ1 (assimilation vs segregation thresholds), and the mean-field control plus the pair of lattice presets answer RQ2 (role of spatial topology).

- **`docs/spec.md` §2 Does the Lattice Matter?** The authoritative justification for the mean-field control preset. Spec text: *"In well-mixed / mean-field populations, agents eventually converge to a single shared vocabulary. Time-to-consensus scales roughly as N^(3/2) and the dynamics are homogeneous — there are no stable sub-populations with divergent vocabularies"* (citing Dall'Asta et al., 2008). The mean-field control preset's parameter design flows directly from this sentence: it reuses outcome-1's population and vocabulary setup but switches `topology.type` from `'lattice'` to `'well-mixed'`, producing a simulation where the same population that ghettoizes on a lattice instead converges quickly. The preset's test assertion (monotonically decreasing Nw, no cluster persistence, convergence in < 50 ticks) is the Baronchelli-literature prediction for this setup. §2 also states: *"Running the same experimental configuration in both lattice and well-mixed modes constitutes a built-in empirical answer to the user's own question and produces a publication-grade figure almost for free."* This is the exact figure the three-preset set produces: outcome-1 (lattice + segregation policies), outcome-2 (lattice + assimilation policies), mean-field-control (well-mixed + either set of policies — this plan uses the outcome-1 policies to isolate the topology variable).

- **`docs/spec.md` §3.1-§3.4 Conceptual model.** The source of every parameter each preset sets. §3.1 names the four `AgentClass` values (`W1-Mono`, `W1-Bi`, `W2-Native`, `W2-Immigrant`) that the language-policy preset entries key off. §3.3 defines the interaction rules whose `languagePolicies` array each preset customizes. §3.4 defines the default initial conditions (3:2 monolingual:bilingual ratio from the PDF) that outcome-1 and outcome-2 both keep — the preset differences are **not** in the population ratio (both lattice presets use 3:2 per the PDF's explicit rule) but in the language policy bias and the preferential-attachment temperature. Outcome-1 and outcome-2 **share** the ratio and topology and differ only in the policy+attachment knobs that drive the emergent outcome; this is the cleanest experimental design for isolating the policy mechanism, and is why each preset's citation comment includes a note explaining which parameter is the "independent variable" relative to the other two presets. §3.5 notes that the specific lexemes (`yellow`, `red`, `jaune`, `rouge`) are defaults the schema already supplies; no preset overrides the vocabulary seed because the research question is about population-level dynamics, not lexical content.

- **`docs/spec.md` §4.1 F5. Language-selection policy.** The policy-bias knob each preset tunes. F5 text: *"Encodes the PDF's policy rules ('Bilinguals in World 1 always use L1 with monolinguals'; 'Bilinguals in World 2 use both') as functions of (speaker.class, hearer.class). Additional policies (e.g. probabilistic code-switching) can be registered."* Outcome-1 biases W2-Immigrant → W2-Native toward L1 (the PDF's ghettoization mechanism — *"In language 1, immigrants or agent 2 start to form a 'ghetto' group"*, `docs/pdftext.md` cite 52). Outcome-2 biases W2-Immigrant → W2-Native toward L2 (the PDF's assimilation mechanism — *"immigrants start to use token in Language 2 to increase communication success with native hosts"*, `docs/pdftext.md` cites 55-56). The mean-field control keeps outcome-1's biases but swaps the topology, so its final metrics measure the contribution of topology alone.

- **`docs/spec.md` §4.1 F6. Preferential attachment.** The second knob each preset tunes. F6's *"Eventually, agents will try to communicate only to agents that match most of their tokens weight"* maps to the preferential-attachment temperature parameter (step 01's schema → `preferentialAttachment.temperature`, step 14's softmax-over-cosine-similarity implementation). Outcome-1 uses a **low temperature** (sharp softmax → strong preferential attachment → in-group clustering is aggressively reinforced). Outcome-2 uses a **higher temperature** (flatter softmax → weaker attachment → more mixing between groups so the L2-biased policy has a chance to land). The mean-field control uses the same temperature as outcome-1 because — with well-mixed topology — preferential attachment can still operate on the interaction memory even though physical locality does not exist, and the goal of the control is to demonstrate that topology alone drives the difference.

- **`docs/spec.md` §7.1 & §7.3 Metrics and classification.** The **assimilation index** (`successful_W2Imm_W2Native_interactions_in_L2 / successful_W2Imm_W2Native_interactions_total`) and **segregation index** (Louvain modularity of the W2-Immigrant subgraph) are the two metrics the verification test asserts on. §7.3 defines the end-of-run classifier that labels a run `'segregated' | 'assimilated' | 'mixed' | 'inconclusive'` based on these two values with user-configurable thresholds. The test's assertion strategy is: run 50 ticks, extract the final tick's indices, assert `outcome-1.finalSegregationIndex > 0.2` and `outcome-1.finalAssimilationIndex < 0.4` (segregation-leaning); assert `outcome-2.finalAssimilationIndex > 0.5` (assimilation-leaning); assert `mean-field.finalNw` has dropped below half its initial value (convergence signal). The specific threshold numbers are conservative — they are deliberately loose to survive seed-to-seed variance at 50 ticks — and are documented alongside each assertion with a comment explaining that a 200-tick run in the MCP script will produce sharper values, but the Vitest cost must stay under ~2 seconds per preset.

- **`docs/spec.md` §5.1 User story US-1** (*"instantiate both worlds with the 3:2 monolingual:bilingual ratio described in our presentation so I can replicate the canonical setup in one click"*) and **§5.2 US-13** (*"the 'Outcome 1' and 'Outcome 2' presets to be one click away"*). F17 is the literal implementation of both user stories; step 31 is the step where they become clickable.

- **CLAUDE.md "UI verification harness".** Step 31 is a UI step with `ui: true` in its frontmatter. `scripts/run-plan.ts` starts `next build && next start` on a random port, seeds the test user, sets `MSKSIM_BASE_URL` / `MSKSIM_SEED_USER` / `MSKSIM_SEED_PASS`, and invokes `claude -p` with a 40-minute budget. The MCP script in §10 follows the same shape as step 25's script (log in → navigate → click → assert → screenshot → console/network triage).

- **CLAUDE.md "Authentication patterns".** Every new Server Action in `app/(auth)/experiments/preset-actions.ts` opens with `const { user } = await verifySession();` — the layout-level session check is not a substitute, per the doc's "defense in depth" requirement. The Load action must also include a `'use server'` directive at the top of the module and an `import 'server-only'` line, mirroring the step-25 actions module exactly.

- **CLAUDE.md "Database access patterns".** `saveConfig` from `@/lib/db/configs` is the single write path; the Load action never issues drizzle queries directly. No new helper is added to `lib/db/configs.ts` — step 31 is pure composition.

## 4. Research notes

Minimum requirements met: **3 local Next doc citations, 2 external WebFetched URLs, 1 path-not-taken, total ≥ 5. This step ships 5 local docs + 2 external + 2 paths-not-taken = 9 citations.**

### Local Next.js 16 documentation (authoritative per `CLAUDE.md` "Next.js 16 deltas from training data" and `AGENTS.md`)

1. **`node_modules/next/dist/docs/01-app/02-guides/authentication.md`**, section *"Sign-up and login functionality → Validate form fields on the server"* (~lines 140-250) and section *"Always verify authentication and authorization inside each Server Function rather than relying on Proxy alone"* (scattered in the DAL subsection). Re-confirms the step-25 pattern that every Server Action opens with `const { user } = await verifySession();` before any business logic. The Load Preset action in §5 follows this shape exactly, and the doc's reminder that *"Relying on the proxy alone is explicitly unsafe — refactoring a Server Action to a different route can silently strip proxy coverage, and POSTing directly to a Server Action URL bypasses the page-level check"* is the reason the DAL call happens in the action body even though the action is imported only from a `(auth)`-gated page. The doc's examples also confirm that a Server Action that ends with `redirect(...)` must place the `redirect` **outside** any try/catch, because `redirect` throws a `NEXT_REDIRECT` sentinel that the framework catches and converts to a 303 response — swallowing it in a try/catch leaves the user on the calling page with no feedback. The Load Preset action's `redirect('/experiments/<id>')` is the final statement of its body, on its own line, not inside any error handler.

2. **`node_modules/next/dist/docs/01-app/02-guides/forms.md`**, section *"Server Actions → Passing additional arguments"* (`.bind` pattern, ~lines 440-490). Documents the canonical Next 16 pattern for binding additional arguments to a Server Action before passing it as a form's `action` prop: `<form action={loadPresetAction.bind(null, preset.id)}>`. The bind returns a new function whose first argument is pre-filled with `preset.id`, and when the form submits, the action receives `(formData: FormData)` as its only remaining parameter. This is how the `PresetCard` Client Component wires its "Load" button to the Server Action without needing to serialize the preset id into a hidden input field. The doc warns that the bind value is serialized over the wire, so only JSON-serializable values should be bound (strings, numbers, booleans, arrays, plain objects) — preset ids are plain strings (`'outcome-1-segregation'`, etc.), satisfying the constraint trivially. The doc also shows the same pattern in step 25's `ConfigListItem` for the `duplicateConfigAction.bind(null, config.id)` and `deleteConfigAction.bind(null, config.id)` handlers; step 31 adopts the same pattern for consistency with the rest of the experiments surface.

3. **`node_modules/next/dist/docs/01-app/02-guides/data-security.md`**, section *"Using a Data Access Layer for mutations"* (~lines 387-430). Reinforces the "thin Server Action → DAL helper → drizzle" layering that step 25 established. The Load Preset action is a canonical example of this pattern: the action's body is (1) `verifySession()`, (2) look up the preset by id from the statically-imported `PRESETS` array (no DB read — presets are code), (3) call `saveConfig({ name, config, createdBy })`, (4) `revalidatePath('/experiments')`, (5) `redirect(`/experiments/${config.id}`)`. Five lines of real work, all the complex logic living in the DAL helper and the step-01 Zod schema. The doc's "Controlling return values" subsection informs the action's return type: the action does **not** return the full `Config` row to the client (which would leak `createdBy`), it ends in a `redirect` so there is no return value at all — Next's framework handles the response directly.

4. **`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/03-route-segment-config.md`** and the `01-app/03-api-reference/01-directives/use-server.md` reference. Confirms that a file with `'use server'` at the top can export only async functions (Server Actions), not constants or arrays. This is the reason the **preset definitions cannot live in the same file as the Load action** — the `PRESETS` array and the preset config literal objects are not async functions, so they cannot co-exist with `'use server'`. The resolution is the two-file split enshrined in §5: `lib/sim/presets/*.ts` (no `'use server'`, just exported constants and types) and `app/(auth)/experiments/preset-actions.ts` (`'use server'`, just async functions that import from `@/lib/sim/presets`). The split is also semantically correct — presets are data, the action is behavior, and they belong in separate modules per the single-responsibility principle. The Zod import inside `lib/sim/presets/*.ts` is safe at module scope because the step-01 schema is **deliberately client-safe** (no `'server-only'` guard per the step-01 plan §5).

5. **`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidatePath.md`**. The Load action calls `revalidatePath('/experiments')` after `saveConfig` but before `redirect`, so the list page shows the new row if the user navigates back. This is the same pattern step 25 uses for `saveConfigAction`, `duplicateConfigAction`, and `deleteConfigAction`. The doc also confirms that `revalidatePath` is a no-op when called outside a Server Action (but throws in v16; verify at implementation time), and that the path argument is a literal path, not a Next 15-style route pattern — `/experiments` not `/experiments/[id]`.

### External WebFetched references

6. **Baronchelli, A., Dall'Asta, L., Barrat, A., & Loreto, V. (2006). *Topology-induced coarsening in language games.*** — `https://pubmed.ncbi.nlm.nih.gov/16486202/` (WebFetched). This is the primary literature citation for the **outcome-1 segregation preset's parameter design**. The paper establishes that on a 2D lattice, the Naming Game produces **coarsening dynamics**: clusters of locally agreeing agents form rapidly and then slowly compete at their boundaries, with time-to-consensus scaling as N² rather than the N^(3/2) of well-mixed populations. The "ghettoization" outcome from `docs/pdftext.md` is the signature of this coarsening dynamic arrested at a meta-stable state by the preferential-attachment rule — immigrants cluster with immigrants because the language policy biases them away from L2 usage, and then preferential attachment locks the cluster in. The outcome-1 preset's specific numeric choices (preferential-attachment temperature ≈ 0.5, warm-up ticks ≈ 50, language policy bias L1:L2 ≈ 0.8:0.2 for W2-Imm → W2-Native interactions) are picked to be inside the regime the Baronchelli paper identifies as producing long-lived cluster structure on lattices of the size step 01's defaults specify (20×20 per world). The paper also confirms that the mean-field control should converge quickly with the same population composition, because without a spatial substrate there is no way for sub-clusters to persist — this is the justification for the mean-field-control preset's assertion that `finalNw` has dropped sharply by tick 50.

7. **Dall'Asta, L., Baronchelli, A., Barrat, A., & Loreto, V. (2008). *In-depth analysis of the Naming Game dynamics: the homogeneous mixing case.*** — `https://arxiv.org/abs/0803.0398` (WebFetched). The authoritative reference for **well-mixed Naming Game dynamics** and the source for the **mean-field control preset**'s expected convergence behavior. The paper derives the N^(3/2) time-to-consensus scaling for homogeneous (well-mixed) populations and shows that the system reaches a single dominant vocabulary through a cascade of pairwise alignments, without passing through any long-lived cluster state. The verification test for the mean-field preset uses this prediction: at a population of 50 per world (step 01's default `agentCount`) and the default number of vocabulary items, consensus should be reached by around ~250 ticks, and **Nw should have decayed substantially by tick 50**. Fifty ticks is enough to see the descending trend unambiguously, even though consensus is not yet reached — the test asserts on the trend, not the endpoint. Section 9's test specifies the exact assertion: `finalNw < 0.7 * initialNw` for the mean-field preset (a 30% drop, which the paper's figures predict comfortably).

### Paths not taken

8. **Storing presets in the `configs` table with an `is_preset` boolean column — rejected.** The step-specific context explicitly mentions this as an option: *"could use a `is_preset: boolean` column, but for v1 just use the name prefix 'preset:' and document"*. The rejection rationale is stronger than the context's tentative phrasing:
   - *(a) Presets are code, not user data.* The three preset definitions are part of the shipped application per F17's own acceptance clause (*"the preset config JSON is part of the shipped application"*). Shipping them via a DB seed script means the source of truth drifts between the code repo and the running DB: a developer updates a preset file in a PR, but old DB rows still carry the old content, and users who clicked "Load" before the PR landed get different results from users who click after. Storing presets in code ensures every user sees the same preset content at the same git SHA.
   - *(b) A DB seed script is a new file type for this project.* Step 02's migration pipeline is `drizzle-kit generate` + `scripts/migrate.ts` running hand-written DDL; the project has no convention for seed data. Introducing one for a set of three static records is over-engineering.
   - *(c) The `configs` table already has `name` which can carry a `"preset: "` prefix.* The step-25 list view already renders the name as the row label; a `"preset: outcome-1-segregation"` row is visually distinguishable from user-authored rows in the same list without any schema change. A researcher who copies a preset into their own named config strips the prefix and the row stops looking like a preset, which is the correct UX.
   - *(d) The "Load" action produces a **copy** of the preset, not a reference to it.* After loading, the researcher is editing an independent row whose content hash equals the preset's content hash only until the first edit. This is the semantics F17 wants (*"populates the config form and is then editable"*) and it is satisfied by a plain `saveConfig` insert — there is no need for the row to remember it was derived from a preset.
   - *(e) An `is_preset` column would complicate step 30's export filenames.* The export filename template already uses the content hash; adding a preset flag would not change any filename but would introduce a field that every downstream consumer has to remember to ignore. YAGNI.
   
   The rejection is clean: **presets are TypeScript constants in `lib/sim/presets/`, the Load action copies one into the `configs` table as a new row, the row's name carries a `"preset: "` prefix only as a visual label, and no schema change is needed**. If a future step needs a proper preset library (search, tags, per-user favorites), a dedicated `presets` table and helpers would be a cleaner v2 refactor than retrofitting an `is_preset` column onto `configs`.

9. **Running the preset verification assertions inside the MCP browser harness instead of in a Vitest unit test — rejected.** The step-specific context mentions *"Running 200 ticks via the playground (or in the node smoke test harness)"* as the verification path, implying either is acceptable. This plan picks the Vitest path over the MCP path for three reasons:
   - *(a) Vitest runs deterministically in CI and locally; the MCP harness depends on a live Next server, a real worker, and network timing that varies run-to-run.* A flaky MCP assertion on a preset's expected outcome would block the pipeline periodically; a deterministic Vitest assertion under `pinned seed + same simulation code + same preset` never flakes.
   - *(b) Vitest is 100x faster.* A 50-tick simulation in the node harness runs in ~100ms per preset; the same simulation in the browser worker plus rendering plus metric extraction via `evaluate_script` plus round-trip overhead is ~5 seconds per preset. Three presets × 5 seconds × future CI runs = minutes of wall-clock time on every push.
   - *(c) The Vitest path tests the **preset parameters directly**, while the MCP path tests the parameters plus the worker plus the rendering pipeline.* The latter is a useful end-to-end smoke check — and the MCP script in §10 still runs 100 ticks per preset and asserts on visible dashboard values at that scale — but the parameter-design sanity check belongs in a unit test where failure points unambiguously at the preset values.
   
   The resolution is a two-layer verification: (1) **unit test (Vitest)** — 50 ticks per preset, conservative thresholds, catches parameter-design regressions cheaply; (2) **MCP smoke (playground, 100 ticks)** — runs one preset end-to-end to prove the full loading → editing → playground → metrics pipeline works. The MCP script does not assert tight thresholds on the 100-tick outcome (seed-to-seed variance at that scale is too wide for tight assertions) — it asserts that the metrics dashboard is showing **non-zero, plausible** values after 100 ticks, and that the preset's topology (e.g., `'lattice'` vs `'well-mixed'`) is reflected in the rendered lattice view. Section 10 specifies the exact MCP assertions.

### Quality gate check

- Local Next docs: 5 (authentication.md, forms.md, data-security.md, use-server.md, revalidatePath.md). ≥ 3 ✓
- External URLs: 2 (Baronchelli 2006, Dall'Asta 2008). ≥ 2 ✓
- Paths not taken: 2 (is_preset column, MCP-only verification). ≥ 1 ✓
- Total citations: 9. ≥ 5 ✓

## 5. Files to create

All paths relative to the repo root.

### Preset config modules (three + an index)

- **`lib/sim/presets/outcome-1-segregation.ts`** — no `'use server'`, no `'server-only'` (the file is shared between server Actions and the client `PresetCard` component; it contains only data and a Zod parse call, no secrets). Body:
  1. Top-of-file block comment citing the source: `// Outcome 1 — Segregation / Ghettoization` + `// Source: docs/How color terms communication success is emerged through language modulated by geographical.pdf, Slide 4 ("First Possible Outcome")` + `// Transcription: docs/pdftext.md, section "First Possible Outcome" (cites 48-52)` + a one-paragraph explanation that mirrors the PDF's language: *"In the first possible outcome, agents in World 1 have greater matching rate in token weight, and higher communication success. Their social bonding is strong. Conversely, agents in World 2 have lower matching rate in token weight in Language 1 with the native hosts. Their social bonding is weak, and form two clusters, one indicating social exclusion of the immigrant agents. In language 1, immigrants start to form a 'ghetto' group."*
  2. Imports: `import { ExperimentConfig } from '@/lib/schema/experiment';`
  3. `const raw = { ... }` with the preset's literal overrides. Specific fields:
     - `seed: 1` (arbitrary pinned integer — the verification test and MCP assertions run at this seed, and the ratio of W2-Immigrants vs W2-Natives at population 50 is deterministic given the seed; picking 1 over 0 avoids any edge-case "seed === default" confusion with step 01's `.default(0)`)
     - `tickCount: 5000` (the default from step 01; the preset does not shorten the run — a researcher who loads this preset and clicks "Run in playground" gets the full hypothesis run)
     - `world1` and `world2` both with `topology: { type: 'lattice', width: 20, height: 20, neighborhood: 'moore' }`, `agentCount: 50`, `monolingualBilingualRatio: 1.5` (the PDF's 3:2)
     - `languagePolicies`: array of entries per the step-01 schema, with the `w2imm-to-w2native-both` policy carrying `languageBias: { L1: 0.8, L2: 0.2 }` (strong L1 bias — the ghettoization mechanism). The other three policy entries (`w1bi-to-w1mono-always-l1`, `w1bi-to-w1bi-configurable`, `w2imm-to-w2imm-both`) use the step-01 defaults.
     - `preferentialAttachment`: `{ enabled: true, warmUpTicks: 50, temperature: 0.5, similarityMetric: 'cosine' }` — low temperature produces sharp softmax, amplifying in-group clustering.
     - `deltaPositive: 0.1` (step-01 default), `deltaNegative: 0` (step-01 default), `retryLimit: 3`, `weightUpdateRule: 'additive'`, `schedulerMode: 'random'`, `sampleInterval: 10` — all step-01 defaults.
  4. `export const outcome1Segregation = ExperimentConfig.parse(raw);` — the parse at module load time validates the literal against the schema and fills any unspecified fields with their defaults, producing a fully-typed `ExperimentConfig` constant. If a future schema change invalidates the preset's literal, `next build` throws at import time with a clear Zod error pointing at the exact field.
  5. `export const outcome1Metadata = { id: 'outcome-1-segregation', name: 'Outcome 1 — Segregation', description: 'Immigrant agents cluster in L1 and form a ghetto (PDF slide 4).', citation: 'Source PDF slide 4; docs/pdftext.md "First Possible Outcome" (cites 48-52).' } as const;` — the metadata object is kept separate from the config object so the `PRESETS` index array can compose them without any runtime string-building.

- **`lib/sim/presets/outcome-2-assimilation.ts`** — same structure as outcome-1. Specific differences from outcome-1:
  - Citation header cites `docs/pdftext.md` section "Second Possible Outcome" (cites 53-56) and the corresponding source PDF slide (slide 5).
  - Description paragraph mirrors the PDF: *"In the 2nd possible outcome, there is still bonding and nothing changes in World 1. However, social bonding is strong in World 2. In this scenario, immigrants start to use tokens in Language 2 to increase communication success with native hosts."*
  - `seed: 2` (different pinned seed to confirm the verification test is not accidentally passing due to a shared-seed coincidence).
  - `languagePolicies[w2imm-to-w2native-both].languageBias = { L1: 0.2, L2: 0.8 }` — **inverted** from outcome-1. This is the critical parameter difference: same ratio, same topology, same preferential attachment, opposite language policy bias.
  - `preferentialAttachment.temperature: 1.5` — **higher** than outcome-1. Flatter softmax produces weaker clustering pressure, so the L2-biased policy has a chance to drive assimilation before preferential attachment locks in any in-group clusters. This is the second knob difference; the plan deliberately varies two parameters between outcome-1 and outcome-2 because varying only one produces intermediate results in 50-tick tests (the parameter-design sanity check in section 9 spot-checks that varying only the bias produces qualitatively weaker but still-in-the-right-direction outcomes, and then the two-knob version is the chosen preset because it produces cleaner qualitative separation at short tick counts).
  - `export const outcome2Assimilation` and `export const outcome2Metadata` with `id: 'outcome-2-assimilation'`, `name: 'Outcome 2 — Assimilation'`.

- **`lib/sim/presets/mean-field-control.ts`** — same structure. Specific differences from outcome-1:
  - Citation header cites `docs/spec.md` §2 ("Does the Lattice Matter?") and the Baronchelli 2006 / Dall'Asta 2008 references in `docs/spec.md` §12.1. No source PDF slide — this preset is the control the research team adds on top of the PDF's two outcomes, not a PDF-specific scenario.
  - Description paragraph: *"Mean-field control: well-mixed topology with the same population composition as Outcome 1. Demonstrates that the ghettoization outcome depends on the spatial substrate — without a lattice, agents converge on a shared vocabulary regardless of language-policy bias. Used as the topological control variable for RQ2."*
  - `seed: 3`.
  - `world1.topology` and `world2.topology`: both `{ type: 'well-mixed' }` (no width/height — the discriminated union in step 01's schema has no extra fields on the well-mixed variant).
  - `languagePolicies`: same as **outcome-1** (strong L1 bias on W2-Imm → W2-Native). The control variable is topology alone; language policies are held fixed at the segregation-favoring bias so the topology swap's effect is measured against the most hostile language policy for assimilation. A researcher can alternatively load outcome-2's policies into a well-mixed topology to double-check that the result is still convergence — that is exercise left to the UI, not codified as a fourth preset.
  - `preferentialAttachment`: same as outcome-1 (`temperature: 0.5`). Preferential attachment still operates on interaction memory in a well-mixed topology, but without the spatial substrate it cannot reinforce local clusters — the paper literature predicts convergence anyway.
  - `export const meanFieldControl` and `export const meanFieldControlMetadata` with `id: 'mean-field-control'`, `name: 'Mean-field control'`.

- **`lib/sim/presets/index.ts`** — the aggregator module. No `'use server'`. Body:
  ```ts
  import { outcome1Segregation, outcome1Metadata } from './outcome-1-segregation';
  import { outcome2Assimilation, outcome2Metadata } from './outcome-2-assimilation';
  import { meanFieldControl, meanFieldControlMetadata } from './mean-field-control';
  import type { ExperimentConfig } from '@/lib/schema/experiment';

  export type PresetMetadata = {
    readonly id: 'outcome-1-segregation' | 'outcome-2-assimilation' | 'mean-field-control';
    readonly name: string;
    readonly description: string;
    readonly citation: string;
  };

  export type Preset = PresetMetadata & { readonly config: ExperimentConfig };

  export const PRESETS: readonly Preset[] = [
    { ...outcome1Metadata, config: outcome1Segregation },
    { ...outcome2Metadata, config: outcome2Assimilation },
    { ...meanFieldControlMetadata, config: meanFieldControl },
  ] as const;

  export function getPresetById(id: string): Preset | undefined {
    return PRESETS.find((p) => p.id === id);
  }
  ```
  The module is the **single import point** for every other file in step 31. The Server Action imports `getPresetById`; the page imports `PRESETS` to render the cards; the Vitest file imports `PRESETS` to iterate over them in the verification test.

### Server Action module

- **`app/(auth)/experiments/preset-actions.ts`** — Server Action module for the Load Preset flow. First line `import 'server-only';`, second line `'use server';`. Imports: `verifySession` from `@/lib/auth/dal`, `saveConfig` from `@/lib/db/configs`, `getPresetById` from `@/lib/sim/presets`, `revalidatePath` from `next/cache`, `redirect` from `next/navigation`. Exports one Server Action:
  - `loadPresetAction(presetId: string, formData: FormData): Promise<void>` — signature matches the `.bind(null, presetId)` pattern (the first argument is the pre-bound preset id; the second is the empty FormData from the form submit). Body:
    1. `const { user } = await verifySession();` — CLAUDE.md "Authentication patterns" requires this even though the action is called from an `(auth)`-gated page.
    2. `const preset = getPresetById(presetId);`
    3. `if (!preset) throw new Error(`unknown preset: ${presetId}`);` — this should never fire in practice because the preset id is bound server-side from the `PRESETS` array, but the guard protects against a crafted POST that forges a different id. The error surfaces as a 500 with a clear message; no silent fallback to a "default preset" is attempted because that would mask the programming error.
    4. `const saved = await saveConfig({ name: `preset: ${preset.id}`, config: preset.config, createdBy: user.id });` — the `name` includes the `"preset: "` prefix as documented in §4's path-not-taken rejection of the `is_preset` column. `saveConfig` returns the inserted `Config` row, from which `saved.id` is the new row's UUID.
    5. `revalidatePath('/experiments');` — refreshes the list page so a user who navigates back sees the new row.
    6. `redirect(`/experiments/${saved.id}`);` — sends the user to the step-25 edit form with the preset pre-loaded. Outside any try/catch per CLAUDE.md "Known gotchas" on `NEXT_REDIRECT`.
  
  Notes:
  - The action does not return a value; the redirect terminates the HTTP response. This means the client-side `useActionState` pattern is **not** used here (there is no error state to surface inline — the action either succeeds and redirects or throws and lands in an error boundary). This is a simpler shape than step 25's `saveConfigAction` which uses `useActionState` because it can fail with field-level validation errors; `loadPresetAction` has no user-input validation to do, so the simpler signature is correct.
  - The action is **not** guarded against duplicate loads. Clicking "Load" on the same preset twice produces two rows in the `configs` table, both with the same `content_hash` (because `saveConfig` canonicalizes and hashes deterministically per step 08). This is intentional: two loads represent two independent research explorations, and the duplicate rows do not cause any correctness issue — they just appear as two rows in the list. A future refinement could dedup on `(content_hash, name)` but that is a v2 concern.
  - Error handling: `saveConfig` throws on DB errors, which propagates out of the action and lands in Next's error boundary. No try/catch, no user-facing error UI for this step — the happy path is the entire implementation.

### Client Component

- **`app/(auth)/experiments/PresetCard.tsx`** — Client Component for a single preset card. First line `'use client';`. Imports: `Preset` type from `@/lib/sim/presets`, `loadPresetAction` from `./preset-actions`. Props: `{ preset: Preset }`. Body:
  - Renders a `<section>` with Tailwind card styling (reusing whatever card class step 25's `ConfigListItem` established — probably `rounded-md border p-4 shadow-sm` or equivalent; the implementing claude greps for the pattern and matches).
  - `<h3>` for `preset.name`.
  - `<p>` for `preset.description`.
  - `<small>` for `preset.citation` (rendered as dimmed text, below the description).
  - A `<form action={loadPresetAction.bind(null, preset.id)}>` containing a single `<button type="submit">Load</button>`. The form has no input fields — the bind-arg carries the preset id, and the Server Action reads nothing from the FormData. The button is the entire form contents.
  - **Pending state**: optionally, use `useFormStatus` from `react-dom` inside an inner component to disable the button while the action is pending. This is a small UX polish that prevents double-submits. The implementing claude decides whether to include it — it adds ~10 lines and zero dependencies (`useFormStatus` is a React 19 built-in), so it is worth the polish. If omitted, the plan still ships — double-submits produce extra rows but no functional damage, as documented in §5's Server Action notes.

### Test files

- **`lib/sim/presets/verify.test.ts`** — Vitest file. Runs under the default `node` environment (no DOM needed). Tests:
  1. **All three presets parse via the step-01 Zod schema.** Iterates `PRESETS`, asserts each `preset.config` is the result of a successful `ExperimentConfig.parse(...)` call (the parse happened at module import, so this test is really checking that the modules loaded without throwing — but the test restates the invariant explicitly for documentation value).
  2. **Preset ids are unique and match the expected set.** Asserts `PRESETS.map(p => p.id)` deep-equals `['outcome-1-segregation', 'outcome-2-assimilation', 'mean-field-control']` (in any order — the test sorts both sides).
  3. **Each preset has non-empty `name`, `description`, and `citation`.** Simple string-length assertions.
  4. **`getPresetById` returns the expected preset for each id.** Three assertions.
  5. **`getPresetById('nonexistent')` returns `undefined`.** Negative case.
  6. **Outcome-1 preset produces a segregation-leaning outcome at 50 ticks.** Imports the step-18 node simulation harness (exact import path verified against step 18's shipped code), runs `simulate(outcome1Segregation, { maxTicks: 50 })`, extracts the final-tick `assimilationIndex` and `segregationIndex` from the returned metrics array (step 15 / 16 / 17 own these), and asserts `finalSegregationIndex > 0.2` and `finalAssimilationIndex < 0.4`. Thresholds are deliberately loose to survive seed-to-seed variance — a 200-tick run in the MCP script (§10) produces sharper values. The test comment explains the thresholds.
  7. **Outcome-2 preset produces an assimilation-leaning outcome at 50 ticks.** Symmetric to test 6: `finalAssimilationIndex > 0.5`. Does not assert on segregation index because the two indices are not strictly inverse — the assertion on the assimilation side alone is sufficient for the qualitative check.
  8. **Mean-field-control preset produces monotonically-decreasing Nw.** Runs 50 ticks, extracts the per-tick `nw` metric for world2, asserts `metrics[50].nw < metrics[0].nw * 0.7` (at least 30% drop). The test comment references Dall'Asta et al. 2008 for the expected convergence behavior.
  
  **Important caveat**: tests 6-8 depend on the simulation engine being fully wired (steps 09-18) and the metrics registry being populated (steps 15-17). If the step-18 harness API differs from what this plan assumes, the implementing claude adapts the test to whatever step 18 actually exposes — the **assertions on the metrics** are the contract, not the specific function signatures used to reach them. If step 18's harness is slow (the 50-tick verification takes > 2 seconds per preset), the test file raises Vitest's default timeout via `test.concurrent(..., 10_000)` or similar. If the harness is not available or the integration is too complex for step 31's scope, tests 6-8 are marked `.skip` with an inline TODO comment referencing "step 32 re-enables after full integration" — but this fallback is a last resort; the preferred path is to make the tests pass because the parameter-design sanity check is the primary mitigation for preset-drift bugs.

### Screenshots

- **`docs/screenshots/step-31-outcome-1.png`** — captured by the MCP script in §10 after loading outcome-1 and running 100 ticks in the playground. Shows the lattice view with early clustering.
- **`docs/screenshots/step-31-outcome-2.png`** — same as above for outcome-2. Shows the lattice view with broader mixing.
- **`docs/screenshots/step-31-control.png`** — same for the mean-field control. Shows the well-mixed topology rendered by step 21's canvas renderer (which visualizes well-mixed as a non-spatial layout — see step 21 for the rendering convention).
- **`docs/screenshots/step-31-experiments-presets.png`** — landing shot of the `/experiments` page with the three preset cards visible. This is the "hero" screenshot for step 31.

## 6. Files to modify

- **`app/(auth)/experiments/page.tsx`** — additive edit only. The Server Component body (established by step 25) already calls `verifySession()`, reads `listConfigs(...)`, and renders a heading plus a table of `ConfigListItem` rows. Step 31 adds a **new section above the table**:
  1. Import `PRESETS` from `@/lib/sim/presets` and `PresetCard` from `./PresetCard`.
  2. Between the page heading and the "New config" button (or between the button and the table — the implementing claude picks the layout that reads best; this plan recommends: heading → "New config" button → presets section → saved configs table), render a `<section aria-labelledby="presets-heading">` block containing:
     - `<h2 id="presets-heading">Hypothesis presets</h2>`
     - `<p>One-click configurations that reproduce the two hypothesized outcomes from the source presentation, plus a mean-field control.</p>`
     - `<div className="grid grid-cols-1 md:grid-cols-3 gap-4">` containing three `<PresetCard key={preset.id} preset={preset} />` elements, one per entry in `PRESETS`.
  3. The table of saved configs below this section is unchanged — step 25's code continues to render exactly as before. The empty-state card from step 25 is still shown when `rows.length === 0`; the presets section is always visible regardless of whether the user has saved any configs.
  
  The edit touches step 25's file but is strictly additive (no existing JSX blocks are modified, no imports are removed, no props change) — this is the only allowed shape for a cross-step file edit per the CLAUDE.md living-document rules. The diff for this file in step 31's commit is ~15 lines of added JSX plus 2 lines of added imports.

- **`CLAUDE.md`** — ≤ 5 lines appended. One line in "Directory layout" noting that `lib/sim/presets/` exists (the hard cap of 40 lines for that section is not at risk; the entry is a single bullet under `lib/sim/`). Optionally one bullet in "Known gotchas" if the implementing claude encountered a surprise (e.g., the `'use server'` / data-co-location split described in research note 4 — worth memorializing because it will come up again for any future step that ships static data alongside a Server Action). See §11 for the exact appended lines.

No other files are modified. No changes to step 25's editor, no changes to step 24's controls, no changes to step 08's helpers, no changes to the step-01 schema, no changes to `proxy.ts`, no changes to `package.json` (no new dependencies — everything in step 31 is pure composition on top of already-installed packages).

## 7. Implementation approach

Work proceeds in eight sequential slices. The slice order reflects the dependency chain: preset data → Server Action → UI component → page edit → tests → build → MCP → commit. Do not reorder; later slices import artifacts created in earlier slices and will fail to typecheck or build if attempted out of order.

**Slice 1 — Verify prerequisite commits and schema shape.** Run `git log --oneline | head -30` and confirm the commit markers for steps 01, 08, 17, 18, 24, and 25 are present. If any prerequisite is missing, stop and surface a diagnostic — step 31 cannot proceed. Then open `lib/schema/experiment.ts` (or wherever step 01 shipped the schema, verified by grep) and read the shape of `ExperimentConfig` — specifically the names of the fields the presets will set (`world1`, `world2`, `topology`, `languagePolicies`, `preferentialAttachment`, `seed`, `tickCount`, etc.). If any field name in this plan does not match the shipped schema (for example, if step 01 used `preferentialAttachmentConfig` instead of `preferentialAttachment`), the implementing claude adjusts every preset file's raw object literal to match the real schema — the schema is authoritative, this plan is a snapshot. Run a quick `npx tsx -e "import('./lib/schema/experiment.ts').then(m => console.log(Object.keys(m.ExperimentConfig.shape)))"` to list the top-level fields and cross-reference against this plan's §5.

**Slice 2 — Write the three preset config files.** Create `lib/sim/presets/outcome-1-segregation.ts` first, following §5's specification in detail: top-of-file citation comment, Zod import, `raw` object literal with every field from §5, `export const outcome1Segregation = ExperimentConfig.parse(raw);`, and the metadata export. The parse-at-import pattern means that if any field is wrong (invalid enum, out-of-range number, missing required field), `tsc --noEmit` and `next build` both catch it — the module fails to load with a clear Zod error. Test locally with `npx tsx -e "import('./lib/sim/presets/outcome-1-segregation.ts').then(m => console.log(JSON.stringify(m.outcome1Segregation, null, 2)))"` and verify the printed JSON contains the expected values. Repeat for `outcome-2-assimilation.ts` and `mean-field-control.ts`. All three files must load without throwing before the next slice starts.

**Slice 3 — Write the preset index.** Create `lib/sim/presets/index.ts` exactly as specified in §5, including the `PresetMetadata` and `Preset` type exports and the `getPresetById` helper. The `PRESETS` array is declared `readonly` and `as const` so TypeScript infers literal types on the `id` field, enabling `getPresetById(id: Preset['id'])` narrowing downstream if desired. Test with `npx tsx -e "import('./lib/sim/presets/index.ts').then(m => console.log(m.PRESETS.map(p => p.id)))"` — expect `['outcome-1-segregation', 'outcome-2-assimilation', 'mean-field-control']`.

**Slice 4 — Write the Server Action.** Create `app/(auth)/experiments/preset-actions.ts` with the `loadPresetAction` export exactly as specified in §5's "Server Action module" subsection. The `'use server'` directive and `import 'server-only'` lines are both present; the DAL call `verifySession()` is the first statement of the body; the `redirect` is the last statement, outside any try/catch. Verify with `npm run typecheck` — the Server Action's signature `(presetId: string, formData: FormData) => Promise<void>` must be compatible with React 19's Server Action type (the framework type-checks this automatically during `next build`).

**Slice 5 — Write the Client Component.** Create `app/(auth)/experiments/PresetCard.tsx` with `'use client';` on line 1 and the card rendering as specified in §5's "Client Component" subsection. The form's `action` prop uses `loadPresetAction.bind(null, preset.id)`; the button is a plain `<button type="submit">Load</button>`. Tailwind classes match whatever step 25's card components used — grep for `ConfigListItem.tsx` and reuse the established class patterns for visual consistency. If `useFormStatus` polish is added for pending-state button disabling, the inner component is declared at the bottom of the same file (no separate file for such a small helper).

**Slice 6 — Edit the experiments list page.** Open `app/(auth)/experiments/page.tsx` (the version shipped by step 25). Add the two imports: `import { PRESETS } from '@/lib/sim/presets';` and `import { PresetCard } from './PresetCard';`. Add the presets section JSX between the page heading and the saved-configs table (see §6 for the exact placement). Do not touch any existing JSX, any existing imports, or the `verifySession()` / `listConfigs()` calls. The edit should produce a diff of ~15 added lines and zero removed or modified lines. Run `npm run typecheck` and `npm run lint` to confirm the edit is clean.

**Slice 7 — Write the verification test.** Create `lib/sim/presets/verify.test.ts`. Tests 1-5 (the static / metadata tests) are trivial — they iterate `PRESETS` and assert on types, ids, and string contents. Tests 6-8 (the simulation-behavior tests) require importing from step 18's harness; the implementing claude greps for the harness's exported function signature (probably `simulate(config, opts)` or similar) and adapts the test to call it. The assertion thresholds in §5's "Test files" subsection are the target; if a 50-tick run at the specified seeds does not reach those thresholds — which is possible if the step-14 / step-16 implementations have different numeric conventions than this plan assumed — the implementing claude **first** tunes the preset parameters in slice 2's files (not the thresholds in the test) so the qualitative outcome matches. This is the primary parameter-design sanity check; falsifying it would defeat the purpose of the test. If the test cannot be made to pass within the slice's time budget (e.g., 200+ ticks are needed to see the qualitative divergence), the thresholds can be relaxed with a documented comment, but **never** should the test be outright skipped without a matching TODO bug entry linked in the plan's §11 CLAUDE.md updates.

**Slice 8 — Run static gates and MCP script.** Run in order: `npm run typecheck` (must exit 0), `npm run lint` (must exit 0), `npm test` (must exit 0; includes the new `verify.test.ts`), `npm run build` (must succeed; the parse-at-import pattern in the preset files doubles as a build-time preset validator). If any gate fails, fix and re-run. Then invoke the MCP chrome-devtools script per §10 to verify the end-to-end flow. Save the four screenshots to `docs/screenshots/step-31-*.png`. Commit everything in one commit per §12.

Four gotchas the implementation must handle:

1. **Server Action bind args are serialized over the wire.** The `loadPresetAction.bind(null, preset.id)` pattern works because `preset.id` is a plain string. If a future refactor tries to bind the entire `preset.config` object, the bundle size balloons (each preset is ~2KB of JSON) and the security model changes (the client now has the full preset content, which is fine for presets but would be dangerous for anything with secrets). This plan explicitly binds only the id to keep the wire payload minimal and the server as the source of truth for the preset content.

2. **`'use server'` files cannot export non-function constants.** Research note 4 explains this in detail. The resolution is the two-file split: `lib/sim/presets/*.ts` (no `'use server'`, exports data) vs `app/(auth)/experiments/preset-actions.ts` (`'use server'`, exports async functions only). The implementing claude must not co-locate the `PRESETS` array with the `loadPresetAction` function in a single file — the build would fail with a `'use server'` validation error.

3. **Preset files must not import from `lib/db/` or `lib/auth/`.** The preset modules are pure data; they load the Zod schema from `lib/schema/` (client-safe per step 01 plan) but they do not import anything that pulls in `better-sqlite3` or argon2. If a future refactor accidentally adds such an import (e.g., because a preset wants to reference a default user id), Turbopack would fail to bundle the module on the client side of the `PresetCard` component. The current plan avoids this by keeping the preset files data-only and having the Server Action (which is the only piece that talks to the DB) import the presets as values. Grep the finished preset files for any `lib/db/` or `lib/auth/` import before committing — the expected result is zero hits.

4. **Redirect after `saveConfig` must use the returned `saved.id`, not the preset id.** The Load action's final `redirect(`/experiments/${saved.id}`)` uses the UUID assigned by `saveConfig`, which is a freshly generated row id. The preset's `id` (e.g., `'outcome-1-segregation'`) is **not** a `configs.id` and would produce a 404 if used in the redirect URL. This is an easy mistake because both "id" fields are present in the action's scope (`preset.id` is the preset's short-form identifier, `saved.id` is the row UUID). The plan calls this out here for emphasis; the implementing claude names the local variables deliberately (`preset` vs `saved`) to make the distinction obvious at the call site.

## 8. Library choices

No new dependencies. Step 31 uses only packages already installed by prior steps:

- **`zod`** (from step 01) — for `ExperimentConfig.parse(...)` at the top of each preset file.
- **`react`** and **`react-dom`** (from step 00) — for the `PresetCard` Client Component and the optional `useFormStatus` polish.
- **`next`** (from step 00) — for `revalidatePath` and `redirect` in the Server Action.
- **Drizzle + better-sqlite3** (from step 02) — transitively, via `saveConfig` in `lib/db/configs.ts` which the Server Action imports.
- **Vitest** (from step 00) — for the `verify.test.ts` file.
- **Tailwind 4** (from step 00) — for the `PresetCard` styling.

The implementing claude verifies with `npm ls zod next react react-dom vitest` that each resolves cleanly. If any is missing, that is a prior-step regression and step 31 stops and surfaces a diagnostic.

## 9. Unit tests

All tests live in a single file: `lib/sim/presets/verify.test.ts`. Runs under Vitest's default `node` environment. Tests 1-5 run in milliseconds; tests 6-8 run a 50-tick simulation each and should complete under ~5 seconds per preset, for a total file runtime under ~20 seconds. If the simulation-behavior tests are too slow, they can be marked `test.concurrent` and run in parallel (Vitest handles this automatically); if still too slow, reduce to 30 ticks and relax the thresholds marginally.

1. **All three presets parse via Zod.** Iterate `PRESETS`, call `ExperimentConfig.safeParse(preset.config)` (belt-and-braces — the parse already happened at module import, but the test reasserts for clarity), assert every result is `success: true`.

2. **Preset ids are unique and match the expected set.** `PRESETS.map(p => p.id).sort()` deep-equals `['mean-field-control', 'outcome-1-segregation', 'outcome-2-assimilation']`.

3. **Metadata fields are non-empty.** For each preset, `preset.name.length > 0`, `preset.description.length > 0`, `preset.citation.length > 0`.

4. **Citation field references the PDF.** For the two outcome presets, `preset.citation.toLowerCase().includes('slide')` or similar — weak assertion that the citation mentions a slide at all. This guards against a future refactor that strips the citation into a URL or similar loss of traceability. The mean-field preset's citation instead mentions `docs/spec.md §2` or the Baronchelli reference; the assertion for that preset uses a different substring (`'spec.md'` or `'baronchelli'`).

5. **`getPresetById` returns the expected preset.** Three assertions for the three valid ids; one assertion that an invalid id returns `undefined`.

6. **Outcome-1 segregation test.** Import the step-18 simulation harness (exact name verified against step 18's actual exports). Run `simulate(outcome1Segregation, { maxTicks: 50 })`. Extract the tick-50 metrics from the return value. Assert `finalSegregationIndex > 0.2 && finalAssimilationIndex < 0.4`. Inline comment: *"Loose thresholds to survive seed-to-seed variance at 50 ticks. The MCP script runs 100 ticks and the full simulation runs 5000; all three should produce monotonically increasing segregation and decreasing assimilation under this preset."*

7. **Outcome-2 assimilation test.** Symmetric. `finalAssimilationIndex > 0.5`.

8. **Mean-field-control convergence test.** Run 50 ticks. Extract per-tick Nw values. Assert `metrics[50].nw / metrics[0].nw < 0.7` (at least 30% drop). Inline comment referencing Dall'Asta et al. 2008 for the expected mean-field convergence.

All tests are deterministic: seeds are pinned in the preset files (`seed: 1`, `seed: 2`, `seed: 3`), the simulation engine is deterministic per step 09-18's contract, and the assertion thresholds are numeric comparisons with no time- or wall-clock-dependent logic. No `Math.random()`, no `Date.now()`, no network, no DOM.

## 10. Acceptance criteria

### Static gates (run automatically by `scripts/run-plan.ts` after the commit)

- `npm run typecheck` (`tsc --noEmit`) exits 0.
- `npm run lint` (ESLint flat config) exits 0.
- `npm test` exits 0 including the new `lib/sim/presets/verify.test.ts` cases.
- `npm run build` (`next build` under Turbopack) succeeds. The parse-at-import pattern in the preset files means a malformed preset fails the build with a Zod error, which is the primary build-time guard.
- CLAUDE.md growth ≤ 100 lines total for the step (this step adds ≤ 5 per §11).
- Commit marker: the latest commit subject matches `/^step\s+31\s*[:.\-]/i`; `scripts/run-plan.ts` normalizes close variants via `git commit --amend`.

### Chrome-devtools MCP script (the primary verification)

The implementing claude runs the following tool calls in order against `process.env.MSKSIM_BASE_URL`. Seed credentials come from `process.env.MSKSIM_SEED_USER` / `process.env.MSKSIM_SEED_PASS`.

**Phase A — Open a fresh page and log in.**

1. `mcp__chrome-devtools__new_page` at `process.env.MSKSIM_BASE_URL`. Expected: proxy 307 → `/login?next=%2F`.
2. `mcp__chrome-devtools__evaluate_script` to clear `localStorage`, `sessionStorage`, and non-HttpOnly cookies. Return `'cleared'`.
3. `mcp__chrome-devtools__take_snapshot` to capture login form UIDs.
4. `mcp__chrome-devtools__fill` username = `MSKSIM_SEED_USER`.
5. `mcp__chrome-devtools__fill` password = `MSKSIM_SEED_PASS`.
6. `mcp__chrome-devtools__click` the submit button.
7. `mcp__chrome-devtools__wait_for` text confirming successful login (e.g. the dashboard heading).

**Phase B — Navigate to `/experiments` and verify presets section.**

8. `mcp__chrome-devtools__navigate_page` to `${BASE_URL}/experiments`.
9. `mcp__chrome-devtools__wait_for` heading text "Experiments".
10. `mcp__chrome-devtools__wait_for` heading text "Hypothesis presets".
11. `mcp__chrome-devtools__evaluate_script`:
    ```js
    return {
      hasOutcome1: document.body.innerText.includes('Outcome 1 — Segregation'),
      hasOutcome2: document.body.innerText.includes('Outcome 2 — Assimilation'),
      hasControl: document.body.innerText.includes('Mean-field control'),
      loadButtons: document.querySelectorAll('form button[type="submit"]').length,
    };
    ```
    Assert: `hasOutcome1 === true && hasOutcome2 === true && hasControl === true && loadButtons >= 3`.
12. `mcp__chrome-devtools__take_screenshot` → `docs/screenshots/step-31-experiments-presets.png`. The hero shot showing the three cards plus the saved-configs table below.

**Phase C — Load outcome-1 and run in playground.**

13. `mcp__chrome-devtools__take_snapshot` to get the "Load" button UID on the Outcome 1 card.
14. `mcp__chrome-devtools__click` the Load button.
15. `mcp__chrome-devtools__wait_for` URL change to `/experiments/<some-uuid>` — use `evaluate_script` + regex on `location.pathname` to assert the URL matches `/^\/experiments\/[0-9a-f-]{36}$/`.
16. `mcp__chrome-devtools__wait_for` form to render. Confirm the name field has value matching `preset: outcome-1-segregation` via `evaluate_script`.
17. `mcp__chrome-devtools__take_snapshot` to find the "Run" button or "Run in playground" link (step 25 exposes this as a `<Link href="/playground?configId=<id>">Run</Link>` per step-25 plan §5 `ConfigListItem` description; the edit page may or may not expose the same link — if not, extract the config id from the URL and navigate manually to `/playground?configId=<id>`).
18. `mcp__chrome-devtools__navigate_page` to `/playground?configId=<id>` (extracted from URL).
19. `mcp__chrome-devtools__wait_for` the playground shell to render (text from the step-21/24 UI — the implementing claude greps for distinctive strings in those steps' files).
20. `mcp__chrome-devtools__take_snapshot` to find the Play button (step 24).
21. `mcp__chrome-devtools__click` Play.
22. `mcp__chrome-devtools__wait_for` a tick counter to reach 100 (the exact selector depends on step 21/24's rendering — use `evaluate_script` in a polling loop: `return Number(document.querySelector('[data-testid="tick-counter"]')?.textContent ?? '0');` and wait until the value is ≥ 100; or use whatever step 24 named the counter). Timeout after 30 seconds.
23. `mcp__chrome-devtools__evaluate_script` to extract the current metric values from the dashboard:
    ```js
    // Exact selectors depend on step 22's metrics-dashboard implementation.
    // The implementing claude greps step 22's files for the chart data attributes
    // and adapts this script. The goal is to read the final tick's
    // assimilationIndex and segregationIndex values.
    return {
      tick: Number(document.querySelector('[data-testid="tick-counter"]')?.textContent ?? '0'),
      segregation: Number(document.querySelector('[data-testid="segregation-index"]')?.textContent ?? '0'),
      assimilation: Number(document.querySelector('[data-testid="assimilation-index"]')?.textContent ?? '0'),
    };
    ```
    Assert: `tick >= 100`. Log `segregation` and `assimilation` for debugging. **Do not** assert tight thresholds — 100 ticks is short and the indices may still be close to starting values. The assertion is "the metrics exist and are numbers, the simulation ran". The strict parameter-design validation lives in the Vitest file, not the MCP script.
24. `mcp__chrome-devtools__take_screenshot` → `docs/screenshots/step-31-outcome-1.png`.

**Phase D — Repeat for outcome-2.**

25. `mcp__chrome-devtools__navigate_page` to `/experiments`.
26. `mcp__chrome-devtools__click` the Load button on Outcome 2.
27. Repeat steps 15-23 for outcome-2.
28. `mcp__chrome-devtools__take_screenshot` → `docs/screenshots/step-31-outcome-2.png`.

**Phase E — Repeat for mean-field control.**

29. `mcp__chrome-devtools__navigate_page` to `/experiments`.
30. `mcp__chrome-devtools__click` the Load button on Mean-field control.
31. After navigating to the editor, `mcp__chrome-devtools__evaluate_script` to read the topology type from the form. Assert it is `'well-mixed'` (distinguishing this preset from the two lattice presets at the form level — this is a cheap, direct check that the topology field made the round trip from the preset file through the Server Action through the editor).
32. Repeat the playground navigation, Play click, and 100-tick wait as in phase C.
33. `mcp__chrome-devtools__take_screenshot` → `docs/screenshots/step-31-control.png`.

**Phase F — Console and network triage.**

34. `mcp__chrome-devtools__list_console_messages`. Filter to `level === 'error'`. Expected: zero. React 19 strict-mode warnings are benign per CLAUDE.md "UI verification harness".
35. `mcp__chrome-devtools__list_network_requests`. Iterate all entries. Expected: every status in `[200, 204, 301, 302, 303, 307, 308]`. Any 4xx or 5xx fails the step.

**Phase G — Commit.**

36. Stage and commit all new files: the three preset modules, the preset index, the Server Action module, the `PresetCard` Client Component, the test file, the four screenshots, the edit to `app/(auth)/experiments/page.tsx`, and the CLAUDE.md append. Subject line exactly `step 31: hypothesis presets` per §12. One commit.

## 11. CLAUDE.md updates

Append ≤ 5 lines total across one or two sections. This is well under the hard cap of 100 lines per step and well under each section's individual cap.

### "Directory layout" (1 line)

- Add a single bullet under `lib/sim/` (or create a new sub-entry for it if the directory layout section lists `lib/sim/` as a leaf):
  > `lib/sim/presets/` — hypothesis preset `ExperimentConfig` constants (F17; step 31). Citations to source PDF slides in each file's top comment.

### "Known gotchas" (optional, ≤ 3 lines)

- Optionally add one bullet if the implementing claude hit the `'use server'` data-co-location wart (research note 4):
  > A file with `'use server'` at the top can export **only async functions**; non-function exports fail the Next 16 `'use server'` directive check at build time. Split data (`lib/sim/presets/*.ts`) from actions (`app/(auth)/experiments/preset-actions.ts`) into separate modules. See step 31's §4 research note 4.

If the `'use server'` wart did not surface during implementation (e.g., the implementing claude landed the split cleanly on the first try without hitting the error), this bullet can be omitted — it describes a trap that could trip up later agents but is not a current-step finding per the CLAUDE.md living-document rules.

Total appended: 1-4 lines. The step stays under all caps.

## 12. Commit message

Exactly:

```
step 31: hypothesis presets
```

No conventional-commit prefix (`feat:`, `chore:`, etc.), no emoji, no trailing period. The `step 31:` marker is load-bearing for `scripts/run-plan.ts` progress detection (CLAUDE.md "Commit-message convention"). One commit for the whole step, including the four screenshot binaries under `docs/screenshots/step-31-*.png`. If intermediate commits occur during implementation, the orchestrator squashes them before advancing.

The commit body (optional but recommended) lists:
- The three preset config modules and their citations (one line each).
- The preset index module.
- The new `PresetCard` Client Component and the new `loadPresetAction` Server Action.
- The edit to `app/(auth)/experiments/page.tsx` (additive only).
- The new Vitest file and a one-line summary of the verification assertions.
- The four screenshot files.
- A one-line MCP verification result summary.

## 13. Rollback notes

If the step lands in a broken state and needs to be undone (destructive — requires user confirmation per CLAUDE.md commit-safety rules):

1. `git log --oneline | head -20` to find the commit SHA immediately prior to `step 31: hypothesis presets`. It will have the subject `step 30: export` (or a normalized variant).
2. `git reset --hard <step-30-sha>`. This reverts everything in step 31: the preset modules under `lib/sim/presets/`, the Server Action module `app/(auth)/experiments/preset-actions.ts`, the `PresetCard` Client Component, the verification test file, the four screenshot binaries under `docs/screenshots/step-31-*.png`, the additive JSX block in `app/(auth)/experiments/page.tsx`, and the CLAUDE.md append — all in one operation. Because step 31 adds no new dependencies, there is no `npm uninstall` step; `package.json` and `package-lock.json` are untouched by step 31 and the reset therefore leaves them in their step-30 state.
3. Verify `git status` is clean and that `app/(auth)/experiments/page.tsx` has reverted to its step-25 state (no imports from `@/lib/sim/presets`, no `<PresetCard>` usage, no "Hypothesis presets" heading).
4. Verify the `lib/sim/presets/` directory is gone (or only contains whatever step 18 or earlier placed there, if any — `ls lib/sim/presets/` should error with "No such file or directory" after a clean reset from step 30's tree).
5. Verify any preset-related rows in the `configs` table from a prior test run are still present (step 31's DB writes are not reverted by the git reset — they are data). If the rollback was triggered because the test fixture DB leaked preset rows, manually clean them up: `sqlite3 data/msksim.db "DELETE FROM configs WHERE name LIKE 'preset: %';"`. This is a maintenance task separate from the git reset.
6. Run `npm run typecheck` and `npm test` against the rolled-back tree to confirm no stale imports or orphaned test files were left behind.
7. Re-run `npx tsx scripts/run-plan.ts --only 31` to redo the step from a clean base once the underlying issue is fixed. Because `scripts/run-plan.ts` greps for the `step 31:` marker and the marker is gone after the reset, the orchestrator picks step 31 up as pending automatically.
