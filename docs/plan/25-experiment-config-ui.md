---
step: "25"
title: "experiment config ui"
kind: ui
ui: true
timeout_minutes: 40
prerequisites:
  - "step 01: zod config schema"
  - "step 08: run persistence schema"
  - "step 07: login and app shell"
---

## 1. Goal

Ship **F11 (Experiment Configuration UI)** from `docs/spec.md` §4.3: a form-driven editor for the full `ExperimentConfig` (from step 01's Zod schema) backed by the `configs` table (from step 08), accessible under the authenticated `app/(auth)/experiments/` route group established by step 07. Concretely, this step delivers (a) a list page at `app/(auth)/experiments/page.tsx` that **replaces** the step-07 stub with a Server Component rendering of every saved row in `configs`, sorted by `updatedAt` descending, with per-row actions Edit / Duplicate / Delete / Run; (b) a "new config" page at `app/(auth)/experiments/new/page.tsx` that renders an empty editor seeded from `ExperimentConfig.parse({})` (which step 01 guarantees is a complete runnable config); (c) an "edit config" page at `app/(auth)/experiments/[id]/page.tsx` that fetches the row via `loadConfig(id)` from step 08, re-parses through the Zod schema, and hydrates the same editor; (d) a shared Client Component `ConfigEditor` that uses **React Hook Form + `@hookform/resolvers/zod`** (picked and justified in §4 and §8) to render form fields for every top-level field in `ExperimentConfig` — World 1 / World 2 nested groups (agent count, mono:bi ratio slider with tick marks, topology discriminated union with conditional lattice fields, neighborhood selector, vocabulary seed as JSON textarea), tick count, seed, Δ⁺, Δ⁻, retry limit, weight update rule, scheduler mode, sample interval, the four `(speakerClass, hearerClass)` language policy rows from step 12, and the preferential attachment group (enabled toggle, warm-up ticks, temperature, top-K); (e) field-level error display inline next to each invalid control, driven by `formState.errors` from RHF combined with Zod's `flatten().fieldErrors` structure; (f) a Server Action at `app/(auth)/experiments/actions.ts` that receives the RHF-serialized form data, re-validates it through `ExperimentConfig.parse` server-side (per the Next 16 `data-security.md` DAL-for-mutations doctrine that every Server Action re-validates at the boundary regardless of any client-side checks), and writes through `saveConfig` from `lib/db/configs.ts`; (g) a `duplicateConfigAction` Server Action that loads a row, mutates its `name` to `"Copy of <original>"`, and re-saves via `saveConfig` (the content hash is unchanged because the ExperimentConfig content is identical — the name is a sibling column); (h) a `deleteConfigAction` Server Action wrapping `deleteConfig(id)` with a `confirm()`-based client-side gate (acceptable for v1 per the step-specific context's "styled confirmation is optional"); (i) a "Run" button per row that navigates to `/playground?configId=<id>` — the playground shell from step 24 will read the search param and load the config (the playground-side wiring is a small add that this step declares but whose rendering is owned by step 24's existing shell, so this step contributes only the link); and (j) **JSON import/export** per F11's acceptance clause *"the exported JSON re-imports losslessly"*: Export is an API route at `app/api/configs/[id]/export/route.ts` that returns the canonicalized JSON with `Content-Disposition: attachment; filename="<name>-<hash8>.json"` (picked over a Server Action because per CLAUDE.md "Export conventions" Server Actions cannot set `Content-Disposition`, and step 30 already commits to the API-route pattern for the same reason); Import is a file `<input type="file">` in `ConfigEditor` that reads the selected file via `FileReader`, parses through `ExperimentConfig.parse` to surface runtime validation errors inline, and populates the RHF form via `reset(parsed)`. The round-trip identity (export → import → same field values) is the primary correctness criterion for F11 and is exercised end-to-end in §10's MCP script. Scope boundary is strict: this step does **not** touch the simulation engine (steps 09-18), does **not** persist runs (step 26), does **not** implement presets (step 31), and does **not** re-architect the playground shell (step 24). It only wires the config editor surface on top of the already-established `configs` table, the already-established Zod schema, and the already-established auth shell.

## 2. Prerequisites

- **Step 01 — zod config schema.** `lib/schema/experiment.ts` exports `ExperimentConfig` with `.default(...)` on every field, guaranteeing `ExperimentConfig.parse({})` returns a runnable config. Step 25's editor treats this schema as the single source of truth: the form field list is derived from `ExperimentConfig.shape` at implementation time; the server-side validation in the Server Action calls `ExperimentConfig.parse(rawFormData)`; the RHF `zodResolver(ExperimentConfig)` at the client end uses the same schema instance. If step 01 has not landed or the schema shape differs from what this plan enumerates in §7, step 25's implementing claude must inspect the actual shipped schema via `Read` and either adapt the field list or surface a clear delta report before editing. Every numeric bound (Δ⁺ positive, tickCount integer > 0, mono:bi ratio > 0, etc.) is defined by step 01's schema, not hardcoded here.
- **Step 08 — run persistence schema.** `lib/db/configs.ts` exports `saveConfig`, `loadConfig`, `listConfigs`, `deleteConfig`. Step 25 is the first step that writes to this module from a UI surface. Two subtleties of step 08's helper contract are load-bearing for step 25: (a) `saveConfig` takes a **parsed** `ExperimentConfig` as input, not a raw object — the Server Action in step 25 must parse before calling; (b) `saveConfig` canonicalizes keys and computes a SHA-256 hash, so two calls with the same logical content produce identical `content_hash` values, which step 25's export filename generator reuses as the first 8 hex characters. The helper does **not** dedup on hash, so "Duplicate" simply re-saves the same content under a new name — the resulting row has the same `content_hash` as the original, which is the intended behavior.
- **Step 07 — login and app shell.** `app/(auth)/layout.tsx` is the authenticated shell with a header, nav row, and `verifySession()` guard. `app/(auth)/experiments/page.tsx` already exists as a stub (`<h1>Experiments</h1>` + "built in step 25" placeholder). Step 25 **replaces** the body of that file with the list view. The nav row's `Experiments` link (from step 07's header component) already points at `/experiments`; step 25 does not touch the nav. Per the CLAUDE.md "Authentication patterns" contract, every new Server Component page (`new/page.tsx` and `[id]/page.tsx`) calls `await verifySession()` at the top of its function body even though the layout already ran — relying on the layout alone is explicitly unsafe per the Next 16 `data-security.md` guidance re-stated in CLAUDE.md. Every new Server Action in `app/(auth)/experiments/actions.ts` also calls `verifySession()` as its first line for the same reason.
- **Step 12 — language selection policies.** The four default `(speakerClass, hearerClass)` language policies are declared by step 12 and live in `lib/sim/policies/` (or equivalent) with a `defaultLanguagePolicies` export the schema layer references. Step 25's editor renders one row per policy with the rule identifier shown as read-only metadata and the `languageBias` shown as a pair of editable numeric inputs (the only per-policy knob). The four rows cover: W1-Bi → W1-Mono (always L1, no bias), W1-Bi → W1-Bi (configurable bias), W2-Imm → W2-Native (configurable bias), W2-Imm → W2-Imm (configurable bias). If step 12's policy identifiers or bias shape differ from what this plan documents, the implementing claude matches step 12's reality — the form field list is a function of the schema, not a freestanding list.
- **Step 14 — preferential attachment.** The preferential attachment config fields (`enabled`, `warmUpTicks`, `temperature`, `topK` where "top-K" is a slight generalization of the `similarityMetric` field in step 01's schema — verify against the actual shipped schema before writing form fields). Step 25's editor groups these into a disclosure panel under "Preferential attachment" so researchers can collapse it when running ablations.
- Node ≥ 20.9 (for Next 16 and native modules). React 19.2.4. Next.js 16.2.2. Tailwind 4. Vitest with `happy-dom` opt-in for the one component test this step ships.

## 3. Spec references

- **`docs/spec.md` §4.3 Batch runner mode — intro.** The prose framing for the entire "experiment workflow" phase: *"The simulation treats **live interactive playground** and **batch experiment runner** as equally first-class modes. A researcher can move fluidly between 'tweak a slider, watch the lattice evolve' and 'queue 200 replicate runs, walk away, come back to aggregated metrics.' Both modes share the same underlying simulation engine and configuration schema."* Step 25 is the first UI surface inside the batch-runner half of this duality, and its job is to make "queue 200 replicate runs" a concrete action the researcher can start from: save a config here, then point a batch at it (step 27). The "shared configuration schema" clause is load-bearing because it pins the Zod schema from step 01 as the only legal shape the editor can emit — the UI is a **view onto** the schema, not a parallel type system.

- **`docs/spec.md` §4.3 F11. Experiment configuration UI.** The literal feature step 25 implements. The spec text: *"A form-driven editor for the full experiment config, validated by a shared schema. Configurations can be saved to and loaded from the browser's local storage, duplicated, and exported as JSON."* The acceptance clause: *"Invalid configs cannot be run (schema errors are shown inline); the exported JSON re-imports losslessly; a config library shows all saved configs with search."* Three concrete requirements step 25 honors from this text:
  1. *"form-driven editor for the full experiment config"* — every top-level field in `ExperimentConfig` (and every nested field in its subschemas) has a form control in §7. No skipped fields, no "advanced" drawer hiding required configuration. The `vocabularySeed` is the one exception handled as a textarea of JSON (§7 documents the rationale).
  2. *"validated by a shared schema"* — the same `ExperimentConfig` instance from `lib/schema/experiment.ts` is used by RHF's `zodResolver`, by the Server Action's `safeParse` at the mutation boundary, and by step 08's `saveConfig` on its typed argument. Three call sites, one schema.
  3. *"exported JSON re-imports losslessly"* — §7's export route returns the canonicalized JSON that `saveConfig` wrote to `content_json`, and §7's import path reads that same string, runs `JSON.parse` + `ExperimentConfig.parse`, and calls RHF's `reset(parsed)`. The round-trip identity is asserted by MCP step 10 in §10.
  
  The "browser's local storage" wording in the spec is a relic of the original IndexedDB architecture and is overridden by CLAUDE.md "Stack and versions" (SQLite via drizzle). Step 25 writes to the `configs` SQLite table, not to `localStorage`. The spec's acceptance criteria are preserved verbatim — save, load, duplicate, export, import — only the storage substrate moves server-side. The "config library shows all saved configs with search" phrase informs the list page in §7 (and §11 documents that search is deferred to a v2 refinement because the v1 row count is expected to stay under ~20 — two researchers building 10-20 configs over the course of the project is the realistic usage pattern per `docs/spec.md` §1).

- **`docs/spec.md` §3.3 Interaction rules.** The authoritative definition of Δ⁺, Δ⁻, the retry limit, and the scheduler modes (sequential / random / priority) — every one of these surfaces as a form control in the editor. The spec's rationales flow into the form's help text (e.g., Δ⁻'s *"the PDF says 'the agent will find another peer...' In the minimal Naming Game there is no weight decrement on failure; v1 follows this convention, with an optional penalty Δ⁻ exposed as a parameter"* becomes the tooltip next to the Δ⁻ input explaining that `0` is the canonical default and non-zero values diverge from the minimal Naming Game).

- **`docs/spec.md` §7.2 Per-tick tensor snapshots.** Defines the `sampleInterval` field (default 10) as "every N ticks"; the editor exposes this as a numeric input labeled "Snapshot sampling interval" with a brief note that lower values produce larger on-disk run records.

- **CLAUDE.md "Authentication patterns".** Every Server Component and Server Action in step 25 calls `verifySession()` directly (not relying on the layout). Section 7's action sequence and section 5's file list are explicit about this: the list page, the new page, the edit page, and every Server Action in `actions.ts` each begin with `const { user } = await verifySession();` as their first statement. Forgetting this call is a security regression even though the proxy and the layout both run — the "defense in depth" DAL pattern is load-bearing.

- **CLAUDE.md "Database access patterns".** `lib/db/configs.ts` is the only module that talks to the `configs` table; step 25's Server Actions import `saveConfig`, `loadConfig`, `listConfigs`, and `deleteConfig` from that module and never issue drizzle queries directly. The Server Component list page also reads through `listConfigs()` rather than inlining a `db.select().from(configs)` call. This is the DAL-for-mutations pattern applied symmetrically to reads.

- **CLAUDE.md "UI verification harness".** Step 25 is a UI step with `ui: true` in its frontmatter. `scripts/run-plan.ts` starts `next build && next start` on a random port, seeds the test user, sets `MSKSIM_BASE_URL` / `MSKSIM_SEED_USER` / `MSKSIM_SEED_PASS`, and invokes `claude -p` with a budget of 40 minutes. Section 10's MCP script follows the same shape as step 07's login script (Phase A open page, Phase B log in, etc.) and saves a home-screen screenshot to `docs/screenshots/step-25-experiments.png`. The console triage and network triage phases are identical to step 07's.

- **CLAUDE.md "Export conventions"** (declared for step 30, cross-referenced here). Step 30 formalizes the rule that exports go through API routes (`app/api/export/...`) because Server Actions cannot set `Content-Disposition`. Step 25 adopts the same pattern one step early for its JSON export: `app/api/configs/[id]/export/route.ts` is a `GET` Route Handler that reads via `loadConfig`, serializes the canonical JSON, and returns it as an attachment. The filename includes the first 8 hex characters of the content hash, matching step 30's filename convention (`<config-name>-<hash8>.json`).

## 4. Research notes

Minimum requirements met: **≥ 3 local Next docs (forms.md, authentication.md, data-security.md), ≥ 2 external URLs (React Hook Form, Zod resolver), ≥ 1 path not taken. Total ≥ 5.**

### Local Next.js 16 documentation (authoritative per `CLAUDE.md` "Next.js 16 deltas from training data" and `AGENTS.md`)

1. **`node_modules/next/dist/docs/01-app/02-guides/forms.md`**, §"Form validation" (~lines 129-189) and §"Validation errors" (~lines 190-275). The authoritative Next 16 reference for the Server Action + Zod pattern step 25 adopts at the mutation boundary. Load-bearing facts confirmed by reading the doc:
   - The canonical example wraps the action body in `const validatedFields = schema.safeParse({ ... });` and returns `{ errors: validatedFields.error.flatten().fieldErrors }` on failure. Step 25's `saveConfigAction` follows this shape **exactly** at its outermost level, with one elaboration: because the editor is a nested form with discriminated unions and arrays, the raw FormData does not flatten cleanly into the schema's shape, so the Client Component serializes the RHF form values to JSON in a hidden `<input type="hidden" name="payload">` and the Server Action does `JSON.parse(formData.get('payload') as string)` before calling `ExperimentConfig.safeParse(...)`. This is a common pattern for non-trivial forms and is documented in §7 below.
   - The doc shows `useActionState` with a `Client Component` wrapper for inline error display. Step 25's `ConfigEditor` is already a Client Component (it needs RHF hooks, which are client-only), so the wiring is: `const [state, formAction, pending] = useActionState(saveConfigAction, { ok: false, fieldErrors: {} });` and a single "Save" button with `disabled={pending || !formState.isValid}`. The `state.fieldErrors` returned from the action are merged into RHF's error display via `setError(path, { message })` in a `useEffect` that watches `state` — this is the cleanest way to surface server-side Zod errors at the same call site as client-side RHF errors.
   - The doc's "Pending states" section (~lines 276-350) confirms `disabled={pending}` is the correct attribute on the submit button. RHF also provides `formState.isSubmitting` which is separately useful for the client-only draft state before the action is dispatched; step 25 uses `pending || formState.isSubmitting` as the button's disabled condition to cover both cases.

2. **`node_modules/next/dist/docs/01-app/02-guides/authentication.md`**, §"Sign-up and login functionality → Validate form fields on the server" (~lines 140-250). Re-confirms the pattern already established by step 07's login action: a Zod schema is defined in the same module as the action (or imported from `lib/schema/...`), `safeParse` is called first, and any validation failure short-circuits the rest of the action body. Step 25's `saveConfigAction` uses `ExperimentConfig.safeParse(parsedJson)` at the top of its body. The same doc re-states the DAL discipline: *"Always verify authentication and authorization inside each Server Action, even if the form is only rendered on an authenticated page."* Step 25 opens every action with `const { user } = await verifySession();` (importing from `lib/auth/dal.ts`). The auth doc's reminder that Server Actions are a separate entry point from the page-level render path is the justification for duplicating the session check.

3. **`node_modules/next/dist/docs/01-app/02-guides/data-security.md`**, §"Data Access Layer" (~lines 55-130) and §"Using a Data Access Layer for mutations" (~lines 387-430). Step 25's Server Actions are the thin wrapper between the form and the step-08 DAL helpers (`saveConfig`, `loadConfig`, `listConfigs`, `deleteConfig`). The doc's "Just as we recommend a Data Access Layer for reading data, you can apply the same pattern to mutations. This keeps authentication, authorization, and database logic in a dedicated server-only module, while 'use server' actions stay thin" is the shape step 25 implements verbatim: the `actions.ts` file is thin, the real work is in `lib/db/configs.ts` from step 08, and the action's job is to call `verifySession()`, parse/validate the input through Zod, delegate to the DAL helper, and then `revalidatePath('/experiments')` plus `redirect(...)` on success. The doc's "Controlling return values" subsection (~lines 429-464) informs the Server Action's return type: it never returns raw `Config` rows to the client (which would leak `createdBy` and other internal columns), it returns only `{ ok: true, id: string } | { ok: false, fieldErrors: Record<string, string[]> }`.

### External references (WebFetched / Context7)

4. **React Hook Form — Get Started → Schema Validation** — `https://react-hook-form.com/get-started#SchemaValidation`. The canonical documentation for wiring RHF to Zod via `@hookform/resolvers/zod`. Load-bearing facts confirmed by the fetch:
   - Install command: `npm install react-hook-form @hookform/resolvers zod`. Zod is already installed by step 01, so step 25's `package.json` edit only adds the first two packages.
   - Usage pattern:
     ```ts
     import { useForm } from 'react-hook-form';
     import { zodResolver } from '@hookform/resolvers/zod';
     import { ExperimentConfig } from '@/lib/schema/experiment';
     type FormValues = z.infer<typeof ExperimentConfig>;
     const { register, handleSubmit, formState: { errors }, control, reset, watch, setValue, setError } = useForm<FormValues>({
       resolver: zodResolver(ExperimentConfig),
       defaultValues: ExperimentConfig.parse({}),
     });
     ```
   - `register('fieldPath')` returns the ref + onChange + onBlur + name props to spread on native inputs. For nested paths (e.g., `register('world1.agentCount')`), RHF resolves the dot-path against the form state. This is how step 25's editor handles the nested World 1 / World 2 groups without flattening.
   - `control` is the object passed to `<Controller>` for non-native inputs (the custom slider for mono:bi ratio, for example). The `Controller` component is the RHF-sanctioned way to wrap any controlled input that does not expose a native `ref` — it handles value/onChange binding and integrates with the same `formState.errors`.
   - `reset(values)` replaces the entire form state with a new `defaultValues` snapshot. Step 25's Import flow calls `reset(parsedJson)` after successful Zod validation on the imported file. The RHF doc confirms this is the correct API for "load a config into the form" flows.
   - `watch('topology.type')` returns the current value of a field and re-subscribes on change. Step 25 uses `watch('world1.topology.type')` to conditionally render the lattice width/height/neighborhood fields only when the type is `'lattice'` — this is the discriminated-union support in the UI layer. The doc confirms that `watch` at a single path is cheap and does not re-render the whole form.
   - `zodResolver` produces RHF-formatted errors from Zod's `.error.format()` tree, so `formState.errors.world1.agentCount.message` is populated automatically when `z.number().int().positive()` rejects a bad value. The step-01 schema's min/max/positive checks flow directly into the form's error display with no additional wiring.

5. **`@hookform/resolvers` README — Zod section** — `https://github.com/react-hook-form/resolvers#zod` (WebFetched / Context7). Confirms the package provides a one-line `zodResolver(schema)` helper compatible with every Zod feature step 01 uses: discriminated unions, nested objects, records, `default`-annotated fields, branded strings, and numeric refinements. The resolver re-validates on every `handleSubmit` call and optionally on every field change (`mode: 'onChange'`). Step 25 uses `mode: 'onBlur'` to avoid validating on every keystroke of the `vocabularySeed` JSON textarea (which would thrash re-renders on a multi-line input); the rest of the fields validate on blur, which is the RHF default. The resolver version pinned in `package.json` matches the latest stable at the time of implementation; the implementing claude runs `npm view @hookform/resolvers version` to confirm.

6. **React Hook Form — `<Controller>` reference** — `https://react-hook-form.com/docs/usecontroller/controller`. Documents the `<Controller name="..." control={control} render={({ field, fieldState }) => ...}>` pattern used by step 25 for non-native inputs. The two custom inputs step 25 ships that require `Controller` are: (a) the mono:bi ratio slider (a custom range input with visible tick marks for 0.0, 0.25, 0.5, 0.75, 1.0 — the spec's 3:2 default corresponds to 0.6 on the 0..1 axis, but the step-01 schema stores it as a raw ratio `1.5` not a normalized 0..1 value, so the slider renders in ratio units and the tick marks are at 0.5, 1.0, 1.5, 2.0, 3.0 — the step-01 schema's `.default(1.5)` is the 3:2 canonical value); (b) the topology type selector as a three-way radio whose selection governs which conditional fields render next (confirming the discriminated-union narrowing works in the UI).

### Path not taken

7. **Hand-rolled form state (useState + manual field binding) — rejected.** The alternative to RHF + `@hookform/resolvers/zod` is a fully hand-written form using `useState` for each field, manual `onChange` handlers, and a hand-rolled `ExperimentConfig.safeParse` call at submit time with manual error display. For a trivial login form (step 07, two fields) this is the right choice — zero dependency, ~20 lines of code. For step 25's `ExperimentConfig` editor, the hand-rolled path would require:
   - Per-field `useState` hooks for ~25 top-level and nested fields (World 1 × 4 + World 2 × 4 + tickCount + seed + Δ⁺ + Δ⁻ + retryLimit + weightUpdateRule + schedulerMode + sampleInterval + 4 language policies × 2 bias fields + preferential attachment × 4 + vocabularySeed textarea = ~30+ individual state slots). React would re-render the entire form on every keystroke in any field.
   - Hand-written error-path extraction from Zod's `.error.flatten()` output mapped into per-field error slots. This is the single most repetitive piece of hand-rolled form code and the most error-prone (off-by-one path strings, missing array-index handling, missed discriminated-union narrowing).
   - Hand-written discriminated-union UI logic: when `topology.type` changes, the width/height fields must render or not render, and their default values must be pulled from the schema each time the type changes. RHF's `watch` + `reset` handles this in three lines; the hand-rolled version is ~30 lines with its own bugs.
   - Hand-written import-file-to-form-state flow: after Zod parses the imported JSON, every state slot must be individually updated via its `setState` setter. RHF's `reset(parsed)` is one call.
   
   The estimated line count delta: hand-rolled ~400-500 lines of boilerplate; RHF + resolvers ~150-200 lines of configuration plus the imports. The dependency cost is **~15KB gzipped** (RHF is famously one of the smallest form libraries in the React ecosystem — the home page explicitly advertises "package size matters"; `@hookform/resolvers/zod` is ~2KB). For an authenticated research tool where bundle size is not a TTFB-critical concern (CLAUDE.md "Stack and versions" explicitly says it is "not optimized for public-page TTFB"), trading 15KB for 250+ lines of hand-rolled form plumbing and a dozen likely-bugs is an obvious trade. **Decision: React Hook Form + `@hookform/resolvers/zod`**, pinned to the latest stable versions at implementation time. The hand-rolled alternative remains the right choice for the login form and any future ≤3-field form, but not here.

### Quality gate check

- Local Next docs: 3 (forms.md, authentication.md, data-security.md). ✓
- External URLs: 3 (RHF Get Started, RHF Controller, `@hookform/resolvers` README). ✓
- Path not taken: 1 (hand-rolled form state). ✓
- Total citations: 7. ✓

## 5. Files to create

All paths relative to the repo root.

### Route files

- **`app/(auth)/experiments/new/page.tsx`** — Server Component. First line of the function body: `const { user } = await verifySession();`. Imports `ConfigEditor` from `./ConfigEditor`, imports `ExperimentConfig` from `@/lib/schema/experiment`, and renders `<ConfigEditor mode="new" initialValues={ExperimentConfig.parse({})} />` inside the authenticated shell. Sets page metadata: `export const metadata = { title: 'msksim — new config' }`. No DB reads — the defaults come from the Zod schema.

- **`app/(auth)/experiments/[id]/page.tsx`** — Server Component. Takes `props: PageProps<'/experiments/[id]'>` (generated by `next typegen` from the dynamic segment). First line: `const { user } = await verifySession();`. Second line: `const params = await props.params;` (Next 16 async params — forgetting the `await` is listed in CLAUDE.md "Known gotchas"). Third line: `const result = await loadConfig(params.id);` importing from `@/lib/db/configs`. If `result === null`, call `notFound()` from `next/navigation`. Otherwise renders `<ConfigEditor mode="edit" configId={params.id} initialName={result.row.name} initialValues={result.parsed} />`. Sets metadata from the loaded name.

- **`app/(auth)/experiments/actions.ts`** — Server Action module. First line: `import 'server-only';`. Second line: `'use server';`. Imports: `z` from `'zod'`; `ExperimentConfig` from `@/lib/schema/experiment`; `saveConfig`, `loadConfig`, `deleteConfig` from `@/lib/db/configs`; `verifySession` from `@/lib/auth/dal`; `revalidatePath`, `redirect` from `'next/cache'` and `'next/navigation'` respectively. Exports four Server Actions:
  - `saveConfigAction(prevState: SaveState, formData: FormData): Promise<SaveState>` — (1) `await verifySession()`, (2) read `const payload = formData.get('payload') as string` (the JSON-encoded RHF values), (3) parse JSON (try/catch, return `{ ok: false, fieldErrors: { _root: ['invalid json payload'] } }` on failure), (4) `const validated = ExperimentConfig.safeParse(json);` return `{ ok: false, fieldErrors: validated.error.flatten().fieldErrors }` on failure, (5) read `const id = formData.get('id') as string | null;` and `const name = formData.get('name') as string;`, (6) if `id` is null or empty → call `saveConfig({ name, config: validated.data, createdBy: user.id })` (new), otherwise → call the update path: currently step 08 exposes only `saveConfig` (which always inserts); for edit mode we **delete the old row and insert the new one** (the UUID changes but the `content_hash` stays the same if the content did not change) — this is acceptable because `configs.id` is a surrogate key the user never sees in URLs after the edit, and `revalidatePath('/experiments')` handles the staleness; the alternative of adding an `updateConfig` helper to step 08 is a small plan deviation documented in §11 as a follow-up. Actually, re-reading step 08's helper list more carefully: the cleanest path is to add a thin `updateConfig(id, { name, config })` helper in step 25's `lib/db/configs.ts` extension (see "Files to modify" below) rather than introducing delete/insert churn. The implementing claude picks one of the two paths and documents the choice in the commit body. (7) `revalidatePath('/experiments')`, (8) `redirect('/experiments')` (outside any try/catch per CLAUDE.md "Known gotchas" on `NEXT_REDIRECT`).
  - `duplicateConfigAction(id: string): Promise<void>` — (1) `await verifySession()`, (2) `const result = await loadConfig(id);` bail with a thrown error on null, (3) `await saveConfig({ name: \`Copy of ${result.row.name}\`, config: result.parsed, createdBy: user.id })`, (4) `revalidatePath('/experiments')`.
  - `deleteConfigAction(id: string): Promise<void>` — (1) `await verifySession()`, (2) `await deleteConfig(id)`, (3) `revalidatePath('/experiments')`.
  - `importConfigJson(formData: FormData): Promise<{ ok: true; config: ExperimentConfig } | { ok: false; error: string }>` — (1) `await verifySession()`, (2) read `const file = formData.get('file') as File;`, (3) `const text = await file.text();`, (4) `const json = JSON.parse(text)` (try/catch → `{ ok: false, error: 'invalid json' }`), (5) `const validated = ExperimentConfig.safeParse(json);` (fail → `{ ok: false, error: validated.error.message }`), (6) return `{ ok: true, config: validated.data }`. **Note**: this helper runs server-side because client code cannot `ExperimentConfig.parse(...)` without bundling the schema — but the schema is deliberately client-safe (step 01 plan §4 documents that `lib/schema/` does NOT start with `import 'server-only'`), so the import can alternatively happen entirely client-side in `ConfigEditor.tsx`, and the server-side `importConfigJson` action is **not strictly needed**. The implementing claude picks the client-side path (simpler, no server round-trip for a pure-validation operation) and omits `importConfigJson` from the actions module. Section 7 documents this decision.

- **`app/(auth)/experiments/ConfigEditor.tsx`** — Client Component (`'use client'` on line 1). The heart of step 25. Imports: `useForm`, `Controller`, `useActionState` from `react-hook-form` and `react`; `zodResolver` from `@hookform/resolvers/zod`; `ExperimentConfig` (and its inferred type) from `@/lib/schema/experiment`; `saveConfigAction` and `deleteConfigAction` and `duplicateConfigAction` from `./actions`; `useRouter` from `next/navigation`. Props: `{ mode: 'new' | 'edit'; configId?: string; initialName?: string; initialValues: ExperimentConfigType }`. State:
  - `const [state, formAction, pending] = useActionState(saveConfigAction, { ok: false, fieldErrors: {} });`
  - `const form = useForm<ExperimentConfigType>({ resolver: zodResolver(ExperimentConfig), defaultValues: initialValues, mode: 'onBlur' });`
  - `const topology1 = form.watch('world1.topology.type');` — for conditional lattice fields.
  - `const topology2 = form.watch('world2.topology.type');`
  - `const [importError, setImportError] = useState<string | null>(null);`
  
  Form layout:
  - A text input for `name` (a sibling column, not part of `ExperimentConfig`; this is why the form has a top-level `name` field and a nested `ExperimentConfig` payload).
  - A two-column grid with "World 1" and "World 2" card headers, each card containing the nested subform (agentCount number input, mono:bi ratio slider, topology radio + conditional lattice fields, referents list, vocabularySeed JSON textarea).
  - Collapsible "Interaction engine" disclosure with tickCount, deltaPositive, deltaNegative, retryLimit, weightUpdateRule, schedulerMode, sampleInterval.
  - Collapsible "Language policies" disclosure with four rows (one per `(speakerClass, hearerClass)` pair), each row a read-only rule-id label plus two numeric inputs for `languageBias.L1` and `languageBias.L2` (when the rule allows bias).
  - Collapsible "Preferential attachment" disclosure with `enabled` checkbox, `warmUpTicks`, `temperature`, `topK` (or `similarityMetric` per the actual schema).
  - A "Seed" number input at the top level.
  - A row of action buttons at the bottom: Save (submit), Cancel (router.push back to `/experiments`), Export, Import (file input hidden behind a styled button).
  - For mode === 'edit', a separate Delete button and Duplicate button near the top of the form (not inside the save/cancel row) to keep destructive actions visually distinct.
  
  Form submission:
  - The `<form>` element's `action` prop is `formAction` (from `useActionState`).
  - A hidden `<input type="hidden" name="payload" value={JSON.stringify(form.getValues())} />` carries the RHF state as a JSON string. **Important**: because RHF's form state changes on every keystroke but React does not re-render the hidden input attribute until the component re-renders, the value must be computed inside a `useWatch` subscription or the submit handler must intercept and re-serialize. The cleanest shape: use `handleSubmit(onValidSubmit)` as the form's `onSubmit` prop, and inside `onValidSubmit` construct a new FormData, set `payload`, `name`, `id` (if edit), and call `formAction(formDataInstance)` imperatively. This bypasses the hidden-input serialization entirely and is the pattern RHF documents for Server Action integration. The `action={formAction}` prop is dropped in favor of `onSubmit={handleSubmit(onValidSubmit)}`. The submit button stays `type="submit"` so keyboard Enter still submits via the form's onSubmit.
  - Error merging: `useEffect` watching `state.fieldErrors` calls `form.setError(path, { message })` for each entry, surfacing server-side Zod errors in the same inline slots as client-side errors.

- **`app/(auth)/experiments/ConfigListItem.tsx`** — Client Component for the per-row actions. Takes `config: ListedConfig` (a thin DTO containing `{ id, name, contentHash, updatedAt, tickCount }` — computed by the list page) and renders: the name, a timestamp, the first 8 chars of `contentHash`, and four buttons (Edit → Link, Duplicate → calls `duplicateConfigAction(id)` inside a `<form action={...}>`, Delete → calls `deleteConfigAction(id)` inside a form after a `confirm('Delete configuration?')` gate in a `onSubmit` handler, Run → Link to `/playground?configId=${id}`, Export → Link to the API route `/api/configs/${id}/export`). The Delete button's confirm() gate is the simplest acceptable implementation per the step-specific context.

- **`app/api/configs/[id]/export/route.ts`** — Route Handler. First line: `import 'server-only';`. Exports `export async function GET(request: Request, props: { params: Promise<{ id: string }> }): Promise<Response>`. Body: (1) `await verifySession();` (wrap this route in the same auth check — the API route is outside the `(auth)` route group but proxy.ts gates it via cookie presence and we re-verify via the DAL as usual; note that step 06 places the proxy cookie-presence redirect on the `(auth)` group only, so `/api/configs/...` would bypass the proxy unless `app/api/` is in the proxy's protected allowlist — the implementing claude verifies this in step 06's `proxy.ts` and extends the allowlist if needed), (2) `const { id } = await props.params;`, (3) `const result = await loadConfig(id);` → 404 Response on null, (4) construct the canonical JSON string (the one stored in `content_json` — `result.row.contentJson` is already canonical), (5) compute the filename: `const filename = \`${sanitize(result.row.name)}-${result.row.contentHash.slice(0, 8)}.json\`;` where `sanitize` strips characters that break `Content-Disposition` (spaces, slashes, quotes), (6) return a `new Response(result.row.contentJson, { headers: { 'Content-Type': 'application/json', 'Content-Disposition': \`attachment; filename="${filename}"\` } });`.

### Unit tests

- **`app/(auth)/experiments/config-editor.test.ts`** — small Vitest suite covering the **pure helpers** extracted from the editor: (a) a `sanitizeFilename(name)` function that strips `Content-Disposition`-hostile characters; (b) an `exportFilename(name, contentHash)` helper that concatenates the sanitized name, the hash-8 suffix, and the `.json` extension; (c) a `mergeFieldErrors(rhfErrors, serverErrors)` helper that combines the two error sources into a single object keyed by form path. No RHF rendering, no DB, no Vitest DOM — plain pure-function tests. If the helpers end up inline in `ConfigEditor.tsx` or `ConfigListItem.tsx`, they are extracted into a sibling `config-helpers.ts` module so the test can import them without pulling in the React tree.

### Screenshot

- **`docs/screenshots/step-25-experiments.png`** — captured by the MCP script in §10, committed as part of the step.

## 6. Files to modify

- **`app/(auth)/experiments/page.tsx`** — **replace** the step-07 stub entirely. New body: Server Component, first line `const { user } = await verifySession();`, reads `const rows = await listConfigs({ limit: 100 });` from `@/lib/db/configs`, then renders a page header ("Experiments"), a "New config" button (a `<Link href="/experiments/new">`), and a table of configs. Each row is a `<ConfigListItem config={row} />`. If `rows.length === 0`, render an empty-state card with a CTA to create the first config. No client boundary at the page level — the page is a Server Component, the row items are Client Components (because they own the duplicate/delete buttons that trigger Server Actions via form submits).

- **`lib/db/configs.ts`** — **add one new helper function** `updateConfig({ id, name, config })` that updates an existing row with a new canonical JSON + content hash + name, bumping `updatedAt`. This is a small, additive extension to step 08's module: `updateConfig` becomes the fifth exported function alongside `saveConfig`, `loadConfig`, `listConfigs`, `deleteConfig`. Rationale for landing it in step 25 rather than step 08: step 08 was written before the edit UI existed, so the helper was not needed; step 25 is the first caller. The implementation is: `await db.update(configs).set({ contentJson: canonical, contentHash: hash, name }).where(eq(configs.id, id));`. `updatedAt` is picked up automatically via step 08's `$onUpdateFn` hook on the schema column. **Note**: this modification touches a step-08 file but is a pure addition (no existing behavior changes), so it does not constitute a step-08 retraction. The CLAUDE.md "Database access patterns" section is extended by ≤ 2 lines in §11 to mention the new helper.

- **`package.json`** — add `react-hook-form` and `@hookform/resolvers` to `dependencies`. Pin to the current latest stable versions verified via `npm view react-hook-form version` and `npm view @hookform/resolvers version` at implementation time (do NOT hardcode version numbers in this plan — they drift). Rough expected ranges: `react-hook-form` ^7.x, `@hookform/resolvers` ^3.x or ^5.x depending on current release. `zod` is already installed by step 01; no new zod dep. `package-lock.json` updates accordingly.

- **`proxy.ts`** — **conditional edit**. Verify that the existing proxy allowlist covers `/api/configs/*` under the same auth gate as `/experiments/*`. Step 06's proxy was designed to gate the `(auth)` route group, which does NOT include `app/api/` by default (api routes are not inside a route group). If step 06's proxy currently allows `/api/*` through unauthenticated, step 25 extends the proxy to cover `/api/configs/*` explicitly. If step 06 already has a general `/api/*` gate, step 25 makes no proxy changes. The implementing claude reads `proxy.ts` first and decides. In either case, the Route Handler itself calls `verifySession()` as a defense-in-depth check per CLAUDE.md "Authentication patterns".

- **`CLAUDE.md`** — small appends to "Database access patterns" (new helper noted, ≤ 2 lines) and "Known gotchas" (one new item: RHF + Zod + discriminated union caveat, ≤ 3 lines). Total CLAUDE.md growth ≤ 10 lines, well under the 100-line step cap. See §11 for exact appended content.

No other files are modified. No changes to the step-01 schema, no changes to step 07's login action, no changes to the step-24 playground shell.

## 7. Implementation approach

Work proceeds in seven sequential slices. Do not reorder — later slices depend on earlier file existence and on the `lib/db/configs.ts` helper extension landing before the Server Action module imports from it.

**Slice 1 — Install dependencies and verify schema.** Run `npm install react-hook-form @hookform/resolvers` (both `--save` into `dependencies`). Record the resolved versions in `package.json`. Run `npm ls react-hook-form @hookform/resolvers zod` to confirm exactly one version of each. Then open `lib/schema/experiment.ts` and verify the shape matches the plan's assumptions: `ExperimentConfig` exists, has `.default(...)` on every field, `ExperimentConfig.parse({})` returns a valid object, and the nested `world1` / `world2` fields have the `topology` discriminated union. Run a quick `npx tsx -e "import('./lib/schema/experiment.ts').then(m => console.log(JSON.stringify(m.ExperimentConfig.parse({}), null, 2)))"` smoke check and visually confirm the JSON has the expected shape. If the schema differs from this plan's assumptions, update the form field list in slice 4 to match — the schema is authoritative, this plan is a snapshot.

**Slice 2 — Extend `lib/db/configs.ts` with `updateConfig`.** Add the new function next to the existing `saveConfig`, preserving the `server-only` guard at line 1. Reuse the `canonicalize` helper from step 08 (it is already in the file; do not re-implement). The update body is: canonicalize the input config to JSON string, compute SHA-256 via `createHash('sha256').update(canonical).digest('hex')`, call `await db.update(configs).set({ contentJson: canonical, contentHash: hash, name }).where(eq(configs.id, id)).returning()`, return the updated row. Import `updateConfig` in the step 08 test file? **No** — step 08's tests are frozen against their commit; step 25's new helper is tested via the MCP end-to-end, not via step 08's unit suite (adding a test to step 08's file would expand its diff in step 25's commit, which is a scope leak). If the implementing claude strongly prefers unit coverage, add a small test to step 25's `config-editor.test.ts` that exercises `updateConfig` against an in-memory drizzle instance following step 08's test fixture pattern — this is optional.

**Slice 3 — Build the Server Actions module `app/(auth)/experiments/actions.ts`.** First line `import 'server-only';`, second line `'use server';`, then the imports from zod, the schema, the DAL helpers, and `verifySession`. Implement `saveConfigAction` first (see §5 for the exact flow). Define the `SaveState` type at the top: `type SaveState = { ok: true; id: string } | { ok: false; fieldErrors: Record<string, string[]> };`. The action's signature is `export async function saveConfigAction(prevState: SaveState, formData: FormData): Promise<SaveState>` per the `useActionState` contract. Use `ExperimentConfig.safeParse(parsedPayload)` for validation; on failure, return `{ ok: false, fieldErrors: result.error.flatten().fieldErrors as Record<string, string[]> }`. On success, branch on `formData.get('id')`: if present, call `updateConfig({ id, name, config: result.data })`; if absent, call `saveConfig({ name, config: result.data, createdBy: user.id })`. Then `revalidatePath('/experiments')` and `redirect('/experiments')`. The `redirect` call is **outside** any try/catch (CLAUDE.md "Known gotchas" on `NEXT_REDIRECT` throw).

Then implement `duplicateConfigAction(id: string)` and `deleteConfigAction(id: string)`. Both are thin: `verifySession`, DAL call, `revalidatePath('/experiments')`. Neither needs a `redirect` because the calling `<form action={...}>` is already on `/experiments` and the page rerenders after the revalidation.

Do **not** implement `importConfigJson` — the JSON import happens entirely client-side in `ConfigEditor.tsx` via a `FileReader` and the `ExperimentConfig.parse` call (the schema is client-safe). The server round-trip is unnecessary.

**Slice 4 — Build the `ConfigEditor` Client Component.** `'use client'` on line 1. Imports listed in §5. Top of the component body: instantiate `useForm<FormValues>` with `resolver: zodResolver(ExperimentConfig)`, `defaultValues: initialValues`, `mode: 'onBlur'`. Instantiate `useActionState(saveConfigAction, { ok: false, fieldErrors: {} })`. Set up `useEffect` watching `state.fieldErrors` — on change, iterate the entries and call `form.setError(path, { type: 'server', message: message })` for each, so server-side errors appear inline alongside client-side errors.

Render the form with `<form onSubmit={form.handleSubmit(onValidSubmit)}>`. `onValidSubmit` is an inner function that constructs a new FormData (`const fd = new FormData(); fd.set('name', data.name); fd.set('payload', JSON.stringify(data)); if (mode === 'edit' && configId) fd.set('id', configId);`) and calls `formAction(fd)` imperatively. This bypasses the hidden-input serialization mentioned in §5 and is the cleanest integration between RHF and `useActionState`.

Field-by-field rendering (prose, not code — the implementing claude writes JSX following this list):

- **Top-level name**: `<label>Name</label><input {...form.register('name', { required: true })} />` plus inline error from `form.formState.errors.name?.message`. Note: `name` is not part of `ExperimentConfig`; the `FormValues` type extends `ExperimentConfig` with `name: string`, and the `zodResolver` is given a widened schema `ExperimentConfig.extend({ name: z.string().min(1) })` so the resolver validates the name too.
- **World 1 / World 2 group**: two `<section className="card">` blocks in a grid. Each section renders:
  - Agent count: `<input type="number" {...form.register('world1.agentCount', { valueAsNumber: true })} />` plus error display.
  - Mono:bi ratio: `<Controller name="world1.monolingualBilingualRatio" control={form.control} render={({ field }) => <input type="range" min={0} max={5} step={0.1} {...field} list="ratio-ticks" />} />` with a `<datalist id="ratio-ticks">` containing `<option value="0.5">`, `<option value="1">`, `<option value="1.5">`, `<option value="2">`, `<option value="3">` — these are the tick marks requested by the step-specific context.
  - Topology radio: three `<input type="radio" value="lattice"|"well-mixed"|"network" {...form.register('world1.topology.type')} />` options. Below the radio, conditional render: `{topology1 === 'lattice' && <LatticeFields prefix="world1" form={form} />}` which renders width, height, neighborhood (`<select> moore | von-neumann`). `{topology1 === 'network' && <NetworkFields ... />}` renders the `kind` and `parameters` placeholder fields.
  - Vocabulary seed: `<textarea {...form.register('world1.vocabularySeed', { setValueAs: (v) => (typeof v === 'string' ? JSON.parse(v) : v), validate: (v) => { try { return typeof v === 'object' && v !== null; } catch { return 'invalid JSON'; } } })} />` rendering `JSON.stringify(field.value, null, 2)` as initial text. **This is hairy**: a textarea of JSON with round-trip parse-on-blur and serialize-on-render. The implementing claude can either (a) use a plain textarea and rely on the `zodResolver` to fail on invalid JSON (delegating parsing to Zod via a custom pre-transform), or (b) use a `<Controller>` with a custom `value`/`onChange` that stringifies on read and parses on blur. Path (a) is simpler and is the v1 choice; the editor treats the vocabulary seed as an opaque editable JSON blob and the researcher is expected to know JSON. Path (b) is deferred to v2. A small note above the textarea explains "This is the raw JSON for per-class vocabulary seeds; see docs/spec.md §3.4 for the expected shape." This is documented in §11 CLAUDE.md updates as a known usability wart.
- **Interaction engine** (collapsible `<details>` element):
  - `tickCount`: number input, `register('tickCount', { valueAsNumber: true })`.
  - `seed`: number input, supports 0 explicitly per F10's clause.
  - `deltaPositive`, `deltaNegative`, `retryLimit`: number inputs.
  - `weightUpdateRule`: `<select>` with options `additive`, `l1-normalized`.
  - `schedulerMode`: `<select>` with options `sequential`, `random`, `priority`.
  - `sampleInterval`: number input.
- **Language policies** (collapsible `<details>`): one row per `(speakerClass, hearerClass)` pair, iterating over `form.getValues('languagePolicies')`. Each row has the rule id as a read-only label, and two numeric inputs for the `languageBias.L1` and `languageBias.L2` fields where the rule allows bias. Use `useFieldArray` from RHF for the array handling if the schema represents policies as an array; otherwise use direct `register('languagePolicies.0.languageBias.L1', ...)` paths.
- **Preferential attachment** (collapsible `<details>`): `enabled` checkbox, `warmUpTicks` number, `temperature` number, `similarityMetric` select (one option `cosine` for v1 per step 01).

Below the form fields, render the action button row: `<button type="submit" disabled={pending}>Save</button>`, a Cancel button (`<Link href="/experiments">Cancel</Link>`), an Export button (only in edit mode: `<Link href={\`/api/configs/${configId}/export\`}>Export JSON</Link>`), and an Import button (a file input styled as a button with a `<input type="file" accept="application/json" onChange={handleImport} />`). `handleImport` reads the file via `e.target.files[0].text()`, runs `JSON.parse` + `ExperimentConfig.parse` inside a try/catch, and either calls `form.reset({ ...parsed, name: form.getValues('name') })` on success or calls `setImportError(err.message)` on failure. The import error is rendered inline above the form actions.

In edit mode only, render Delete and Duplicate buttons at the top of the form (above the first field), separate from the save/cancel row. Delete is `<form action={() => { if (confirm('Delete this configuration? This also deletes any runs it owns.')) deleteConfigAction(configId); }}>` (note: the `confirm()` gate runs on the client before the action fires; the form's `action` prop is a client function that conditionally invokes the Server Action). Actually, the cleanest shape is: wrap the delete button in a native form with `<form action={deleteConfigAction.bind(null, configId)} onSubmit={(e) => { if (!confirm('Delete?')) e.preventDefault(); }}>` and let the submit handler cancel on confirm=false. This keeps the Server Action binding clean and the confirm() as a pure client-side gate. Duplicate is a similar `<form action={duplicateConfigAction.bind(null, configId)}>` with no confirm.

**Slice 5 — Build the `ConfigListItem` Client Component.** `'use client'` on line 1. Takes a `config` DTO prop. Renders the name (as the Edit link text), the `updatedAt` timestamp formatted via `new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' })` (no moment.js — `Intl.DateTimeFormat` is a browser built-in and produces deterministic output per CLAUDE.md's testing deterministic requirement), the content hash (first 8 chars in a `<code>` element), and four action buttons: Edit (`<Link href={\`/experiments/${config.id}\`}>Edit</Link>`), Duplicate (form wrapping `duplicateConfigAction.bind(null, config.id)`), Delete (form wrapping `deleteConfigAction.bind(null, config.id)` with onSubmit confirm gate), Run (`<Link href={\`/playground?configId=${config.id}\`}>Run</Link>`), Export (`<Link href={\`/api/configs/${config.id}/export\`}>Export</Link>`).

**Slice 6 — Rewrite `app/(auth)/experiments/page.tsx`.** Replace the step-07 stub. Server Component. First line `const { user } = await verifySession();`. Second line `const rows = await listConfigs({ limit: 100 });`. Render a page title, a "New config" link button, and either an empty-state card or a table of `ConfigListItem` rows. The table does NOT have a search box in v1 (deferred to v2 per §3 spec reference discussion). Adds a subtle top-of-table legend showing the count ("N configs").

**Slice 7 — Build the API export route.** `app/api/configs/[id]/export/route.ts`. `import 'server-only';` line 1. `export async function GET(request: Request, props: { params: Promise<{ id: string }> })` — Next 16 async params in the route signature. Call `verifySession()` at the top; on null return `new Response('unauthorized', { status: 401 })` (the proxy will 307 to login before reaching this, but defense in depth). Await params. Call `loadConfig(id)`; 404 on null. Construct the filename via `exportFilename(row.name, row.contentHash)` (the pure helper in `config-helpers.ts`). Return `new Response(row.contentJson, { status: 200, headers: { 'Content-Type': 'application/json', 'Content-Disposition': \`attachment; filename="${filename}"\` } })`. The `row.contentJson` is already canonical (saved that way by step 08), so no re-serialization is needed.

**Slice 8 — Check proxy allowlist.** Open `proxy.ts` and verify that `/api/configs/*` is either inside the authenticated allowlist or explicitly gated by cookie presence. If the proxy's current logic is "allow everything outside the `(auth)` group", the api route is allowed through unauthenticated and the `verifySession()` call inside the route handler is the only gate — this is acceptable but fragile. Prefer the proxy-level gate: add `/api/configs` to the protected-path list if not already there. This is a one-line edit.

**Slice 9 — Run the static gates.** `npm run typecheck`, `npm run lint`, `npm test` (all must pass). Then `npm run build` (this runs `next build` under Turbopack; it must succeed before `next start` runs the MCP harness). If any gate fails, fix and re-run.

**Slice 10 — Run the MCP verification script.** See §10 for the full enumerated steps. Save the screenshot to `docs/screenshots/step-25-experiments.png` and commit everything in one commit with the canonical subject line from §12.

Three gotchas the implementation must handle:

1. **`useActionState` + RHF integration.** The naive pattern of putting `action={formAction}` on the `<form>` does not work with RHF because RHF wants to own the submit handler to run client-side validation first. The correct shape is `onSubmit={form.handleSubmit(onValidSubmit)}` where `onValidSubmit` imperatively calls `formAction(fd)` after constructing a FormData from the validated RHF state. This is the documented RHF + React 19 Actions integration.

2. **`redirect()` inside Server Actions throws.** `redirect('/experiments')` at the end of `saveConfigAction` must be **outside** any try/catch or it silently swallows the `NEXT_REDIRECT` error and leaves the user on the edit page with no feedback. The action body has no try/catch at its outer level; errors from `loadConfig` or `saveConfig` propagate to Next's error boundary naturally. This is a restatement of the same gotcha the step 07 plan called out for login's `redirect('/')`.

3. **Nested async params in Next 16.** Both `app/(auth)/experiments/[id]/page.tsx` and `app/api/configs/[id]/export/route.ts` receive a `params: Promise<{ id: string }>` shaped prop. Forgetting the `await` produces a Promise whose `.id` is `undefined` and the DB query returns null → 404 for every row. CLAUDE.md "Known gotchas" already lists this rule; the plan calls it out at the two specific file sites for emphasis.

## 8. Library choices

- **`react-hook-form`** — pinned to the current latest stable (v7.x as of the research date; the implementing claude runs `npm view react-hook-form version` at execution time and writes the exact resolved version into `package.json`). The library is small (~15 KB gzipped per the project's home page), battle-tested, has a Zod resolver via a sibling package, and is the most common choice in the React ecosystem for form-heavy UIs. The decision over a hand-rolled alternative is documented in §4's "path not taken".
- **`@hookform/resolvers`** — pinned to the current latest stable (v3.x or v5.x depending on release timing; the implementing claude runs `npm view @hookform/resolvers version`). This is a thin adapter package (~2 KB) that exports `zodResolver(schema)` which plugs into RHF's `resolver` option. It is the officially-supported integration between RHF and Zod.
- **`zod`** — already installed by step 01. No change.
- No other new runtime or dev dependencies. `happy-dom` is already available from step 00's devDependencies if the implementing claude decides to write a component test for `ConfigEditor` (the plan scopes this to pure-helper unit tests only, so `happy-dom` is likely not needed for step 25).

The implementing claude verifies via `npm ls react-hook-form @hookform/resolvers zod` that each resolves to exactly one version before committing. If any of them is missing or duplicated, the step stops and surfaces a clear diagnostic.

## 9. Unit tests

The real verification of step 25 is the MCP script in §10. The vitest suite is deliberately small and targets the **pure helpers** only — the Server Actions, the Route Handler, the Client Component rendering, and the RHF/Zod integration are all covered end-to-end in the MCP run.

All tests live in `app/(auth)/experiments/config-editor.test.ts` (or `config-helpers.test.ts` if the helpers are extracted into a separate module). The test file runs under the default Vitest `node` environment (no DOM needed).

1. **`sanitizeFilename` — alphanumerics pass through.** `sanitizeFilename('Baseline Test')` returns `'Baseline-Test'` (space replaced with `-`). `sanitizeFilename('my_config')` returns `'my_config'`.
2. **`sanitizeFilename` — hostile characters stripped.** `sanitizeFilename('A/B\\C"D')` returns `'ABCD'` or `'A-B-C-D'` depending on the chosen strategy (the implementing claude picks one and documents it in the helper's JSDoc). `sanitizeFilename('../etc/passwd')` returns a string without `..` or `/`.
3. **`sanitizeFilename` — empty string handling.** `sanitizeFilename('')` returns `'config'` (a safe default).
4. **`sanitizeFilename` — length cap.** `sanitizeFilename('a'.repeat(500))` returns a string of length ≤ 100 (or whatever cap the helper enforces).
5. **`exportFilename` — concatenates parts correctly.** `exportFilename('Baseline', 'abc12345efg')` returns `'Baseline-abc12345.json'` (first 8 hex chars of the hash plus `.json`).
6. **`exportFilename` — uses sanitized name.** `exportFilename('Baseline Test /v1', 'abc12345efg')` returns `'Baseline-Test-v1-abc12345.json'` (or equivalent after sanitize).
7. **`mergeFieldErrors` — server errors take precedence over client errors on the same path.** Given `{ world1: { agentCount: { message: 'client' } } }` and `{ 'world1.agentCount': ['server error'] }`, the merge produces a unified error object where `world1.agentCount` has the server message.
8. **`mergeFieldErrors` — disjoint paths combine.** Client errors on `tickCount` and server errors on `seed` both appear in the merged output.
9. **`mergeFieldErrors` — empty inputs.** Both empty → empty output. One empty → the non-empty one is returned unchanged.

All nine tests are deterministic — no `Date.now()`, no `Math.random()`, no I/O, no network, no DOM. They run under Vitest's `node` environment in < 100ms total.

No Server Action tests in this file. Per CLAUDE.md "Authentication patterns" and Next 16 `data-security.md`, Server Actions are tested end-to-end through the MCP harness against a running `next start` server. Attempting to unit-test a Server Action in isolation requires mocking `verifySession`, the DAL, `revalidatePath`, and `redirect` — the test ends up coupled to implementation details and provides little confidence. The MCP script exercises the happy path and the wrong-input path for every action.

## 10. Acceptance criteria

### Static gates (run automatically by `scripts/run-plan.ts` after the commit)

- `npm run typecheck` (`tsc --noEmit`) exits 0.
- `npm run lint` (ESLint flat config) exits 0.
- `npm test` exits 0 including the new `config-editor.test.ts` / `config-helpers.test.ts` cases.
- `npm run build` (`next build` under Turbopack) succeeds. If the build fails, the MCP harness never runs.
- CLAUDE.md growth ≤ 100 lines total (this step adds ≤ 10 per §11).
- Commit marker: the latest commit subject matches `/^step\s+25\s*[:.\-]/i`; `scripts/run-plan.ts` normalizes close variants via `git commit --amend`.

### Chrome-devtools MCP script (the primary verification)

The implementing claude runs the following tool calls in order against `process.env.MSKSIM_BASE_URL`. Seed credentials come from `process.env.MSKSIM_SEED_USER` / `process.env.MSKSIM_SEED_PASS`. The login flow copies step 07's phase-B pattern; only the post-login steps are step-25-specific.

**Phase A — Open a fresh page and log in.**

1. `mcp__chrome-devtools__new_page` at `process.env.MSKSIM_BASE_URL`. Expected: proxy 307 → `/login?next=%2F`.
2. `mcp__chrome-devtools__evaluate_script` to clear `localStorage`, `sessionStorage`, and non-HttpOnly cookies. Return `'cleared'`.
3. `mcp__chrome-devtools__take_snapshot` to capture login form UIDs.
4. `mcp__chrome-devtools__fill` username = `MSKSIM_SEED_USER`.
5. `mcp__chrome-devtools__fill` password = `MSKSIM_SEED_PASS`.
6. `mcp__chrome-devtools__click` the submit button.
7. `mcp__chrome-devtools__wait_for` text "Welcome" on the home page.

**Phase B — Navigate to `/experiments` (empty state).**

8. `mcp__chrome-devtools__navigate_page` to `${BASE_URL}/experiments`.
9. `mcp__chrome-devtools__wait_for` heading "Experiments".
10. `mcp__chrome-devtools__evaluate_script` `return document.body.innerText.includes('New config');` → `true`. Confirms the new-config button is visible. If any prior step's state leaked into the DB (e.g., a previous step-25 run left rows behind), the list will have rows — the script does not assert the list is empty, only that the page renders.

**Phase C — Create a new config.**

11. `mcp__chrome-devtools__click` the "New config" button (its UID from `take_snapshot`).
12. `mcp__chrome-devtools__wait_for` URL change to `/experiments/new`.
13. `mcp__chrome-devtools__evaluate_script` `return location.pathname;` → `'/experiments/new'`.
14. `mcp__chrome-devtools__take_snapshot` to get form field UIDs.
15. `mcp__chrome-devtools__fill` the name field with `'Test Config A'`.
16. `mcp__chrome-devtools__click` the Save button.
17. `mcp__chrome-devtools__wait_for` URL to return to `/experiments` and the row text "Test Config A" to appear.

**Phase D — Edit the config, change `tickCount`.**

18. `mcp__chrome-devtools__take_snapshot` to get the Edit link UID for the "Test Config A" row.
19. `mcp__chrome-devtools__click` the Edit link.
20. `mcp__chrome-devtools__wait_for` URL change to `/experiments/<id>` and the form to render with `name` = `'Test Config A'`.
21. `mcp__chrome-devtools__take_snapshot` to get the tickCount input UID.
22. `mcp__chrome-devtools__fill` the tickCount input with `'500'`.
23. `mcp__chrome-devtools__click` Save.
24. `mcp__chrome-devtools__wait_for` URL `/experiments` and a confirmation that the list still contains "Test Config A".
25. (Optional, if the list page displays tickCount as a column) `mcp__chrome-devtools__evaluate_script` `return document.body.innerText.includes('500');` → `true`. If the list does not display tickCount, skip this assertion and instead re-navigate to `/experiments/<id>` and confirm the loaded form has `tickCount = 500`.

**Phase E — Duplicate.**

26. `mcp__chrome-devtools__take_snapshot` to get the Duplicate button UID for "Test Config A".
27. `mcp__chrome-devtools__click` Duplicate.
28. `mcp__chrome-devtools__wait_for` the row text "Copy of Test Config A" to appear.
29. `mcp__chrome-devtools__evaluate_script` `return document.body.innerText.match(/Copy of Test Config A/g)?.length;` → `1` (exactly one duplicate exists; not a duplication loop).

**Phase F — Delete the copy.**

30. `mcp__chrome-devtools__take_snapshot` for the Delete button UID on the "Copy of Test Config A" row.
31. `mcp__chrome-devtools__click` Delete.
32. `mcp__chrome-devtools__handle_dialog` (the `confirm()` popup) with `accept: true`. The chrome-devtools MCP supports dialog handling; this is the native browser confirmation dialog the `confirm()` call triggers.
33. `mcp__chrome-devtools__wait_for` the row "Copy of Test Config A" to disappear from the DOM.
34. `mcp__chrome-devtools__evaluate_script` `return document.body.innerText.includes('Copy of Test Config A');` → `false`.

**Phase G — Export and verify download.**

35. `mcp__chrome-devtools__take_snapshot` for the Export link UID on "Test Config A".
36. `mcp__chrome-devtools__click` Export. The link points to `/api/configs/<id>/export`, which returns a JSON attachment.
37. `mcp__chrome-devtools__list_network_requests` — filter for the `/api/configs/.../export` response. Assert: status 200, response header `content-disposition` starts with `attachment; filename="Test-Config-A-`, and response header `content-type` includes `application/json`. The exact download file may or may not land on disk depending on the chrome-devtools MCP's download handling; the network-request inspection is the authoritative signal.

**Phase H — Import roundtrip.**

38. `mcp__chrome-devtools__click` "New config" to return to the empty editor.
39. `mcp__chrome-devtools__take_snapshot` for the Import file input UID.
40. `mcp__chrome-devtools__upload_file` with the path to the exported JSON file (the MCP chrome-devtools `upload_file` tool accepts a local filesystem path and posts it through the file input). Alternative if `upload_file` is not available: `mcp__chrome-devtools__evaluate_script` to inject the JSON via `JSON.parse` directly into the RHF form state through a globally-exposed test hook — but this is a test-only backdoor and violates the "test real user interactions" principle. The `upload_file` path is preferred.
41. `mcp__chrome-devtools__wait_for` the form name field to display "Test Config A" (confirming the import reset the form to the exported values).
42. `mcp__chrome-devtools__evaluate_script` to read the tickCount input value; assert it equals `'500'`.

**Phase I — Screenshot and finalize.**

43. `mcp__chrome-devtools__navigate_page` back to `/experiments` (so the screenshot captures the list view with at least one row).
44. `mcp__chrome-devtools__take_screenshot` saving to `docs/screenshots/step-25-experiments.png`.
45. (Cleanup) `mcp__chrome-devtools__click` Delete on "Test Config A" and accept the dialog, so the test DB is clean for the next pipeline run. This is optional — `scripts/run-plan.ts` may or may not reset the DB between steps; defer to the orchestrator's documented behavior.

**Phase J — Console and network triage.**

46. `mcp__chrome-devtools__list_console_messages`. Filter to `level === 'error'`. Expected: zero errors (React 19 strict-mode warnings are benign per CLAUDE.md "UI verification harness").
47. `mcp__chrome-devtools__list_network_requests`. Iterate all entries. Expected: every status in `[200, 204, 301, 302, 303, 307, 308]`. Any 4xx or 5xx fails the step (except: the file download in phase G may show as a `net::ERR_ABORTED` depending on how the MCP browser handles attachments — this is acceptable only if the `content-disposition` header was observed in phase G).

**Phase K — Commit.**

48. Stage and commit all new files (pages, editor, list item, actions, API route, helpers, test file, proxy edit, package.json changes, package-lock.json, CLAUDE.md append, screenshot). Subject line exactly `step 25: experiment config ui` per §12. One commit.

## 11. CLAUDE.md updates

Append ≤ 10 lines total across two sections, preserving both sections' existing caps.

### "Database access patterns" (≤ 2 lines)

- Step 25 extends `lib/db/configs.ts` with an `updateConfig({ id, name, config })` helper. Same canonicalization + SHA-256 hashing as `saveConfig`; bumps `updatedAt` via the column's `$onUpdateFn`. The edit flow in `app/(auth)/experiments/[id]/page.tsx` + `actions.ts` is the only caller as of this step.

### "Known gotchas" (≤ 3 lines)

- React Hook Form's `zodResolver` narrows discriminated unions correctly, but conditional fields (e.g., `topology.type === 'lattice'` → show `width`/`height`) must be driven by `form.watch('path.to.discriminator')` to re-render on type change. Using `form.getValues()` inside the JSX instead of `watch` will cause stale conditional fields after a type switch.
- `useActionState` + RHF integration requires `onSubmit={handleSubmit(onValidSubmit)}` with an inner `onValidSubmit` that constructs FormData and calls `formAction(fd)` imperatively. Do **not** use `<form action={formAction}>` directly — it bypasses RHF's client-side validation and submits raw FormData that the Server Action would have to re-parse without any typing.

The remaining bullet (known wart) lives only in this plan file, not in CLAUDE.md, because the vocabulary-seed JSON textarea is a v1 compromise and is expected to be replaced by a proper structured editor in a future step. Documenting it in CLAUDE.md would surface a temporary UX wart as permanent tribal knowledge.

Total appended: ≤ 5 lines. Well under the 100-line step cap and both section caps.

## 12. Commit message

Exactly:

```
step 25: experiment config ui
```

No conventional-commit prefix (`feat:`, `chore:`, etc.), no emoji, no trailing period. The `step 25:` marker is load-bearing for `scripts/run-plan.ts` progress detection (CLAUDE.md "Commit-message convention"). One commit for the whole step, including the screenshot binary at `docs/screenshots/step-25-experiments.png`. If intermediate commits occur during implementation, the orchestrator squashes them before advancing.

The commit body (optional but recommended) lists:
- The four new routes (list, new, edit, API export).
- The new `ConfigEditor` + `ConfigListItem` Client Components and the new `actions.ts` Server Actions module.
- The `updateConfig` helper extension to `lib/db/configs.ts`.
- The two new dependencies (`react-hook-form`, `@hookform/resolvers`) and their pinned versions.
- The screenshot file and the MCP verification result summary.

## 13. Rollback notes

If the step lands in a broken state and needs to be undone (destructive — requires user confirmation per CLAUDE.md commit-safety rules):

1. `git log --oneline | head -20` to find the commit SHA immediately prior to `step 25: experiment config ui`. It will have the subject `step 24: interactive controls` (or a normalized variant).
2. `git reset --hard <step-24-sha>`. This reverts everything in step 25: the new pages, the Server Actions module, the Client Components, the API export route, the helper test file, the proxy edit, the `lib/db/configs.ts` extension, the `package.json` + `package-lock.json` dependency additions, the `docs/screenshots/step-25-experiments.png` binary, and the CLAUDE.md append — all in one operation.
3. `npm uninstall react-hook-form @hookform/resolvers` — removes the two packages added by this step. Run `npm install` afterward to reconcile `node_modules/` with the reverted `package.json`. If `git reset --hard` did not revert `package-lock.json` cleanly (it should, since the lockfile is tracked), a `rm -rf node_modules && npm install` resolves any lingering staleness.
4. Verify `docs/screenshots/step-25-experiments.png` is gone after the reset (it was introduced in this step; the hard reset drops it).
5. Verify `app/(auth)/experiments/page.tsx` is back to the step-07 stub state — a grep for "Experiments" should find the original "built in step 25" placeholder text.
6. Run `npm run typecheck` and `npm test` against the rolled-back tree to confirm no stale imports or orphaned test files were left behind.
7. Re-run `npx tsx scripts/run-plan.ts --only 25` to redo the step from a clean base once the underlying issue is fixed. Because `scripts/run-plan.ts` greps for the step marker and the marker is gone after the reset, the orchestrator picks step 25 up as pending automatically.
