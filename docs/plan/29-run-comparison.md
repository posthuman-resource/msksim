---
step: "29"
title: "run comparison"
kind: ui
ui: true
timeout_minutes: 40
prerequisites:
  - "step 22: metrics dashboard"
  - "step 26: run persistence and browser"
---

## 1. Goal

Deliver **F14 — Run comparison** from `docs/spec.md` §4.3 as a new authenticated route at `/runs/compare` that lets a researcher pick up to four completed runs and visualize their time-series metrics side-by-side on a shared tick-number X axis, with per-series color coding and a dedicated CSV download of the aligned metrics. This is the primary mechanism through which the researchers answer RQ2 (*role of spatial topology — lattice vs well-mixed*) because the "publication-grade figure almost for free" the spec's §2 promises is exactly this view: the same configuration run in two topology modes, rendered as two overlaid success-rate / cluster-size / assimilation-index curves on one axis. It is also the daily bread of RQ1 investigations — a researcher tweaking the mono:bi ratio from 1:4 to 4:1 in ten discrete values will frequently open the comparison view on a pair of those runs to decide whether the threshold they hypothesized is real. Step 29 ships (a) a Server Component page at `app/(auth)/runs/compare/page.tsx` that reads the `runs` query parameter from the URL, resolves the selected runs via the step-08 helpers, loads their `tick_metrics`, aligns them on a shared tick grid, and renders a grid of `ChartPanel` instances (reused from step 22) with up to four color-coded series per chart; (b) a small selection sidebar (client component) that lets the user add or remove runs from the comparison via a dropdown filtered to completed runs, with the URL as the single source of truth (every selection change calls `router.replace` to rewrite `?runs=<ids>`); (c) a pure server-side alignment helper that takes N parallel `TickReport[]` streams and produces a single wide-format dataset suitable for Recharts consumption; (d) a dedicated CSV download endpoint at `app/api/runs/compare/route.ts` that accepts the same `runs=` query parameter, streams an aligned long-format CSV `(run_id, tick, world, metric_name, metric_value)` through a `ReadableStream` with `Content-Type: text/csv` and `Content-Disposition: attachment`, and (e) a small "Compare" affordance on the step-26 runs browser that collects checked rows and links to `/runs/compare?runs=<ids>`. The comparison page reuses the step-22 `MetricsDashboard` composition primitives (`ChartPanel`, the Okabe-Ito palette, the `syncId` tooltip synchronization) verbatim — step 29 does not ship any new charting code. No new database tables, no new metrics, no new simulation semantics; the whole step is **read-side URL-driven navigation plus alignment and CSV streaming**, sitting on top of what steps 08, 22, and 26 already built.

Scope boundary: step 29 does **not** reimplement any chart component, does **not** modify the `MetricsDashboard` internals, does **not** add per-run annotation (v2), does **not** add statistical significance overlays (v2, would require multiple replicates and CI bands — that is step 28 territory, not step 29), does **not** touch the worker, and does **not** introduce any new database migrations. The only modifications to non-step-29 files are (i) an optional lightweight extension to the step-26 runs browser to add a "Compare selected" button / checkbox column, and (ii) an optional tiny extension to CLAUDE.md "Export conventions" documenting the per-comparison CSV endpoint as a distinct shape from the per-run export that step 30 ships.

## 2. Prerequisites

- Commit marker `step 22: metrics dashboard` present in `git log`. Step 22 shipped `app/(auth)/playground/chart-panel.tsx`, the `SERIES_COLORS` Okabe-Ito palette, and the `ResponsiveContainer` / `LineChart` / `Line` idioms step 29 reuses unmodified. Step 29 imports `ChartPanel` directly from its step-22 location — the component is already pure-props, already accepts a multi-series `series: Array<{ dataKey; name; color }>` prop, and already handles the `syncId` synchronization across panels. If the `ChartPanel` signature drifts from what step 22 landed (e.g. step 22's implementing claude renamed a prop), step 29 honors the actual signature as shipped and adjusts its call sites — schema stability across steps beats perfect plan-file consistency (same discipline step 26 uses).

- Commit marker `step 26: run persistence and browser` present in `git log`. Step 26 shipped (a) the `app/(auth)/runs/page.tsx` browser, (b) the extended `listRuns({ status, classification, configId, ...})` helper in `lib/db/runs.ts`, (c) the `listRunsWithConfig` join helper, (d) the `lib/sim/metrics/serialize.ts` module with `serializeTickReportsToMetricRows` and `materializeTickReports`, and (e) the `formatClassificationLabel` helper. Step 29 consumes every one of these — most critically `materializeTickReports` for reconstructing `TickReport[]` from stored `tick_metrics` rows, and `listRunsWithConfig` for populating the run-picker dropdown. The step-26 runs browser page is the link source for "Compare selected" and is the page step 29's small modification (see §6) extends to carry comparison checkboxes.

- Commit marker `step 08: run persistence schema` present in `git log`. Step 08 shipped the `lib/db/runs.ts` helpers (`getRun`, `listRuns`) and the `lib/db/tick-metrics.ts` helper (`loadTickMetrics`) that step 29 calls to resolve selected runs and pull their metric rows. The `tick_metrics` composite primary key `(run_id, tick, world, metric_name)` and the `tick_metrics_run_metric_idx` secondary index are what make the per-run metric loads on the comparison page serve efficiently — step 29 issues up to 4 parallel `loadTickMetrics(runId)` calls and both indexes ensure the scans are index-seeks rather than full-table reads.

- Commit marker `step 17: run summary metrics` present in `git log`. Step 17 defines the `RunSummary` shape and the classification enum that populate the run-picker dropdown labels and the "Configs differ" banner logic in §7 slice seven. Step 29 does not compute any summary metrics — it reads them out of `runs.summary_json` and `runs.classification` via the existing `getRun` helper.

- Commit marker `step 07: login and app shell` present in `git log`. The authenticated route group `app/(auth)/` and the `verifySession()` DAL from step 07 are the auth substrate: the new `app/(auth)/runs/compare/page.tsx` Server Component begins its body with `await verifySession()` per `CLAUDE.md` "Authentication patterns", and the new `app/api/runs/compare/route.ts` route handler independently calls `await verifySession()` as its first line because proxy cookie-presence checks are not sufficient on their own (the data-security guide cited in the research notes explicitly warns against this, and step 06 already documented the discipline in the "Authentication patterns" CLAUDE.md section).

- Node ≥ 20.9, Next 16.2.2, React 19.2.4, Drizzle ORM (step 02), Recharts (step 22), Tailwind 4 (step 00). **No new runtime dependencies** are installed in this step — the CSV streaming uses only Web `ReadableStream` and the `TextEncoder` built-in, both of which are first-party Node 20 / browser APIs with no package backing.

## 3. Spec references

- `docs/spec.md` **§4.3 Batch runner mode**, specifically **F14 Run comparison**: *"Pick any two (or N) completed runs and diff their time-series metrics side-by-side on shared axes. Ideal for before/after comparisons of a single parameter change or topology swap. Acceptance: Up to 4 runs can be compared simultaneously; the comparison view downloads as a single CSV of aligned metrics. Supports: RQ2 specifically (lattice vs well-mixed comparison), and any cross-run analysis."* This is the authoritative contract step 29 delivers. The **"Up to 4 runs"** clause is operationalized as a hard cap on the `runs` query parameter (silently truncated to the first 4 ids if more are supplied, with a warning banner shown) and on the run-picker sidebar's "Add run" button (disabled once four runs are selected). The **"single CSV of aligned metrics"** clause is operationalized as the `/api/runs/compare` route handler described in §5 below. The **"RQ2 specifically"** clause is the reason the page's empty state text references lattice-vs-well-mixed as the canonical use case (a small paragraph of help text that guides a first-time visitor).

- `docs/spec.md` **§2 Does the Lattice Matter?** This is the motivational backbone of step 29. The spec's §2 paragraph 2 closes with *"Running the same experimental configuration in both lattice and well-mixed modes constitutes a built-in empirical answer to the user's own question and produces a publication-grade figure almost for free."* **Step 29 is the UI affordance that makes "almost for free" literally true.** A researcher who wants that figure selects two runs (one lattice, one well-mixed, same config otherwise) from the runs browser, clicks Compare, and the resulting view is the figure they would hand to a reviewer. The "Download CSV" button then gives them the underlying data for post-hoc statistical analysis in R or pandas, which is the reproducibility workflow §11 open-question 6 ("how should we keep the browser-side and post-hoc analysis pipelines in sync?") hints at. Step 29 is therefore not just a UI convenience — it is the **single most RQ2-aligned user-visible step** in the whole build plan, and its quality bar is correspondingly high.

- `docs/spec.md` **§1.2 RQ2 — Role of spatial topology (lattice vs well-mixed)** and **§6 Research Goals → Software Support Matrix row for RQ2**. The matrix lists F14 as one of the primary features for RQ2. The primary observables the matrix enumerates for RQ2 are *"cluster count, mean cluster size, time-to-consensus"* — these are the three metrics a comparison view most urgently needs to render side-by-side, because they are where lattice and well-mixed diverge most visibly (lattice: slow coarsening through long-lived metastable states; well-mixed: fast monotone convergence). Step 29 does not add any new metrics, but it does take care to ensure these three are clearly visible and **not collapsed into a single generic "cluster metrics" chart** — they get their own panels in the grid, same shape as step 22's dashboard, so the researcher can see the divergence at a glance.

- `docs/spec.md` **§5.1 US-3**: *"As a researcher, I want to run the same population config in lattice mode and in well-mixed mode and compare the outcomes on shared axes, so I can empirically justify the geographical-constraint assumption to reviewers."* **(F4, F14)** This is the single most important user story for step 29 — the literal US-3 text reads like the acceptance criterion for the feature. Step 29 satisfies it end-to-end: the runs browser lets the researcher pick two runs; the comparison page shows them on shared axes; the CSV download gives them the data to justify the figure with a p-value if a reviewer demands one.

- `docs/spec.md` **§7.1 Per-tick scalar metrics** and **§7.2 Sampled tensor snapshots**. The comparison page reads `tick_metrics` only; it does not touch `snapshots`. The scalar metrics enumerated in §7.1 are the union of what step 22's dashboard renders and what step 26's `serializeTickReportsToMetricRows` writes to the database — the two are aligned by design, so step 29's alignment helper simply re-groups rows by `(metricName, world)` across runs and emits a wide-format series dataset.

- `docs/spec.md` **§F16 Export** — referenced for the CSV long-format convention. The per-comparison CSV step 29 ships is a **subset** of the per-run CSV step 30 will ship: step 30's CSV is one run at a time (`SELECT tick, world, metric_name, metric_value FROM tick_metrics WHERE run_id = ?`); step 29's CSV is N runs aligned on a shared tick grid (`SELECT run_id, tick, world, metric_name, metric_value FROM tick_metrics WHERE run_id IN (?, ?, ?, ?) AND tick < <shared_min_tick_count>`). The two endpoints are **orthogonal**, not redundant — they answer different questions and produce different row shapes. See §4 path-not-taken 8 for the design decision recording why step 29 ships its own endpoint rather than piggy-backing on step 30's.

## 4. Research notes

Minimum requirements met: **4 local Next doc citations, 2 WebFetched external URLs, 2 paths not taken, total ≥ 8 citations.**

### Local Next.js 16 documentation

1. **`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md`** — the canonical `page.tsx` reference for Next 16 App Router. Load-bearing facts for step 29: (a) `searchParams` is a **`Promise`** in Next 16 and must be `await`ed: `searchParams: Promise<{ [key: string]: string | string[] | undefined }>`. Forgetting the `await` is the single most common Next 16 footgun per `CLAUDE.md` "Known gotchas" and `CLAUDE.md` "Next.js 16 deltas from training data". Step 29's compare page body begins with `const params = await searchParams;` immediately after the `verifySession()` check. (b) `searchParams` is a **request-time API** whose values force the page into dynamic rendering — that is exactly what step 29 wants because the selected runs are data-driven and cannot be statically generated. No `generateStaticParams`, no static export. (c) `searchParams` is a plain object, not a `URLSearchParams` instance — reading `params.runs` returns either `string` (single value), `string[]` (repeated key), or `undefined`. Step 29 handles all three shapes defensively: if `params.runs` is an array, it takes the first element; if it is a string, it splits on `,`; if it is undefined, it falls through to the empty-state render. (d) The `PageProps<'/(auth)/runs/compare'>` helper generated by `next typegen` gives strongly-typed access to the route literal — step 29's implementing claude runs `npx next typegen` after creating the new route directory so the helper is available. The alternative is hand-typing `{ searchParams: Promise<{ runs?: string | string[] }> }` inline, which is also acceptable if `next typegen` has not run yet.

2. **`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-search-params.md`** — the client-side `useSearchParams` hook. Load-bearing facts: (a) `useSearchParams()` returns a **read-only** `URLSearchParams`-shaped object, and is the client-side mirror of the Server Component `searchParams` prop. Step 29's run-picker sidebar (client component) uses `useSearchParams()` to read the current `runs` parameter and `useRouter().replace()` to write it back — this is the URL-as-state pattern step 26 already uses for its runs-browser filter bar. (b) The hook is explicitly documented as not supported in Server Components — the doc states *"useSearchParams is a Client Component hook and is not supported in Server Components to prevent stale values during partial rendering"*. The comparison page's split is therefore: the Server Component (`page.tsx`) reads `searchParams` via the prop for the initial render; the client component (`run-picker-sidebar.tsx`) reads `useSearchParams()` for subsequent user-driven updates. (c) The doc recommends wrapping any client component that uses `useSearchParams` in a `<Suspense />` boundary to avoid forcing the whole tree into client-side rendering. Step 29 follows this recommendation: the `RunPickerSidebar` client component is wrapped in `<Suspense fallback={<SidebarSkeleton />}>` by its parent Server Component.

3. **`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-router.md`** — the `useRouter` hook from `next/navigation`. Load-bearing facts: (a) `router.replace(href)` updates the URL **without pushing a new history entry** — exactly what step 29 wants for run-selection changes, because pressing Back should take the researcher back to wherever they came from (the runs browser), not step backward through every intermediate run-selection state. Using `router.push` instead would leave ten history entries behind for a researcher who toggled four runs in and out of the comparison, which is bad UX. (b) `router.replace` triggers a client-side navigation that re-fetches the RSC payload for the new URL, so the Server Component body re-runs with the new `searchParams` and the new `tick_metrics` loads happen server-side — this is the data refresh step 29 depends on. (c) The doc warns against sending untrusted URLs to `router.replace` (XSS risk via `javascript:` URLs). Step 29's run picker only ever constructs URLs from its own internal selection state (an array of run-id strings that came from the DB), so the XSS surface is zero by construction, but the warning is noted here so a future extension (e.g. "share this comparison link" input) does the right validation.

4. **`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`** — the Route Handler (`route.ts`) file convention for API routes in Next 16. Load-bearing facts for step 29's CSV endpoint: (a) A `route.ts` file at `app/api/runs/compare/route.ts` defines HTTP handlers for `/api/runs/compare`; exporting `async function GET(request: Request) { ... }` handles `GET` requests. (b) The handler receives a `NextRequest` (extension of the Web `Request`) and returns a standard Web `Response`. The `Response` constructor accepts a `ReadableStream<Uint8Array>` as its body, which is the streaming primitive step 29 uses to emit the CSV row-by-row without buffering the whole thing in memory. (c) Headers are set on the `Response` constructor's second argument: `new Response(stream, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="msksim-compare-<hash>.csv"' } })`. This is the exact pattern step 30 will use for per-run exports; step 29 uses it first. (d) Route Handlers can be dynamic by default (no `generateStaticParams`, no `revalidate` export), which is what step 29 wants — every request to `/api/runs/compare?runs=<ids>` is a fresh DB read. (e) Auth: the handler must call `verifySession()` first, same as any Server Action, because the proxy cookie check is not sufficient (per `CLAUDE.md` "Authentication patterns"). A stray POST to a Route Handler from an unauthenticated client would otherwise bypass page-level auth.

### External WebFetched references

5. **MDN — `ReadableStream`**, `https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream` (WebFetched at plan-write time). Load-bearing facts confirmed by the fetch: (a) The `ReadableStream` constructor accepts a `source` object with `start(controller)`, `pull(controller)`, and `cancel(reason)` callbacks. For step 29's CSV endpoint, only `start(controller)` is needed — the whole CSV is emitted in one pass from the already-loaded in-memory rows, because the 4-run × ~200k-row cap is comfortably small (worst case: 4 × 200k = 800k rows × ~60 bytes per CSV line ≈ 48 MB — streamable without buffering, but well within RAM if a simpler batch-emit approach were chosen). (b) `controller.enqueue(chunk)` accepts a `Uint8Array`; the CSV writer uses a single `TextEncoder` instance to convert strings to bytes. (c) `controller.close()` signals end-of-stream. Step 29's CSV handler emits the header row first, then loops over the aligned dataset and emits one row per `(run_id, tick, world, metric_name, metric_value)` tuple, then calls `controller.close()`. (d) The `Response` constructor accepts a `ReadableStream` as its body and wires it to the underlying Node HTTP response — no manual chunking or `Transfer-Encoding` header is needed; Next.js / the Node runtime handles the framing. (e) Alternative: a simple `Response(csvString, { headers })` with the whole CSV buffered as a string would also work and is meaningfully simpler at the 48 MB upper bound. **Decision**: use a `ReadableStream` because it matches the pattern step 30 will adopt for longer single-run exports (where the dataset can be ~2 GB for a 10⁴-tick run), and adopting the pattern here avoids a step-30 refactor. The streaming version is ~20 extra lines compared to the string version and the code is the same shape downstream readers expect.

6. **RFC 4180 — Common Format and MIME Type for Comma-Separated Values (CSV) Files**, `https://datatracker.ietf.org/doc/html/rfc4180` (WebFetched at plan-write time). Load-bearing facts: (a) The canonical MIME type for CSV is `text/csv` (not `application/csv` or `text/plain`). The `Content-Type` header step 29 sets is exactly `text/csv; charset=utf-8`, with the explicit charset because the CSV contains UTF-8 string values (run names, config names) and some downstream parsers default to Latin-1 without an explicit charset. (b) Fields containing commas, double quotes, or newlines must be enclosed in double quotes, and embedded double quotes must be doubled (`"` → `""`). Step 29's CSV writer applies this quoting rule via a tiny `csvQuote(value)` helper: if the string contains `,`, `"`, or `\n`, wrap in quotes and escape internal quotes. Run ids are UUIDs (no special characters) and metric names are snake_case (no special characters), so the quoting rule only fires on the config `name` column in the "run name" lookup — which is exactly the field a researcher might have typed a comma into. (c) The RFC recommends `\r\n` line endings, but modern tools (R, pandas, Excel) all accept plain `\n` as well — step 29 emits `\n` because it is simpler and all target consumers handle it. (d) The first row is the header row — step 29 emits `run_id,run_name,tick,world,metric_name,metric_value\n` as the first line. (e) The RFC does not define how to represent NaN, Infinity, or null numeric values; the convention in scientific CSV is to emit empty strings for null/NaN, which is what step 29 does (`value ?? ''` with `Number.isFinite` check).

7. **Recharts — Multi-series line chart pattern**, `https://recharts.org/en-US/examples/LineChartWithXAxisPadding` and `https://recharts.org/en-US/examples/MultipleYAxes` (WebFetched at plan-write time; canonical URLs may rotate, in which case the implementing agent WebFetches the latest equivalent pattern page). Load-bearing facts: (a) Recharts' `<LineChart>` accepts a single `data: Array<Record<string, number>>` prop where each row is a point across all series, and each `<Line dataKey="seriesKey">` inside the chart reads from the same row. For step 29, this means the aligned dataset shape is a wide-format array where each row is `{ tick: number; 'run1_world1_success_rate': number; 'run2_world1_success_rate': number; 'run3_world1_success_rate': number; ... }` and the comparison chart renders one `<Line>` per selected run with `dataKey={`run_${runIndex}_${world}_${metricName}`}` and `stroke={colorForRun(runIndex)}`. This is a pure data-shape transform — the chart component itself (step 22's `ChartPanel`) needs no modification. (b) The Okabe-Ito palette's first four usable colors (`#E69F00`, `#56B4E9`, `#009E73`, `#F0E442` — or substituting `#0072B2` for `#F0E442` on dark backgrounds where yellow contrast is poor) are exactly enough for the F14 4-run cap. Step 29 reuses the `SERIES_COLORS` constant step 22 exported, taking the first four entries in order. (c) The `syncId` prop is passed through from each `ChartPanel` with the same string (`syncId="msksim-compare"`), so hovering on a tick in one chart shows the crosshair on every chart — same pattern step 22 uses for the live dashboard, different `syncId` value to keep the two use cases isolated. (d) The `<Legend />` component renders a series legend at the bottom of each chart, automatically picking up the `name` prop from each `<Line name="Run #1 (seed 42)" ...>`. Step 29 emits the legend name as `<short run id> · seed <seed>` so the researcher can disambiguate at a glance.

### Paths not taken

8. **Dedicated API route for comparison CSV vs. reuse of step 30's per-run export route — chose the dedicated route.** The step-specific context spells out the decision point: step 30 will ship a streaming export API route at `app/api/export/[runId]/route.ts` for per-run CSV/JSON downloads. The tempting shortcut is to skip a step-29 CSV endpoint entirely and just ship "N download buttons, one per selected run, each linking to step 30's single-run export" on the comparison page. **Rejected** because: (a) the researcher asking for "download the CSV of this comparison" wants **one file** with all N runs' metrics aligned on a shared tick grid, not N separate files they must concatenate manually — the whole point of F14's "single CSV of aligned metrics" clause is one-file convenience. (b) The comparison CSV has a different row shape than the per-run CSV (it carries a `run_id` column so rows from different runs can be distinguished after concatenation; the per-run CSV does not need that column because the run id is implicit in the filename). Making step 30's endpoint handle both shapes would force it to take an optional `?runs=<list>` parameter that switches the row shape — an ugly conditional that muddies step 30's contract. (c) Step 29 and step 30 may be implemented in parallel (they are adjacent steps in the same wave), so assuming step 30's endpoint is fixed and available at step-29 implementation time is a fragile dependency. **Chosen**: step 29 ships `app/api/runs/compare/route.ts` as a **small, focused, self-contained endpoint** that is independent of step 30 and can be developed without coordination. Step 30's per-run endpoint remains clean and single-purpose. The two endpoints share a CSV-quoting helper (extracted into `lib/sim/metrics/csv.ts` in this step so step 30 can reuse it) but are otherwise independent.

9. **Client-side alignment and CSV generation instead of server-side — rejected.** The alternative is: the comparison page loads the raw `tick_metrics` rows for each run via Server Components, ships them to the client as JSON, and the client-side code aligns them and generates the CSV in memory using a `Blob` + `<a download>` link. **Rejected** because: (a) shipping 800k rows across the RSC serialization boundary is wasteful — the row count is the same on both sides but the JSON representation is ~3x bigger than the CSV representation, and the client has to re-parse it all for alignment. (b) The server-side path uses SQLite's index directly (`WHERE run_id IN (?, ?, ?, ?) ORDER BY run_id, tick, metric_name`) and the in-memory alignment runs on already-sorted data — O(N) time with a tiny constant. (c) A `<a download>` link on a generated Blob URL works but has browser-compatibility footguns (revocation timing, large-blob failures on Safari at multi-hundred-MB sizes); streaming via a `Content-Disposition: attachment` response is the bulletproof path. (d) Step 30 is going to ship exactly this pattern for per-run exports, so step 29 following the same pattern keeps the two endpoints architecturally aligned and minimizes review surface area. **Chosen**: server-side alignment, server-side CSV generation, streaming response with `Content-Disposition`.

10. **Rendering the comparison charts on the client with a raw Recharts composition (no `ChartPanel` reuse) — rejected.** The alternative is: since step 29's comparison chart has slightly different concerns from step 22's live dashboard (no pin button, no Y-axis popover, up to 4 series instead of 2-3), copy-paste step 22's chart code and strip out the unused features. **Rejected** because: (a) the step 22 `ChartPanel` signature is already parametric — it accepts `series: Array<{ dataKey; name; color }>` of arbitrary length, so 4 series is the same code path as 2. The pin button and the Y-axis popover are controlled by optional props with sensible defaults; step 29 can pass `isPinned={false}` and `onPinToggle={() => {}}` or just omit the pin affordance if the component ships the button unconditionally (in which case step 29's comparison page passes a no-op handler and accepts the minor UX footprint). (b) Duplicating chart code would create two sources of truth for chart styling, tooltip behavior, legend positioning, and the Okabe-Ito palette mapping — and the moment step 22 is tweaked (say, the legend font size changes), step 29's charts would drift. (c) `CLAUDE.md` "Living-document rules" implicitly discourages duplication by requiring each plan file to document what it reuses from earlier steps. **Chosen**: reuse `ChartPanel` verbatim. If its pin affordance needs to be suppressed on the comparison page, add a `suppressPinButton?: boolean` prop to `ChartPanel` in a small step-22 follow-up (< 5 lines) rather than forking the component.

11. **Alignment by interpolation onto a fixed-resolution tick grid vs. alignment by truncation to the minimum common length — chose truncation.** The step-specific context says "align on the minimum common length". The alternative would be: if run A has 1000 ticks and run B has 1500 ticks, interpolate run A's series onto a 1500-point grid (or interpolate run B down to a 1000-point grid, or up-sample both to 10k via a lerp). **Rejected** because: (a) interpolation introduces synthetic data points that never existed in the raw observations, and the Naming Game's metrics are integer-valued or tightly bounded (success rate in [0,1], cluster count in integers), so interpolation either produces meaningless fractional values or lies about monotone steps. (b) The research workflow this feature supports is "did the two runs diverge at the same time?" — interpolation would hide exactly the divergences the researcher wants to see. (c) Truncation is semantically correct: the comparison is only meaningful up to the point where both runs have data. If one run ended early (because its `tickCount` was lower, or because it crashed mid-run and was persisted with `status: 'completed'` anyway), the comparison should only show the ticks both runs reached. **Chosen**: truncation to `minTickCount = min(run.tickCount for run in selectedRuns)`. The comparison page displays a small note ("Showing ticks 0–<minTickCount>; run X reached <tickCount> but was truncated to match the shortest run") so the researcher is never surprised by missing data. The CSV download applies the same truncation — otherwise the CSV would contain rows from longer runs that have no counterpart in shorter runs, which would break every tidyverse `left_join` the researcher tried to do.

### Informational references

12. **WHATWG Fetch Standard — `Content-Disposition`**, `https://datatracker.ietf.org/doc/html/rfc6266` (referenced, not strictly needed at implementation time). The `attachment` disposition with a `filename=` parameter is the canonical way to force a browser to download rather than display a response body. Step 29 emits `Content-Disposition: attachment; filename="msksim-compare-<short-hash>.csv"` where `<short-hash>` is the first 8 hex characters of the SHA-256 of the concatenated sorted run ids (so the same comparison always gets the same filename, which is useful for researchers who download the same comparison twice). This mirrors the step-30 filename convention from `CLAUDE.md` "Export conventions".

Total citations: **4 local Next docs** (page.md, use-search-params.md, use-router.md, route.md) + **3 external WebFetched URLs** (MDN ReadableStream, RFC 4180, Recharts examples) + **3 paths not taken** (dedicated vs shared CSV route, client-side vs server-side alignment, duplicating vs reusing ChartPanel, + the truncation-vs-interpolation choice counts as a fourth) + **1 informational RFC** (Content-Disposition) = **11 citations**, comfortably clearing the quality gates (≥ 3 local Next docs, ≥ 2 external URLs, ≥ 1 path not taken, total ≥ 5).

## 5. Files to create

All paths relative to the repo root.

### Comparison page (Server Component)

- **`app/(auth)/runs/compare/page.tsx`** — **new file**. Server Component, no `'use client'`. Body skeleton:
  1. `await verifySession()` from `@/lib/auth/dal` as the first statement in the async default export.
  2. Accept `props: PageProps<'/(auth)/runs/compare'>` (or inline `{ searchParams: Promise<{ runs?: string | string[] }> }` if `next typegen` has not been re-run). `await props.searchParams` into a local constant.
  3. Parse the `runs` parameter defensively: if it is an array, take the first element; if it is a string, split on `,`; if it is undefined or empty, fall through to the empty-state render (see slice six). Trim whitespace, filter empties, deduplicate via `[...new Set(ids)]`, and **truncate to the first 4 ids** (F14 hard cap).
  4. For each selected run id, call `getRun(id)` from `@/lib/db/runs` in parallel via `Promise.all`. Any run that returns `null` is flagged as a "missing" run and excluded from the comparison (but recorded in a `missingRunIds` array shown as a banner at the top of the page).
  5. For each resolved run, call `loadConfig(run.configId)` from `@/lib/db/configs` in parallel via another `Promise.all` to populate the run-picker labels and to compare configs for the "different configs" banner logic. The `loadConfig` helper returns `{ row, parsed } | null`; step 29 consumes `row.name` and `row.contentHash` (the latter for the "configs differ" check).
  6. For each resolved run, call `loadTickMetrics(run.id)` from `@/lib/db/tick-metrics` in parallel via a third `Promise.all`. Each call returns `TickMetric[]` ordered `(tick asc, world asc, metricName asc)` per the step-08 guarantee. The four resulting arrays are handed to the alignment helper in the next step.
  7. Compute `minTickCount = Math.min(...runs.map(r => r.tickCount))` — this is the shared X-axis upper bound per the truncation decision in §4 path-not-taken 11.
  8. Call the new pure helper `alignRunMetrics(rows: TickMetric[][], runs: Run[], minTickCount: number)` from `@/lib/sim/metrics/compare.ts` (see below). It returns a `ComparisonDataset` shape that is a wide-format array suitable for Recharts consumption, grouped by metric. See slice three below for the exact return shape.
  9. Call `listRunsWithConfig({ status: 'completed', limit: 200 })` from `@/lib/db/runs` to populate the run-picker dropdown with the available completed runs. This list is passed as a prop to the `RunPickerSidebar` client component.
  10. Render the page layout: a two-column grid (Tailwind `grid grid-cols-[16rem_1fr] gap-4`) with the `RunPickerSidebar` client component on the left and the `ComparisonChartGrid` component on the right. Above both, render a small header card with the comparison title, a "Download CSV" button (a plain `<a href="/api/runs/compare?runs=<ids>" download>` — simple, no client-component needed), and a warning banner if `configs.differ === true` (see slice seven) or if `missingRunIds.length > 0`.
  11. The `ComparisonChartGrid` is a **Server Component** that takes the `ComparisonDataset` as a prop and renders one `ChartPanel` instance per metric. Each `ChartPanel` is a client component (per step 22), and the RSC → client serialization boundary carries the chart data as a JSON-serializable prop. The grid layout is Tailwind `grid grid-cols-1 lg:grid-cols-2 gap-4` — two charts per row on large screens, one per row on mobile.
  12. Empty state: if `selectedRunIds.length === 0`, render only the header and the sidebar with an empty selection, and a helpful card in the chart area that reads "Select at least one run from the sidebar to begin comparison. Tip: F14 is designed for topology comparisons — try picking one lattice run and one well-mixed run with the same config." The card links back to `/runs` for convenience.
  13. File size: ~180 lines including the data-loading section, the parallel `Promise.all`s, the banner logic, and the layout JSX.

### Client-side run picker

- **`app/(auth)/runs/compare/run-picker-sidebar.tsx`** — **new file**. Starts with `'use client'`. Exports `RunPickerSidebar(props)`. Props:
  ```typescript
  interface RunPickerSidebarProps {
    availableRuns: Array<{
      id: string;
      shortId: string; // first 8 hex chars of UUID
      configName: string;
      seed: number;
      classification: RunClassification | null;
      tickCount: number;
      finishedAt: string; // ISO string, server-formatted
    }>;
    selectedRunIds: string[];
  }
  ```
  The component uses `useSearchParams()` and `useRouter()` from `next/navigation`. On every selection change it constructs a new `URLSearchParams` by copying the current one, sets `runs` to the comma-joined new id list (or deletes the key if the list is empty), and calls `router.replace('?' + params.toString())`. It renders:
  - A header "Selected runs (N/4)" with N being the current count.
  - A list of currently-selected runs as removable pills: each pill shows the run's short id, config name, seed, and classification badge (using `formatClassificationLabel` from step 26's serialize module), plus an "x" button that removes the run from the selection via the URL rewrite. The color stripe on the left edge of each pill uses the Okabe-Ito palette entry corresponding to that run's index in the selection (so the sidebar visually matches the chart legend colors).
  - An "Add run" dropdown (`<select>` with a placeholder option) populated from `availableRuns` filtered to exclude already-selected ids. Selecting a run triggers the URL rewrite. The dropdown is **disabled** once 4 runs are selected (honoring F14's hard cap), with a disabled-state tooltip "Maximum 4 runs".
  - A link to `/runs` at the bottom: "Back to all runs".
  The component holds no local state — **the URL is the single source of truth**, and every re-render reads from `useSearchParams()`. This matches the step-26 runs-browser filter-bar pattern and the research note 2 recommendation to wrap the component in a Suspense boundary (done by the parent Server Component).
  File size: ~140 lines.

### Comparison chart grid (Server Component wrapper)

- **`app/(auth)/runs/compare/comparison-chart-grid.tsx`** — **new file**. A small Server Component that takes a `ComparisonDataset` prop and renders a grid of `ChartPanel` instances, one per metric the dataset carries. No `'use client'` at the top — this component is a pure layout wrapper; the heavy lifting is inside each `ChartPanel` (which is itself a client component because it imports from `recharts`). Exports:
  ```typescript
  interface ComparisonChartGridProps {
    dataset: ComparisonDataset;
    runs: Array<{ id: string; shortId: string; seed: number; color: string }>;
  }
  ```
  The `ComparisonDataset` shape (declared in `lib/sim/metrics/compare.ts` below) is roughly:
  ```typescript
  interface ComparisonDataset {
    minTickCount: number;
    metrics: Array<{
      metricKey: string; // e.g. 'success_rate_world1'
      displayName: string; // e.g. 'Success rate (World 1)'
      yAxisMode: 'auto' | 'zeroOne';
      rows: Array<Record<string, number | null>>; // wide-format, one row per tick
      seriesKeys: string[]; // dataKey names for each selected run
    }>;
  }
  ```
  The grid renders a Tailwind two-column layout (one column on mobile), and for each `metric` in `dataset.metrics`, emits a `<ChartPanel>` with:
  - `title={metric.displayName}`
  - `series={runs.map((run, i) => ({ dataKey: metric.seriesKeys[i], name: `${run.shortId} · seed ${run.seed}`, color: run.color }))}`
  - `data={metric.rows}`
  - `yAxisMode={metric.yAxisMode}`
  - `isPinned={false}` (no pinning on comparison page)
  - `onPinToggle={() => {}}` (no-op — pin button is either hidden via an optional `suppressPinButton` prop added to `ChartPanel` in a sibling 5-line step-22 follow-up, or rendered as an unreactive no-op for simplicity in v1; pick the latter)
  - `syncId="msksim-compare"` so tooltips synchronize across all panels on the comparison page
  - `testId={`compare-chart-${metric.metricKey}`}` for MCP identification
  File size: ~90 lines.

### CSV export API route

- **`app/api/runs/compare/route.ts`** — **new file**. Route Handler for `GET /api/runs/compare?runs=<ids>`. Structure:
  1. Import `verifySession` from `@/lib/auth/dal`, `getRun` / `listRuns` from `@/lib/db/runs`, `loadConfig` from `@/lib/db/configs`, `loadTickMetrics` from `@/lib/db/tick-metrics`, `alignRunMetrics` from `@/lib/sim/metrics/compare`, `csvQuote` and `generateCompareFilename` from `@/lib/sim/metrics/csv`, and the `NextRequest` type from `next/server`.
  2. `export async function GET(request: NextRequest): Promise<Response>`.
  3. Body: (a) `await verifySession()` — returns early with `new Response('Unauthorized', { status: 401 })` if unauthenticated. Note: `verifySession()` from `lib/auth/dal.ts` already throws or redirects per step 06's implementation; the Route Handler may need to catch the redirect and convert it to a 401 since Route Handlers cannot redirect to login the same way page components can. Check step 06's DAL at execution time and handle accordingly — the canonical pattern is: wrap the `verifySession()` call in a try/catch and on the `NEXT_REDIRECT` error code return a 401 JSON response. (b) Parse `request.nextUrl.searchParams.get('runs')` into the same id list the page component produces: split on comma, trim, filter empties, dedupe, truncate to 4. If the list is empty, return `new Response('Missing runs parameter', { status: 400 })`. (c) Parallel-load the runs, configs (not strictly needed for the CSV but needed for the "run name" column — use config name or fall back to the short id), and tick metrics via the same `Promise.all` pattern the page uses. If any run is not found, return `new Response('Run not found: <id>', { status: 404 })`. (d) Compute `minTickCount` and call `alignRunMetrics` to produce the `ComparisonDataset`. The CSV endpoint could alternatively emit rows directly from the raw `TickMetric[]` arrays without going through `alignRunMetrics` — the long-format CSV does not need the wide-format reshape — and **this is the preferred path** because it avoids double work and matches the tidyverse-friendly shape. Use the raw rows, filtered to `tick < minTickCount`. (e) Construct a `ReadableStream<Uint8Array>` with a `start(controller)` callback that:
     - Creates a single `TextEncoder` instance.
     - Emits the header row: `run_id,run_name,tick,world,metric_name,metric_value\n`.
     - For each run in the selection order, iterates its `TickMetric[]` (already ordered `(tick asc, world asc, metric_name asc)` by step 08), skipping any row with `tick >= minTickCount`, and emits one CSV line per row: `${csvQuote(run.id)},${csvQuote(run.name)},${row.tick},${row.world},${row.metricName},${row.metricValue}\n`.
     - Calls `controller.close()` when done.
  4. Return `new Response(stream, { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${generateCompareFilename(runIds)}"`, 'Cache-Control': 'no-store' } })`. The `no-store` prevents browsers or intermediate caches from serving a stale CSV if the researcher deletes a run and then redownloads.
  5. Total function body: ~80 lines including error handling and the stream construction. Keep the function focused; the bulk of the row-emitting logic is in the stream's `start` callback.

### Pure alignment helper

- **`lib/sim/metrics/compare.ts`** — **new file**, pure TypeScript, no React, no DB, no `'use server'`, no `'use client'`. Client-safe and worker-safe by convention. Exports:
  - `alignRunMetrics(rows: TickMetric[][], runs: Run[], minTickCount: number): ComparisonDataset` — the core alignment helper. Walks each run's `TickMetric[]`, groups by `(metricName, world)`, and builds a wide-format dataset where each metric becomes its own `rows: Array<Record<string, number | null>>` and each run becomes its own `dataKey` within that row. The dataKey format is `run_<index>` (where `index` is the position in the `runs` array, 0-3). The shared X-axis value is `tick`, extracted from the row. For each `(metricName, world)` combination that appears in **any** of the run arrays, the helper builds a row-indexed sparse table: `table[tick][dataKey] = value`. Ticks with no data for a given run produce `null` entries (which Recharts renders as line gaps). Ticks with `tick >= minTickCount` are dropped entirely. The helper also assembles the `metrics` list — one entry per `(metricName, world)` combination — with a stable ordering (the same metric ordering step 22's dashboard uses, so the comparison page visually matches the live dashboard).
  - `ComparisonDataset` — the type declared above.
  - `isYZeroOne(metricName: string): boolean` — returns true for metrics that are bounded in [0,1] (success rate, matching rate, assimilation index, segregation index, modularity) so the `ChartPanel` can set its Y axis to `zeroOne` mode. Returns false for metrics that are unbounded integers (cluster count, largest cluster size, Nw) so the axis is `auto`. A small static map at the top of the file.
  - `METRIC_DISPLAY_NAMES: Record<string, string>` — maps internal metric names (`'success_rate'`, `'mean_token_weight'`, ...) to human-readable display strings (`'Success rate'`, `'Mean token weight'`, ...). This is shared with step 22's dashboard if step 22 put it somewhere reusable; if not, step 29 declares it locally and a later refactor can dedupe. The display name is combined with the world (`'World 1'`, `'World 2'`, `'Both'`) into the `ChartPanel` title: `${displayName} (${worldLabel})`.
  - File size: ~180 lines. JSDoc on each exported function.

### CSV helpers

- **`lib/sim/metrics/csv.ts`** — **new file**, pure TypeScript, no React, no DB. Exports:
  - `csvQuote(value: string | number | null | undefined): string` — the RFC 4180 quoting helper. If `value` is null or undefined, returns an empty string. If `value` is a finite number, returns `String(value)`. If `value` is a NaN or infinite number, returns an empty string (per the "missing observation" convention step 26's `serializeTickReportsToMetricRows` established). If `value` is a string and contains `,`, `"`, or `\n`, wraps in double quotes and escapes internal quotes by doubling them. Otherwise returns the string unchanged.
  - `generateCompareFilename(runIds: string[]): string` — takes a list of run ids, sorts them lexicographically, joins with `,`, computes SHA-256 via `node:crypto`, takes the first 8 hex characters, and returns `msksim-compare-<hash>.csv`. Stable: same run set always produces the same filename, regardless of URL parameter order, so a researcher downloading the same comparison twice gets overwrite-safe filenames rather than `(1)`-suffixed duplicates.
  - File size: ~50 lines.

### Unit tests

- **`lib/sim/metrics/compare.test.ts`** — **new file**, Vitest suite for the alignment helper. Runs under the default `node` environment. Tests enumerated in §9. ~150 lines.

- **`lib/sim/metrics/csv.test.ts`** — **new file**, Vitest suite for the CSV helpers. Runs under the default `node` environment. Tests enumerated in §9. ~80 lines.

## 6. Files to modify

- **`app/(auth)/runs/page.tsx`** — **small extension** to add a "Compare selected" affordance. The minimal change is two parts: (a) the runs-table client component (from step 26, `app/(auth)/runs/runs-table.tsx`) gains a new first column with a `<input type="checkbox">` per row that tracks a local selection state (a `Set<string>` in `useState`), and (b) a new "Compare N runs" button appears above the table when the selection is non-empty; clicking it constructs `/runs/compare?runs=${[...selection].join(',')}` and calls `router.push(...)` from `next/navigation`. The checkbox and the selection state live entirely inside the client component — no server round-trip until the button is clicked. The button is disabled when the selection is empty and shows a count (e.g. "Compare 2 runs") when non-empty. The checkbox column respects the F14 4-run cap by disabling unchecked checkboxes once the selection reaches 4. This modification is ~40 lines added to `runs-table.tsx` and zero lines to `page.tsx` itself (the server component is unchanged). **Fallback if the step-26 runs-table client component signature has drifted**: the implementing claude adjusts to whatever step 26 actually shipped — the "Compare selected" extension is load-bearing for the MCP script's alternative navigation path but the MCP script also tests the direct URL navigation path (`navigate_page('/runs/compare?runs=<id1>,<id2>')`) which works regardless of the runs-browser extension. If the step-26 client component is prohibitively different from the plan file, the implementing claude can **skip the runs-browser modification entirely** and rely solely on direct URL navigation — documenting the skip in the commit message. Direct URL navigation is sufficient for F14 acceptance; the "Compare selected" button is a convenience, not a requirement.

- **`app/(auth)/playground/chart-panel.tsx`** (step 22) — **optional 5-line extension** to add a `suppressPinButton?: boolean` prop. If present and true, the pin button is not rendered. This lets the comparison page reuse `ChartPanel` without the pin affordance, which is confusing on a comparison view because there is nowhere to "pin to". The extension is minimal and defaults to `false` (pin button rendered), so no existing call site breaks. If the implementing claude judges this unnecessary (i.e. the pin button as a no-op is acceptable UX for v1), the prop is not added — the `onPinToggle={() => {}}` no-op approach is fine. Either path is acceptable; document the choice in the commit body.

- **`CLAUDE.md`** — **append ≤ 15 lines** to the "Export conventions" section documenting the per-comparison CSV endpoint as a distinct shape from the per-run export step 30 ships. See §11 for the exact bullets.

- **`docs/screenshots/step-29-compare.png`** — the MCP verification screenshot committed with the step, written by the script in §10. This is a new file, not a modification, but is listed here because committing it is part of the step's deliverable and it sits under an existing directory.

**No other files are modified.** In particular: `package.json` is untouched (no new deps), `tsconfig.json`, `next.config.ts`, `proxy.ts`, `db/schema/*`, `db/migrations/*`, `vitest.config.ts`, `lib/db/client.ts`, and every `lib/sim/*` module except the new `compare.ts` and `csv.ts` additions are untouched.

## 7. Implementation approach

The work is sliced so each slice compiles and type-checks in isolation, and the UI is exercised end-to-end only after every server-side piece is green. The overall order: write the pure helpers first (alignment and CSV) with unit tests, then the CSV route handler (pure IO on top of the helpers), then the Server Component page, then the client-side sidebar, then optionally extend the runs browser, then run the MCP verification.

**Slice one — grep-first audit of step-22 and step-26 surfaces.** Before writing any new code, the implementing claude runs the equivalent of `grep -rn "ChartPanel\|ComparisonDataset\|alignRunMetrics\|formatClassificationLabel\|listRunsWithConfig\|loadTickMetrics\|materializeTickReports" app/ lib/` to confirm (a) `ChartPanel` exists at its step-22 location with the expected props shape, (b) none of the step-29-new symbols already exist (they should not), and (c) `listRunsWithConfig`, `loadTickMetrics`, and `formatClassificationLabel` are in the locations step 26 landed them. The audit also includes opening `app/(auth)/playground/chart-panel.tsx` to read its exact exported prop interface — the plan file describes the shape but the single source of truth at implementation time is the shipped file. If any symbol has drifted from the plan-file expectation, the implementing claude adjusts the step-29 consumer code to match the actual shape — never the other way around.

**Slice two — write `lib/sim/metrics/csv.ts`.** Start with the smallest and simplest helper file. `csvQuote` is ~15 lines of string manipulation with a handful of conditionals; `generateCompareFilename` is ~15 lines using `node:crypto`'s `createHash`. JSDoc on each function describing the RFC 4180 quoting rules and the filename-stability contract. Write the unit tests (`csv.test.ts`) in lockstep: for `csvQuote`, test cases covering null, undefined, finite numbers, NaN, Infinity, plain strings, strings with commas, strings with quotes, strings with newlines, and the combination. For `generateCompareFilename`, test cases covering: same input → same output, different orderings of the same ids → same output (sort-stability), different id sets → different outputs, the output matches the `msksim-compare-<hash>.csv` shape. Run `npm test -- csv` and confirm green.

**Slice three — write `lib/sim/metrics/compare.ts` and its tests.** This is the most substantive pure module in the step. Declare the `ComparisonDataset` type at the top of the file. Implement `alignRunMetrics` in three passes:
1. **Pass A (discover metrics)**: walk all N input arrays and collect the set of `(metricName, world)` combinations that appear in any of them. Sort the combinations in a stable order that matches step 22's dashboard ordering (`success_rate`, `mean_token_weight`, `distinct_active_tokens`, `matching_rate`, `largest_cluster_size`, `cluster_count`, `interaction_modularity`, `assimilation_index`, `segregation_index`) — if step 22 exported an ordering constant, reuse it; if not, duplicate the list here with a comment noting the duplication is temporary.
2. **Pass B (per-metric row materialization)**: for each `(metricName, world)` combination, build a tick-indexed map where each tick's value is a record mapping `run_<index>` → `number | null`. Initialize every row with every run key set to `null`, then fill in values from the corresponding run's `TickMetric[]` for rows where the data exists. Drop rows where `tick >= minTickCount`. Convert the map to a sorted array by tick.
3. **Pass C (assembly)**: combine the per-metric row arrays into the final `ComparisonDataset` with display names from `METRIC_DISPLAY_NAMES` and Y-axis modes from `isYZeroOne`.

The `METRIC_DISPLAY_NAMES` map is the friendly-name lookup; the entries mirror what step 22's dashboard displays:
```typescript
const METRIC_DISPLAY_NAMES: Record<string, string> = {
  success_rate: 'Success rate',
  mean_token_weight: 'Mean token weight',
  token_weight_variance: 'Token weight variance',
  distinct_active_tokens: 'Distinct active tokens (Nw)',
  matching_rate: 'Matching rate',
  largest_cluster_size: 'Largest cluster size',
  cluster_count: 'Cluster count',
  interaction_modularity: 'Interaction-graph modularity',
  assimilation_index: 'Assimilation index',
  segregation_index: 'Segregation index',
};
```

The world label helper adds ` (World 1)`, ` (World 2)`, or nothing for `both`. `isYZeroOne` returns true for `success_rate`, `matching_rate`, `assimilation_index`, `segregation_index`, `interaction_modularity` (which is technically in [-1, 1] but for display purposes `zeroOne` is close enough; or extend the `ChartPanel` Y-axis modes to include `minusOneToOne` — out of scope for step 29, default to `auto` for modularity). Write the unit tests in lockstep per §9. The most important test is the round-trip test: construct three synthetic `TickMetric[]` arrays with known values at known ticks, run `alignRunMetrics`, and assert the dataset has the expected number of metrics, the expected row counts (equal to `minTickCount`), and the expected per-cell values at a handful of spot-check ticks. Include a test where one run has fewer ticks than the others to verify the truncation. Include a test where all runs have exactly the same tick count and the same metric set (the "happy path" for a parameter comparison). Run `npm test -- compare` and confirm green.

**Slice four — write the CSV Route Handler.** Create `app/api/runs/compare/route.ts` per the skeleton in §5. The error-handling discipline is: every external boundary (auth, DB read, stream construction) has a try/catch that converts exceptions to 4xx/5xx JSON responses with a clear error message. The `verifySession()` call is wrapped in a try/catch that matches the `NEXT_REDIRECT` error code and returns 401 — the implementing claude verifies the exact error-code string by reading `lib/auth/dal.ts` at execution time, because the redirect mechanism may have evolved between step 06 and now. The stream's `start(controller)` callback uses a single `TextEncoder` instance reused across rows. The filename comes from `generateCompareFilename(runIds)` — the sorted-stable version — not from a hand-rolled join. Manual smoke test: run `npm run dev` (if available) or `next build && next start`, log in, and curl `/api/runs/compare?runs=<two-fake-ids>` to confirm the endpoint returns a 404 (because the fake ids do not exist) and the error format matches expectations. Then curl with real ids (after running a simulation in the playground) to confirm the CSV body is well-formed and the headers are correct. The manual smoke test is not part of the automated acceptance script but is a useful sanity check during implementation.

**Slice five — write the `run-picker-sidebar.tsx` client component.** Start with `'use client'`. Import `useSearchParams`, `useRouter` from `next/navigation`. Implement the render function per §5. The single most delicate part is the URL rewrite: the component must **copy** the current `URLSearchParams` (not mutate the returned read-only object directly), set the `runs` key, and pass `params.toString()` to `router.replace()`. Mutating the `useSearchParams()` return value directly is a no-op because the returned object is a read-only proxy. The correct idiom is:
```typescript
const searchParams = useSearchParams();
const router = useRouter();
const onSelectionChange = (newIds: string[]) => {
  const params = new URLSearchParams(searchParams.toString());
  if (newIds.length === 0) params.delete('runs');
  else params.set('runs', newIds.join(','));
  router.replace(`?${params.toString()}`);
};
```
The sidebar's "Add run" dropdown renders an `<select>` with a placeholder `<option value="">Add a run...</option>` and one `<option value={run.id}>` per `availableRuns` entry filtered to exclude selected ids. The `onChange` handler appends the new id to the selection, then calls the URL rewriter. The pill list maps over the selected ids in order, looks each up in `availableRuns` for display metadata, and renders a small bordered div with the short id, config name, seed, classification badge, and an "x" button. Each pill's left-edge color stripe uses `SERIES_COLORS[index]` from step 22's palette export.

**Slice six — write `app/(auth)/runs/compare/page.tsx`.** Follow the skeleton in §5 strictly. The key design choices:
- Use `Promise.all` for the three parallel loads (runs, configs, tick metrics). Do not await them serially — that would triple the page's TTFB.
- If any `getRun(id)` returns null, flag the id as missing but **continue** with the remaining ids. A comparison of 3 runs where one id was typo'd is still a useful comparison; forcing the page to fail closed would be bad UX.
- The "configs differ" banner check compares `config.contentHash` across the runs. If not all runs share the same `contentHash`, render a small amber banner: "These runs were generated from different configs. The comparison may be harder to interpret." The banner includes a link to each config's editor so the researcher can inspect the diffs. Config-hash comparison is the correct primitive because step 08's `configs.contentHash` is SHA-256 over the canonical JSON, so two runs with logically-identical configs have the same hash even if they were saved at different times.
- The "Download CSV" button is a plain `<a>` tag with `href={`/api/runs/compare?runs=${selectedRunIds.join(',')}`}` and `download` attribute. It is **not** a client component — a plain anchor tag is sufficient for a file download, no JavaScript required. The only nuance is that the href must use the encoded id list (though UUIDs are URL-safe, no encoding is required in practice; use `encodeURIComponent` defensively).
- The layout is a two-column grid via Tailwind. On mobile, the sidebar collapses to a full-width top section and the chart grid becomes single-column.
- The Suspense wrapping per research note 2: the `RunPickerSidebar` client component is rendered inside a `<Suspense fallback={<div>Loading picker...</div>}>` — not strictly required because the sidebar's props are already resolved at render time (they come from the Server Component parent via props, not from a data fetch inside the client component), but including the Suspense boundary is a small future-proofing cost and matches the docs' recommendation.
- No `cache()` wrapping for this page: the step-specific context suggests "Memoize the result server-side if possible (Next cache)." **Decision**: React's `cache()` from `react` is the right primitive if the page calls the same helper multiple times in one request (it dedupes). Step 29's page calls each loader exactly once, so `cache()` provides no within-request benefit. Cross-request caching via `unstable_cache` or the new `use cache` directive is **not** used because the data is per-user-session and the run set changes whenever new runs complete — stale caches would show deleted or outdated runs. The step-specific context's "if possible" qualifier authorizes this skip; the implementing claude documents it in the commit body.

**Slice seven — the "different configs" banner logic.** This is a small but important UX affordance. After loading the configs, the page computes `const allHashesMatch = selectedRuns.every(r => r.configContentHash === selectedRuns[0].configContentHash);`. If false, render the banner. The banner shows the count of distinct configs (e.g. "2 distinct configs across the selected runs") and includes the first few characters of each config's hash so the researcher can see at a glance which runs came from which config. The banner is amber (`bg-amber-900/20 border-amber-700`) not red — it is informational, not an error.

**Slice eight — extend the runs browser (optional).** Per §6, the runs-table client component gets a checkbox column and a "Compare N runs" button. This slice is gated on the step-26 client component being in a state that can accept the extension; if not, skip and document. The extension is ~40 lines in `runs-table.tsx`:
```typescript
const [selected, setSelected] = useState<Set<string>>(new Set());
const toggleRow = (id: string) => {
  setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else if (next.size < 4) next.add(id);
    return next;
  });
};
// ... render:
// A "Compare N runs" button above the table, disabled if selected.size === 0,
// that navigates to `/runs/compare?runs=${[...selected].join(',')}`.
// A <th><input type="checkbox" ... /></th> column header (for select-all, optional).
// A <td><input type="checkbox" checked={selected.has(row.id)} onChange={() => toggleRow(row.id)} /></td> cell per row.
// Disable unchecked checkboxes when selected.size >= 4.
```

**Slice nine — run the typecheck and lint.** `npm run typecheck` and `npm run lint` must both exit 0. The most common typecheck failure at this stage is a drift between the `ChartPanel` prop interface step 22 actually shipped and what step 29 assumes — the grep-first audit in slice one should have caught this, but a final typecheck catches anything missed. The most common lint failure is unused imports from `drizzle-orm` in the page component (`eq`, `and`, `desc` are only used if the page does its own query composition; most of step 29's queries go through helpers, so the imports should be minimal — remove any that are unused).

**Slice ten — run the MCP verification script.** Follow the `CLAUDE.md` "UI verification harness" protocol: `next build && next start` on the MSKSIM_PORT, wait for `/` to 200, log in with `MSKSIM_SEED_USER` / `MSKSIM_SEED_PASS`, then execute the acceptance script in §10. Screenshot to `docs/screenshots/step-29-compare.png`. Verify console is clean (no thrown errors, no hydration mismatches) and network requests are 200 or 304 (no 4xx/5xx, no dangling requests). Commit.

**Key design decisions the implementing claude must not second-guess mid-implementation.** The hard cap of 4 runs is non-negotiable (F14 acceptance criterion). Truncation to `minTickCount` is the alignment strategy, not interpolation (§4 path-not-taken 11). The CSV endpoint is dedicated at `app/api/runs/compare/route.ts`, not reused from step 30 (§4 path-not-taken 8). The `ChartPanel` is reused verbatim from step 22, not forked (§4 path-not-taken 10). The URL is the single source of truth for run selection — no React state in the sidebar beyond local UI state. Every Server Component and every Route Handler calls `verifySession()` first. The long-format CSV is `(run_id, run_name, tick, world, metric_name, metric_value)` — the `run_id` column is what step 30's per-run CSV lacks and is the feature that makes the comparison CSV tidyverse-friendly without requiring post-hoc joins.

## 8. Library choices

**No new libraries in this step.**

- `next` 16.2.2 — already installed in step 00; provides `Response`, `NextRequest`, the App Router file conventions, `useSearchParams`, `useRouter`, `searchParams` on Server Components.
- `react` 19.2.4 — already installed in step 00; provides hooks and the `'use client'` directive.
- `drizzle-orm` — already installed in step 02; consumed transitively via the `lib/db/*` helpers.
- `recharts` — already installed in step 22; consumed transitively via `ChartPanel`.
- `@/lib/db/runs`, `@/lib/db/configs`, `@/lib/db/tick-metrics` — step 08 server-only helpers.
- `@/lib/sim/metrics/serialize` — step 26 pure helper (reused for `formatClassificationLabel`).
- `node:crypto` — Node core, used for the SHA-256 filename hash in `generateCompareFilename`. No package to install.
- `TextEncoder` — Web standard, available in Node 20 as a global and in browsers.
- `ReadableStream` — Web standard, available in Node 18+ as a global and in browsers.

The implementing claude verifies via `npm ls next react recharts drizzle-orm` that each resolves to exactly one version (no duplicates) before writing any code. No `npm install` runs in this step.

## 9. Unit tests

All tests live in the two new Vitest files under `lib/sim/metrics/`. Each runs under Vitest's default `node` environment. No network, no filesystem, no DOM.

### `lib/sim/metrics/compare.test.ts`

1. **Round-trip: two runs with identical metric shapes.** Construct two synthetic `TickMetric[]` arrays, each with 10 ticks, 2 worlds, 3 metrics (30 rows per run). Call `alignRunMetrics([rows1, rows2], [run1, run2], 10)`. Assert the returned `dataset.metrics.length === 6` (3 metrics × 2 worlds, assuming the test metrics are all per-world). For each metric entry, assert `metric.rows.length === 10` and every row has `run_0` and `run_1` keys with finite values. Spot-check three specific tick/run/metric cells against the expected values.

2. **Truncation: runs with different tick counts.** Construct two `TickMetric[]` arrays where run A has 10 ticks and run B has 6 ticks. Pass `minTickCount = 6` (the caller's responsibility). Assert that every metric's row count is exactly 6, and that the rows for ticks 6-9 (from run A) do not appear in the output. Assert that tick 5's row has both `run_0` and `run_1` with finite values, confirming the overlap region is preserved.

3. **Missing metric in one run.** Construct two `TickMetric[]` arrays where run A has metric `m1` and run B does not (run B has only `m2`). Call `alignRunMetrics` and assert that `dataset.metrics` includes both `m1` and `m2`. For `m1`, assert each row has `run_0` finite and `run_1 === null`. For `m2`, assert each row has `run_0 === null` and `run_1` finite. This is the "sparse alignment" test — missing data produces nulls, not dropped rows.

4. **Up to 4 runs, no errors.** Construct four `TickMetric[]` arrays with identical metrics and tick counts. Call `alignRunMetrics([rows1, rows2, rows3, rows4], runs, 10)`. Assert the `metric.seriesKeys` array has 4 entries: `['run_0', 'run_1', 'run_2', 'run_3']`. Assert each row has all four keys with finite values. This verifies the helper handles the F14 cap correctly.

5. **Empty input.** Call `alignRunMetrics([], [], 0)`. Assert the returned dataset has `minTickCount === 0` and `metrics === []`. The helper must not throw on empty input — the page component uses an empty state for zero selected runs, and if it accidentally calls the helper with an empty list, the helper must return a clean empty dataset rather than crash.

6. **Metric ordering is stable.** Construct two input arrays with metrics in different orders (`[largest_cluster_size, success_rate]` vs `[success_rate, cluster_count]`). Call `alignRunMetrics` and assert the output `metrics` array is ordered consistently with the `METRIC_DISPLAY_NAMES` constant ordering — `success_rate` before `cluster_count` before `largest_cluster_size` (matching step 22's dashboard). This ensures the comparison page always shows metrics in the same order regardless of which run's rows were read first.

7. **`isYZeroOne` returns true for bounded metrics.** Parameterized test: for each metric name in the known list, assert `isYZeroOne(name)` returns the expected boolean. `success_rate`, `matching_rate`, `assimilation_index`, `segregation_index` → true. `largest_cluster_size`, `cluster_count`, `distinct_active_tokens`, `mean_token_weight`, `token_weight_variance` → false. Unknown metrics → false (default).

### `lib/sim/metrics/csv.test.ts`

8. **`csvQuote` handles null, undefined, and NaN as empty.** `csvQuote(null) === ''`, `csvQuote(undefined) === ''`, `csvQuote(NaN) === ''`, `csvQuote(Infinity) === ''`, `csvQuote(-Infinity) === ''`.

9. **`csvQuote` handles finite numbers.** `csvQuote(0) === '0'`, `csvQuote(1.5) === '1.5'`, `csvQuote(-3.14) === '-3.14'`, `csvQuote(1e10) === '10000000000'`. Verify scientific notation does not leak into the output — use `.toString()` explicitly if the default `String(n)` produces scientific notation for values outside a safe range, though at the scale of the metrics (success rates in [0,1], cluster counts ≤ 10k) this is not a concern in practice.

10. **`csvQuote` handles plain strings.** `csvQuote('hello') === 'hello'`, `csvQuote('') === ''`, `csvQuote('lattice') === 'lattice'`.

11. **`csvQuote` escapes commas, quotes, and newlines.** `csvQuote('hello, world') === '"hello, world"'`. `csvQuote('she said "hi"') === '"she said ""hi"""'`. `csvQuote('line1\nline2') === '"line1\nline2"'`. `csvQuote('"')  === '""""'` (a single quote character gets wrapped and doubled).

12. **`generateCompareFilename` is stable for the same id set.** Call `generateCompareFilename(['b-uuid', 'a-uuid'])` and `generateCompareFilename(['a-uuid', 'b-uuid'])`. Assert they return the same value. Assert the return matches the pattern `/^msksim-compare-[0-9a-f]{8}\.csv$/`.

13. **`generateCompareFilename` differs for different id sets.** Call with `['a', 'b']` and `['a', 'c']`. Assert they return different values.

All tests are deterministic (no `Math.random`, no wall clock beyond what `node:crypto` needs internally). Total test count: 13 across the two files.

## 10. Acceptance criteria

The step is complete when all of the following are observably true on a clean clone after running the new step, and the MCP script below passes end-to-end.

### Static checks

- `npm run typecheck` exits 0.
- `npm run lint` exits 0 (no suppression comments added).
- `npm test -- lib/sim/metrics/compare` exits 0, all 7 tests pass.
- `npm test -- lib/sim/metrics/csv` exits 0, all 6 tests pass.
- `npm test` (full suite) exits 0. No regression in prior step tests.

### Commit hygiene

- The commit contains exactly: the new page (`app/(auth)/runs/compare/page.tsx`), the new sidebar (`run-picker-sidebar.tsx`), the new chart grid (`comparison-chart-grid.tsx`), the new CSV route (`app/api/runs/compare/route.ts`), the two new pure helpers (`lib/sim/metrics/compare.ts`, `lib/sim/metrics/csv.ts`), their two test files, the optional `runs-table.tsx` extension (if slice eight was executed), the optional `chart-panel.tsx` `suppressPinButton` prop extension (if slice six chose that path), the CLAUDE.md append, and the MCP screenshot at `docs/screenshots/step-29-compare.png`.
- The commit diff does not touch `package.json` or `package-lock.json` (no new dependencies).
- The commit diff does not touch `db/schema/*`, `db/migrations/*`, `next.config.ts`, `proxy.ts`, `tsconfig.json`, `vitest.config.ts`, or any file under `lib/db/` (this step is pure read-side on top of existing helpers).
- No `.next/`, no `data/msksim.db`, no screenshot temporaries, no stray `.env`.

### MCP verification script

The script is executed by `scripts/run-plan.ts` via `claude -p` against a fresh `next build && next start` server on a random `MSKSIM_PORT`, following the `CLAUDE.md` "UI verification harness" protocol. The script:

1. **Clear state and log in.** `evaluate_script('localStorage.clear(); sessionStorage.clear();')`. Clear cookies via DevTools protocol. Navigate to `/login`. Fill `MSKSIM_SEED_USER` and `MSKSIM_SEED_PASS`. Submit. Assert the redirect lands on `/` (or wherever step 07 landed the post-login redirect).

2. **Create a config and three runs.** Either use step 25's config editor UI or drop straight into the playground (step 24's interactive controls) and run a small simulation three times with different seeds. The canonical recipe: navigate to `/playground`, accept the default config (or apply a preset from step 31 if available — note, step 31 comes after step 29, so at step-29 execution time the preset UI may not be present; fall back to the default config), set `tickCount` to something small (100 is fine for MCP speed), set the seed to `1`, start, wait for completion (observe the auto-save toast from step 26), then reset and repeat with seeds `2` and `3`. Three runs total, all persisted. Alternative: use the runs already present in the DB if any prior step's MCP verification left some behind. The script should check and reuse if possible. If no runs exist, the script creates them via the playground UI.

3. **Navigate to `/runs` and verify the table lists at least 3 completed runs.** `list_console_messages` must show no errors. Take a snapshot of the page for debugging if the row count is unexpected.

4. **Navigate to `/runs/compare?runs=<id1>,<id2>` via direct URL.** Use `navigate_page` with the first two run ids extracted from the `/runs` table (via `evaluate_script` that reads `data-run-id` attributes from the rendered rows, if the step-26 table exposes them; otherwise use `list_network_requests` on the `/runs` page to find the run ids in the RSC payload, or fall back to reading the run ids from the URL via `evaluate_script` on the View links). Wait for the comparison page to render.

5. **Verify the page renders the comparison charts with 2 series per chart.** Take a snapshot. Assert the page title is "Run comparison" or similar (`evaluate_script('document.querySelector("h1").textContent')`). `evaluate_script` against the DOM to locate one specific chart by test id: `document.querySelector('[data-testid="compare-chart-success_rate_world1"] svg')`. Count the distinct `<path class="recharts-curve">` or `<path class="recharts-line">` elements inside that SVG — assert the count is exactly **2** (one line per selected run). Also count distinct stroke colors via `document.querySelectorAll('[data-testid^="compare-chart-"] svg path[stroke]').length > 0` and verify at least one chart has two distinct stroke values.

6. **Verify the sidebar shows 2 selected runs.** `evaluate_script` on the sidebar's selection pill list: `document.querySelectorAll('[data-testid="run-picker-pill"]').length === 2`.

7. **Add a third run via the sidebar's "Add run" dropdown.** `list_console_messages` baseline check. Locate the dropdown via `data-testid="run-picker-add-select"` and use `select_option` (or `fill_form` with the `<select>` element) to choose the third run id. Wait for the URL to update (assertion: `window.location.search.includes('runs=')` and the comma-separated id list now has 3 entries). Wait for the charts to re-render. Re-count the `<path>` elements in the same test-id'd chart — assert the count is now **3**.

8. **Click "Download CSV" and verify the network response.** Locate the download link via `data-testid="compare-download-csv"`. Click it. Use `list_network_requests` to find the most recent request matching `/api/runs/compare`. Assert the response has: status `200`, `Content-Type` starting with `text/csv`, `Content-Disposition` starting with `attachment; filename=`. Optionally `get_network_request` to fetch the response body and assert the first line matches the expected header `run_id,run_name,tick,world,metric_name,metric_value` and that the body has > 1 data row.

9. **Test the 4-run cap.** If a fourth run exists in the database, add it via the sidebar. Assert the chart count updates. If a fifth run exists, attempt to add it via the dropdown and assert the dropdown is disabled (or the option is absent), and the URL is not rewritten. Skip this step if fewer than 5 runs are available — the 4-run cap is unit-tested in the alignment helper already.

10. **Take the screenshot.** `take_screenshot(full_page=True)` and save to `docs/screenshots/step-29-compare.png`.

11. **Console + network clean check.** `list_console_messages` must contain no thrown errors, no hydration mismatches, no unhandled promise rejections, and no React 19 dev-mode-shadowed errors (React 19 strict-mode warnings are benign and ignored per `CLAUDE.md` "UI verification harness"). `list_network_requests` must show no 4xx or 5xx responses (the 200 CSV download from step 8 is the only external request beyond the initial page loads).

The MCP script terminates with an explicit assertion summary printed to stdout. `scripts/run-plan.ts` captures that output and, on success, performs the commit.

## 11. CLAUDE.md updates

Append to the **"Export conventions"** section. That section's hard cap is 20 lines. It currently holds ~6 lines from step 30's plan declaration (or is empty if step 30 has not landed — step 29 and step 30 may be written in parallel; if step 30 has not landed, step 29 populates the section with its own content plus a note that step 30 will add per-run exports later). The appended content, in prose form (rewritten as CLAUDE.md bullets by the implementing claude):

- Run comparison CSV is a **dedicated endpoint** at `app/api/runs/compare/route.ts`, distinct from the per-run export step 30 ships. It accepts `?runs=<comma-separated-ids>` (up to 4 ids, deduplicated, truncated to the minimum common tick count across selected runs) and returns a long-format CSV with columns `run_id, run_name, tick, world, metric_name, metric_value`. The `run_id` column is what makes the comparison CSV tidyverse-friendly without post-hoc joins — rows from multiple runs share a single file and are distinguished by that column.
- Filename convention for comparison CSVs: `msksim-compare-<hash>.csv`, where `<hash>` is the first 8 hex characters of the SHA-256 of the lexicographically-sorted run-id list. The hash is stable across URL parameter orderings, so a researcher downloading the same comparison twice gets overwrite-safe filenames rather than `(1)`-suffixed duplicates.
- Both the per-run export (step 30) and the comparison export (step 29) stream their responses via `ReadableStream` with `Content-Type: text/csv; charset=utf-8` and `Content-Disposition: attachment`. Server Actions cannot set `Content-Disposition`, which is why both endpoints are Route Handlers. Route Handlers must call `verifySession()` first as their own auth check — the proxy cookie check is not sufficient on its own.
- The shared CSV helpers `csvQuote(value)` (RFC 4180 field quoting) and `generateCompareFilename(ids)` (stable SHA-256-based filename) live in `lib/sim/metrics/csv.ts` as a pure module with no `import 'server-only'` guard — they are client-safe and worker-safe, and step 30's per-run endpoint reuses `csvQuote` for its own row emission.

The implementing claude verifies the appended content is ≤ 15 lines and that the "Export conventions" section total stays under its 20-line hard cap after the append. If the cap would be exceeded, promote the new content into a new dedicated "Comparison exports" section per `CLAUDE.md` "Living-document rules" rather than truncating any existing bullets. No other CLAUDE.md sections are touched in this step.

## 12. Commit message

Exactly:

```
step 29: run comparison
```

No conventional-commit prefix, no emoji, no trailing period. The `step 29:` marker is load-bearing for `scripts/run-plan.ts` progress detection per `CLAUDE.md` "Commit-message convention". One commit for the whole step; if `claude -p` produces intermediate commits during implementation, they are squashed by the orchestrator before advancing to step 30.

The commit body (optional but recommended) lists:
- The new page `/runs/compare` and its URL-driven selection model.
- The dedicated CSV endpoint at `app/api/runs/compare/route.ts` and its relationship to step 30's per-run exports (orthogonal, not redundant).
- The two new pure helpers in `lib/sim/metrics/` (`compare.ts` for alignment, `csv.ts` for row formatting) and their unit-test coverage.
- The `ChartPanel` reuse from step 22 (no new charting code) and the decision about `suppressPinButton` (added or not, per slice six).
- Whether the step-26 runs browser was extended with a "Compare selected" checkbox column (per slice eight, optional).
- Confirmation that no new packages were added and no schema migrations were needed.

## 13. Rollback notes

If this step lands in a bad state and needs to be undone (destructive — requires user confirmation per `CLAUDE.md` commit-safety rules):

1. `git log --oneline | grep -E '^[a-f0-9]+ step (28|29):'` to find the commit SHAs for step 28 (the prior step) and step 29 (this step). The target rollback SHA is the step-28 commit.
2. `git reset --hard <step-28-sha>` — single-move rollback. This removes the new page, the sidebar, the chart grid, the CSV route, the two pure helpers and their tests, the CLAUDE.md append, the MCP screenshot, and any optional extensions to the step-26 runs-table or step-22 chart-panel in one operation.
3. Run `npm install` to reconcile `node_modules/` with the reverted `package.json` — this is a no-op for this step (no packages were added) but is cheap and defensive.
4. Run `npm run typecheck` and `npm test` to confirm the working tree is clean and the step 00-28 suites still pass.
5. Re-run `npx tsx scripts/run-plan.ts --only 29` once the underlying issue is fixed to redo the step from a clean base.

The rollback is purely file-system; there is no schema migration to reverse, no DB data to clean up, and no external service to deconfigure. Step 29 is entirely read-side on top of data that already exists from step 26, so the rollback surface is minimal.
