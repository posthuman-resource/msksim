---
step: '22'
title: 'metrics dashboard'
kind: ui
ui: true
timeout_minutes: 40
prerequisites:
  - 'step 17: run summary metrics'
  - 'step 21: lattice canvas renderer'
---

## 1. Goal

Deliver **F9 (Live metrics dashboard)** from `docs/spec.md` §4.2 as a React client component that renders a panel of synchronized Recharts time-series charts alongside the lattice canvas landed in step 21. The dashboard consumes the per-tick `TickReport` stream the simulation worker emits (step 20's `SimulationWorkerApi.run(totalTicks, onProgress)` or the `step()` snapshots), maintains a rolling in-memory history buffer, and renders one `LineChart` per core §7.1 observable: (a) communication success rate per world and combined, (b) number of distinct active tokens `Nw` per world, (c) mean token weight per world, (d) largest-cluster size per world, (e) Louvain interaction-graph modularity per world, (f) assimilation index as a single cross-world series, and (g) segregation index as a single world-2 series. Every chart is wrapped in a `ResponsiveContainer`, shares a common tick-number X axis, and exposes a lightweight **manual Y-axis override** (auto / `0..1` / custom) via a small popover anchored to the chart header. The F9 acceptance criterion "the researcher can pin any chart to a larger view" is satisfied by a plain state-toggle pin button on the chart header — no routing, no portal, no dialog library, just a conditional layout class that promotes the pinned chart into a full-width panel on top of the grid. The history buffer is a **circular ring of the last 10,000 ticks** with display-time down-sampling to `≤ 1,000` points (every `Nth` tick for long runs) so that Recharts' SVG path never becomes a liability at 60 fps even on a 10⁴-tick run. The buffer is pure-tested; the React surface is MCP-tested; no persistence happens in this step (steps 26 and 30 handle that later). This step is strictly the **live, in-memory visual readout** — the tick stream that already exists from step 20 becomes eyes-on-glass for RQ1 through RQ5 without touching the database, the Server Actions, or any of the `lib/sim/*` pure modules. The dashboard lives on the existing `app/(auth)/playground/page.tsx` route next to the canvas; it does not introduce any new routes, API endpoints, or public files. Step 22 ships (a) a pure history buffer with unit tests, (b) a shared `ChartPanel` wrapper that encapsulates Recharts boilerplate and the Y-axis/pin affordances, (c) the top-level `MetricsDashboard` component that composes seven panels, (d) an extension to `SimulationShell` that collects the metrics stream and threads it into the dashboard, and (e) the `recharts` package installed at the current stable version pinned at execution time.

## 2. Prerequisites

- Commit marker `step 17: run summary metrics` present in `git log`. Step 17 is named in the frontmatter prerequisites because it is the step whose types — `RunSummary`, and by extension the `ScalarMetricsSnapshot`/`GraphMetricsSnapshot` re-exports — the dashboard imports via the step-20 worker API re-export chain. The dashboard itself does **not** render any run-summary fields (step 17's classifiers are end-of-run labels, not per-tick observables), but the `RunResult` type the worker returns from `run()` is composed of step-17 types and step-22 must be able to import it cleanly.
- Commit marker `step 21: lattice canvas renderer` present in `git log`. Step 21 is the direct load-bearing prerequisite: it creates `app/(auth)/playground/page.tsx` and `app/(auth)/playground/simulation-shell.tsx`, owns the worker lifecycle via `createSimulationWorker()` inside a `useEffect`, drives a per-tick render loop, and already exposes either (a) a `metricsHistory` React state array of `TickReport` objects, or (b) a context holding that array. Step 22 **extends** whichever shape step 21 chose (see section 7 slice three for the grep-first protocol for detecting that shape). The `SimulationShell` is the only file in `app/(auth)/playground/` this step modifies; every other file it creates is a sibling of that shell.
- Commit marker `step 20: simulation worker integration` present in `git log`. Step 20 exports the `SimulationWorkerApi` Comlink interface and the `TickReport` / `RunResult` type shapes that the dashboard consumes as readonly input. The shell in step 21 already holds a `Remote<SimulationWorkerApi>`; step 22 does not import the worker types directly, it imports the already-flowing data structures through whatever prop/context the shell exposes, in order to avoid any accidental dual-resolution of the Comlink transport on the main thread (section 4 path-not-taken 9 records this discipline).
- Commit marker `step 16: graph metrics` and `step 15: scalar metrics` present in `git log`. These are the upstream producers of the `ScalarMetricsSnapshot` and `GraphMetricsSnapshot` fields the dashboard reads. Step 22 never computes these snapshots — it only indexes into them. Section 5 enumerates the exact field paths the dashboard reads (`world1.successRate.rate`, `world1.distinctActiveTokens`, etc.) and section 10's MCP script asserts the rendered lines carry the same values the worker emits, not values computed on the main thread.
- Commit marker `step 07: login and app shell` present in `git log`. Step 07 is the UI verification harness baseline — the MCP script in section 10 logs in with the seed credentials `MSKSIM_SEED_USER` / `MSKSIM_SEED_PASS` and navigates to `/playground`, following the `CLAUDE.md` "UI verification harness" protocol the step-07 plan file established.
- Node ≥ 20.9, Next.js 16.2.2, React 19.2.4, and the Tailwind 4 tooling from step 00. The dashboard is a client component and Tailwind classes style its grid layout; no new Tailwind plugins are installed.

## 3. Spec references

- `docs/spec.md` **§4.2 Live playground mode**, specifically **F9 Live metrics dashboard**: _"A panel of synchronized time-series charts showing the observables from §7: communication success rate, mean token weight, number of distinct tokens (Nw), cluster count, largest-cluster size, assimilation index, segregation index. Acceptance: All seven core metrics update each tick; the researcher can pin any chart to a larger view; Y-axes are auto-scaled with a manual override. Supports: RQ1–RQ5."_ This is the **authoritative contract** step 22 delivers. Every chart the dashboard ships traces to one of the enumerated metrics. The "pin any chart to a larger view" clause is satisfied by the pin-to-large-view toggle in section 7 slice eight. The "manual override" clause is satisfied by the `auto | 0..1 | custom` popover in section 7 slice seven. The "update each tick" clause is satisfied by the shell's per-tick buffer append hook in section 7 slice three.
- `docs/spec.md` **§7.1 Per-tick scalar metrics** — the authoritative table the dashboard's chart list traces to. The F9 enumeration in §4.2 is a subset of §7.1, and step 22 implements exactly that subset, not the full table. In particular: the dashboard does **not** show `matchingRate`, `tokenWeightVariance`, `successRateByClassPair`, `clusterCount` on its own (it ships `largestClusterSize` as the primary cluster signal), or `timeToConsensus` (which is a summary observable from §7.3, not a per-tick observable). The rationale for the subset selection is F9's own wording: _"communication success rate, mean token weight, number of distinct tokens (Nw), cluster count, largest-cluster size, assimilation index, segregation index"_ — seven items, which map exactly to seven `ChartPanel` instances in section 7 slice five.
- `docs/spec.md` **§9 Capability Requirements — "Time-series charts" row**: _"Recharts — React-declarative, TypeScript-friendly. Also viable: Plotly.js for more statistical features; Visx for full control. Notes: Recharts is the path of least friction for success-rate curves and Nw plots."_ This is the spec's **explicit recommendation** for the chart library. Step 22 honors it by installing `recharts` as the single charting dependency and pinning the current stable version at execution time. Plotly and Visx are the two rejected alternatives recorded in section 4 paths-not-taken 7 and 8.
- `docs/spec.md` **§1.2 RQ1 — Assimilation vs. segregation thresholds** and **RQ5 — Quantifying linguistic pressure.** Both research questions are operationalized by the assimilation and segregation indices from step 16, which become the primary signal the researchers will watch during an interactive session. The dashboard's single-series panels for those two indices are therefore the most important visual in the whole F9 surface — they are the metric the researchers need to see in real time to know whether a config parameter tweak moves the system toward assimilation or segregation. Step 22 gives them their own full-width-friendly pin buttons so a researcher mid-investigation can promote them with one click.
- `docs/spec.md` **§1.2 RQ2 — Role of spatial topology.** RQ2's primary observable per §6's traceability matrix is "cluster count, mean cluster size, time-to-consensus." Largest-cluster size and cluster count are available in the step-16 snapshot; this dashboard plots largest-cluster size (the more diagnostic of the two at a glance). The spec's §2 discussion — _"on a 2D lattice, consensus is reached through a fundamentally different mechanism: topology-induced coarsening. Regional clusters of locally agreeing agents form rapidly, then slowly compete at their boundaries"_ — is exactly what a time-series of `largestClusterSize` visualizes. On well-mixed mode the line goes straight up to `N`; on lattice mode it grows slowly through metastable intermediates. The dashboard must not hide that signal; it is one of the reasons F9 is a first-class playground feature.
- `docs/spec.md` **§11 question 2 "What is the right agent count?"** — _"default to N = 50–500 per world for interactive playground mode [...] and allow headless sweeps up to N = 10⁴ in workers."_ The interactive regime is where the dashboard lives; at N ≤ 500 per world with tick rates up to ~60 Hz, the buffer fills at ≤ 60 `TickReport`/s, and a 10-minute session produces ≤ 36,000 reports. The 10,000-tick circular buffer cap documented in section 7 slice two is chosen to exceed the longest plausible interactive session without unbounded growth; longer sessions will drop the earliest ticks but retain the most recent 10,000, which is the regime the researcher is actually watching. Display down-sampling to `≤ 1,000` points is chosen so a single `LineChart`'s SVG path never carries more than 1,000 points, matching the Recharts performance guidance in section 4 research note 5.

## 4. Research notes

**Local Next.js 16 docs (authoritative per `CLAUDE.md` "Next.js 16 deltas from training data" and `AGENTS.md`):**

1. `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md` §"Using Client Components" and §"Prop boundaries". Documents the `'use client'` directive rules and the Server → Client serialization boundary. **Load-bearing facts for step 22**: (a) the `'use client'` directive must be the first non-comment statement in `metrics-dashboard.tsx`, `chart-panel.tsx`, and any file that consumes Recharts runtime; Recharts components use browser-only APIs (`ResizeObserver`, `SVGElement`) and cannot be SSR-rendered without a dynamic import guard, so they live behind the `'use client'` boundary exactly like the lattice canvas in step 21. (b) Props passed from a Server Component parent to a Client Component child must be JSON-serializable — this is not a concern for step 22 because the dashboard is hosted inside `SimulationShell`, which is itself a Client Component, so all the dashboard's props flow client-to-client without serialization. (c) The Server Component part of `app/(auth)/playground/page.tsx` remains a Server Component responsible for auth verification via `verifySession()` from `lib/auth/dal.ts`; step 22 does not touch the page-level Server Component. This separation is the same split step 21 already ships and step 22 reuses verbatim.

2. `node_modules/next/dist/docs/01-app/03-api-reference/08-turbopack.md` §"Language features" and §"Module resolution". Confirms Turbopack is the default bundler in Next 16 and that it reads `tsconfig.json` path aliases across the unified module graph. **Load-bearing facts for step 22**: (a) `recharts` is an ESM package with a plain `import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'` call; Turbopack resolves it identically in both server and client chunks without any `next.config.ts` knobs or `serverExternalPackages` entries — no custom loader, no legacy webpack configuration. (b) Recharts' CommonJS-era baggage (it historically shipped both CJS and ESM builds) is transparent to Turbopack as long as the package's `exports` field points at the right files, which it has done since Recharts v2.x. The v3.x line the current stable (v3.8.1 per section 8) is cleanly ESM, so there is zero bundler risk. (c) The `'use client'` directive is a Turbopack-recognized boundary that emits a separate client chunk for the dashboard; a Server Component importing `metrics-dashboard.tsx` is valid because the transform automatically generates the RSC → client shim. This is the same pattern the step-21 `SimulationShell` already uses.

3. `node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md` — establishes Vitest as the supported test runner for Next 16 and documents the `node` / `happy-dom` environment split. **Load-bearing facts for step 22**: (a) the circular buffer unit test in `metrics-history.test.ts` is a pure-function test against a data structure with zero React or DOM dependencies — it runs under Vitest's default `node` environment, consistent with the `CLAUDE.md` "Testing conventions" rule _"Tests colocate next to source as `_.test.ts`"* and with step 15's `lib/sim/metrics/scalar.test.ts`precedent. (b) The dashboard component itself is **not** unit-tested under`happy-dom`— Recharts'`ResponsiveContainer`uses`ResizeObserver`, which happy-dom stubs but does not implement faithfully, and the component's correctness is covered end-to-end by the MCP script in section 10 that reads the real rendered SVG. This decision mirrors the step-21 rule to let MCP be the UI-verification layer and Vitest be the pure-logic layer.

4. `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/layout.md` — the App Router `layout.tsx` contract. Relevant because step 22 does **not** add or modify any layout file; the `app/(auth)/layout.tsx` shell created in step 07 already wraps the playground page with the authenticated header and nav, and `app/(auth)/playground/page.tsx` from step 21 already hosts the `SimulationShell`. Step 22's new files are all siblings of the shell file, not layout children, so no layout changes are needed. This citation is included to explicitly record the no-change status against the file convention most likely to be accidentally touched by a careless edit.

**External references (WebFetched during research):**

5. **`https://github.com/recharts/recharts`** (WebFetched during research). Load-bearing facts confirmed by the fetch:
   - **Current stable version**: **v3.8.1** (released March 25, 2026, per the GitHub releases page fetched at plan-write time). The implementing agent **must re-check** at execution time via `npm view recharts version` and pin whatever `npm install` chooses; the version recorded here is the plan-time snapshot and is not authoritative. Section 8 records the re-check protocol and the expected `^3.x` semver range.
   - **Peer dependencies**: `react` and `react-dom` as standard peers, plus `react-is` as a runtime dep (`react-is`'s major version should match the installed React). The project ships React 19.2.4 per `CLAUDE.md` "Stack and versions", and Recharts 3.8.x supports React 19 as a first-class peer. `react-is` is auto-installed as a transitive dependency when `recharts` is installed, but the implementing agent should confirm by running `npm ls react-is` after install and pin the matching major if a mismatch appears.
   - **Core components used by the dashboard**: `LineChart`, `Line`, `XAxis`, `YAxis`, `CartesianGrid`, `Tooltip`, `Legend`, and `ResponsiveContainer`. The typical composition inside the dashboard's `ChartPanel` is:
     ```tsx
     <ResponsiveContainer width="100%" height="100%">
       <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 16 }}>
         <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
         <XAxis dataKey="tick" tick={{ fontSize: 11 }} stroke="#9ca3af" />
         <YAxis domain={yDomain} tick={{ fontSize: 11 }} stroke="#9ca3af" />
         <Tooltip contentStyle={{ background: '#1f2937', border: '1px solid #374151' }} />
         <Legend wrapperStyle={{ fontSize: 12 }} />
         {series.map((s) => (
           <Line
             key={s.dataKey}
             dataKey={s.dataKey}
             name={s.name}
             stroke={s.color}
             dot={false}
             isAnimationActive={false}
             strokeWidth={1.5}
           />
         ))}
       </LineChart>
     </ResponsiveContainer>
     ```
     The `isAnimationActive={false}` setting is important at high tick rates: Recharts' default re-entry animation replays on every prop update, which visibly stutters a live-updating chart. Disabling it makes updates instant. The `dot={false}` setting removes per-point circles because the buffer after down-sampling can still carry up to 1,000 points per series, and drawing circles at that density crushes the frame budget.
   - **ResponsiveContainer**: wraps a single chart child and sizes it to the parent `<div>`'s dimensions using a `ResizeObserver` internally. It must have a parent with a concrete height — in flex/grid layouts a Tailwind class like `h-64` or `min-h-[16rem]` is required; a bare `<div>` with no height causes the container to render at 0×0 and Recharts silently produces an empty SVG. The dashboard enforces a `min-h-[14rem]` on every panel's chart wrapper in section 7 slice four to avoid this footgun.
   - **SSR note**: Recharts is not safe to server-render in Next 16 because it depends on browser APIs during layout. The `'use client'` boundary on every file that imports from `'recharts'` is therefore mandatory, not cosmetic.
   - **Performance guidance from the README**: the README recommends keeping per-series data arrays under ~1,000 points for smooth interaction on mid-range hardware. Longer arrays work but visibly degrade pan/hover latency. This is the citation for the 1,000-point down-sampling cap in section 7 slice two.

6. **`https://recharts.org/en-US/api`** (fetched via the repository canonical link; may 404 on the raw slug, in which case the implementing agent should WebFetch `https://recharts.org/en-US/examples/SynchronizedLineChart` and `https://recharts.org/en-US/examples/CustomActiveShapePieChart` as concrete examples). Load-bearing fact: the **synchronized chart** pattern the spec's F9 wording hints at ("a panel of **synchronized** time-series charts") is a first-class Recharts feature via the `syncId` prop on any chart component. Passing the same `syncId` string to multiple `LineChart` instances causes Recharts to synchronize their tooltips and hover position across charts — hover over a tick on one chart and the crosshair moves on every other chart with the same `syncId`. This is the canonical "synchronized" primitive the dashboard needs and the simplest possible implementation: add `syncId="msksim-dashboard"` to every `LineChart` in the grid. Section 7 slice six documents the exact placement. No other synchronization mechanism is used; the X-axis is shared conceptually (every chart plots `tick` on the X axis against the same buffer) but not shared via a DOM mechanism, because Recharts does not expose a single-axis-multi-chart primitive and the `syncId` tooltip-synchronization is sufficient for the F9 requirement.

7. **Okabe & Ito colorblind-safe palette** — <https://jfly.uni-koeln.de/color/> and <https://davidmathlogic.com/colorblind/>. WebFetched at plan-write time for validation. The **Okabe-Ito 8-color qualitative palette** is the project's chosen multi-series color scheme. It is designed to be distinguishable under protanopia, deuteranopia, and tritanopia (the three common color-vision deficiencies) and has become the de facto standard for scientific figures. The eight hex codes pinned in section 8 (and echoed literally in `chart-panel.tsx` as a `SERIES_COLORS` constant) are:
   - `#000000` (black, reserved as the neutral axis color — not used for data series)
   - `#E69F00` (orange)
   - `#56B4E9` (sky blue)
   - `#009E73` (bluish green)
   - `#F0E442` (yellow) — use sparingly on dark backgrounds because contrast is low
   - `#0072B2` (blue)
   - `#D55E00` (vermillion)
   - `#CC79A7` (reddish purple)
     The dashboard uses at most three distinct colors per chart (e.g. world1 / world2 / combined for the success-rate chart), so a 7-color palette comfortably covers the worst case. The `CC79A7` pink is held as a reserve and the rest are assigned in order of appearance across chart types. This palette was chosen over ColorBrewer's `Set2`/`Dark2` schemes because Okabe-Ito is specifically tuned for categorical series on dark backgrounds (the playground uses the step-07 authenticated-layout dark theme) while ColorBrewer's qualitative schemes are tuned for light backgrounds and cartographic maps. The tradeoff is documented and revisitable; if the researchers prefer a warmer palette in a later step, swap the `SERIES_COLORS` constant — everything else stays the same.

**Paths not taken:**

8. **Plotly.js instead of Recharts.** Considered and rejected. Plotly is the richest JavaScript statistical-charts library in the ecosystem and provides zoom, pan, export-to-PNG, and a huge library of chart types out of the box. The rejection rationale is three-fold: (a) `docs/spec.md` §9 **explicitly names Recharts** as the leading candidate for this capability — Plotly is listed as a "also viable" alternative for "more statistical features," and F9's requirements are not statistical in the sense Plotly targets (no box-plots, no violins, no regression overlays); (b) Plotly's bundle size is ~3 MB minified vs. Recharts ~200 KB minified, a 15x difference that matters on the live-playground route where the lattice canvas and the metrics dashboard already share a chunk; (c) Plotly's React wrapper (`react-plotly.js`) is a community project with a slower update cadence than Recharts' own React-native distribution, and has had persistent React 19 compatibility gaps per its GitHub issue tracker. Recharts is the path of least friction for seven small `LineChart`s on a dashboard; Plotly is overkill for v1 and can be revisited in v2 if the researchers ask for box-plot or heatmap overlays on the time series.

9. **Visx (Airbnb) instead of Recharts.** Considered and rejected. Visx is a set of low-level React primitives over D3 that give the developer full control over scales, axes, legends, and interactions. It is the "build it yourself out of LEGO" option. The rejection rationale: (a) F9's requirements are covered by Recharts' high-level declarative API in ~30 lines per chart, whereas Visx would take ~150 lines per chart because every axis, grid, tooltip, and hover overlay must be composed from scratch; (b) the step budget (40 minutes) does not accommodate a custom chart framework; (c) `docs/spec.md` §9 again names Visx only as "also viable for full control," not as the recommendation. Visx remains a fine choice for a later step if step 28's parameter sweep view needs a highly custom aggregated heatmap that Recharts cannot express, but F9's linear time-series grid is Recharts' sweet spot.

10. **Sharing the metrics buffer via React Context instead of prop drilling.** Considered and chosen as an **intermediate** design: the `SimulationShell` already holds the metrics history in a React state (step 21), and the dashboard is a direct child of the shell. There are two viable shapes for the hand-off: (a) `<MetricsDashboard history={metricsHistory} />` prop drilling from the shell, and (b) a `MetricsContext` that the shell provides and the dashboard consumes via `useContext`. Step 22 picks **(a) prop drilling** for v1 because the shell and dashboard are sibling components in the same directory with exactly one parent-child link between them — introducing a context for a single hop is over-engineering. If step 23 (network view) or a future panel also needs the same history, the refactor to a context is a five-minute change because the prop shape becomes the context shape unchanged. Section 7 slice four documents the prop signature; section 11 notes that the hand-off can be promoted to a context in a future step without touching the dashboard's internals.

11. **Server-rendering the dashboard via `next/dynamic(..., { ssr: false })` instead of `'use client'`.** Considered and rejected. `next/dynamic` with `ssr: false` is an alternative to the `'use client'` directive for suppressing server rendering of a component. The rejection rationale: (a) `'use client'` is the modern Next 16 idiom for declaring a client boundary — the `'use client'` directive is checked at transform time and emits a cleaner chunk boundary than `next/dynamic`, which adds a runtime loading fallback component; (b) `'use client'` composes cleanly with the existing `SimulationShell`, which is already a client component, so the entire dashboard lives inside the same client tree with zero dynamic-import overhead; (c) `CLAUDE.md` "Worker lifecycle" documents the two options and says _"Pick one and document it in the step's plan file"_ — step 21 picked `'use client'` for the shell, and step 22 follows the same discipline for consistency. `next/dynamic` remains available as a fallback if some future step discovers a Recharts component that cannot be tree-shaken from a server bundle at all; for v1 the directive is sufficient.

12. **Streaming the history buffer out of the worker via a `Comlink.proxy` callback on every tick.** Considered and chosen as the **default** pattern, with a fallback to pull-based polling. The step-specific context says "Pick one pattern and document it." The decision: **use the `onProgress` callback already exposed by `SimulationWorkerApi.run(totalTicks, onProgress)`** from step 20. The shell wraps a main-thread handler with `Comlink.proxy(...)` per the step-20 JSDoc requirement and passes it into `run()`. Every tick the worker invokes the callback with the new `TickReport`, the handler calls `dispatchMetrics(report)` which pushes into the circular buffer, and React re-renders the dashboard with the updated buffer view. This is a push-based design with no extra polling and no duplicated data path. The rejected alternative was a `setInterval`-based polling loop on the main thread that calls `api.getMetrics()` every 100 ms; the rejection rationale is that polling creates two sources of truth (the worker's `state.timeSeries` array and the main thread's buffer), and the synchronization edge cases (what happens if the poll interval drifts relative to the tick rate?) are exactly the bug class the callback model avoids. The `onProgress` callback is also cheaper at high tick rates because it is invoked exactly once per tick with the exact data already in hand, whereas polling at 100 ms intervals either misses ticks at a 60 Hz rate (only every ~6th tick is sampled) or wastes cycles by polling more often than new data arrives. The chosen pattern is documented in section 7 slice three and in the `MetricsHistory` JSDoc so step 24 (interactive controls) can follow the same pattern when it wires start/pause/step controls.

13. **Using a Web Canvas 2D renderer instead of SVG for the charts.** Considered and rejected. The canvas approach would give better performance at very high point densities (≥ 10⁴ per series), but Recharts is SVG-only by design — the `<LineChart>` element is a React tree that ultimately renders to DOM SVG elements. Switching to a canvas-based library (e.g., `uPlot`, `chart.js` with canvas backend) would replace Recharts wholesale and contradict the spec's explicit recommendation. The 1,000-point down-sampling cap in section 7 slice two makes the SVG cost manageable at the target tick counts, and pan/hover latency on a ≤ 1,000-point SVG series is well under 16 ms on modern hardware. If a future research scenario demands > 10⁴ points per series with sub-frame interactivity, uPlot is the documented escape hatch — but F9 does not demand it and v1 does not pay the switching cost.

Total research items: **4 local Next docs** (server-and-client-components.md, turbopack.md, vitest.md, layout.md) + **3 external WebFetched references** (Recharts GitHub, Recharts API, Okabe-Ito palette) + **6 paths not taken** (Plotly, Visx, React Context hand-off, `next/dynamic` instead of `'use client'`, polling instead of callback, canvas instead of SVG) = **13 research items**, comfortably clearing the quality gates (≥ 3 local Next docs, ≥ 2 external URLs, ≥ 1 path not taken, total ≥ 5).

## 5. Files to create

- `app/(auth)/playground/metrics-history.ts` — the **pure, non-React circular buffer helper**. This file contains zero React imports and zero DOM APIs; it is pure TypeScript that builds, appends to, and materializes views over a ring of `TickReport` objects. Exports:
  - `type MetricsHistory` — an opaque shape `{ buffer: TickReport[]; capacity: number; head: number; length: number }`. Consumers treat it as opaque and only use the helper functions; the internal shape is exported only because TypeScript requires it for prop typing.
  - `function createMetricsHistory(capacity?: number): MetricsHistory` — factory. Default `capacity` is **10,000** (matching the step-specific context's "circular buffer of the last 10,000 ticks"). The returned object has `buffer: new Array(capacity)`, `capacity: capacity`, `head: 0`, `length: 0`.
  - `function appendTick(history: MetricsHistory, report: TickReport): MetricsHistory` — **returns a new history object** (the outer shape is a fresh object so React's `useState` reference-equality check fires a re-render), but the underlying `buffer` array is **mutated in place** via circular indexing `buffer[head % capacity] = report`, then `head = head + 1`, then `length = Math.min(length + 1, capacity)`. The in-place buffer mutation is a deliberate performance choice: cloning a 10,000-element array on every tick would allocate ~10 MB/s at 60 Hz and crush the GC. The outer-object clone (`{ ...history, head, length }`) is small and cheap. React consumers must accept the buffer aliasing — they should treat the buffer as a snapshot and never mutate it themselves. JSDoc documents this contract loudly.
  - `function getHistoryWindow(history: MetricsHistory, maxPoints: number): TickReport[]` — returns a **down-sampled, chronologically ordered** read view. If `history.length <= maxPoints`, returns every stored tick in chronological order (unwrapping the ring). Otherwise, returns `maxPoints` evenly-spaced ticks from oldest to newest using a `stride = Math.ceil(history.length / maxPoints)` and picking every `stride`-th entry, **with the most-recent entry always included as the last element** (per the step-specific context's "assert the most recent point is always included"). The returned array is a fresh `TickReport[]` — the ring-to-linear unwrap is a necessary allocation, and happens at most once per render, so it does not dominate the frame budget. The function is pure: same inputs → same outputs, no RNG, no wall clock.
  - `function clearHistory(history: MetricsHistory): MetricsHistory` — resets `head` and `length` to 0 without deallocating `buffer`. Used by step 24's reset-button path (not by step 22's acceptance flow). Included here so step 24 does not have to add it as a follow-up.
  - `type TickReport` — **re-exported** from the worker's type surface at `@/workers/simulation.worker` (or whichever path step 20 chose to route the type through, per section 2 prerequisites). The re-export is a `type` re-export so it is erased at compile time and the worker module is not pulled into the main-thread bundle.
  - The file header comment states: _"Pure, React-free, DOM-free circular buffer for TickReport time-series. Used by metrics-dashboard.tsx to cap memory usage and down-sample very long runs for display. See `docs/plan/22-metrics-dashboard.md` §7 slice two for the design rationale."_

- `app/(auth)/playground/metrics-history.test.ts` — the **Vitest suite for the buffer**. Runs under the default `node` environment (no React, no DOM). Contains the tests enumerated in section 9. File size: ~120 lines.

- `app/(auth)/playground/chart-panel.tsx` — the **shared wrapper** used by the top-level dashboard to render any single chart. Starts with the `'use client'` directive. Exports `ChartPanel(props)` where `props` is:

  ```typescript
  interface ChartPanelProps {
    title: string;
    series: Array<{ dataKey: string; name: string; color: string }>;
    data: Array<Record<string, number | null>>;
    yAxisMode: 'auto' | 'zeroOne' | 'custom';
    yAxisCustomMin?: number;
    yAxisCustomMax?: number;
    onYAxisModeChange: (mode: 'auto' | 'zeroOne' | 'custom', min?: number, max?: number) => void;
    isPinned: boolean;
    onPinToggle: () => void;
    syncId?: string;
    testId?: string;
  }
  ```

  The panel renders a bordered container with a header row containing the title, a Y-axis-mode popover trigger, and a pin toggle button. The chart body is a `<ResponsiveContainer>` wrapping a `<LineChart>` with the props listed in section 4 research note 5. The Y-axis-mode popover is a plain `useState`-driven `<div>` that opens on click of the mode button, contains three radio choices ("Auto", "0 to 1", "Custom min/max"), and — for "Custom" — two `<input type="number">` fields that call `onYAxisModeChange('custom', min, max)` on change. No Radix UI, no Headless UI, no popover library — plain conditional rendering. The pin toggle is a button with `aria-pressed={isPinned}` and an up-arrow glyph; clicking it calls `onPinToggle()`. When `isPinned` is true, the panel's outer wrapper gets the Tailwind class `col-span-full row-span-2 min-h-[24rem]` so it spans the full dashboard grid; when false, the default class is `col-span-1 min-h-[14rem]`. The `syncId` prop is passed through to `<LineChart syncId={syncId}>` so every panel in the dashboard shares the same tooltip crosshair. The `testId` prop is rendered as `data-testid` on the outer wrapper so the MCP script can locate each panel by ID (see section 10). File size: ~160 lines.

- `app/(auth)/playground/metrics-dashboard.tsx` — the **top-level dashboard component**, a client component starting with `'use client'`. Imports: `ChartPanel` from `./chart-panel`, `getHistoryWindow` and the `MetricsHistory` / `TickReport` types from `./metrics-history`, and nothing from `'recharts'` directly (all Recharts imports live inside `chart-panel.tsx`). Exports a default `MetricsDashboard` component whose props signature is:

  ```typescript
  interface MetricsDashboardProps {
    history: MetricsHistory;
    maxDisplayPoints?: number; // defaults to 1000
  }
  ```

  The component uses `React.useMemo` to compute the down-sampled view from `history` once per render, then shapes the view into **seven** `data` arrays — one per chart — by mapping the `TickReport[]` into per-chart `Array<Record<string, number | null>>` shapes. For example, the success-rate chart's data is `view.map(report => ({ tick: report.tick, world1: report.scalar.world1.successRate.rate, world2: report.scalar.world2.successRate.rate, overall: report.scalar.overall.successRate.rate }))`. The component holds its own local state for (a) a `Record<string, YAxisConfig>` keyed by chart ID tracking each chart's Y-axis override, and (b) a `string | null` of the currently pinned chart ID (so at most one chart is pinned at a time — pinning a second unpins the first). It renders a responsive grid `<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 p-4">` and maps over the seven chart configurations to produce seven `<ChartPanel>` instances. The grid is reshuffled when a chart is pinned: the pinned panel renders first with `col-span-full`, followed by the other six in the regular grid. File size: ~220 lines.

  **The seven charts** (enumerated explicitly so the implementation cannot drift):
  1. **`success-rate`** — "Communication Success Rate". Series: world1 (Okabe-Ito sky blue), world2 (vermillion), overall (bluish green). `dataKey`s: `world1`, `world2`, `overall`. Y domain auto, `0..1` mode maps to `[0, 1]`. Data shaper reads `report.scalar.world1.successRate.rate`, `report.scalar.world2.successRate.rate`, `report.scalar.overall.successRate.rate`.
  2. **`distinct-tokens`** — "Distinct Active Tokens (Nw)". Series: world1 (sky blue), world2 (vermillion). `dataKey`s: `world1`, `world2`. Y domain auto. Data shaper reads `report.scalar.world1.distinctActiveTokens`, `report.scalar.world2.distinctActiveTokens`.
  3. **`mean-weight`** — "Mean Token Weight". Series: world1 (sky blue), world2 (vermillion). Y domain auto. Data shaper reads the per-world `perLanguage` sub-object and computes the mean over all languages for each world (or, if step 15 happens to expose a pre-computed aggregate, reads that directly; section 7 slice five has the fallback rule). For v1 it reads `report.scalar.world1.perLanguage[defaultLanguageId].meanTokenWeight` with a helper that picks the first key in the `perLanguage` object as the default language and documents the choice — a future step can add a language selector dropdown.
  4. **`largest-cluster`** — "Largest Cluster Size". Series: world1 (sky blue), world2 (vermillion). Y domain auto. Data shaper reads `report.graph.world1.largestClusterSize`, `report.graph.world2.largestClusterSize`.
  5. **`modularity`** — "Louvain Modularity". Series: world1 (sky blue), world2 (vermillion). Y domain auto, `0..1` mode maps to `[-0.5, 1]` because modularity is bounded in `[-1, 1]` but positive values dominate in practice. Data shaper reads `report.graph.interactionGraphModularity` — **however**, step 16's `GraphMetricsSnapshot` ships a single overall `interactionGraphModularity` scalar, not per-world. Section 7 slice five resolves this: the dashboard shows a **single series** labeled "Combined" using that scalar, and the "per-world modularity" plan is deferred to a future step. The chart title is amended to "Louvain Modularity (cumulative graph)" to make the scope explicit.
  6. **`assimilation`** — "Assimilation Index (W2)". Series: a **single** cross-world series (sky blue). Y domain `0..1` by default. Data shaper reads `report.graph.assimilationIndex`. Because the index can be `null` (step 16 documents `null` for "no W2-Immigrant ↔ W2-Native interactions this tick"), the shaper emits `null` for those ticks; Recharts treats `null` as a gap in the line, which is the correct visual semantics (the researcher sees when there is no data vs. a zero).
  7. **`segregation`** — "Segregation Index (W2-Immigrants)". Series: a **single** world-2-only series (vermillion). Y domain auto. Data shaper reads `report.graph.segregationIndex`.

- `app/(auth)/playground/chart-panel.test.ts` — **not created** in step 22. The chart-panel component is covered end-to-end by the MCP script in section 10; no unit test file ships for it. See section 9 for the testing-strategy rationale. This entry is listed here only to make the intentional absence visible in the plan.

## 6. Files to modify

- `app/(auth)/playground/simulation-shell.tsx` — **extend** to own the metrics history and thread it into the dashboard. This is the primary integration point with step 21's work. The edits are:
  1. **Grep-first to locate step 21's current metrics state shape.** Run `grep -n "metrics" app/(auth)/playground/simulation-shell.tsx` (or equivalent) to find whichever of these three patterns step 21 chose: (a) a `useState<TickReport[]>` of the raw time series; (b) a `useState<MetricsHistory>` already using the step-22 buffer (unlikely, since step 22 is what introduces it — but possible if step 21 was written optimistically); (c) no metrics collection at all, just the latest-tick snapshot held in a separate state. The step-21 plan file (per the step-specific context) already "collects metrics into an array" but does not necessarily use the circular buffer, so the likely shape is (a). If it is (a), replace the raw array with a `MetricsHistory` via `useState(() => createMetricsHistory(10_000))` and update the on-tick handler to call `setHistory(h => appendTick(h, report))`. If it is (b), leave it alone. If it is (c), add the `useState` and the handler fresh.
  2. **Wire the `onProgress` callback.** Step 21 either already passes a `Comlink.proxy(onProgress)` into `api.run(...)`, in which case step 22 just extends whatever handler step 21 set up to also call `appendTick`, or step 21 uses a different pattern (e.g. `step()` in a `requestAnimationFrame` loop); in the second case, step 22's edit appends the new `TickReport` to the history inside the existing RAF tick handler. The grep-first protocol from slice one identifies which pattern to extend.
  3. **Render the dashboard.** Add `<MetricsDashboard history={metricsHistory} />` next to (or below) the existing `<LatticeCanvas />` element from step 21. The layout is a two-column flex on wide screens (`<div className="flex flex-col xl:flex-row gap-4">`) and a stacked column on narrower screens. Step 21's existing layout either already has this wrapper or does not; if it does not, add it. The dashboard's grid internal is independent of this outer flex.
  4. **Import the new types**: `import { createMetricsHistory, appendTick, type MetricsHistory } from './metrics-history';` and `import { MetricsDashboard } from './metrics-dashboard';`.
  5. **Do not add new worker methods.** Step 22 reuses the step-20 `SimulationWorkerApi` surface verbatim. The shell already has an `api: Remote<SimulationWorkerApi>` handle; step 22 only needs its existing `run` / `step` / `onProgress` plumbing, not a new method.
  6. **Do not change the auto-start behavior.** The step-specific context notes "the shell may auto-start — pick one and document." Step 22 does not introduce any new start/stop logic; whatever step 21 chose (auto-start on mount, or explicit start button, or `run()` triggered inside an effect) is preserved verbatim. Section 10's MCP script is flexible about this — it waits for 50 ticks to elapse regardless of whether the start was automatic or button-driven, and clicks a start button only if one is present.

- `package.json` — **install `recharts`** at the current stable version. The agent runs `npm view recharts version` at execution time, then `npm install recharts@<that-version>`. At plan-write time this resolves to **`3.8.1`** (see section 4 research note 5), so the expected `"dependencies"` entry after install is approximately `"recharts": "^3.8.1"`. `react-is` is auto-installed as a transitive dependency; confirm via `npm ls react-is` and, if a major-version mismatch with React 19 is reported, pin `react-is` explicitly via `npm install react-is@^19.0.0` to match. `package-lock.json` is updated automatically and committed. **No other runtime dependencies are added.**

- `CLAUDE.md` — **append ≤ 12 lines** to the "UI verification harness" section documenting the F9 MCP verification pattern (SVG path introspection via `evaluate_script`, pin-to-large-view click-and-assert, panel testId convention). See section 11 for the exact text.

**No other files are modified.** In particular: `next.config.ts` is untouched, `tsconfig.json` is untouched, `vitest.config.ts` is untouched, `app/(auth)/layout.tsx` is untouched, `app/(auth)/playground/page.tsx` is untouched (the server component wrapper is already correct — it just invokes `verifySession()` and renders `SimulationShell`), `proxy.ts` is untouched, and no file under `lib/sim/*`, `lib/db/*`, `lib/auth/*`, `workers/*`, or `db/*` is modified.

## 7. Implementation approach

The work is ordered so the dependency arrows point forward: install Recharts first (the install can fail and blocks everything else), then build the pure buffer helper and its tests (pure functions land before React so a TypeScript regression is caught early), then extend the shell to collect metrics into the buffer (the buffer must exist before the shell imports it), then build the shared `ChartPanel` wrapper (the dashboard depends on it), then assemble the top-level `MetricsDashboard` (the composition is last because it imports everything else), then wire pin-to-large-view and Y-axis override (the state lifts cleanly into the dashboard component once the panel surface is ready), then run the MCP verification script. Each slice is self-contained and can be reviewed independently; an agent halting mid-step leaves the working tree in one of a small number of well-defined states, each of which compiles and typechecks.

**Slice one — install Recharts and verify the build surface.** Run `npm view recharts version` to discover the current stable (plan-time value: `3.8.1`, re-check at execution). Run `npm install recharts@<version>`. Verify `package.json` gained the `"recharts"` entry. Run `npm run typecheck` — must pass with zero errors (no code yet imports from `'recharts'`, so this is a tautological pass but verifies the install did not corrupt `node_modules`). Run `npm run build` — must pass; Turbopack resolves the ESM entry point and the dev dependencies graph rebuilds. If the build fails with a peer-dependency warning about `react-is`, run `npm ls react-is` to see the resolved version; if it does not match React 19's major, pin `react-is@^19.0.0` explicitly. No other edits happen in this slice; the commit boundary is not yet crossed.

**Slice two — author the pure buffer module `metrics-history.ts`.** Create the file under `app/(auth)/playground/`. Start with the file-header comment from section 5. Declare the internal shape `MetricsHistory` and the re-exported `TickReport` type. Implement `createMetricsHistory(capacity = 10_000)` as documented in section 5. Implement `appendTick(history, report)` with in-place buffer mutation and outer-object clone. Implement `getHistoryWindow(history, maxPoints)`: the core challenge is the ring-to-linear unwrap. The canonical unwrap is: `let start = (history.head - history.length + history.capacity) % history.capacity` gives the index of the oldest stored entry; then `for (let i = 0; i < history.length; i++) out.push(history.buffer[(start + i) % history.capacity])` walks the ring chronologically. For down-sampling: if `history.length > maxPoints`, compute `stride = Math.floor(history.length / maxPoints)` (using `floor` so the result has at least `maxPoints` entries), then push every `stride`-th entry into an output array. The most-recent entry must always be included; after the stride-based loop, if the last pushed entry is not at index `history.length - 1` of the linearized ring, push the final ring entry as the last element. This guarantees the "most recent point is always included" invariant the unit tests will assert. Implement `clearHistory(history)` as a simple `{ ...history, head: 0, length: 0 }`. Add JSDoc to every function documenting the mutation contract (in-place buffer, fresh outer object).

**Slice three — write `metrics-history.test.ts`.** Vitest default `node` environment, pure-function tests only. Tests enumerated in section 9. Every test uses hand-crafted `TickReport`-shaped fixtures with minimal fields — the real `ScalarMetricsSnapshot` and `GraphMetricsSnapshot` shapes are too verbose to replicate in a buffer test. Use a type assertion to narrow the fixture down: `const makeReport = (tick: number): TickReport => ({ tick, scalar: {} as any, graph: {} as any })`. The `as any` is acceptable here because the buffer tests are about indexing, ordering, and down-sampling — not about the snapshot's internal structure. Document the assertion in a test-file header comment so a future reader does not think the tests are undisciplined. Run `npm test -- metrics-history` and confirm every test passes before moving on.

**Slice four — extend `simulation-shell.tsx`.** This is the slice that depends on step 21's shape, so start by reading the current file and running the grep-first protocol in section 6 edit one. Once the current metrics-collection shape is known, swap it to the circular buffer as documented. The minimal edit, assuming step 21 used a raw `useState<TickReport[]>`:

```tsx
// Before step 22 (step 21's shape):
const [metrics, setMetrics] = useState<TickReport[]>([]);
const onTick = (report: TickReport) => setMetrics((m) => [...m, report]);

// After step 22:
const [history, setHistory] = useState<MetricsHistory>(() => createMetricsHistory(10_000));
const onTick = (report: TickReport) => setHistory((h) => appendTick(h, report));
```

Replace any read of `metrics` inside the shell (e.g. to display the current tick number) with a computation against `history.length` or `getHistoryWindow(history, 1)[0]?.tick`. Import `MetricsDashboard` and render it beside the lattice canvas. Keep the `onProgress` callback wrapped in `Comlink.proxy(...)` as step 21 set up — step 22 does not touch the Comlink marshalling contract.

**Slice five — author `chart-panel.tsx`.** Start with `'use client'` on line 1. Import Recharts components: `LineChart`, `Line`, `XAxis`, `YAxis`, `CartesianGrid`, `Tooltip`, `Legend`, `ResponsiveContainer` from `'recharts'`. Import React hooks `useState` from `'react'`. Define the `ChartPanelProps` interface from section 5. Define an internal `YAxisDomain` helper that takes `yAxisMode`, `yAxisCustomMin`, `yAxisCustomMax` and returns the `domain` prop value for `<YAxis>`: `auto` → `['auto', 'auto']`, `zeroOne` → `[0, 1]`, `custom` → `[yAxisCustomMin ?? 0, yAxisCustomMax ?? 1]`. Build the JSX:

```tsx
return (
  <div
    data-testid={testId}
    className={`rounded border border-gray-700 bg-gray-900 p-2 ${
      isPinned ? 'col-span-full row-span-2 min-h-[24rem]' : 'col-span-1 min-h-[14rem]'
    }`}
  >
    <div className="flex items-center justify-between border-b border-gray-800 pb-1 mb-1">
      <h3 className="text-sm font-medium text-gray-200">{title}</h3>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setYAxisPopoverOpen(o => !o)}
          className="text-xs text-gray-400 hover:text-gray-200"
          aria-haspopup="menu"
        >
          Y: {yAxisMode}
        </button>
        <button
          type="button"
          onClick={onPinToggle}
          aria-pressed={isPinned}
          className="text-xs text-gray-400 hover:text-gray-200"
          data-testid={testId ? `${testId}-pin` : undefined}
        >
          {isPinned ? 'Unpin' : 'Pin'}
        </button>
      </div>
    </div>
    {yAxisPopoverOpen && <YAxisPopover ... />}
    <div className="h-[calc(100%-2rem)] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} syncId={syncId} margin={{ top: 8, right: 16, bottom: 8, left: 16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis dataKey="tick" tick={{ fontSize: 11 }} stroke="#9ca3af" />
          <YAxis domain={yAxisDomain} tick={{ fontSize: 11 }} stroke="#9ca3af" />
          <Tooltip contentStyle={{ background: '#1f2937', border: '1px solid #374151' }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {series.map(s => (
            <Line
              key={s.dataKey}
              dataKey={s.dataKey}
              name={s.name}
              stroke={s.color}
              dot={false}
              isAnimationActive={false}
              strokeWidth={1.5}
              connectNulls={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  </div>
);
```

The `YAxisPopover` is a small nested component (same file, not exported) that renders three radio inputs and, for custom mode, two number inputs. It calls `onYAxisModeChange(mode, min, max)` on change. When a radio is picked, the popover closes via `setYAxisPopoverOpen(false)`. The `connectNulls={false}` prop makes Recharts break the line across `null` data points, which is the desired behavior for the assimilation index (section 5, chart 6).

**Slice six — author `metrics-dashboard.tsx`.** Start with `'use client'` on line 1. Import `useMemo`, `useState` from React. Import `ChartPanel` from `./chart-panel`. Import `getHistoryWindow`, `type MetricsHistory`, `type TickReport` from `./metrics-history`. Define a `CHART_CONFIGS` constant listing the seven charts from section 5 as static configuration objects `{ id, title, series, shaper }`, where `shaper` is a function `(report: TickReport) => Record<string, number | null>` that maps a tick report to the chart's data row. Define the `SERIES_COLORS` constant as the Okabe-Ito array from section 4 research note 7. Define the `MetricsDashboard` component:

```tsx
export function MetricsDashboard({ history, maxDisplayPoints = 1000 }: MetricsDashboardProps) {
  const view = useMemo(
    () => getHistoryWindow(history, maxDisplayPoints),
    [history, maxDisplayPoints],
  );
  const chartData = useMemo(
    () => Object.fromEntries(CHART_CONFIGS.map((c) => [c.id, view.map(c.shaper)])),
    [view],
  );
  const [yAxisConfigs, setYAxisConfigs] = useState<
    Record<string, { mode: 'auto' | 'zeroOne' | 'custom'; min?: number; max?: number }>
  >(() => ({
    'success-rate': { mode: 'auto' },
    'distinct-tokens': { mode: 'auto' },
    'mean-weight': { mode: 'auto' },
    'largest-cluster': { mode: 'auto' },
    modularity: { mode: 'auto' },
    assimilation: { mode: 'zeroOne' },
    segregation: { mode: 'auto' },
  }));
  const [pinnedChartId, setPinnedChartId] = useState<string | null>(null);

  const orderedConfigs = pinnedChartId
    ? [
        CHART_CONFIGS.find((c) => c.id === pinnedChartId)!,
        ...CHART_CONFIGS.filter((c) => c.id !== pinnedChartId),
      ]
    : CHART_CONFIGS;

  return (
    <div
      className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 p-4"
      data-testid="metrics-dashboard"
    >
      <div className="col-span-full text-sm text-gray-400" data-testid="current-tick">
        Tick: {view[view.length - 1]?.tick ?? 0}
      </div>
      {orderedConfigs.map((config) => (
        <ChartPanel
          key={config.id}
          testId={`chart-${config.id}`}
          title={config.title}
          series={config.series}
          data={chartData[config.id]}
          syncId="msksim-dashboard"
          yAxisMode={yAxisConfigs[config.id].mode}
          yAxisCustomMin={yAxisConfigs[config.id].min}
          yAxisCustomMax={yAxisConfigs[config.id].max}
          onYAxisModeChange={(mode, min, max) =>
            setYAxisConfigs((prev) => ({ ...prev, [config.id]: { mode, min, max } }))
          }
          isPinned={pinnedChartId === config.id}
          onPinToggle={() => setPinnedChartId((prev) => (prev === config.id ? null : config.id))}
        />
      ))}
    </div>
  );
}
```

The `CHART_CONFIGS` object is a module-level constant so the seven configurations are a single source of truth. Each config's `shaper` function is the only place a snapshot field path appears — if step 15 or step 16 ever renames a field, exactly seven places in this file change. The shapers are defined inline inside `CHART_CONFIGS`:

```typescript
const CHART_CONFIGS = [
  {
    id: 'success-rate',
    title: 'Communication Success Rate',
    series: [
      { dataKey: 'world1', name: 'World 1', color: '#56B4E9' },
      { dataKey: 'world2', name: 'World 2', color: '#D55E00' },
      { dataKey: 'overall', name: 'Combined', color: '#009E73' },
    ],
    shaper: (r: TickReport) => ({
      tick: r.tick,
      world1: r.scalar.world1.successRate.rate,
      world2: r.scalar.world2.successRate.rate,
      overall: r.scalar.overall.successRate.rate,
    }),
  },
  // ... six more configurations
] as const;
```

The `as const` assertion is intentional: it turns the array into a tuple of literal object types so TypeScript can narrow `chartData[config.id]` based on the specific chart's shape at compile time.

**Slice seven — wire the Y-axis override popover.** The popover is already shipped in slice five inside `chart-panel.tsx`. Slice seven is a verification pass: click through each chart in dev mode (or mentally walk the state machine) and confirm the three modes (`auto`, `zeroOne`, `custom`) produce the expected Y-axis behavior. Document the supported modes and their domains in a short JSDoc on the `ChartPanel` props interface. No code changes in this slice unless a bug is discovered; it is a review-and-lock step.

**Slice eight — wire the pin-to-large-view toggle.** Already shipped by slices five and six (the `ChartPanel` carries `isPinned` / `onPinToggle` props, and `MetricsDashboard` owns the `pinnedChartId` state). Slice eight is a verification pass: confirm that clicking a pin button promotes the panel to `col-span-full row-span-2 min-h-[24rem]` and clicking again (or clicking a different pin) restores the grid. Confirm that the grid reshuffle puts the pinned panel first (it does, via the `orderedConfigs` computation in slice six). No code changes unless a bug is discovered.

**Slice nine — write the MCP verification script.** See section 10 for the full script. The script uses `mcp__chrome-devtools__*` tools to drive a live browser through the login → playground → 50-tick wait → SVG introspection → pin toggle → screenshot flow. The script file is **not** committed to the repository — it lives only in the plan file as a reference for the implementing agent to run interactively. `scripts/run-plan.ts` spawns `claude -p` with the step-22 plan file as context; the agent reads section 10 and executes each MCP call in order. If an MCP call fails, the step fails and the commit is not produced.

**Slice ten — run the full verification checklist before committing.** Commands in order: `npm run typecheck`, `npm run lint`, `npm test` (Vitest; the new `metrics-history.test.ts` runs alongside every prior test and all must pass), `npm run build` (Turbopack must bundle `recharts` and the three new client files cleanly), then the MCP script from slice nine. Only after every command exits 0 is the commit produced.

**Slice eleven — append the CLAUDE.md update.** Per section 11.

**Slice twelve — commit with the exact subject line from section 12.** A single commit. The diff contains: four new files (`metrics-history.ts`, `metrics-history.test.ts`, `chart-panel.tsx`, `metrics-dashboard.tsx`), one modified file (`simulation-shell.tsx`), `package.json` and `package-lock.json` updates (recharts), one small CLAUDE.md append, and one screenshot (`docs/screenshots/step-22-dashboard.png`).

## 8. Library choices

**New runtime dependency: `recharts`.** Installed via `npm install recharts@<current-stable>`. At plan-write time the current stable is **v3.8.1** (released 2026-03-25 per the GitHub releases page fetched in section 4 research note 5). The implementing agent **must re-check** at execution time via `npm view recharts version` and pin whatever `npm install` chooses; if the current stable has moved to a later 3.x or to a new 4.x major, use the latest **stable** (non-`beta`, non-`rc`) 3.x release. If a 4.x major has landed with breaking changes, the step-specific context's instruction "Check current stable version" applies — read the 4.x migration notes and pin the most recent 3.x line as a fallback, and document the choice in the commit body. The plan-time expected `package.json` entry is approximately `"recharts": "^3.8.1"` with the semver range chosen by `npm install`. `react-is` is auto-installed as a transitive dependency matching React 19's major; confirm with `npm ls react-is` and only pin explicitly if a mismatch appears. **No other runtime dependencies** are added by this step.

**Zero new dev dependencies.** Vitest, TypeScript, ESLint, Tailwind, and the MCP tooling are all from step 00 and earlier. No new `@types/*` packages are needed because Recharts ships its own TypeScript declarations.

**Out of scope for v1** (explicit rejections from section 4 paths-not-taken): Plotly.js, Visx, uPlot, `chart.js`, `d3-scale`, `react-vis`, `nivo`. Any future chart library swap replaces Recharts entirely and is a separate step.

## 9. Unit tests

**Pure-function tests only.** The buffer helper `metrics-history.ts` is a pure module (no React, no DOM, no wall clock, no RNG), and its correctness is essential — every chart in the dashboard reads through it, and an off-by-one in the ring index or the down-sampling stride propagates to every series. The tests live in `app/(auth)/playground/metrics-history.test.ts` and run under Vitest's default `node` environment.

The **chart-panel** component and the **metrics-dashboard** component are covered end-to-end by the MCP script in section 10 and do **not** ship a Vitest test file. The reasons: (a) `ResponsiveContainer` uses `ResizeObserver`, which `happy-dom` stubs incompletely — tests against the container routinely report width `0` and the chart renders as an empty SVG, making the test assertion "the line appears" a false negative; (b) Recharts' internal layout machinery depends on async browser paint cycles, which Vitest cannot reliably orchestrate without a real browser; (c) the MCP script exercises the real rendered SVG against a real Chrome instance and is the single source of truth for the visual contract. Attempting to unit-test a Recharts component with a stubbed DOM is a well-known source of flaky tests and was explicitly considered and rejected here, with the MCP script as the replacement.

**Enumerated tests in `metrics-history.test.ts`** (8 tests, exceeds the step-specific context's minimum):

1. **`createMetricsHistory` returns a zero-length buffer with the specified capacity.** Assert `history.length === 0`, `history.capacity === 100` for a small-capacity fixture, and `history.head === 0`. Assert `getHistoryWindow(history, 10)` returns an empty array.

2. **`createMetricsHistory()` with no argument defaults to capacity 10,000.** Assert `history.capacity === 10_000`. This pins the default from the step-specific context.

3. **`appendTick` below capacity appends in order and `getHistoryWindow` returns them in order.** Create a capacity-10 buffer, append 5 ticks `(tick=0..4)`, call `getHistoryWindow(history, 10)`, assert the result is `[tick0, tick1, tick2, tick3, tick4]` in that order. Also assert `history.length === 5` and `history.head === 5`.

4. **`appendTick` at capacity wraps and overwrites oldest entries.** Create a capacity-5 buffer, append 8 ticks `(tick=0..7)`, call `getHistoryWindow(history, 10)`, assert the result is `[tick3, tick4, tick5, tick6, tick7]` — the oldest three (`tick0`, `tick1`, `tick2`) have been overwritten by the wrap. Assert `history.length === 5` (capped) and `history.head === 8` (monotonic counter).

5. **`getHistoryWindow` down-samples when history.length exceeds maxPoints.** Append 10,000 ticks to a default-capacity buffer, call `getHistoryWindow(history, 1000)`, assert `result.length <= 1000` (per the step-specific context "down-sampling produces ≤ 1000 points") and `result[result.length - 1].tick === 9999` (the most-recent tick is always included). Also assert `result[0].tick === 0` — the first element after down-sampling is tick 0 (for a clean stride the first point is always included when `length % maxPoints === 0`). Use `toBeLessThanOrEqual(1000)` and `toBeGreaterThanOrEqual(900)` so the assertion tolerates stride-induced rounding without being brittle.

6. **`getHistoryWindow` preserves chronological order after down-sampling.** Append 5,000 ticks, call `getHistoryWindow(history, 500)`, iterate the result asserting that each element's `tick` is strictly greater than the previous element's `tick` (monotonic increasing). This catches bugs where the stride walk wraps around incorrectly and produces out-of-order output.

7. **`getHistoryWindow` includes the most-recent tick even after wrap.** Create a capacity-5 buffer, append 20 ticks `(tick=0..19)`, call `getHistoryWindow(history, 10)`, assert `result[result.length - 1].tick === 19`. This pins the "most recent point is always included" invariant specifically for the wrapped case, which is the hardest case to get right and the step-specific context explicitly calls out.

8. **`clearHistory` resets length and head without deallocating the buffer.** Append 100 ticks to a capacity-500 buffer, call `clearHistory(history)`, assert `history.length === 0` and `history.head === 0`. Assert that `history.capacity === 500` still. Call `appendTick(history, makeReport(999))` and `getHistoryWindow(history, 10)` and assert the result is `[tick999]` — cleared buffers accept new entries without stale reads.

All eight tests are deterministic, take no RNG input, and run under Vitest's default `node` environment. Run with `npm test -- metrics-history`. Expected cost: well under 1 second total across all tests.

## 10. Acceptance criteria

**Build and typecheck:**

- `npm run typecheck` exits 0. The new types compose with the step-20 worker types and the step-21 shell integration.
- `npm run lint` exits 0 on all new and modified files under the step-00 ESLint flat config.
- `npm run build` (Turbopack `next build`) exits 0. `recharts` bundles cleanly. The `'use client'` boundary on `metrics-dashboard.tsx` and `chart-panel.tsx` emits client chunks that do not leak into the server bundle.
- `npm test` exits 0. All 8 buffer tests pass. All prior tests remain green.
- `grep -n "'use client'" app/(auth)/playground/metrics-dashboard.tsx` matches line 1.
- `grep -n "'use client'" app/(auth)/playground/chart-panel.tsx` matches line 1.
- `grep -n "import 'server-only'" app/(auth)/playground/` returns zero matches — the playground sub-tree is 100% client-context per the step-21 precedent.
- `grep -n "recharts" package.json` matches exactly one line under `dependencies`.

**MCP verification script** (executed via `scripts/run-plan.ts` against a `next build && next start` server per `CLAUDE.md` "UI verification harness"). The script runs the following calls in order; any failure fails the step:

1. Clear storage and log in with seed credentials:
   - `mcp__chrome-devtools__navigate_page { url: process.env.MSKSIM_BASE_URL + '/login' }`
   - `mcp__chrome-devtools__evaluate_script { script: 'localStorage.clear(); sessionStorage.clear();' }` and cookie clear via DevTools protocol
   - `mcp__chrome-devtools__fill_form` with fields `username: process.env.MSKSIM_SEED_USER`, `password: process.env.MSKSIM_SEED_PASS`
   - `mcp__chrome-devtools__click` on the login submit button
   - `mcp__chrome-devtools__wait_for { text: 'Playground' }` or a nav-visible text from the step-07 shell

2. Navigate to the playground and wait for the shell to initialize:
   - `mcp__chrome-devtools__navigate_page { url: process.env.MSKSIM_BASE_URL + '/playground' }`
   - `mcp__chrome-devtools__wait_for { text: 'Metrics' }` or a dashboard-visible text marker

3. Start the simulation if an explicit start button exists; otherwise rely on auto-start:
   - `mcp__chrome-devtools__take_snapshot` to see the current DOM
   - If a button with text matching `/start|play|run/i` is present, `mcp__chrome-devtools__click` on it
   - Otherwise proceed — the shell from step 21 auto-starts on mount

4. Wait until at least 50 ticks have elapsed:
   - `mcp__chrome-devtools__wait_for { text: 'Tick: 5', timeout: 60000 }` — matches "Tick: 50" through "Tick: 59" via prefix, and is robust against the exact final tick number. Alternatively, `wait_for` on a specific text produced by the `data-testid="current-tick"` element in the dashboard header (the element renders "Tick: N" per section 7 slice six).

5. Assert the seven charts rendered non-empty series by reading SVG path elements:
   - `mcp__chrome-devtools__evaluate_script { script: "JSON.stringify(Array.from(document.querySelectorAll('[data-testid^=\"chart-\"]')).map(el => ({ id: el.dataset.testid, pathCount: el.querySelectorAll('svg path').length })))" }`
   - Parse the returned JSON and assert every `pathCount > 0` — each chart must have at least one rendered `<path>`. The `grid + axes + lines` composition of a Recharts `LineChart` always produces multiple paths per chart, so the threshold `> 0` is conservative; a more aggressive `>= 3` also works (grid, axis, line), and if the test wants to pin an exact count a later optimization can tighten it.

6. Assert the success-rate line's `d` attribute is non-empty (the primary "series rendered" signal):
   - `mcp__chrome-devtools__evaluate_script { script: "document.querySelector('[data-testid=\"chart-success-rate\"] svg path.recharts-curve')?.getAttribute('d') ?? ''" }`
   - Assert the returned string is non-empty (length > 0) and starts with a path command (`M` for move-to). An empty `d` means no data points were rendered, which means either the buffer is empty (upstream bug) or the Recharts props are wrong (downstream bug).

7. Click a chart's pin button and verify the pinned state is applied:
   - `mcp__chrome-devtools__click { selector: '[data-testid="chart-success-rate-pin"]' }` (the pin button's `data-testid` is `${chartTestId}-pin` per section 7 slice five)
   - `mcp__chrome-devtools__evaluate_script { script: "document.querySelector('[data-testid=\"chart-success-rate\"]').className" }` and assert the returned string contains `col-span-full` (the pinned panel's Tailwind class, per section 7 slice five)
   - Alternatively, read the bounding-box width via `element.getBoundingClientRect().width` and assert it is larger than the pre-click width

8. Click the pin button again to unpin and verify the class reverts:
   - `mcp__chrome-devtools__click { selector: '[data-testid="chart-success-rate-pin"]' }`
   - `mcp__chrome-devtools__evaluate_script { script: "document.querySelector('[data-testid=\"chart-success-rate\"]').className" }` and assert the returned string contains `col-span-1` (the unpinned default, per section 7 slice five) and does **not** contain `col-span-full`

9. Take a screenshot of the full playground page:
   - `mcp__chrome-devtools__take_screenshot { filePath: 'docs/screenshots/step-22-dashboard.png', fullPage: true }`
   - The screenshot is committed as part of the step-22 diff per `CLAUDE.md` "UI verification harness"

10. Verify no console errors and no 4xx/5xx network responses:
    - `mcp__chrome-devtools__list_console_messages { level: 'error' }` — assert the returned list is empty, or contains only the React 19 dev-mode strict-mode warnings that `CLAUDE.md` "UI verification harness" declares benign (strict-mode double-invocation notices). Any **thrown errors**, hydration mismatches, or unhandled promise rejections fail the step.
    - `mcp__chrome-devtools__list_network_requests { status: '4xx-5xx' }` or equivalent filter — assert the returned list is empty. Any 400-class or 500-class response fails the step.

**Exit criteria**: all ten MCP calls succeed and all nine pre-MCP build/typecheck/lint/test criteria pass. Only then is the commit produced.

## 11. CLAUDE.md updates

Append ≤ 12 lines to the "UI verification harness" section. The section's hard cap is **60 lines** per the `CLAUDE.md` section-header annotation, and prior UI steps (07, 19, 21) have each added a few lines. Step 22's append lands under the existing bullet list without replacing any prior content.

Exact appended block:

- **Chart SVG introspection**: UI steps that render Recharts (or any SVG-based chart library) verify that series actually rendered by reading DOM elements via `mcp__chrome-devtools__evaluate_script`. The canonical assertion is: query `[data-testid="chart-<id>"] svg path` and assert the match count is non-zero; then read the `d` attribute of a specific `path.recharts-curve` and assert it is non-empty. An empty `d` means zero data points reached the chart — upstream bug in the metric stream or a prop-wiring bug. Step 22 established this pattern for the F9 metrics dashboard; subsequent chart-rendering steps reuse it.
- **Pin/unpin panel assertion**: client components that support a pin-to-large-view affordance expose the pin toggle as a button with `data-testid="chart-<id>-pin"` and render the pinned panel with a distinctive Tailwind class (e.g., `col-span-full`). The MCP script clicks the pin button, reads the element's `className` via `evaluate_script`, and asserts the class is applied; then clicks again and asserts it is removed. No dialog library, no portal, no routing is involved — the toggle is pure state.
- **Recharts SSR boundary**: every file that imports from `'recharts'` starts with `'use client'`. Recharts depends on `ResizeObserver` and SVG layout during mount; SSR execution throws. A grep for `"import.*recharts"` in files **without** `'use client'` is a smoke signal for an SSR leak — prior steps enforce this discipline and a review-time grep catches regressions.

Total appended: 10 lines. Well under the 12-line ceiling, the 30-line per-commit section cap, and the 100-line per-step pipeline guard.

## 12. Commit message

```
step 22: metrics dashboard
```

Exactly this line. No conventional-commit prefix, no trailing period, no body required. `scripts/run-plan.ts` greps for this marker to track pipeline progress per `CLAUDE.md` "Commit-message convention". If intermediate commits appear during implementation (e.g. a separate commit for the `recharts` install and another for the component files), squash via `git reset --soft HEAD~N && git commit -m "step 22: metrics dashboard"` before the pipeline advances to step 23.

## 13. Rollback notes

If step 22 lands in a broken state:

1. `git log --oneline` to find the step-21 commit SHA. Its subject should be `step 21: lattice canvas renderer`.
2. `git reset --hard <step-21-sha>` drops the working tree back to the pre-step-22 state. This will: (a) remove `app/(auth)/playground/metrics-history.ts`, `app/(auth)/playground/metrics-history.test.ts`, `app/(auth)/playground/chart-panel.tsx`, `app/(auth)/playground/metrics-dashboard.tsx`; (b) revert the `simulation-shell.tsx` edits; (c) revert the `package.json` / `package-lock.json` `recharts` install; (d) revert the `CLAUDE.md` append; (e) remove `docs/screenshots/step-22-dashboard.png`. All in one operation.
3. `npm uninstall recharts` — **not strictly needed** after a `git reset --hard` because the reset restores `package.json` / `package-lock.json` to their pre-step-22 state, but the `node_modules/recharts` directory persists on disk. Running `npm install` after the reset prunes it automatically, or run `npm uninstall recharts` explicitly for an eager cleanup. The net effect is identical.
4. `rm -rf .next` flushes Turbopack's dependency cache. A partial build that cached Recharts resolution can produce phantom errors on the next `next build` if the reset leaves stale module-graph entries.
5. Verify the rolled-back tree: `npm run typecheck && npm run lint && npm test && npm run build` all exit 0. This confirms step 21 is internally consistent without step 22's additions. If any of these fails on the rolled-back tree, the failure existed before step 22 landed and is a step-21 regression that the rollback did not cause.
6. Re-run `npx tsx scripts/run-plan.ts --only 22` to retry the step from the clean step-21 base. If the retry fails the same way, inspect the failure mode against the acceptance criteria in section 10 — likely causes are (a) Recharts version drift (re-check `npm view recharts version`), (b) a step-21 shell-shape drift since the plan was written (re-run the grep-first protocol in section 6), or (c) an MCP-harness environmental change (check `MSKSIM_PORT`, `MSKSIM_SEED_USER`, `MSKSIM_SEED_PASS` are set). Update this plan file if a recurring failure mode suggests the plan is stale.
7. If the rollback is permanent (step 22 is deferred to a later pipeline cycle), the `CLAUDE.md` "UI verification harness" append from section 11 must also be reverted — `git reset --hard` takes care of this automatically, but verify manually that the "Chart SVG introspection" and "Pin/unpin panel assertion" bullets are absent from the rolled-back `CLAUDE.md`.
