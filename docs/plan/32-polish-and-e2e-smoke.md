---
step: "32"
title: "polish and e2e smoke"
kind: polish
ui: true
timeout_minutes: 40
prerequisites:
  - "step 31: hypothesis presets"
---

## 1. Goal

Land the final commit of the msksim v1 pipeline: a polish pass that closes the remaining rough edges across every user-facing surface landed in steps 07-31 and an **end-to-end chrome-devtools MCP smoke script** that exercises a single researcher's full day-in-the-life journey from login through export. Step 32 ships no new features. It adds (a) a top-level `error.tsx` under `app/(auth)/` plus scoped `error.tsx` files under `app/(auth)/playground/`, `app/(auth)/experiments/`, and `app/(auth)/runs/` so a thrown error in one feature shows a friendly fallback card with an `unstable_retry()` button instead of a blank shell; (b) `loading.tsx` files with Tailwind skeleton placeholders for the three slow routes whose Server Components issue non-trivial DB loads — `/runs/[id]` (loads one run plus ~200k tick_metrics rows), `/runs/compare` (loads up to four runs in parallel plus their metric streams plus alignment), and `/experiments/sweeps/[id]` if step 28 landed such a route (otherwise the run-detail and compare loadings cover the slow routes); (c) tight **empty states** on the `/runs` list (step 26), the `/experiments` list (step 25), and the `/runs/compare` view (step 29) that give researchers a clear next-step link rather than a mute blank panel; (d) minor polish verification that every page's `<title>` via `export const metadata = ...` is a meaningful msksim-scoped string (not the Next starter default), that the root layout's `<html lang="en">` attribute is intact from step 00, that the nav row's active-state class highlights the current route, and that stray `console.log` calls or dev-only hacks left behind in earlier steps are removed; and (e) **the full end-to-end MCP smoke script** described in §10 that logs in, creates a 50-tick config from the editor, runs it in the playground, verifies lattice and metrics and network views, opens the saved run from the runs browser, exports both CSV and JSON, opens the compare view with one run, loads the Outcome 1 — Segregation preset from step 31, runs it in the playground, and finally logs out — asserting no console errors and no 4xx/5xx network responses at each stage while saving a stage-keyed screenshot to `docs/screenshots/step-32-e2e-<stage>.png`. This is the most comprehensive MCP script in the pipeline and ties together every UI surface steps 07, 21, 22, 23, 24, 25, 26, 27, 29, 30, and 31 built. After step 32 lands, **msksim v1 is complete**: the final commit carries the acceptance claim that the product works as a connected whole, not just as a collection of independently-tested components.

Scope boundary: step 32 does **not** refactor any feature, does **not** add new components beyond the five empty-state cards and the four error pages and the three loading skeletons, does **not** add new routes, does **not** touch the simulation engine or the worker or any of `lib/sim/*`, does **not** add persistence, does **not** invent new metrics or export formats, and does **not** perform a v2 feature audit. Every file touched outside `app/**/error.tsx` / `app/**/loading.tsx` / the empty-state components is touched only to add the empty-state conditional block or to fix a console.log or to correct a page title. If a polish candidate surfaces during execution that would require a feature-sized change (e.g., "the metrics dashboard should persist its pinned-chart state across page reloads"), it is recorded as a follow-up note in the commit message body and **not** implemented in this step — v1 closes here.

## 2. Prerequisites

- Commit marker `step 31: hypothesis presets` present in `git log`. Step 31 is the direct predecessor: it ships **F17 Hypothesis presets** (Outcome 1 — Segregation, Outcome 2 — Assimilation, Mean-Field Control), each a one-click configuration that populates the step-25 editor and can be run directly in the playground. The step 32 E2E script exercises one of those presets near the end to verify the preset → editor → playground handoff is intact as an end-to-end flow. If step 31 did not ship exactly the preset names the E2E script enumerates (`"Outcome 1 — Segregation"`, `"Outcome 2 — Assimilation"`, `"Mean-Field Control"`), the step 32 implementing claude greps the step 31 plan file to discover the exact labels step 31 actually used and adjusts the MCP script accordingly — schema stability across steps beats perfect plan-file alignment, same discipline steps 26 and 29 both applied.

- Commit marker `step 30: export` present in `git log`. Step 30 ships the two Route Handlers at `app/api/export/[runId]/metrics.csv/route.ts` and `app/api/export/[runId]/snapshot.json/route.ts`. The E2E script's "Export CSV" and "Export JSON" stages are literal `navigate_page` calls against those URLs with assertion on the response status and the `Content-Disposition: attachment` header. If step 30 landed the routes under different paths (e.g., a single route with a `?format=csv` query), the E2E script adapts to the real URLs via a `Grep` against `app/api/export/` at execution time.

- Commit marker `step 29: run comparison` present in `git log`. Step 29 ships the `/runs/compare` route with URL-driven selection state. The E2E script's "Compare view with 1 run" stage navigates to `/runs/compare?runs=<id>` and asserts the single-run comparison view renders without error and without blocking on "please select at least one run" — this is one of the step 32 empty-state decisions (see §5 / §6): the compare view's empty state triggers at 0 selections, **not** 1, so a 1-run comparison is a legal rendering.

- Commit markers `step 25: experiment config ui`, `step 26: run persistence and browser`, `step 27: batch queue`, `step 22: metrics dashboard`, `step 23: network view`, `step 24: interactive controls`, `step 21: lattice canvas renderer`, `step 07: login and app shell`. Every one of these is exercised by the E2E script. If any marker is missing, step 32 cannot run (the script would fail on a missing route or a missing feature). `scripts/run-plan.ts` enforces this via the `prerequisites` frontmatter field — the orchestrator will refuse to invoke step 32 until step 31 is detected in the log, and step 31's own prerequisites transitively cover the rest.

- Commit marker `step 00: project bootstrap` present in `git log`. Step 00 set the root `app/layout.tsx` with `<html lang="en">`. Step 32's polish pass verifies that attribute is still on disk (a single grep) — a later refactor could silently have removed it, and this is the last checkpoint before shipping v1. The verification is a one-line assertion in §7 slice four, not a file modification.

- Node ≥ 20.9, Next 16.2.2, React 19.2.4, Drizzle ORM (step 02), Tailwind 4 (step 00). **No new runtime dependencies.** Every polish surface uses Tailwind utility classes for skeleton placeholders and empty-state cards; no new packages are installed. The E2E script uses only the chrome-devtools MCP tools that every prior UI step has already used.

## 3. Spec references

- `docs/spec.md` **§5 User Stories** — the entire section. The step 32 E2E script is deliberately structured as a linear walk through the researcher stories US-1 through US-8 (and collaborator US-12 where the preset load → playground handoff is concerned), not an arbitrary happy-path trace. The script's stage ordering maps to the user stories as follows:
  - **US-1** *"instantiate both worlds with the 3:2 monolingual:bilingual ratio"* → stages 3-4 (create config, fill in the 50-tick config form with a 3:2 ratio via the editor's mono:bi slider inherited from the step-25 default).
  - **US-2** *"watch the World-2 lattice evolve in real time"* → stages 4-6 (navigate to playground with the created configId, click Play, wait for tick counter to reach 50, assert the lattice canvas renders non-empty).
  - **US-5** *"export tick-by-tick metrics as a long-format CSV"* → stage 11 (click Export CSV, assert 200 response).
  - **US-6** *"every run to be reproducible from its seed and config"* → stage 9 implicit (the run is reopened from the runs browser, and the run detail page shows the seed prominently per step 26's layout).
  - **US-7** *"save a run today and revisit it tomorrow"* → stages 9-10 (navigate to /runs, assert the new run appears, click it, verify detail page loads).
  - **US-8** *"pause mid-simulation and inspect any agent's full inventory"* → partially covered implicitly via the lattice canvas hover (step 21's hover reveals inventory); the E2E script does not explicitly hover because the MCP hover tool is noisier than the click tool and the agent-inspector inventory is not a load-bearing acceptance criterion for v1.
  - **US-12** *"open a shared JSON config and reproduce a colleague's exact run"* → stages 14-15 (load Outcome 1 preset into editor, click Run in playground, verify playground loads with the preset config). The preset is the in-app analog of a "shared JSON config" — a one-click recipe that populates the editor with a known-good configuration.
  - **US-13** *"Outcome 1 and Outcome 2 presets are one click away"* → stages 14-15 directly.

  Stages the E2E script does **not** cover and the reason: **US-3** (run same config in lattice and well-mixed, compare on shared axes) would need two full simulation runs and a comparison view with 2+ runs — the step 32 script runs only one simulation to keep wall-clock under the 40-minute budget, and the comparison view is exercised with 1 run at stage 13 to confirm it doesn't crash on a single selection (which is the step-29 empty-state decision). **US-4** (parameter sweep) and **US-9/US-10** (ablation toggles) are step-28-specific and step-24-specific user stories that would multiply the wall-clock cost of this step by 5-10× for no additional end-to-end coverage beyond what a focused MCP script on the sweep page already provides in step 28's own verification. Recording the non-coverage so future reviewers know the gap is deliberate.

- `docs/spec.md` **§6 Research Goals → Software Support Matrix.** Every row in the matrix is touched by at least one stage of the E2E script: RQ1 (F13, F14, F15 via /experiments → /playground → /runs → /runs/compare), RQ2 (F4 topology selection inside the editor, F14 comparison view), RQ3 (F9 metrics dashboard assertion at stage 7), RQ4 (F8 network view assertion at stage 8), RQ5 (F5 language policy is part of the default config the editor writes). The script does not explicitly verify each research question is "answerable" — it verifies each feature required by the matrix **renders, runs, and persists** end-to-end, which is the v1 completeness bar.

- `docs/spec.md` **§4.4 F15 Recorded runs** — the acceptance criterion *"Runs survive page reload"* is verified by stages 9-10 (run is listed after navigation from /playground to /runs, meaning it came out of the DB, not in-memory React state).

- `docs/spec.md` **§4.4 F16 Export** — the acceptance criterion *"Exports work for single runs"* is verified by stages 11-12 (Export CSV → 200, Export JSON → 200, both for the run just created).

- `docs/spec.md` **§4.4 F17 Hypothesis presets** — the acceptance criterion *"Clicking it populates the config form and is then editable"* is verified by stage 14, *"citation to the PDF slide"* is tooltip-only and not verified by MCP assertion, and "one click away" is satisfied by the single click in the script's preset stage.

- **CLAUDE.md "UI verification harness"** (60-line cap). Step 32 is the most demanding consumer of this section: the script is ~30 ordered tool calls spanning login, config creation, simulation run, run persistence, export, comparison, preset, and logout. The script's shape follows the same Phase A/B/C layering every prior UI step used (open page → clear state → log in → exercise features → console triage → network triage), just with many more feature phases between login and logout. Any clarification discovered during step 32's run goes back into this section per §11, **subject to the 60-line cap** — which is already nearly full from step 07's contributions and later steps, so §11's appends are minimal and focused on the "complete E2E run" shape that the harness section has not yet documented.

- **CLAUDE.md "Authentication patterns"** — the new `error.tsx` files are Client Components (per the Next 16 `error.md` doc, error boundaries must be `'use client'`), so they do **not** call `verifySession()`. The layout above them has already called `verifySession()` and redirected to /login if no session exists, so by the time an error boundary renders there is no unauthenticated path to it. This is important to record because a naive reviewer might ask "why does the error page not check auth?" — the answer is "because the layout already did, and Client Component error boundaries cannot call the DAL anyway (it is `'server-only'`)."

- **CLAUDE.md "Living-document rules"** — step 32's §11 appends include a "v1 complete" note at the end of this section, marking the pipeline's close. This is the final documentation artifact of the build plan. Section 11 of this plan file records the exact wording and line budget.

- **CLAUDE.md "Known gotchas"** — the polish pass verifies no new gotchas have been added silently during the later steps. Step 32 does not expand the gotchas list unless the E2E script surfaces a reproducible new one; if it does, the gotcha is added with a rationale per the section's own rule.

## 4. Research notes

Minimum requirements met: **4 local Next doc citations, 3 WebFetched external URLs, 2 paths not taken, total ≥ 9 citations.**

### Local Next.js 16 documentation

1. **`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md`** — the entire file (333 lines). Canonical reference for the `error.tsx` file convention in Next 16. Load-bearing facts verified by reading the doc at plan-write time:
   - (a) *"Error boundaries must be Client Components"* — every `error.tsx` file in this step begins with `'use client'` as line 1. This is a hard requirement from the file convention; forgetting it causes a build-time error.
   - (b) Props: `{ error: Error & { digest?: string }; unstable_retry: () => void }`. The `digest` property is an opaque server-side identifier useful for log correlation. The `unstable_retry()` callback (new in v16.2.0 per the Version History table at the bottom of the doc) re-renders the error boundary's children — exactly what the "Reload" button this step specifies does. The doc's opening example (lines 20-51) is the literal template the step 32 error pages follow: a `useEffect` that logs the error, a friendly message, and a `<button onClick={() => unstable_retry()}>Try again</button>`.
   - (c) `error.tsx` *"wraps a route segment and its nested children in a React Error Boundary. When an error throws within the boundary, the error component shows as the fallback UI."* The scope of each `error.tsx` file is determined by its location: `app/(auth)/error.tsx` catches errors in every page/layout under `(auth)`; `app/(auth)/playground/error.tsx` catches only errors inside the playground sub-tree. **Step 32 intentionally ships both the group-level fallback and per-feature scoped fallbacks** so a crash in the metrics dashboard shows the playground error page (which keeps the app shell and nav visible) rather than bubbling all the way to the `(auth)` fallback (which would replace the whole body content).
   - (d) *"It does not wrap the `layout.js` or `template.js` above it in the same segment."* Therefore `app/(auth)/error.tsx` does **not** catch errors thrown by `app/(auth)/layout.tsx`. That layout calls `verifySession()`, which can throw on a DB failure. The only fallback for a layout-level throw is `app/global-error.tsx` (the file at the root of `app/`). Step 32 **does not** ship `app/global-error.tsx` — a DB failure during `verifySession()` is outside the v1 threat model (two researchers, one local SQLite file), and adding a global error page would require also adding `<html>` and `<body>` tags since the root layout is replaced when global-error renders. Recording this deliberate scope limit; the global fallback is a v2 candidate if the DB ever lives on a network-mounted volume.
   - (e) The doc's *"Graceful error recovery with a custom error boundary"* example (lines 205-320) is **rejected** for step 32 — it is a more sophisticated pattern that preserves last-known-good HTML via `dangerouslySetInnerHTML`. For a research tool where the expected error mode is "a worker threw because the config was malformed" rather than "a third-party script clobbered the DOM", the simple retry button is the right fit.

2. **`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/loading.md`** — the entire file (197 lines). Canonical reference for the `loading.tsx` file convention. Load-bearing facts:
   - (a) *"The special file `loading.js` helps you create meaningful Loading UI with React Suspense. With this convention, you can show an instant loading state from the server while the content of a route segment streams in."* `loading.tsx` is a Server Component by default; step 32's loading files are all Server Components (no interactivity, just skeleton markup). They do **not** need `'use client'`.
   - (b) *"In the same folder, `loading.js` will be nested inside `layout.js`. It will automatically wrap the `page.js` file and any children below in a `<Suspense>` boundary."* This is why `app/(auth)/runs/[id]/loading.tsx` renders while the Server Component at `app/(auth)/runs/[id]/page.tsx` is fetching: Next's App Router implicitly wraps the page in `<Suspense>` with the loading component as the fallback. No hand-wiring required.
   - (c) *"If the layout accesses uncached or runtime data (e.g. `cookies()`, `headers()`, or uncached fetches), `loading.js` will not show a fallback for it."* This is an important caveat for step 32: the `app/(auth)/layout.tsx` calls `verifySession()` which reads `cookies()`, so navigation **from unauthenticated to authenticated** does not trigger the loading fallback — the whole layout has to finish before anything renders. This is intentional per step 06's design. Step 32's loading files trigger on navigation **between** authenticated routes, which is the regime that matters for UX (clicking a link in the nav row should show a skeleton within ~100ms, not a blank screen for 500ms while the DB load finishes).
   - (d) The doc's "Status Codes" section notes that streaming responses always return 200 even if the final rendered content includes a `notFound()` or `redirect()` — the MCP script's network triage must tolerate 200s that represent streamed-in errors, not just fully-successful pages. This is why stage assertions at §10 use the page content (e.g., "detail page loads with full metrics") as the success signal, not just the response status code.

3. **`node_modules/next/dist/docs/01-app/02-guides/production-checklist.md`** — the entire file (153 lines). Canonical reference for Next 16 production-readiness items. Load-bearing facts verified by reading the doc at plan-write time:
   - (a) Under **"During development → Routing and rendering"** the doc recommends *"Error Handling: Gracefully handle catch-all errors and 404 errors in production by creating custom error pages."* Step 32 ships the error pages per §5. The 404 case (`not-found.tsx`) is not in step 32's scope — every authenticated route the E2E script touches is expected to exist, and a missing run id is already handled by step 26's call to `notFound()` in the run detail page which falls through to Next's default 404. A custom `not-found.tsx` is a v2 polish item.
   - (b) Under **"UI and accessibility → Global Error UI"**: *"Add `app/global-error.tsx` to provide consistent, accessible fallback UI and recovery for uncaught errors across your app."* Recorded as a v2 deferral (see research note 1(d) above).
   - (c) Under **"Metadata and SEO → Metadata API"**: *"Use the Metadata API to improve your application's Search Engine Optimization (SEO) by adding page titles, descriptions, and more."* Step 32's polish-pass title audit (§7 slice four) walks every `page.tsx` file and asserts an `export const metadata` block is present with a msksim-scoped `title`. If any step-07-through-31 page shipped without a meaningful metadata export, step 32 adds one. This is the one place step 32 routinely **modifies files from earlier steps** as part of polish; §6 documents which files may need the touch.
   - (d) Under **"During development → UI and accessibility → ESLint"**: *"Use the built-in `eslint-plugin-jsx-a11y` plugin to catch accessibility issues early."* The ESLint flat config from step 00 already ships a11y rules; the step 32 `npm run lint` gate (§10) catches any new violations introduced since the last lint pass.
   - (e) Under **"Before going to production"**: *"Before going to production, you can run `next build` to build your application locally and catch any build errors, then run `next start` to measure the performance of your application in a production-like environment."* This is exactly what the `scripts/run-plan.ts` harness already does for every UI step; step 32 inherits the build-then-start flow without modification.

4. **`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md`**, the metadata-related sections. Confirms the `export const metadata` pattern for setting a page `<title>` in a Server Component. The Next 16 shape is `export const metadata: Metadata = { title: 'msksim — <page>' }`, where `Metadata` is imported from `'next'`. Each polished page's title follows the template `msksim — <feature name>` (e.g., `msksim — playground`, `msksim — runs`, `msksim — experiments`, `msksim — run detail`, `msksim — compare runs`). The root layout's default title `msksim` is what every unset child inherits — the polish pass ensures no child page shows the fallback.

### External WebFetched references

5. **React — Error Boundaries documentation**, `https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary` (WebFetched at plan-write time). The canonical reference for React error boundaries. Load-bearing facts confirmed by the fetch:
   - (a) Error boundaries are class components that implement `getDerivedStateFromError(error)` and/or `componentDidCatch(error, info)`. Next's `error.tsx` convention wraps this in a function-component interface so consumers don't write the class themselves — the resulting behavior is identical.
   - (b) Error boundaries catch errors thrown during rendering, in lifecycle methods, and in constructors of their descendants. They do **not** catch errors in event handlers, async code (e.g., `fetch` callbacks), or server-side rendering. Step 32's error pages are therefore intended to catch:
     - Server Component rendering errors (e.g., a DB helper throws while loading a run). Next forwards these to the `error.tsx` via the RSC transport.
     - Client Component rendering errors (e.g., the metrics dashboard's chart-panel tries to index into an undefined `history` prop because of a race).
   - They are **not** intended to catch errors from the simulation worker — those surface as rejected promises from the Comlink proxy and are handled by the shell's own `try/catch` around the worker calls (established in step 20). Recording this so a reviewer doesn't expect the error pages to catch worker crashes.
   - (c) The React docs explicitly recommend that error boundaries display *"a friendly message"* rather than a stack trace. Step 32's error pages follow this: the messages are "Something went wrong loading the playground. Try again or reload the page." and similar per-feature. No stack traces, no raw `error.message` strings (per the Next doc's own warning at research note 1(b) — server-forwarded errors have sanitized messages in production anyway).

6. **React — `Suspense` documentation**, `https://react.dev/reference/react/Suspense` (WebFetched at plan-write time). Confirms the Suspense boundary mechanics Next's `loading.tsx` wraps. Load-bearing facts:
   - (a) `<Suspense fallback={<Loading />}>{children}</Suspense>` shows the fallback until every child that suspends has resolved. A Server Component that `await`s a data call is treated as suspending; the `loading.tsx` fallback renders during the wait.
   - (b) **Nested Suspense boundaries** reveal content progressively — if a parent's data loads before a child's, the parent renders and the child's fallback is still shown. Step 32's `loading.tsx` files are a **single** Suspense boundary per slow route, not a nested tree, because the slow routes are small enough that progressive reveal isn't worth the complexity.
   - (c) The doc's "Showing a skeleton while content is loading" example (lines ~100-140) is the literal template for step 32's skeleton markup: a grid of `bg-gray-200 rounded animate-pulse` divs sized to match the final layout, so the layout shift on content arrival is minimal. Tailwind's `animate-pulse` utility provides the shimmer without a custom keyframe.

7. **Tailwind CSS — `animate-pulse` utility**, `https://tailwindcss.com/docs/animation#pulse` (WebFetched at plan-write time). Confirms the built-in pulse animation: `.animate-pulse { animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; } @keyframes pulse { 50% { opacity: .5; } }`. Step 32's loading skeletons apply this class to every placeholder div; no custom keyframes are authored. The animation is subtle enough that it does not conflict with the `prefers-reduced-motion` media query (Tailwind's default CSS does not suppress `animate-pulse` under reduced motion, but the opacity-only animation is within WCAG 2.1 SC 2.3.3 guidelines — recording this for completeness, not as a modification).

### Paths not taken

8. **Playwright or Cypress E2E suite instead of the chrome-devtools MCP script — rejected.** Playwright is the industry-standard browser-automation framework for Next.js projects and ships a first-class `@playwright/test` runner with fixtures, retries, parallel execution, and a visual reporter. Cypress is a slightly older but equally viable alternative. The **tempting** path is to install `@playwright/test`, write the E2E script as a `.spec.ts` file, wire it to `npm run e2e`, and let Playwright run the browser itself via its own Chromium binary. **Rejected** because:
   - (a) The pipeline's MCP harness in `scripts/run-plan.ts` **already** owns the `next build && next start` lifecycle and the chrome-devtools browser process. Every prior UI step (07, 19, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31) is verified via `claude -p` + chrome-devtools MCP, not Playwright. Introducing Playwright in step 32 would fork the verification story for a single step and duplicate everything the harness already does.
   - (b) Playwright would require installing `@playwright/test` (~200 MB including the browser), adding a `playwright.config.ts`, adding a `tests/e2e/` directory, and teaching `scripts/run-plan.ts` to run Playwright as a separate subprocess with a separate port / fixture / teardown lifecycle. The integration cost is multi-day and the incremental verification value over "the same script written as MCP calls" is nil.
   - (c) The MCP tools available to the step 32 agent are a **strict superset** of what Playwright needs: `navigate_page`, `fill`, `click`, `wait_for`, `take_screenshot`, `evaluate_script`, `list_console_messages`, `list_network_requests`, `take_snapshot`. Every Playwright idiom has a direct MCP analog; nothing in the E2E script requires a Playwright-only feature (visual regression via pixel diff, trace viewer, etc.).
   - (d) The step 32 script is expected to run **once**, as the final smoke test of the pipeline, on the final commit. Retries and parallelism — Playwright's killer features — are irrelevant for a single linear sequence. **Decision: write the E2E script as MCP tool calls in the step 32 `claude -p` invocation, same shape as every prior UI step, just longer.**

9. **A dedicated `app/global-error.tsx` file instead of scoped `error.tsx` files — rejected (for v1).** Per research note 1(d), `app/global-error.tsx` is the only file that catches layout-level errors (including the `(auth)/layout.tsx` crash case where `verifySession()` throws). The tempting path is to ship one big global-error that catches everything, simplifying the mental model. **Rejected for v1** because:
   - (a) Global-error must define its own `<html>` and `<body>` tags because it replaces the root layout when active. This means either duplicating the root layout's Tailwind CSS imports and font loading, or living with an unstyled fallback. Neither is good.
   - (b) A crash in one feature — say, the metrics dashboard — is much better served by a **scoped** error boundary that keeps the app shell, nav, and other features intact and only shows the retry button in the broken pane. A global error boundary would force a full-page "Something went wrong" state for any crash, even a tiny one.
   - (c) The `v16.2.0` `unstable_retry()` prop documented in research note 1(b) works equally well on scoped and global error boundaries, so neither option has a retry-affordance advantage.
   - (d) The v1 threat model (two researchers, local SQLite, no network dependency) makes layout-level throws extremely unlikely. The scoped fallbacks cover 99% of realistic crashes; the remaining 1% shows the Next default error page, which is not pretty but is recognizable and actionable. **Decision: ship the four scoped `error.tsx` files in §5 and defer `global-error.tsx` to v2** (recorded in the commit-message body as a known-gap).

### Informational references

10. **WCAG 2.1 Success Criterion 2.3.3 Animation from Interactions**, `https://www.w3.org/WAI/WCAG21/Understanding/animation-from-interactions.html` (referenced, not strictly load-bearing). The step 32 loading skeletons use Tailwind's `animate-pulse` (opacity-only, 2s duration, infinite). Under WCAG 2.3.3 Level AAA, *"Motion animation triggered by interaction can be disabled."* The pulse animation is not triggered by an interaction — it's a loading indicator — so 2.3.3 does not strictly apply. No `prefers-reduced-motion` override is added. If a future accessibility audit flags this, a one-line CSS rule wrapping the `animate-pulse` class in `@media (prefers-reduced-motion: no-preference)` would be the fix. Recording so the future agent doesn't reinvent the analysis.

11. **MDN — `Document.title` and `<title>`**, `https://developer.mozilla.org/en-US/docs/Web/HTML/Element/title` (referenced, not WebFetched). Confirms that each HTML document should have exactly one `<title>` element in its `<head>`. In Next 16, the title is set via `export const metadata = { title: '...' }` in the page or layout file. The root layout's metadata is the default; page-level metadata overrides it for that page. Step 32's title audit verifies this override is present on every page the E2E script touches; the assertion is a simple "does the page's `metadata` export set a `title` field?" grep, not a runtime `document.title` check (which would be order-of-events fragile).

Quality gate check: **4 local Next docs ≥ 3, 3 external WebFetched URLs ≥ 2, 2 paths not taken ≥ 1, total 11 citations ≥ 5.** All gates pass.

## 5. Files to create

- `app/(auth)/error.tsx` — **Client Component**. Line 1 is `'use client'`. Imports `useEffect` from React. Exports `export default function AuthError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void })`. Body: a `useEffect` that calls `console.error(error)` (the friendly message does not include the error text, but the console log preserves it for debugging under the "Console-log triage" harness rules from CLAUDE.md "UI verification harness"); a Tailwind card `<div className="mx-auto mt-16 max-w-md rounded-lg border bg-white p-6 shadow">` containing `<h2 className="text-lg font-semibold">Something went wrong</h2>`, a `<p className="mt-2 text-sm text-gray-600">msksim hit an unexpected error. You can try again or reload the page.</p>`, and a `<button type="button" onClick={() => unstable_retry()} className="mt-4 rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">Try again</button>`. Approximately 20 lines. This is the group-level fallback for `app/(auth)/`.

- `app/(auth)/playground/error.tsx` — **Client Component**. Identical shape to the auth-group error page but with feature-specific message: `<h2>Playground error</h2>` and `<p>The playground view crashed. Reload the page or go back to the runs browser.</p>`. The card includes a second button `<Link href="/runs">Go to runs</Link>` as an escape hatch — a common pattern when a researcher's simulation config triggers a crash and they need to reach the runs browser to delete the bad config without navigating back through the broken playground page. Approximately 25 lines.

- `app/(auth)/experiments/error.tsx` — **Client Component**. Shape as above, message: `<h2>Experiments error</h2>` and `<p>The experiments view crashed. Reload or return to the home page.</p>`. Secondary link to `/`. Approximately 25 lines.

- `app/(auth)/runs/error.tsx` — **Client Component**. Shape as above, message: `<h2>Runs error</h2>` and `<p>The runs browser crashed. Reload or return to the home page.</p>`. Secondary link to `/`. Approximately 25 lines.

- `app/(auth)/runs/[id]/loading.tsx` — **Server Component** (no `'use client'`). Renders a skeleton matching the run detail page's layout from step 26: a top card (`<div className="h-16 bg-gray-200 rounded animate-pulse" />`), a row of three metric summary cards (a flex row of three `h-20 bg-gray-200 rounded animate-pulse`), and a grid of chart placeholders (a 2×4 grid of `aspect-video bg-gray-200 rounded animate-pulse`). Uses only Tailwind utility classes; no React state, no props, no imports except optional type helpers. Approximately 30 lines.

- `app/(auth)/runs/compare/loading.tsx` — **Server Component**. Skeleton for the compare view: a sidebar placeholder on the left (`w-64 h-screen bg-gray-100 rounded animate-pulse`) and a chart grid on the right (same 2×4 grid of aspect-video animate-pulse placeholders as the detail loading). Approximately 25 lines.

- `app/(auth)/experiments/sweeps/[id]/loading.tsx` — **Optional, only if step 28 shipped a sweep-detail route at this path**. Skeleton for the sweep detail page: a heatmap placeholder (`aspect-square max-w-2xl bg-gray-200 rounded animate-pulse`) and a table placeholder below it (rows of `h-6 bg-gray-200 rounded animate-pulse` with `mb-2` spacing). Approximately 25 lines. **If step 28 ships the sweep detail under a different path** (e.g., `/experiments/sweeps/page.tsx?sweepId=<id>` as a flat page rather than a dynamic route), the loading file is **not** created — only dynamic route segments benefit from `loading.tsx`, flat pages would need an inline `<Suspense>` wrapper which is out of step 32's polish scope.

- `app/(auth)/_components/empty-state.tsx` — **Reusable Server Component**. A small presentational card that takes `{ title: string; description: string; action?: { label: string; href: string } }` as props and renders a centered Tailwind card (`mx-auto mt-16 max-w-md rounded-lg border border-dashed bg-gray-50 p-8 text-center`) containing an icon-like placeholder (a light SVG or a Tailwind-styled divider), the title as `<h2 className="text-lg font-semibold text-gray-700">`, the description as `<p className="mt-2 text-sm text-gray-500">`, and if the action prop is present a `<Link href={action.href} className="mt-4 inline-block rounded bg-blue-600 px-4 py-2 text-sm text-white">{action.label}</Link>`. Approximately 30 lines. Lives in the `_components` folder (Next's convention for non-routed directories — the leading underscore prevents the router from treating it as a route segment). This component is the **only** new UI component step 32 ships; the three empty states in §6 all consume it rather than hand-rolling their own markup.

- `app/(auth)/_components/empty-state.test.tsx` — **Vitest component test** under the `happy-dom` environment via the `// @vitest-environment happy-dom` docblock. Tests: (a) renders title and description; (b) renders the action link when provided; (c) does not render an action link when `action` is absent. Approximately 40 lines. This is the only new unit test file in step 32 — every other verification is via the E2E MCP script.

- `docs/screenshots/step-32-e2e-login.png` — **Generated by the MCP verification script** during step execution. Binary file committed in the same commit. Captures the login page.

- `docs/screenshots/step-32-e2e-config-editor.png` — **Generated by the MCP script**. Captures the new-config editor with the 50-tick form filled in.

- `docs/screenshots/step-32-e2e-playground.png` — **Generated by the MCP script**. Captures the playground with the simulation running and the metrics dashboard populated.

- `docs/screenshots/step-32-e2e-network.png` — **Generated by the MCP script**. Captures the network view.

- `docs/screenshots/step-32-e2e-runs.png` — **Generated by the MCP script**. Captures the runs browser with the new run listed.

- `docs/screenshots/step-32-e2e-run-detail.png` — **Generated by the MCP script**. Captures the run detail page with the full metrics rendered from DB.

- `docs/screenshots/step-32-e2e-compare.png` — **Generated by the MCP script**. Captures the comparison view with one run.

- `docs/screenshots/step-32-e2e-preset.png` — **Generated by the MCP script**. Captures the experiments page after clicking the Outcome 1 — Segregation preset.

- `docs/screenshots/step-32-e2e-logout.png` — **Generated by the MCP script**. Captures the login page after logout (to confirm the redirect).

Every screenshot is committed in the same commit as the code. Nine PNGs total; at ~100KB each this is under 1MB of binary, well within the commit budget.

## 6. Files to modify

Step 32 is the polish pass and therefore legitimately touches files landed in earlier steps. Each modification is small and additive — no file is rewritten. The modifications fall into four buckets:

**Empty state integrations:**

- `app/(auth)/runs/page.tsx` (from step 26) — add a conditional at the top of the render tree: if `runs.length === 0`, return `<EmptyState title="No runs yet" description="Start a simulation from the playground to see it here." action={{ label: 'Go to playground', href: '/playground' }} />` instead of the (presumably empty) table. The conditional wraps the existing table JSX without modifying it.

- `app/(auth)/experiments/page.tsx` (from step 25) — add the same shape conditional: if `configs.length === 0`, return `<EmptyState title="No configs yet" description="Create your first experiment configuration to get started." action={{ label: 'New config', href: '/experiments/new' }} />`.

- `app/(auth)/runs/compare/page.tsx` (from step 29) — add a conditional: if the parsed `runs` query-param array is empty, return `<EmptyState title="Select runs to compare" description="Pick 1 to 4 completed runs from the runs browser and compare their metrics on shared axes." action={{ label: 'Go to runs', href: '/runs' }} />`. The "1 to 4" wording is deliberate — it matches the step-specific context's requirement that the comparison view renders for 1 run (not just ≥ 2). Step 29's implementation already supports a 1-run comparison; this empty state only triggers on 0 selections.

**Title metadata fixes** (only if earlier steps forgot them):

- `app/(auth)/page.tsx`, `app/(auth)/playground/page.tsx`, `app/(auth)/experiments/page.tsx`, `app/(auth)/experiments/new/page.tsx`, `app/(auth)/experiments/[id]/page.tsx`, `app/(auth)/runs/page.tsx`, `app/(auth)/runs/[id]/page.tsx`, `app/(auth)/runs/compare/page.tsx`, and the step-27/28 sweep routes if they exist — for each file, step 32 checks (via Grep or Read) whether an `export const metadata` block exists with a `title` field. If yes and the title is msksim-scoped, leave it alone. If missing or the title is a generic default, add `export const metadata: Metadata = { title: 'msksim — <feature>' };` at the top of the file with the appropriate feature label. **The step 32 implementing claude reports the list of files it touched** for title metadata; the count is expected to be ≤ 4 because most earlier plan files explicitly ship metadata in their files-to-create section.

**Active nav link styling** (only if earlier steps didn't):

- `app/(auth)/layout.tsx` or `app/(auth)/_components/nav.tsx` (wherever step 07 put the nav row) — if the nav row does not already apply an "active" class (e.g., `font-semibold text-blue-700`) to the link matching the current route, add the logic via `usePathname()` in a small `'use client'` nav component. If step 07's nav is a Server Component with hard-coded links and no active state, extracting a client wrapper is the minimal change. This is a ≤ 20-line addition. **If the active state is already implemented** (which the step 07 plan does not mandate, so it's a step-32-run-time check), leave the file alone.

**Stray console.log removal:**

- Grep the entire `app/` and `lib/` tree for `console.log` and `console.debug`. For each match, decide:
  - If it's inside an `error.tsx` file (where `console.error(error)` is the canonical pattern per the Next error doc), **leave it**.
  - If it's inside a test file (`*.test.ts` or `*.test.tsx`), **leave it** — tests are allowed to log.
  - If it's inside a production code path (a page, a component, an action, a lib helper), **remove it**. These are the dev-only hacks the polish pass is supposed to catch.
- Report the list of files touched in the commit body. Expected count is small — earlier plan files discourage console.log liberally — but the audit is the point.

**CLAUDE.md append** — per §11, with a strict line budget.

**No other files are modified.** No feature files are refactored. No component signatures change. No library versions are bumped.

## 7. Implementation approach

Work proceeds in seven sequential slices. Do not reorder: later slices depend on earlier ones landing.

**Slice one — audit the landed state of every UI surface.** Before writing any code, the implementing claude runs `Grep` across the repo to answer concrete questions: (a) Which `app/(auth)/**/page.tsx` files already have an `export const metadata` block with a msksim-scoped title? (Grep: `export const metadata`.) (b) Does `app/(auth)/layout.tsx` already implement an active nav link state? (Grep: `usePathname`.) (c) How many `console.log` calls exist outside test files and `error.tsx` files? (Grep: `console\.log` then filter.) (d) What is the exact preset label for Outcome 1 that step 31 shipped? (Grep `app/(auth)/experiments/presets*` or similar, looking for the string.) (e) What is the exact URL shape of the export routes step 30 shipped? (Grep `app/api/export`.) The audit produces a short internal report — a Markdown scratch file under `/tmp` or just a mental note — that drives which files §6's modifications actually touch. **This slice is cheap and must happen first**; skipping it causes the polish pass to either miss obvious fixes or redundantly re-add what earlier steps already shipped.

**Slice two — ship the four `error.tsx` files.** Create `app/(auth)/error.tsx` first as the group-level fallback. It is a Client Component (`'use client'` on line 1) with the `{ error, unstable_retry }` props shape and the friendly-card + retry-button body documented in §5. Then create the three scoped error pages under `app/(auth)/playground/`, `app/(auth)/experiments/`, and `app/(auth)/runs/`, each with a feature-specific message and — for playground and runs — a secondary escape-hatch link. After the four files land, run `npm run build` to verify Next's App Router picks them up and no TypeScript errors appear (the `Error & { digest?: string }` type is from the Next doc, not imported from `'next'` — it's a structural annotation, not a named type, so the build should succeed without extra imports). **Verification step inside this slice**: once the build succeeds, temporarily throw a hand-crafted error inside `app/(auth)/playground/page.tsx` (e.g., `if (process.env.MSKSIM_TEST_CRASH === '1') throw new Error('test crash');`), confirm via `next start` + manual browser visit with the env var set that the playground error page renders, then **remove the crash helper** before committing. This is a development-time smoke test; the E2E script does not exercise the error boundary because deliberately crashing a page in the middle of a happy-path E2E is fragile and adds state-reset complexity.

**Slice three — ship the `loading.tsx` files.** Create `app/(auth)/runs/[id]/loading.tsx` first because it is the most-visited slow route. It is a Server Component (no `'use client'`) returning a Tailwind-styled skeleton grid. The layout must match the run detail page's layout from step 26 closely enough that the post-load content-in shift is minimal — read step 26's page.tsx first to see what the detail page actually renders, then shape the skeleton to match. Then create `app/(auth)/runs/compare/loading.tsx` with the sidebar + grid split matching step 29. Then **conditionally** create `app/(auth)/experiments/sweeps/[id]/loading.tsx` only if step 28 shipped that route (grep first). After each file lands, run `next build` to verify Next picks it up. **Verification step**: `next start` and navigate to `/runs/<id>` where `<id>` is a freshly-created small run from a previous step's DB (or seed one manually if the DB is empty). The skeleton should flash briefly before the page loads. If the skeleton does not appear, the Server Component is returning faster than the perceptual threshold — that's fine and is **not a bug**; the skeleton exists for slow loads and short loads are a win. The E2E script at §10 does **not** explicitly assert the loading skeleton renders because the assertion is timing-fragile (a fast SSD on the test machine would skip the skeleton entirely); the skeleton's correctness is verified by the `next build` success and the manual visual check in this slice.

**Slice four — ship the empty-state component and integrate it.** Create `app/(auth)/_components/empty-state.tsx` with the `{ title, description, action? }` props shape and the Tailwind card markup. Create the `.test.tsx` file alongside it with three rendering tests. Then modify the three list pages per §6: `app/(auth)/runs/page.tsx`, `app/(auth)/experiments/page.tsx`, `app/(auth)/runs/compare/page.tsx`. Each modification is a single conditional block at the top of the render tree — a few lines. The list pages still work the same way when data is present; only the empty case changes. Run `npm test` to verify the new `empty-state.test.tsx` cases pass, then `npm run build` to verify the integrations still compile. **Important scope reminder**: the empty-state component is the **only** new UI component this step ships. The error pages and loading pages are not imported from `_components/` — each is a page-level file living where Next expects it.

**Slice five — polish-pass audits and fixes.** Walk every `page.tsx` under `app/(auth)/` and verify the `export const metadata` block has a msksim-scoped title. Fix the ones that don't (add `export const metadata: Metadata = { title: 'msksim — <feature>' };`). Verify `app/layout.tsx` still carries `<html lang="en">` (grep; if missing, restore from step 00's commit). Verify the nav row highlights the active route; if it does not, add a `usePathname`-based client nav wrapper. Run the Grep for `console.log` / `console.debug` outside tests and error.tsx files; remove each match. After the audit, run `npm run lint` and fix any violations the a11y plugin or other rules surface. Run `npm run typecheck` and fix any drift. The polish pass is "small-diff, many-files" by design; no single file should see more than ~10 lines of change from this slice, and most files should see zero.

**Slice six — the E2E MCP smoke script.** This is the acceptance criterion for the whole step. The implementing claude executes the ordered sequence of MCP tool calls enumerated in §10 against `process.env.MSKSIM_BASE_URL`, with the seed credentials from `MSKSIM_SEED_USER` / `MSKSIM_SEED_PASS`, taking a screenshot at each major stage, and checking `list_console_messages` and `list_network_requests` between stages. The script runs long — 30+ tool calls over ~10-15 minutes of wall time depending on simulation-run speed — so the 40-minute step timeout has comfortable margin. The script is a **single linear sequence**; there is no branching on stage failures. If any assertion fails, the implementing claude reports the failure, does **not** continue past it, and does **not** commit. A partial pass is not a pass.

**Slice seven — commit and CLAUDE.md append.** Stage the code changes, the nine screenshots, and the CLAUDE.md edit in a single commit. The commit message is exactly `step 32: polish and e2e smoke` (§12). The CLAUDE.md edit is a small append per §11. After the commit, `scripts/run-plan.ts`'s post-step gates run `npx tsc --noEmit`, `npx eslint .`, and verify the commit subject matches the canonical marker. If any gate fails, the step is a failure and the commit is reverted via `git reset --soft HEAD~1` for re-work.

Three gotchas the implementing claude must handle:

1. **React 19 strict mode effects.** The `error.tsx` files use `useEffect` to log the error. React 19 strict mode double-invokes effects in development. This means `console.error(error)` fires twice per error in dev. This is fine and **not a bug** — the MCP script's console triage already ignores strict-mode warnings per the harness rules, and the `console.error` log is for debugging, not for assertion. The gotcha is documented here so a future reviewer doesn't chase the duplicate log as an issue.

2. **`await searchParams` in the runs/compare page.** When modifying the step-29 compare page to add the empty-state conditional, the condition must be based on the already-awaited `searchParams` — not on `searchParams` directly, which in Next 16 is a Promise. If the compare page's body is `const sp = await searchParams; const runs = parseRunsParam(sp.runs); if (runs.length === 0) { return <EmptyState ... />; }`, this is correct. Inserting the check **before** the await is a silent bug — the condition always reads `runs` as undefined because `sp` is still a Promise. Recording the sequencing explicitly.

3. **Preset label drift.** The E2E script expects step 31's preset label to be `"Outcome 1 — Segregation"` (em-dash, title case). If step 31 shipped `"Outcome 1: Segregation"` (colon) or `"Outcome 1 - Segregation"` (hyphen) or a slightly different casing, the MCP `wait_for` or `click` that targets the preset button by its visible text will fail. The audit in slice one must grep for the actual label, and the E2E script at §10 must use whatever label step 31 actually shipped. Record any mismatch in the commit body for the benefit of the step-31 plan file.

## 8. Library choices

**None.** Step 32 installs zero new runtime dependencies and zero new devDependencies. Every polish file uses Tailwind utility classes from the step-00 install. Every error page uses React + Next primitives shipped with `next@16.2.2` and `react@19.2.4`. The `empty-state.tsx` test uses Vitest + `happy-dom` which step 00 already installed. The E2E script uses the chrome-devtools MCP tools which are part of the harness runtime, not an npm package.

If any dependency appears to be needed during implementation (e.g., "we need a spinner library"), stop and reconsider — the polish should be achievable with zero additions, and an added dependency at this stage is a code smell. Tailwind's `animate-pulse` is enough for skeletons; Next's `error.tsx` + `loading.tsx` conventions handle the rest.

## 9. Unit tests

The E2E MCP script is the primary verification of this step. The Vitest suite adds only the component tests for the new `EmptyState` component.

All tests live in `app/(auth)/_components/empty-state.test.tsx`. The file opens with `// @vitest-environment happy-dom` to opt into the DOM environment. Imports: `{ render, screen } from '@testing-library/react'` (if already installed from earlier steps) or the bare Vitest + JSDOM equivalent (hand-rolled `render` helper). If `@testing-library/react` is not already installed, the tests use a minimal hand-rolled render function — **do not install the library just for these three tests**; they are small enough to write without it.

Tests:

1. **EmptyState renders title and description.** Given `<EmptyState title="No runs" description="Start one" />`, assert the DOM contains the text "No runs" and "Start one".
2. **EmptyState renders action link when provided.** Given `<EmptyState title="..." description="..." action={{ label: 'Go', href: '/playground' }} />`, assert an `<a>` with `href="/playground"` and text "Go" is in the DOM.
3. **EmptyState does not render action link when absent.** Given `<EmptyState title="..." description="..." />`, assert no `<a>` tag is in the DOM.

These three tests are the **only** new Vitest cases step 32 adds. The error pages, the loading pages, and the integrations on the list pages are all covered by the E2E script.

`npm test` must exit 0 including these three new cases (and all prior tests). `npm run typecheck` and `npm run lint` must also exit 0 per the static gates in §10.

## 10. Acceptance criteria

### Static gates (run by `scripts/run-plan.ts` post-commit)

- `npx tsc --noEmit` exits 0.
- `npx eslint .` exits 0.
- `npm test` exits 0 (including the three new `empty-state.test.tsx` cases).
- `npm run build` (`next build`) exits 0. Critical for step 32 because the polish changes include new route-segment files (error.tsx, loading.tsx) that the App Router picks up only at build time.
- CLAUDE.md diff ≤ 100 lines growth (per-step pipeline guard); step 32's §11 target is ≤ 20 lines, so this is comfortable.
- Commit subject matches `/^step\s+32\s*[:.\-]/i`. If the implementing claude used a slightly off variant, `scripts/run-plan.ts` normalizes via `git commit --amend`.
- Grep confirms no `console.log` outside test files and `error.tsx` files remain in the repo.
- Grep confirms every `app/(auth)/**/page.tsx` has an `export const metadata` block with a title string matching `/msksim/i`.
- Grep confirms `app/layout.tsx` still contains `lang="en"`.

### End-to-end chrome-devtools MCP script (the main verification)

The implementing claude runs the following tool calls in order against `process.env.MSKSIM_BASE_URL`. Between each major stage, the claude calls `mcp__chrome-devtools__list_console_messages` and `mcp__chrome-devtools__list_network_requests` to verify no errors or 4xx/5xx responses have accumulated. The seed credentials come from `process.env.MSKSIM_SEED_USER` and `process.env.MSKSIM_SEED_PASS` (set by `scripts/run-plan.ts` and seeded by its `ensureSeedUser` helper). Screenshots go to `docs/screenshots/step-32-e2e-<stage>.png`.

**Stage 1 — Open, clear, login.**

1. `mcp__chrome-devtools__new_page` with `url: process.env.MSKSIM_BASE_URL`. Creates a fresh browser page with no residual state.
2. `mcp__chrome-devtools__evaluate_script` with `document.cookie.split(';').forEach(c => document.cookie = c.replace(/^ +/, '').replace(/=.*/, '=;expires=' + new Date().toUTCString() + ';path=/')); localStorage.clear(); sessionStorage.clear(); return 'cleared';`. Clears residual state from any prior pipeline run.
3. `mcp__chrome-devtools__navigate_page` to `/`. Expected: 307 redirect to `/login?next=%2F` from the proxy; browser lands on `/login`.
4. `mcp__chrome-devtools__evaluate_script` with `return location.pathname;`. Assert value is `'/login'`.
5. `mcp__chrome-devtools__take_screenshot` → save to `docs/screenshots/step-32-e2e-login.png`.
6. `mcp__chrome-devtools__take_snapshot` to get UIDs for the username input, password input, and submit button.
7. `mcp__chrome-devtools__fill` username with `process.env.MSKSIM_SEED_USER`.
8. `mcp__chrome-devtools__fill` password with `process.env.MSKSIM_SEED_PASS`.
9. `mcp__chrome-devtools__click` the submit button.
10. `mcp__chrome-devtools__wait_for` text `'Welcome'` (the authenticated home page card from step 07). 10-second timeout. Assert the URL is now `'/'`.
11. Console + network triage. Zero console errors; every status in `[200, 204, 301, 302, 303, 307, 308]`.

**Stage 2 — Create a new config in the experiments editor.**

12. `mcp__chrome-devtools__navigate_page` to `/experiments`. Wait for text `'Experiments'` (the page heading).
13. `mcp__chrome-devtools__take_snapshot`. Locate the "New config" button (labeled per step 25; grep if uncertain).
14. `mcp__chrome-devtools__click` on the New Config button. Expected: navigation to `/experiments/new`.
15. `mcp__chrome-devtools__wait_for` text indicating the editor form is rendered (e.g., a field label like `'World 1'` or `'Tick count'` per step 25).
16. `mcp__chrome-devtools__take_snapshot`. Locate the tick-count input, the config-name input (if exposed), and the Save button.
17. `mcp__chrome-devtools__fill` or `mcp__chrome-devtools__fill_form` on the tick-count input to set it to `50` (a short run to keep the MCP wall-clock reasonable). If step 25's editor hydrates from schema defaults, most fields stay at defaults; only `tickCount = 50` and optionally a config name like `"e2e-smoke"` need explicit writes.
18. `mcp__chrome-devtools__take_screenshot` → `docs/screenshots/step-32-e2e-config-editor.png`.
19. `mcp__chrome-devtools__click` on the Save button.
20. `mcp__chrome-devtools__wait_for` the post-save state — either a redirect to `/experiments/[id]` (the edit page for the newly-created config) or to `/experiments` with the new row visible. Step 25's plan documents both options; the E2E script accepts either and extracts the `configId` from either location (via `evaluate_script('return location.pathname;')` + string parsing, or via reading a data-attribute on the row).
21. Capture the new `configId` into a script-local variable for later stages.
22. Console + network triage.

**Stage 3 — Run the simulation in the playground.**

23. `mcp__chrome-devtools__navigate_page` to `/playground?configId=<configId>` (substituting the captured id).
24. `mcp__chrome-devtools__wait_for` the simulation shell to initialize — text indicating the lattice canvas or controls are present (e.g., `'Play'` button per step 24).
25. `mcp__chrome-devtools__take_snapshot`. Locate the Play button.
26. `mcp__chrome-devtools__click` the Play button.
27. `mcp__chrome-devtools__wait_for` the tick counter to reach 50. The wait condition is a text-match on the tick counter element (e.g., `'tick 50'` or `'50 / 50'` per step 24's HUD). 30-second timeout — at the default tick rate a 50-tick run with N = 100 per world completes in a few seconds, but the worker startup and rendering loop add overhead.
28. `mcp__chrome-devtools__evaluate_script` with a query like `return document.querySelector('[data-testid="lattice-canvas-world1"]')?.getContext('2d')?.getImageData(0,0,10,10)?.data.length;` to verify the lattice canvas is non-empty (has rendered pixels). If step 21 did not ship a `data-testid` attribute, use the canvas element tag name query and the same `getContext('2d')` check. Assert the result is truthy.
29. `mcp__chrome-devtools__evaluate_script` with a query like `return Array.from(document.querySelectorAll('svg path')).length;` to verify the metrics dashboard has populated chart SVG paths (Recharts renders each line as an SVG path). Assert the result is > 0.
30. `mcp__chrome-devtools__take_screenshot` → `docs/screenshots/step-32-e2e-playground.png`.
31. `mcp__chrome-devtools__take_snapshot`. Locate the "Network view" tab / toggle (step 23 shipped the view toggle; grep the step-23 plan for the exact label if uncertain — likely `'Network'` or `'Network view'`).
32. `mcp__chrome-devtools__click` the Network view toggle.
33. `mcp__chrome-devtools__wait_for` the sigma canvas to render — a WebGL canvas element (step 23). Use `evaluate_script` to query `document.querySelector('canvas.sigma-scene, [data-sigma="true"] canvas')` and assert it exists and has nonzero width/height.
34. `mcp__chrome-devtools__take_screenshot` → `docs/screenshots/step-32-e2e-network.png`.
35. Console + network triage. Zero errors; every status in the allowed set.

**Stage 4 — Verify run persistence via the runs browser.**

36. `mcp__chrome-devtools__navigate_page` to `/runs`. Wait for the table to render.
37. `mcp__chrome-devtools__evaluate_script` with `return document.body.innerText.includes('completed');` (or whichever classification label step 26 uses for the most-recently-created row). Assert true.
38. `mcp__chrome-devtools__take_screenshot` → `docs/screenshots/step-32-e2e-runs.png`.
39. `mcp__chrome-devtools__take_snapshot`. Locate the row for the most recent run (the one this E2E just created) and its "View" link / click affordance.
40. `mcp__chrome-devtools__click` the View link for the new run.
41. `mcp__chrome-devtools__wait_for` the run detail page to load (text like the run's classification label or metrics headings per step 26).
42. `mcp__chrome-devtools__evaluate_script` to assert the detail page rendered at least one chart (SVG path count > 0) and has the run's seed visible in the page text.
43. `mcp__chrome-devtools__take_screenshot` → `docs/screenshots/step-32-e2e-run-detail.png`.
44. Capture `location.pathname` to extract the run id (for the export URLs in the next stage).
45. Console + network triage.

**Stage 5 — Export CSV and JSON.**

46. `mcp__chrome-devtools__evaluate_script` with `fetch('/api/export/<runId>/metrics.csv', { credentials: 'same-origin' }).then(r => ({ status: r.status, contentType: r.headers.get('content-type'), contentDisposition: r.headers.get('content-disposition') }));` — this fetches the export route and returns the response metadata without downloading the body (the body is discarded because the fetch's response is not consumed further). Assert `status === 200`, `contentType` starts with `'text/csv'`, and `contentDisposition` contains `'attachment'`. If step 30 shipped the route under a different path (per the slice-one audit), use the actual path.
47. `mcp__chrome-devtools__evaluate_script` with `fetch('/api/export/<runId>/snapshot.json', { credentials: 'same-origin' }).then(r => ({ status: r.status, contentType: r.headers.get('content-type'), contentDisposition: r.headers.get('content-disposition') }));`. Assert `status === 200`, `contentType` starts with `'application/json'`, and `contentDisposition` contains `'attachment'`.
48. Console + network triage. The two 200s from the fetches are the success signal; if the Route Handlers throw, the status will be 500 and the triage will catch it.

**Stage 6 — Open the comparison view with one run.**

49. `mcp__chrome-devtools__navigate_page` to `/runs/compare?runs=<runId>` (substituting the captured id).
50. `mcp__chrome-devtools__wait_for` the compare view to render — text indicating the chart grid or the run label per step 29. 10-second timeout.
51. `mcp__chrome-devtools__evaluate_script` to assert the comparison page rendered at least one chart. Assert the **empty state card is NOT visible** (text `'Select runs to compare'` is absent from the page). This is the critical assertion for the step-32 empty-state decision: 1 run is a valid comparison, not empty.
52. `mcp__chrome-devtools__take_screenshot` → `docs/screenshots/step-32-e2e-compare.png`.
53. Console + network triage.

**Stage 7 — Load a hypothesis preset and run it in the playground.**

54. `mcp__chrome-devtools__navigate_page` to `/experiments`. Wait for the page.
55. `mcp__chrome-devtools__take_snapshot`. Locate the "Outcome 1 — Segregation" preset button / tile (or whatever exact label step 31 shipped; per the slice-one audit).
56. `mcp__chrome-devtools__click` the preset button.
57. `mcp__chrome-devtools__wait_for` the editor to populate with the preset's values. The wait condition is a text-match on a characteristic field value the preset sets (e.g., a specific mono:bi ratio or a specific agent count). Step 31's plan file will document what that value is; the E2E script uses it.
58. `mcp__chrome-devtools__take_screenshot` → `docs/screenshots/step-32-e2e-preset.png`.
59. `mcp__chrome-devtools__take_snapshot`. Locate the "Run in playground" button (step 31 documents this affordance per its plan file).
60. `mcp__chrome-devtools__click` the Run in Playground button.
61. `mcp__chrome-devtools__wait_for` the playground to load with the preset config — a redirect to `/playground?configId=<preset-config-id>` and the simulation shell initialized.
62. `mcp__chrome-devtools__evaluate_script` to assert `location.pathname === '/playground'` and `location.search` includes `configId=`.
63. Console + network triage.

**Stage 8 — Logout.**

64. `mcp__chrome-devtools__take_snapshot`. Locate the logout button in the header (step 07 shipped it as a `<form action={logoutAction}>` submit button).
65. `mcp__chrome-devtools__click` the logout button.
66. `mcp__chrome-devtools__wait_for` the redirect to `/login` — text `'msksim — sign in'` or similar heading.
67. `mcp__chrome-devtools__evaluate_script` with `return location.pathname;`. Assert value is `'/login'`.
68. `mcp__chrome-devtools__take_screenshot` → `docs/screenshots/step-32-e2e-logout.png`.
69. Final console + network triage. Zero errors, all statuses in the allowed set.

**Stage 9 — Commit.**

70. Stage all changes (new files, modified files, nine screenshots), create the single commit with the canonical message from §12, and confirm via `git log -1 --oneline`.

### Tolerance notes

- React 19 dev-mode warnings (strict-mode double-invocation notices, specific known React 19 hydration hints) are tolerated per CLAUDE.md "UI verification harness". Thrown errors, hydration mismatches, unhandled promise rejections, and 4xx/5xx network responses fail the step.
- The 307 from the proxy redirect on step 1→4, the 303 from the login action redirect on step 10, and any 200-with-streamed-notfound responses are all allowed per the allowed-status list.
- The network triage skips preflight `OPTIONS` requests and browser-originated `favicon.ico` 404s (which are not application bugs). The triage explicitly checks only requests whose URL starts with `MSKSIM_BASE_URL`.

## 11. CLAUDE.md updates

Append to CLAUDE.md **"UI verification harness"** section (≤ 10 lines; the section is near its 60-line cap, so the append is terse):

- The step 32 E2E smoke script is the reference "full researcher journey" MCP sequence: login → create config → run → save → reopen → export CSV/JSON → compare → preset → logout. Copy/adapt the stage structure from `docs/plan/32-polish-and-e2e-smoke.md` §10 for any future multi-feature end-to-end verification. The script uses only the standard MCP tool set (`new_page`, `navigate_page`, `fill`, `click`, `wait_for`, `evaluate_script`, `take_snapshot`, `take_screenshot`, `list_console_messages`, `list_network_requests`) — no Playwright, no Cypress, no custom harness extension.
- Multi-stage screenshots use the naming convention `docs/screenshots/step-NN-<keyword>-<stage>.png` (e.g., `step-32-e2e-playground.png`) so the reviewer can scrub through the user journey chronologically.
- For export endpoints (Route Handlers), the MCP verification uses `evaluate_script` with `fetch(url, { credentials: 'same-origin' })` + response-metadata inspection rather than `navigate_page`, because navigating to a download URL triggers the browser's native download flow which the MCP tools do not model cleanly. The fetch-based check asserts status, `content-type`, and `content-disposition` without consuming the body.

Append to CLAUDE.md **"Living-document rules"** section a single closing marker (≤ 3 lines):

- **v1 complete.** Step 32 lands the end-of-pipeline polish and the end-to-end smoke. Subsequent edits to this document are for v2 planning or in-production maintenance, not for the v1 build plan. The plan directory `docs/plan/NN-*.md` is frozen as the historical record of how v1 was built.

Total CLAUDE.md growth: ≤ 13 lines, well within the 100-lines-per-step pipeline guard and the per-section caps. The "UI verification harness" section remains within its 60-line cap after the append; the implementing claude verifies by counting lines of the section before and after the edit and aborts if the cap is breached.

## 12. Commit message

Exactly:

```
step 32: polish and e2e smoke
```

No conventional-commit prefix (`feat:`, `chore:`, etc.), no emoji, no trailing period. The `step NN:` marker is load-bearing for `scripts/run-plan.ts` progress detection (CLAUDE.md "Commit-message convention" — the orchestrator greps `git log` for this literal pattern). One commit for the whole step, including the nine `docs/screenshots/step-32-e2e-*.png` binaries, the four `error.tsx` files, the two or three `loading.tsx` files, the `empty-state.tsx` component and its test, the list-page empty-state integrations, any title/nav/console-log polish fixes, and the CLAUDE.md append. The commit message body may optionally list files touched for title metadata and console.log removal (small diff notes) and any preset-label drift found during slice one (as a cross-reference to step 31), but the subject line is exactly the canonical marker. If the implementing claude's tool produces multiple intermediate commits, `scripts/run-plan.ts` squashes them via `git reset --soft HEAD~N && git commit` before advancing. If the subject differs slightly (e.g., `Step 32:` or `step 32 -`), the orchestrator normalizes via `git commit --amend`.

## 13. Rollback notes

If the step lands in a broken state and needs to be undone:

1. `git log --oneline | head -5` to find the commit SHA of step 31 (`step 31: hypothesis presets` or normalized variant).
2. `git reset --hard <step-31-sha>`. This reverts everything in step 32: the four `error.tsx` files, the two to three `loading.tsx` files, the `empty-state.tsx` component and its test, the list-page empty-state conditionals, any title/nav/console-log polish fixes, the CLAUDE.md append, and all nine E2E screenshots.
3. Verify via `git status` that the working tree is clean and the HEAD commit subject reads `step 31: hypothesis presets`. If any stray untracked files remain (e.g., screenshot files that were saved before the commit and the commit never finalized), `rm docs/screenshots/step-32-e2e-*.png` manually.
4. Re-run `npm test` against the rolled-back tree to confirm step 31's tests still pass and that nothing from step 32 left behind a stray import or test file.
5. Re-run `npx tsx scripts/run-plan.ts --only 32` to redo the step from a clean base. Because `scripts/run-plan.ts` detects completed steps via `git log` greps for the `step NN:` marker and the step 32 marker is now gone, the orchestrator will pick the step up as pending.

Because step 32 is the **final step** in the pipeline, there is no "subsequent step to worry about" case — no forward rollback is needed. If a bug is discovered after v1 ships and the repo is the main branch, the fix is a new commit (either `step 32-fix: ...` as a followup or a feature-branch PR), not a rewrite of the step 32 commit. Rewriting the step 32 commit after a successful pipeline run would be a destructive history edit with no upside.

Special case: if the rollback is triggered **after** someone has already built on top of the step 32 commit (e.g., v2 planning has started and new commits reference step 32's files), the hard reset is destructive and drops the v2 work too. In that case, prefer `git revert <step-32-sha>` to create an inverse commit — which is the less disruptive path for any v2 work already underway. The revert commit's subject is `revert: step 32: polish and e2e smoke`, which `scripts/run-plan.ts` will then see as "step 32 incomplete" and re-queue on the next pipeline run.
