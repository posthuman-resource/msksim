---
step: '30'
title: 'export'
kind: ui
ui: true
timeout_minutes: 40
prerequisites:
  - 'step 08: run persistence schema'
  - 'step 26: run persistence and browser'
---

## 1. Goal

Deliver **F16 — Export** from `docs/spec.md` §4.4 end-to-end. Step 30 exposes two download endpoints for every completed run persisted by step 26: (a) a **long-format CSV** of per-tick metrics (`tick,world,metric_name,metric_value`) suitable for ingestion into R's tidyverse or Python's pandas, and (b) a **JSON snapshot bundle** containing the run's config, seed, end-of-run summary, and any sampled agent-state snapshots — enough material for offline replay or independent verification by a collaborator. Both endpoints live under `app/api/export/[runId]/...` as Next 16 **Route Handlers**, authenticate via the Data Access Layer established in step 06, stream their response bodies via `ReadableStream` + `TextEncoder` chunks so a 140k-row tick*metrics table does not materialize as a single string in RAM, and set a `Content-Disposition: attachment` header whose filename follows the project-wide template `msksim-<configHash8>-seed-<seed>-<kind>.<ext>`. The run detail page landed in step 26 (`app/(auth)/runs/[id]/page.tsx`) gains two `<a>` buttons that point at these routes — plain HTML anchors, no client-side fetch wrangling, because the browser's native download UX is exactly what researchers want. This step ships no new DB schema, no new simulation code, and no new UI components beyond the two buttons; it is a pure **read-and-serialize** pass on top of the step-08 helpers with the Route Handler as the HTTP adapter. The invariant it establishes: \_after this step lands, any persisted run can be exported to long-format CSV or JSON via a single click on its detail page, and the exported filename carries enough identity (config hash + seed) to reproduce the run on another machine from the paired JSON alone*.

Scope boundary: step 30 does **not** implement sweep exports (deferred per the step-specific context — sweeps aren't persisted in v1, see `docs/plan/28-parameter-sweep.md`), does **not** implement comparison CSV exports (step 29 already ships that as a client-side `Blob` inside the comparison view), does **not** implement public / unauthenticated export URLs (the `app/(public)/` route group is empty in v1 per `CLAUDE.md` "Stack and versions"), does **not** introduce client-side streaming UI progress indicators (native browser download is sufficient for the data volumes in scope), and does **not** touch the `tick_metrics` or `snapshots` schemas. It also does **not** re-validate the stored JSON against the Zod schemas on export — the validation discipline already established in step 08's `loadConfig` (re-parse through `ExperimentConfig.parse`) is what the JSON endpoint reuses, so a schema-drift incident would surface as a 500 with a clear Zod error rather than a silently corrupted export.

## 2. Prerequisites

- Commit marker `step 08: run persistence schema` present in `git log`. Step 08 created the `configs`, `runs`, `tick_metrics`, and `snapshots` tables and the four helper modules under `lib/db/` that this step consumes verbatim. Specifically this step calls:
  - `getRun(id)` from `@/lib/db/runs` to resolve the run row (and discover `configId`, `seed`, `summaryJson`, `status`).
  - `loadConfig(configId)` from `@/lib/db/configs` to pull the config row (for `contentHash`, `contentJson`, and the parsed `ExperimentConfig`).
  - `loadTickMetrics(runId)` from `@/lib/db/tick-metrics` for the CSV body.
  - `loadSnapshots(runId)` from `@/lib/db/snapshots` for the JSON body.
    Step 08's `configs` table already carries a `content_hash` column — the first 8 hex characters of its SHA-256 digest are the `configHash8` this step's filenames embed. Step 30 does **not** re-hash the config on export; it uses what step 08 stored. If the step-08 helper signatures differ from the shape assumed here (e.g. `loadTickMetrics` returns a different row shape, or `loadConfig` does not return `{ row, parsed }`), **honor the existing signatures** and adjust the Route Handlers accordingly — schema stability across steps beats perfect plan-file alignment.

- Commit marker `step 26: run persistence and browser` present in `git log`. Step 26 shipped the `app/(auth)/runs/[id]/page.tsx` detail page that this step modifies by adding the two export buttons. The detail page's Server Component body already loads the run row and the config; this step's UI edit is a small additive block that renders two `<a>` tags pointing at the new API routes. Step 26 also confirmed the run detail page has access to `run.id` and `run.seed`, which is all the buttons need in their `href` — the Route Handler pulls the hash and summary itself.

- Commit marker `step 06: proxy route groups and dal` present in `git log`. Step 06 established `lib/auth/dal.ts` with the `verifySession = cache(async () => { ... })` export. Route Handlers in this step call `verifySession()` as their first line; a missing or expired session cookie causes the DAL's own `redirect('/login')` to throw `NEXT_REDIRECT`, which Next's framework intercepts and serves to the browser. For fetch-based callers (the MCP verification script's `evaluate_script('fetch(...)')` case), `NEXT_REDIRECT` surfaces as a 307 response with a `Location: /login` header; this is the expected 401-equivalent behavior for an API under the v1 auth regime where the whole app is gated. The step-30 Route Handlers do **not** diverge from the DAL pattern — they are not carved out of the auth gate, they do not accept bearer tokens, and they do not short-circuit the `verifySession()` call for any path. Step 06's `(auth)/layout.tsx` wraps **pages**, not API routes, so the layout-level check does not cover `/api/...` paths; the Route Handler's own `verifySession()` call is the sole enforcement point for these endpoints. This is the exact scenario the v16 data-security doc warns about (see research note 2 below), and it is why the Route Handler cannot omit the DAL call.

- Node ≥ 20.9, Next 16.2.2, React 19.2.4, Drizzle ORM (step 02), Tailwind 4 (step 00). **No new runtime dependencies**. The implementation uses only the standard library (`crypto` is already pulled in transitively via step 08's helpers), the Web `ReadableStream` / `TextEncoder` globals (available in Node 20.9+ and fully supported by Next 16's Route Handler runtime), and the drizzle / db helpers already on disk.

## 3. Spec references

- `docs/spec.md` **§4.4 Persistence and export**, specifically **F16 Export**: _"Two export formats are always available: (a) CSV of per-tick metrics for statistical analysis in R/Python, (b) JSON of full agent state at selected snapshots for offline replay or independent verification. Acceptance: Exports work for single runs and for sweep aggregates; the CSV is long-format (one row per tick per metric) for easy ingestion into tidyverse/pandas; file names include the config hash and seed for traceability. Supports: RQ1–RQ5 — enables the research team to do work outside the browser."_ This is the authoritative contract. The "work for single runs and for sweep aggregates" clause is the one this step **scopes down**: single-run export is the primary focus, sweep aggregate export is deferred (see the path-not-taken in §4 and the explicit deferral note in §5). The "long-format CSV" clause is non-negotiable and is why the CSV body emits `(tick, world, metric_name, metric_value)` tuples directly from `tick_metrics` with no pivoting. The "file names include the config hash and seed" clause pins the filename template used by both endpoints.

- `docs/spec.md` **§7.1 Per-tick scalar metrics** — enumerates the metric-name vocabulary that lands in `tick_metrics.metric_name`. The CSV export does not re-enumerate these names; it streams whatever is in the table in sorted order. Any metric the simulation engine emits (scalar or graph, world-scoped or cross-world) becomes a row in the CSV with zero export-side work. This is why the `tick_metrics` long-format choice in step 08 was load-bearing: the export is a straight `SELECT ... ORDER BY tick, world, metric_name` piped into a chunked response with no JSON reshaping on the hot path.

- `docs/spec.md` **§7.2 Per-tick tensor snapshots** — snapshots are sampled at a configurable interval (default every 10 ticks). The JSON export bundles every snapshot row the run has, in `(tick asc, kind asc)` order, with each row's `content_json` parsed back into an object so the exported JSON is human-readable and not a string-of-stringified-strings. If the run has no snapshots (e.g., the worker did not compute them), the `snapshots` array in the export is empty and the JSON is still valid and useful because it carries config + seed + summary.

- `docs/spec.md` **§5.1 US-5**: _"As a researcher, I want to export tick-by-tick metrics as a long-format CSV so I can do statistical analysis in R using tidyverse."_ This is the single user story the CSV endpoint directly satisfies. The long format is specifically called out because it is what `tidyr::pivot_wider(...)` and `pandas.DataFrame.pivot(...)` expect as input — the researcher can pivot to wide format inside their analysis environment but cannot cheaply go the other way if the exporter emits wide.

- `docs/spec.md` **§5.2 US-12**: _"As a collaborator, I want to open a shared JSON config and reproduce a colleague's exact run in my browser, so I can debug disagreements without round-tripping data over email."_ This is the user story the JSON endpoint directly satisfies — the exported JSON carries both the config and the seed, so a collaborator can load it on their machine and reproduce the exact run. The `configHash8` in the filename plus the `seed` in the filename means the file is self-identifying before being opened.

- `CLAUDE.md` **"Export conventions"** section — the living-document section this step populates. It already states: _"Exports stream through API routes (not Server Actions), because Server Actions cannot set Content-Disposition. Route shape: app/api/export/[runId]/route.ts. CSV uses long format: one row per (tick, metric_name, metric_value) triple ... Filenames include the config SHA-256 (first 8 hex) and the seed: msksim-<config-hash>-seed-<seed>-<kind>.csv or .json."_ Step 30 is the step that turns this section into code. The single routing detail where this plan **deviates** from the section's current text: the section sketches `app/api/export/[runId]/route.ts` as one file, but step 30 splits into two files — `app/api/export/[runId]/metrics.csv/route.ts` and `app/api/export/[runId]/snapshot.json/route.ts` — because one Route Handler cannot serve two different URLs, and the `.csv` / `.json` suffixes in the URL path make the routes self-describing (plus they hint the intended file extension to the browser's default Save dialog even without `Content-Disposition`). The §11 CLAUDE.md append refines the section to reflect this two-file split.

- `CLAUDE.md` **"Authentication patterns"** section — _"Every Server Component in app/(auth)/ and every Server Action calls verifySession() directly. Do not rely on the proxy alone — refactoring a Server Action to a different route can silently strip proxy coverage, and POSTing directly to a Server Action URL bypasses the page-level check."_ The same rule applies to Route Handlers: the Route Handlers in this step each start with `await verifySession()` as their first line. The `/api/...` path is not in the proxy's `PUBLIC_PATHS` allowlist (step 06), so the proxy will cookie-check and redirect unauthenticated requests before they reach the handler — but the in-handler `verifySession()` call is the actual security boundary for the reasons CLAUDE.md and the Next 16 data-security doc both spell out. Defense in depth: proxy is a UX optimization, DAL is the gate.

- `CLAUDE.md` **"Database access patterns"** section — step 30 obeys every rule: reads happen through helpers under `lib/db/*`, every file that imports from those helpers begins with `import 'server-only';` transitively (the helpers themselves carry the guard), client components never import from `lib/db/`, the drizzle client is the step-02 singleton. The Route Handler files are server-only by their file type — Turbopack does not bundle `route.ts` into the client bundle — but the step-30 implementing claude still runs a grep verification before commit to confirm no stray `lib/db/` import leaked into `runs-table.tsx` or any other client component touched tangentially.

## 4. Research notes

Minimum requirements met: **3 local Next doc citations, 2 WebFetched external URLs, 1 path not taken, total ≥ 5 citations.**

### Local Next.js 16 documentation

1. **`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`**, the entire file (670 lines). Canonical reference for the Route Handler file convention in Next 16. Load-bearing facts verified by reading the doc at plan-write time:
   - (a) _"Route Handlers allow you to create custom request handlers for a given route using the Web Request and Response APIs."_ The handler exports one async function per HTTP method (`GET`, `POST`, etc.); step 30 only needs `GET` for both endpoints.
   - (b) The `context` parameter carries `params` as a `Promise`, not a bare object: `{ params }: { params: Promise<{ runId: string }> }`. Forgetting the `await` silently yields a Promise-shaped object per `CLAUDE.md` "Known gotchas". Step 30's handlers begin with `const { runId } = await context.params;` after the session check.
   - (c) The `RouteContext<'/api/export/[runId]/metrics.csv'>` helper is generated by `next typegen` and is globally available after that run. The handler signature becomes `export async function GET(req: NextRequest, ctx: RouteContext<'/api/export/[runId]/metrics.csv'>)`. Step 30's implementing claude runs `npx next typegen` after creating the dynamic `[runId]` directory so the helper exists; without typegen, the hand-written `{ params: Promise<{ runId: string }> }` annotation is a perfectly valid fallback and produces identical runtime behavior.
   - (d) The doc's § Streaming example (lines ~400-480) shows the exact pattern step 30 uses for the CSV body: `new ReadableStream({ async pull(controller) { ... controller.enqueue(value); ... controller.close(); } })` wrapped in `return new Response(stream, { headers });`. The example uses `TextEncoder().encode(...)` to convert strings into `Uint8Array` chunks suitable for `controller.enqueue`. Step 30's CSV handler follows this verbatim: one chunk for the header row, then one chunk per batch of N tick_metrics rows (batch size ~1000 for I/O amortization; see §7 slice four for the exact number).
   - (e) The doc's § Cookies and § Headers sections confirm Route Handlers use `await cookies()` from `next/headers` — same async rule as Server Components. Step 30's handlers do not need cookies directly because `verifySession()` reads the cookie itself via the step-04 helpers, but the handler's response headers are set by constructing `new Response(body, { headers: new Headers({ 'Content-Type': '...', 'Content-Disposition': '...' }) })`. The doc's § Headers sub-section explicitly notes _"This `headers` instance is read-only. To set headers, you need to return a new `Response` with new `headers`."_ — which is exactly what the step 30 handlers do.

2. **`node_modules/next/dist/docs/01-app/02-guides/data-security.md`**, the §§ "Data Access Layer", "Server Actions", and the closing audit checklist. Cited in every prior auth-touching step (06, 08, 26) and cited here for the one sentence that is most load-bearing for step 30: _"`proxy.ts` and `route.ts`: Have a lot of power. Spend extra time auditing these using traditional techniques."_ (the exact text grep'd at plan-write time from line 600 of the doc). Route Handlers are listed alongside the proxy as the two surfaces that most easily bypass the page-layout-level auth check. For step 30 this means the Route Handlers **must** call `verifySession()` as their first executable statement, **not** after doing any DB work, **not** after reading `params`, and **not** inside a `try` block that could swallow the `NEXT_REDIRECT` throw. The order is: `const session = await verifySession();` → then `const { runId } = await context.params;` → then `const run = await getRun(runId);`. Deviating from this order is the kind of bug that "looks fine" in a PR review and breaks auth silently. The § Data Access Layer section also recommends the DAL pattern step 06 landed; step 30's handlers consume `verifySession` from `@/lib/auth/dal` exactly as step 26's Server Components do, so the audit surface is uniform across the app.

3. **`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/dynamic-routes.md`**, the full file. Confirms the `[runId]` bracket notation for dynamic segments in route paths under `app/api/`. Load-bearing facts: (a) dynamic segments in Route Handlers work the same way they do in pages — the `[runId]` folder creates a `:runId` parameter in the request URL, and the handler reads it from `await context.params`. (b) Multi-segment paths like `app/api/export/[runId]/metrics.csv/route.ts` work because Next treats the `metrics.csv` folder as a static segment — the dot in `metrics.csv` is a valid folder-name character on every supported OS, and Next's router matches it verbatim. This is what lets the URL `/api/export/<id>/metrics.csv` route to one handler and `/api/export/<id>/snapshot.json` route to another, without any `[kind]` parameter shenanigans. (c) The `generateStaticParams` helper exists for dynamic Route Handlers but is **not** applicable here because export results depend on DB state that can change between builds (and on authenticated user state). Both step 30 handlers are fully dynamic and uncached. The implementing claude adds `export const dynamic = 'force-dynamic';` at the top of each route file as a belt-and-braces signal to the Next router that the handler must re-execute on every request — otherwise Next's default cache heuristics might try to static-serve a stale CSV in development, which would confuse the MCP verification script.

4. **`node_modules/next/dist/docs/01-app/03-api-reference/08-turbopack.md`** — referenced again for the same reason every prior step cites it: Turbopack is the default bundler in Next 16, and the rule _"every file that imports from lib/db/ or lib/auth/ begins with `import 'server-only';` or is itself a server-only file type (route.ts, page.tsx Server Component, 'use server' module)"_ applies to step 30's Route Handlers automatically because `route.ts` under `app/api/` is inherently server-only. Turbopack will not bundle any of `app/api/export/[runId]/metrics.csv/route.ts` into the client bundle even without an explicit `import 'server-only';` line, because the App Router's build graph segregates Route Handlers from client components at the entry-point level. The implementing claude still adds `import 'server-only';` as line 1 of each route file — this is cheap insurance against a future refactor that accidentally imports the route module from a non-route context (e.g., a shared `export const FILENAME_TEMPLATE = ...` constant being pulled out into a library file that gets imported by both the route and a client component). The shared CSV writer utility in `lib/export/csv.ts` (described in §5 below) does carry an `import 'server-only';` guard in its own right because it could in principle be imported from a client component by a confused future contributor, and the guard catches that at build time.

### External WebFetched references

5. **`ReadableStream` — MDN Web Docs**, https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream (WebFetched at plan-write time). Load-bearing facts this step depends on:
   - (a) A `ReadableStream` is constructed via `new ReadableStream({ start(controller) { ... }, pull(controller) { ... }, cancel() { ... } })`. The `start` method is called synchronously at construction and is the right place for one-shot initialization (e.g., enqueue the CSV header row). The `pull` method is called by the consumer when it wants more data — the stream is **backpressure-aware**, meaning if the client is slow to drain the response body, `pull` is not called repeatedly; this keeps memory bounded for a 140k-row export even if the client's network buffer fills up.
   - (b) `controller.enqueue(chunk)` accepts a `Uint8Array` (or a string in "byte-stream" mode, but mixing modes is error-prone; step 30 always encodes strings via `TextEncoder().encode(...)` to `Uint8Array` for consistency).
   - (c) `controller.close()` signals end-of-stream. After `close`, no further `enqueue` calls are permitted and the consumer sees the final chunk. Step 30 calls `close()` from inside `pull` when the underlying DB row iterator is exhausted.
   - (d) Thrown errors inside `pull` are caught by the stream and surface as an error on the consumer side — for a browser download, this manifests as a truncated file. Step 30's implementation wraps the row-emission loop in a try/catch inside `pull` that calls `controller.error(err)` explicitly, which is cleaner than letting the throw propagate because it gives the stream a chance to send a partial error signal.
   - (e) The `Response` constructor accepts a `ReadableStream` as its body argument directly: `new Response(stream, { headers })`. Next 16's Route Handler runtime honors this without any framework-level wrapping. This is the minimal, idiomatic streaming pattern and is what the Next route.md example uses (research note 1 above) — the MDN page and the Next doc converge on the same implementation.
   - Memory-footprint claim verified by the fetch: with the batch-per-pull pattern, peak memory is the batch size (e.g., ~1000 rows × ~80 bytes per row ≈ 80 KB per in-flight batch, plus whatever the drizzle query cursor is holding). For a 140k-row run this is ~0.057% of the naive "buffer the whole CSV as a string" approach (~11 MB for the same data), which is the justification for bothering with the stream at all. The 140k figure is the same one step 08's "Path not taken" analysis used as its sizing target.

6. **RFC 4180 — Common Format and MIME Type for Comma-Separated Values (CSV) Files**, https://www.rfc-editor.org/rfc/rfc4180 (WebFetched at plan-write time). The definitive reference for CSV escaping rules. Load-bearing facts:
   - (a) Fields containing any of `,` (comma), `"` (double quote), or CR/LF (carriage return / line feed) **must** be enclosed in double quotes.
   - (b) Inside a double-quoted field, any literal `"` must be doubled: `"` → `""`. So a field containing `she said "hi"` becomes `"she said ""hi"""` on the wire.
   - (c) Fields that contain none of the special characters may be emitted unquoted (and the RFC allows it — there is no "always quote" requirement). Step 30 chooses to **always quote strings that are user-provided or free-form** (metric names are free-form text per the step-08 schema decision) and to emit numbers and fixed enum values unquoted. This is a valid RFC-4180-compliant choice and makes the escape logic trivial for numeric columns.
   - (d) The record separator is CRLF (`\r\n`), not a bare LF. Most modern CSV parsers accept bare LF too, but RFC 4180 specifies CRLF and R's `readr::read_csv()` and Python's `pandas.read_csv()` both handle either. Step 30 emits CRLF for strict compliance.
   - (e) Header row format is identical to data row format; there is no "header marker" character.
   - (f) The MIME type is `text/csv`, and the RFC recommends `Content-Type: text/csv; charset=utf-8` when the file is UTF-8 encoded. Step 30 emits `text/csv; charset=utf-8` (the `charset` parameter is important because R's `readr` on Windows will guess Latin-1 by default otherwise, and any metric name with a non-ASCII character would be mis-decoded).

   The RFC also specifies that the MIME type can optionally carry a `header=present` parameter (`text/csv; charset=utf-8; header=present`), which some parsers use to skip a header row. Step 30 does **not** emit `header=present` because it adds length without improving interop — R and Python both default to `header=TRUE`/`header=0` semantics and infer from the file. This is a minor choice and is documented here so a future reader does not wonder why it was omitted.

   The field-escape function step 30 ships (`csvEscape(field: string): string`) implements clauses (a) and (b) verbatim. Its unit tests in §9 cover every case the RFC calls out: plain ASCII, comma, quote, CR, LF, CRLF, all-special, empty, and Unicode.

### Path not taken

7. **Server Action returning a `Blob` with `Content-Disposition` headers — rejected.** The tempting symmetry is: step 26 ships Server Actions for `persistCompletedRun` and `deleteRun`, so why not ship `exportRunCsv(id)` and `exportRunJson(id)` as Server Actions too? The `docs/spec.md` F16 mention of downloads plus the Server Action ergonomics (type-safe call from a client component, Next handles the wire transport) make this look cleaner than hand-writing a Route Handler. **Rejected for three concrete reasons**:
   - (a) **Server Actions cannot set arbitrary response headers.** A Server Action's return value is serialized through the RSC wire format and delivered to the calling component as a JavaScript value — it does not become a full HTTP response with controllable headers. There is no hook for setting `Content-Disposition: attachment; filename="..."`, and without that header the browser will not invoke its native download UI. A client-side workaround would be to receive a string / Blob from the Server Action and then `URL.createObjectURL(new Blob([...]))` + `<a href="..." download="...">` on the client — but that round-trips the full payload through the RSC channel, which is not streaming (RSC serialization buffers), and it materializes the whole CSV as a JS string in browser memory. For a 140k-row run that is ~11 MB of string inside the browser process before the download even starts, and the user sees a multi-second freeze while the Server Action promise resolves. Route Handlers stream natively and never materialize the full body on either side.
   - (b) **`CLAUDE.md` "Export conventions" already commits the project to API routes for this exact reason.** The section (cited in §3 above) says _"Exports stream through API routes (not Server Actions), because Server Actions cannot set Content-Disposition."_ That decision was recorded before this step landed precisely to preempt the Server Action temptation. Step 30 honors the section verbatim.
   - (c) **Browser download semantics are simpler with a plain `<a href>`.** A client component that imports a Server Action and calls it imperatively is more code (a `'use client'` wrapper, an `onClick` handler, a pending state, error handling) than a static `<a href="/api/export/abc123/metrics.csv" download>Export CSV</a>`. The anchor tag works with middle-click, context-menu "Save link as...", keyboard navigation, and the browser's built-in download manager. No JS required. This is the right affordance for researchers who may be downloading exports in bulk via scripted browser automation or via plain "right-click → save as" habits.
   - The rejection is recorded here so a future agent revisiting the design does not re-open the debate. The Server Action pattern is correct for mutations (step 26, step 27) and for small return values — it is wrong for streamed file downloads.

### Additional informational citation

8. **`ReadableStream` + Drizzle cursor streaming** — the drizzle docs (https://orm.drizzle.team/docs/select) note that drizzle's `db.select(...)` API returns a Promise<TRow[]> by default, not an async iterator. That means drizzle does not expose a row-at-a-time cursor the way a raw `better-sqlite3` `stmt.iterate()` would. Two implementation paths: (i) call `loadTickMetrics(runId)` once, get the full array, stream it to the response in chunks of N; or (ii) bypass the helper, use the raw better-sqlite3 singleton from `lib/db/client`, and call `stmt.iterate()` for true row-at-a-time streaming. **Step 30 chooses (i) — the full-array-then-chunk path.** Rationale: for v1 the expected tick_metrics row count per run (~140k at the step-08 sizing target) fits comfortably in Node heap (~11 MB of row objects), and calling the existing helper keeps the Route Handler's DB access on the same code path as step 26's detail page — same test coverage, same performance characteristics, same upgrade path. If a future run exceeds ~1M rows (which would be a v2 sizing change), the helper can be refactored to expose an async iterator without changing the Route Handler's chunking logic. The important invariant the chunking provides is that the **network response** is streamed even if the DB read is not — the client sees bytes flowing immediately after the header row, and the Node process does not materialize a multi-MB CSV string in memory (only the row objects and one chunk-worth of encoded bytes). Recording this as an informational note because the chunking vs. row-cursor distinction is subtle and a reviewer asking "why aren't you using `stmt.iterate()`?" deserves a pointer to this rationale.

Total citations: **4 local Next doc references** (route.md, data-security.md, dynamic-routes.md, turbopack.md) + **2 external WebFetched URLs** (MDN ReadableStream, RFC 4180) + **1 path not taken** (Server Action Blob return) + **1 informational note** (drizzle full-array vs. iterator) = **8 citations, quota satisfied with margin**.

## 5. Files to create

All paths relative to the repo root.

### Route Handlers (two new files under `app/api/export/[runId]/`)

- **`app/api/export/[runId]/metrics.csv/route.ts`** — the CSV export endpoint. First line `import 'server-only';`. Next imports: `verifySession` from `@/lib/auth/dal`, `getRun` from `@/lib/db/runs`, `loadConfig` from `@/lib/db/configs`, `loadTickMetrics` from `@/lib/db/tick-metrics`, `csvEscape`, `csvHeaderRow`, `csvRowFromTickMetric`, and `buildExportFilename` from `@/lib/export/csv`, `notFound` from `next/navigation`, and `type { NextRequest }` from `next/server`. Exports:
  - `export const dynamic = 'force-dynamic';` — explicit opt-out of static optimization per research note 3. Without this, Next's default cache heuristics might hand out a stale response in development.
  - `export async function GET(req: NextRequest, context: { params: Promise<{ runId: string }> })` — the handler body. Order of operations is non-negotiable and is dictated by the auth-first rule in research note 2:
    1. `const session = await verifySession();` — first line of the function body, before any other await. If the caller is unauthenticated, `verifySession` throws `NEXT_REDIRECT` and Next's framework handles the rest. `session` is captured but never used further in this handler (the run is not user-scoped in v1 — every authenticated user sees every run per the step-26 decision); the variable binding is defensive for future per-user scoping.
    2. `const { runId } = await context.params;` — unwrap the dynamic segment.
    3. `const run = await getRun(runId);` — DB lookup. If `run == null`, call `notFound()` from `next/navigation`, which throws `NEXT_NOT_FOUND` and Next serves a 404.
    4. `const configResult = await loadConfig(run.configId);` — lookup the config. If `configResult == null` (should not happen per FK cascade, but belt-and-braces), also call `notFound()`.
    5. `const filename = buildExportFilename({ configHash: configResult.row.contentHash, seed: run.seed, kind: 'metrics', extension: 'csv' });` — compute the filename via the shared helper. This produces `msksim-<configHash8>-seed-<seed>-metrics.csv`.
    6. `const rows = await loadTickMetrics(run.id);` — load all tick_metrics rows in their canonical sort order (step 08 guarantees `(tick asc, world asc, metric_name asc)`).
    7. Build the stream: `const encoder = new TextEncoder();` then `const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(encoder.encode(csvHeaderRow())); }, pull(controller) { /* emit next batch */ } });`. The `pull` function walks an index-based cursor into `rows`, encodes a batch of (e.g.) 1000 rows into a single `Uint8Array` via concatenation or `encoder.encode(batchString)`, enqueues it, and calls `controller.close()` once the index reaches `rows.length`. The batch size is exported as a named constant `CSV_STREAM_BATCH_SIZE` from `@/lib/export/csv` for testability and tuning.
    8. Return `new Response(stream, { status: 200, headers: new Headers({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': \`attachment; filename="\${filename}"\`, 'Cache-Control': 'no-store' }) });`. The `Cache-Control: no-store` is a hardening choice: exports should not be cached by any intermediary because they contain research data that may be updated (if a run is ever re-computed with different metrics, which v1 does not support but v2 might).
  - The handler body is ~50 lines including the stream construction. All logic that is not HTTP-adapter-specific (CSV row formatting, escape, header row, filename building, batch size) lives in the shared `lib/export/csv.ts` module so it can be unit-tested without an HTTP context.

- **`app/api/export/[runId]/snapshot.json/route.ts`** — the JSON export endpoint. First line `import 'server-only';`. Imports: `verifySession`, `getRun`, `loadConfig`, `loadSnapshots` from `@/lib/db/snapshots`, `buildExportFilename` from `@/lib/export/csv` (the filename helper lives with the CSV helpers but is format-agnostic — its name is slightly misleading but consolidating it in one place is better than shipping two parallel helpers), `notFound` from `next/navigation`. Exports:
  - `export const dynamic = 'force-dynamic';`.
  - `export async function GET(req: NextRequest, context: { params: Promise<{ runId: string }> })` — body:
    1. `const session = await verifySession();` — same first-line rule.
    2. `const { runId } = await context.params;`.
    3. `const run = await getRun(runId);` — `notFound()` on null.
    4. `const configResult = await loadConfig(run.configId);` — `notFound()` on null.
    5. `const snapshots = await loadSnapshots(run.id);` — array of `Snapshot` rows ordered by tick asc per step 08.
    6. Build the export object:
       ```typescript
       const exportPayload = {
         msksimExportVersion: 1,
         generatedAt: new Date().toISOString(),
         config: configResult.parsed, // already parsed through ExperimentConfig.parse
         configHash: configResult.row.contentHash,
         seed: run.seed,
         run: {
           id: run.id,
           status: run.status,
           tickCount: run.tickCount,
           classification: run.classification,
           startedAt: run.startedAt.toISOString(),
           finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
         },
         summary: run.summaryJson ? JSON.parse(run.summaryJson) : null,
         snapshots: snapshots.map((s) => ({
           tick: s.tick,
           kind: s.kind,
           content: JSON.parse(s.contentJson), // parse so the exported JSON is a nested object, not a string
         })),
       };
       ```
       The `msksimExportVersion: 1` field is a forward-compat marker: if the export format ever changes (e.g., adding a `tickMetrics` inline array in v2), the version bumps and importers can branch on it. The `generatedAt` timestamp is informational.
    7. Build the filename via the shared helper: `const filename = buildExportFilename({ configHash: configResult.row.contentHash, seed: run.seed, kind: 'snapshot', extension: 'json' });`.
    8. Serialize the payload: `const body = JSON.stringify(exportPayload, null, 2);` — pretty-printed with 2-space indent for human readability. The JSON endpoint does **not** stream because (a) the full payload is bounded by the snapshots count (typically ≤ 1000 objects per run at the default sampling interval), (b) `JSON.stringify` with a non-null space argument is not streaming-friendly anyway, and (c) the user story is "collaborator opens the file in a text editor or imports it into their IDE" — pretty-printing is more valuable than streaming for a file that is typically ≤ 1 MB.
    9. Return `new Response(body, { status: 200, headers: new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': \`attachment; filename="\${filename}"\`, 'Cache-Control': 'no-store' }) });`.
  - The handler body is ~40 lines. It does **not** use `ReadableStream` because the response body is already a bounded string.

### Shared export utility

- **`lib/export/csv.ts`** — new file, pure TypeScript, server-only (begins with `import 'server-only';` for the reasons outlined in research note 4). Exports:
  - `export const CSV_STREAM_BATCH_SIZE = 1000;` — the batch size used by the CSV Route Handler's `pull` function. Factored out so the unit tests can also verify batching behavior.
  - `export function csvEscape(field: string | number | null | undefined): string` — the RFC-4180-compliant field escape function. Semantics:
    - If `field` is `null` or `undefined`, return empty string (unquoted empty field).
    - If `field` is a `number`, return `String(field)` unquoted (safe — numbers never contain CSV special characters after `.toString()` for finite values; `NaN` and `Infinity` should not reach this function because the step-26 serializer already skips them, but belt-and-braces the function returns empty string for non-finite numbers rather than letting "NaN" leak into the CSV).
    - If `field` is a `string`: if it contains any of `,`, `"`, `\r`, or `\n`, return `'"' + field.replace(/"/g, '""') + '"'` (wrap in quotes, double any internal quotes). Otherwise return the string unquoted.
  - `export function csvHeaderRow(): string` — returns `'tick,world,metric_name,metric_value\r\n'`. The header is fixed and hardcoded; it matches the long-format schema established in step 08 and the MCP verification script's assertion in §10.
  - `export function csvRowFromTickMetric(row: { tick: number; world: string; metricName: string; metricValue: number }): string` — returns the formatted CSV row for one `TickMetric`, including the trailing CRLF. Body: `\`\${row.tick},\${csvEscape(row.world)},\${csvEscape(row.metricName)},\${row.metricValue}\r\n\``. The `tick`and`metricValue`are numeric and never need escaping; the`world`and`metricName`fields are escaped defensively (in practice`world`is always one of`'world1' | 'world2' | 'both'`and never needs quoting, but running it through`csvEscape` is free and future-proof in case the enum ever grows).
  - `export function csvBatchFromRows(rows: Array<{ tick: number; world: string; metricName: string; metricValue: number }>): string` — concatenates many rows into a single string, used by the Route Handler's `pull` function. Equivalent to `rows.map(csvRowFromTickMetric).join('')`. Factored out for readability.
  - `export function buildExportFilename({ configHash, seed, kind, extension }: { configHash: string; seed: number; kind: 'metrics' | 'snapshot'; extension: 'csv' | 'json' }): string` — returns `\`msksim-\${configHash.slice(0, 8)}-seed-\${seed}-\${kind}.\${extension}\``. The `configHash.slice(0, 8)`is the canonical project-wide truncation — matches the CLAUDE.md "Export conventions" section text verbatim. No input sanitization is needed on`configHash`(it is always a hex string from`crypto.createHash('sha256').digest('hex')`), on `seed`(it is a JS number, stringified to decimal), or on`kind`/`extension` (both are TypeScript literal types). The function is ~5 lines but is shared between both Route Handlers so ownership is explicit.
  - File size: ~80 lines with JSDoc. Server-only because future additions to this module might consume DB types, and because the `import 'server-only'` guard is the cheapest insurance against a stray client-component import.

### Unit test file for the CSV writer

- **`lib/export/csv.test.ts`** — new Vitest suite, colocated with the helper under test per `CLAUDE.md` "Testing conventions". Runs under the default `node` environment. Imports `csvEscape`, `csvHeaderRow`, `csvRowFromTickMetric`, `csvBatchFromRows`, `buildExportFilename`, and `CSV_STREAM_BATCH_SIZE` from `./csv`. Test cases are enumerated in §9 below. File size: ~150 lines.

## 6. Files to modify

- **`app/(auth)/runs/[id]/page.tsx`** — the run detail page shipped by step 26. Add two `<a>` buttons in the page header or toolbar area, next to the existing "Reopen in playground" link. The buttons are plain HTML anchors with `href`, `download`, and Tailwind classes — no `'use client'` needed because there is no event handler. Exact JSX (to be inserted next to the "Reopen in playground" link, preserving the existing layout):

  ```tsx
  <a
    href={`/api/export/${run.id}/metrics.csv`}
    download
    data-testid="export-csv-link"
    className="inline-flex items-center rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
  >
    Export CSV
  </a>
  <a
    href={`/api/export/${run.id}/snapshot.json`}
    download
    data-testid="export-json-link"
    className="inline-flex items-center rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700"
  >
    Export JSON
  </a>
  ```

  The `download` attribute is a hint to the browser to use the filename from `Content-Disposition` and to invoke the download UI rather than navigating to the URL. The `data-testid` attributes are the MCP script's selectors for clicking these buttons in §10. Tailwind classes approximate the button style step 26 used for the "Reopen in playground" link — the implementing claude should mirror whatever classes that link uses for visual consistency, grep-first before editing to confirm the exact palette (the `bg-blue-600` / `bg-green-600` here are placeholders and can be unified if step 26 chose different ones).

  The edit is ~12 lines of new JSX and zero lines of removed code. The existing Server Component body (session check, data loading, dashboard rendering) is untouched.

- **`CLAUDE.md`** — append to the "Export conventions" section. The section's hard cap is 20 lines; the current text (from the living document) is ~8 lines, so there is room for ≤ 10 additional lines. The append is documented in §11 below.

- **`docs/screenshots/step-30-export.png`** — the MCP verification screenshot committed with the step. Written by the MCP script in §10.

**No other files are modified.** In particular: `package.json` is untouched (no new deps), `tsconfig.json` is untouched, `next.config.ts` is untouched, `proxy.ts` is untouched, the `db/schema/*` files are untouched (the export consumes the step-08 schema as-is), `vitest.config.ts` is untouched, no `lib/db/*` helper is modified, no simulation module is touched. The scope is deliberately narrow: two new Route Handlers, one new utility module with its tests, and a two-button UI addition.

## 7. Implementation approach

The work is sliced so each slice compiles and type-checks in isolation, and the UI-facing HTTP path is exercised end-to-end only after all server-side pieces are green. Do the slices in order; each one is independently verifiable.

**Slice one — grep-first audit.** Before writing any new code, the implementing claude runs the equivalent of `grep -rn "buildExportFilename\|csvEscape\|csvHeaderRow\|/api/export/" app/ lib/ docs/` to confirm none of these symbols exist yet (they should not — this is the step that introduces them). Also grep for `loadTickMetrics`, `loadSnapshots`, `getRun`, and `loadConfig` to confirm the step 08 helpers are available at the expected paths. And inspect `app/(auth)/runs/[id]/page.tsx` from step 26 to learn (a) how the existing "Reopen in playground" link is rendered (button style, layout container, where it sits in the component tree), and (b) whether the Server Component already exposes `run.id` and `run.seed` as local variables in the scope where the new buttons will live. Expected: yes, both are available from the `getRun` call result. If step 26 landed differently, adapt the insert location without changing the URL shape or the button text.

**Slice two — the shared CSV writer utility.** Create `lib/export/csv.ts` with `import 'server-only';` on line 1. Declare the `CSV_STREAM_BATCH_SIZE` constant, then the `csvEscape`, `csvHeaderRow`, `csvRowFromTickMetric`, `csvBatchFromRows`, and `buildExportFilename` functions as specified in §5. Add JSDoc comments on each export explaining (a) the RFC 4180 clause it implements, (b) the expected input type, (c) the output invariants. Run `npm run typecheck` — must pass. This slice has no dependencies on the DB, the Next router, or any other step-30 file, so it is the smallest independently-verifiable unit of work.

**Slice three — write the unit tests for the CSV writer.** Create `lib/export/csv.test.ts` with the eleven test cases enumerated in §9. Run `npm test -- csv` (or `npm test -- lib/export`). Every test must pass. The RFC 4180 examples — fields with commas, embedded double quotes, embedded CRLF, empty fields — are the single most important set of tests in this step; if any of them fails, the CSV export is broken and downstream R/Python analysis will see corrupted rows. The round-trip test ("generate a CSV, parse it with a reference parser, deep-equal against the original") uses Node's built-in CSV capability — actually Node has no built-in CSV parser, so the test implements a minimal line-by-line tokenizer inline (or reuses `papaparse` / similar only if it's already installed, which it is not per the step 08 path-not-taken analysis). **Decision**: the test ships an inline ~30-line RFC 4180 parser helper that handles the subset of the grammar the CSV writer emits — this is simpler than adding a dev dependency and is the same approach step 25 took for its JSON round-trip tests (grep to confirm).

**Slice four — the CSV Route Handler.** Create the directory `app/api/export/[runId]/metrics.csv/` (note the dot in the folder name is valid per research note 3, but the implementing claude double-checks by running `mkdir -p app/api/export/\\[runId\\]/metrics.csv` and confirming the folder exists on disk before adding `route.ts`). Then create `route.ts` inside it with `import 'server-only';` on line 1 and the body described in §5. The handler begins with `const session = await verifySession();` per the auth-first rule. The stream construction uses `new ReadableStream<Uint8Array>` with both `start` (enqueues the header row) and `pull` (emits batches of rows). The `pull` method reads from a closure-captured `cursor` variable that starts at 0 and increments by `CSV_STREAM_BATCH_SIZE` on each call:

```typescript
let cursor = 0;
const stream = new ReadableStream<Uint8Array>({
  start(controller) {
    controller.enqueue(encoder.encode(csvHeaderRow()));
  },
  pull(controller) {
    if (cursor >= rows.length) {
      controller.close();
      return;
    }
    const batch = rows.slice(cursor, cursor + CSV_STREAM_BATCH_SIZE);
    cursor += CSV_STREAM_BATCH_SIZE;
    const batchString = csvBatchFromRows(batch);
    controller.enqueue(encoder.encode(batchString));
  },
});
```

The `pull` is called by the consumer each time it wants more data — the stream is backpressure-aware by construction. After the stream is built, return `new Response(stream, { status: 200, headers: ... })`. Run `npx next typegen` to regenerate the `RouteContext` types so the handler's `context` parameter is strongly typed. Run `npm run typecheck` and `npm run build` — the build is load-bearing because Turbopack will error if the route file has a bundling issue (e.g. an accidental client-component import).

**Slice five — the JSON Route Handler.** Create the directory `app/api/export/[runId]/snapshot.json/` and `route.ts` inside it with `import 'server-only';` on line 1 and the body described in §5. The body is linear: session check, params unwrap, DB reads, object construction, `JSON.stringify(payload, null, 2)`, filename build, `new Response(body, { ... })`. No stream, no batching, no generator. Run `npx next typegen` again (it is idempotent and cheap), then `npm run typecheck` and `npm run build`.

**Slice six — add the two buttons to the run detail page.** Open `app/(auth)/runs/[id]/page.tsx`. Locate the existing "Reopen in playground" link. Insert the two new `<a>` elements adjacent to it inside the same layout container (most likely a flex container or grid cell per step 26's design). Use the exact JSX from §6. Run `npm run typecheck` — must pass. Run `npm run lint` — must pass with no new suppression comments. Run `npm run build` — must pass.

**Slice seven — full test + type + lint + build sweep.** Run `npm test` (every test suite, including the new `lib/export/csv.test.ts`), `npm run typecheck`, `npm run lint`, and `npm run build` one after another. All four must exit 0. This is the pre-MCP gate: if any of them fails, fix it before touching the MCP script. The build is especially important because Turbopack bundling errors for Route Handlers (e.g., a stray client-component import leaking drizzle into the client bundle) only surface at build time.

**Slice eight — run the MCP verification script and save the screenshot.** Per `CLAUDE.md` "UI verification harness", `scripts/run-plan.ts` spins up a fresh `next build && next start` on a random port; the step's MCP script reads `MSKSIM_BASE_URL`, clears storage, logs in, creates a small config, runs it to completion in the playground (reusing the step 26 playground auto-save path), navigates to the run detail page, and exercises both export buttons as well as the unauthenticated-access failure case. Full script in §10. Screenshot saved to `docs/screenshots/step-30-export.png`.

**Slice nine — CLAUDE.md update and commit.** Append the ≤ 10 lines to the "Export conventions" section per §11. Run `grep -n "TODO\|FIXME\|XXX" docs/plan/30-*.md` — should be empty. Stage all files, commit with the subject `step 30: export` exactly.

**Key design decisions the implementing claude must not second-guess mid-implementation.** (a) The CSV endpoint streams via `ReadableStream`; the JSON endpoint does not. (b) Both endpoints authenticate via `verifySession()` as the first line of the handler body. (c) The buttons are plain `<a>` tags with `download`, not React event handlers calling Server Actions. (d) The filename format is `msksim-<configHash8>-seed-<seed>-<kind>.<ext>` with exactly 8 hex characters from the SHA-256 hash. (e) The `world` enum values (`world1` / `world2` / `both`) are emitted unquoted in the CSV because they contain no special characters; the escape function is still called for defense-in-depth. (f) Sweep export is deferred to a later phase and is not implemented in this step — document the deferral in the commit body.

## 8. Library choices

**No new runtime dependencies.** Every library this step uses was already installed in an earlier step:

- `next` 16.2.2 — step 00. The `next/server` module (for `NextRequest`), `next/navigation` (for `notFound`, `redirect`), and the Route Handler runtime are all part of the Next package.
- `drizzle-orm` / `better-sqlite3` — step 02, consumed only transitively via the step-08 helpers.
- `@node-rs/argon2` — step 03, used transitively via `verifySession()` for the login session the MCP script establishes.
- Node's built-in `TextEncoder` and `ReadableStream` globals — available in Node 20.9+ (the project's minimum per `CLAUDE.md` "Stack and versions") and in the Next 16 Route Handler runtime. No polyfill needed.
- Vitest — step 00. The new `lib/export/csv.test.ts` runs under the default `node` environment.
- Tailwind 4 — step 00. The two new `<a>` buttons use the same utility classes step 26 used for the "Reopen in playground" link.

The implementing claude verifies via `npm ls next vitest` at execution time that each resolves to exactly one version and the versions match the ones step 00 installed. If any is missing or at an unexpected version, the step stops and surfaces the delta rather than attempting a silent upgrade.

## 9. Unit tests

All tests live in `lib/export/csv.test.ts`. Each test runs under Vitest's default `node` environment and is deterministic.

1. **`csvEscape` leaves plain ASCII unchanged.** Input `'hello'` → output `'hello'`. Input `'metric_name_42'` → output `'metric_name_42'`. Input `''` (empty string) → output `''`. These are the base cases — most metric names in practice hit this branch.

2. **`csvEscape` quotes and escapes fields containing a comma.** Input `'a,b,c'` → output `'"a,b,c"'`. Input `'hello, world'` → output `'"hello, world"'`. RFC 4180 clause (a): comma forces quoting.

3. **`csvEscape` quotes and escapes fields containing a double quote.** Input `'she said "hi"'` → output `'"she said ""hi"""'`. Input `'"leading'` → output `'"""leading"'`. Input `'trailing"'` → output `'"trailing"""'`. RFC 4180 clause (b): internal `"` becomes `""`, and the whole field is quoted.

4. **`csvEscape` quotes fields containing CR, LF, or CRLF.** Input `'line1\nline2'` → output `'"line1\nline2"'`. Input `'line1\rline2'` → output `'"line1\rline2"'`. Input `'line1\r\nline2'` → output `'"line1\r\nline2"'`. RFC 4180 clause (a): any line break character forces quoting. The newlines themselves are **not** escaped to `\\n` — they remain literal bytes inside the quoted field, which is what RFC 4180 specifies and what all modern CSV parsers (tidyverse, pandas, Excel) expect.

5. **`csvEscape` handles numbers by calling `String(n)`.** Input `42` → output `'42'`. Input `3.14` → output `'3.14'`. Input `-0.0` → output `'0'` (JavaScript `String(-0.0)` is `'0'`; this is consistent across Node versions). Input `1e-10` → output `'1e-10'`. No quoting for any number.

6. **`csvEscape` handles null and undefined as empty string.** Input `null` → output `''`. Input `undefined` → output `''`. Per the defensive contract in §5.

7. **`csvEscape` handles non-finite numbers as empty string.** Input `NaN` → output `''`. Input `Infinity` → output `''`. Input `-Infinity` → output `''`. The step-26 serializer already filters these out, but this test covers the defense-in-depth path.

8. **`csvHeaderRow` returns the exact string `'tick,world,metric_name,metric_value\r\n'`.** Byte-exact match. Asserts both the column order (the long-format schema) and the CRLF terminator.

9. **`csvRowFromTickMetric` formats a row with CRLF terminator.** Input `{ tick: 0, world: 'world1', metricName: 'success_rate', metricValue: 0.5 }` → output `'0,world1,success_rate,0.5\r\n'`. Input `{ tick: 100, world: 'both', metricName: 'assimilation_index', metricValue: -0.1234 }` → output `'100,both,assimilation_index,-0.1234\r\n'`. Verifies numeric columns are emitted without quotes, enum-like string columns are unquoted when they contain no special characters, and the CRLF terminator is present.

10. **`csvRowFromTickMetric` escapes metric names containing special characters.** Input `{ tick: 0, world: 'world1', metricName: 'custom,metric', metricValue: 1 }` → output `'0,world1,"custom,metric",1\r\n'`. (In practice no metric name contains a comma in v1, but the step 08 schema uses free-form text for the column, so future metric additions must be safe.)

11. **`csvBatchFromRows` concatenates multiple rows in order.** Build a 3-row input, call `csvBatchFromRows`, and assert the output is exactly `csvRowFromTickMetric(row0) + csvRowFromTickMetric(row1) + csvRowFromTickMetric(row2)`. Verifies there is no extra separator, no missing terminator, no reordering.

12. **`buildExportFilename` produces the canonical filename template.** Inputs `{ configHash: 'abcdef01234567890abcdef0123456789abcdef0123456789abcdef0123456789', seed: 42, kind: 'metrics', extension: 'csv' }` → output `'msksim-abcdef01-seed-42-metrics.csv'`. Inputs `{ configHash: '0000000000000000000000000000000000000000000000000000000000000000', seed: 0, kind: 'snapshot', extension: 'json' }` → output `'msksim-00000000-seed-0-snapshot.json'`. Inputs `{ configHash: 'ff', seed: -1, kind: 'metrics', extension: 'csv' }` → output `'msksim-ff-seed--1-metrics.csv'` (short hash truncation handles hashes shorter than 8 chars gracefully via `slice(0, 8)`; negative seeds are stringified verbatim — this is a safety check, not an expected case, because RNG seeds in the step 09 convention are non-negative integers).

13. **RFC 4180 round-trip integration test.** Build a synthetic array of 5 `TickMetric` rows with deliberately adversarial values: commas in metric names, double quotes in metric names, CRLF in metric names, negative numbers, exponential notation. Call `csvHeaderRow() + csvBatchFromRows(rows)` to produce a full CSV string. Parse it with a minimal inline RFC 4180 tokenizer (implemented in the test file as a ~30-line helper). Assert the parsed rows exactly deep-equal the originals modulo the `tick → string` and `world → string` and `metricName → string` promotions that parsing into strings implies. This test is the single most load-bearing assertion in the step: it proves the writer and any downstream reader agree on the wire format.

All thirteen tests are deterministic, idempotent, and run in well under 1 second combined. They do not touch the DB, do not touch the filesystem, and do not require any Vitest environment beyond the default `node`.

## 10. Acceptance criteria

The step is complete when all of the following are observably true on a clean clone after running the new step:

- `npm run typecheck` exits 0.
- `npm run lint` exits 0.
- `npm test` exits 0. The new `lib/export/csv.test.ts` runs with all thirteen cases green; no regressions in earlier-step tests.
- `npm run build` exits 0. Turbopack bundles the two new Route Handlers without errors and without leaking `lib/db/*` into any client chunk. The implementing claude verifies the absence of leaks by scanning the `.next/static/chunks/` output for any mention of `better-sqlite3` (sanity check; if this appears in a client chunk, the build should already have failed, but the grep is cheap insurance).
- `docs/screenshots/step-30-export.png` exists and is a non-empty PNG showing the run detail page with the two export buttons visible.
- The MCP verification script (below) runs to completion against the `next build && next start` server and exits cleanly. All assertions pass. Console logs contain no errors or hydration warnings (React 19 dev-mode strict-double-invoke warnings are ignored per `CLAUDE.md` "UI verification harness"). Network requests contain no 4xx / 5xx responses (**except** the deliberate logged-out 401/302 check in step 6 below — that one is **expected** to fail-fast and the script asserts on it explicitly rather than treating it as a console/network error).

**MCP verification script (executed by the step's `claude -p` invocation inside `scripts/run-plan.ts`):**

1. Clear storage via `evaluate_script`: `localStorage.clear(); sessionStorage.clear(); document.cookie.split(';').forEach(c => document.cookie = c.trim().split('=')[0] + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/');`.
2. `navigate_page` to `${MSKSIM_BASE_URL}/login`. `fill_form` with `MSKSIM_SEED_USER` / `MSKSIM_SEED_PASS` and submit. Wait for redirect to `/` or `/playground`.
3. Create a small config and run it to completion — reuse the step 26 mechanism:
   - `navigate_page` to `${MSKSIM_BASE_URL}/experiments`. Create a new config named `step-30-smoke` with `tickCount: 100` (minimum the step-25 editor allows), default seed (e.g., `42`), default topology.
   - Click "Run in playground" (or whatever step 25's load-into-playground action is labeled). Wait for initialization.
   - Click "Run to completion" or wait for auto-start. Poll `evaluate_script` reading `data-testid="tick-counter"` until it reaches 100 (timeout 30s).
   - Wait for the step-26 auto-save toast (`data-testid="run-saved-toast"`) to appear. Capture the saved run ID from its `data-run-id` attribute or via a follow-up query.
4. `navigate_page` to `${MSKSIM_BASE_URL}/runs/${capturedRunId}`. Wait for the run detail page to render. Assert `data-testid="run-summary-card"` and `data-testid="metrics-dashboard"` are both present (verifies step 26 still works post-edit). Assert `data-testid="export-csv-link"` and `data-testid="export-json-link"` are both present (verifies the two new buttons landed).
5. **Export CSV round trip.** Call `list_network_requests` once as a baseline to capture the current request count. Click `data-testid="export-csv-link"` via the MCP click tool. Wait briefly (1-2s) for the request to complete. Call `list_network_requests` again and locate the new GET request to `/api/export/${runId}/metrics.csv`. Assert:
   - Response status is `200`.
   - Response header `Content-Type` starts with `text/csv` (exact match `text/csv; charset=utf-8` is ideal but the assertion tolerates any value that `startsWith('text/csv')` for robustness).
   - Response header `Content-Disposition` is `attachment; filename="msksim-<8hex>-seed-<seed>-metrics.csv"`. Assert via regex match: `/^attachment; filename="msksim-[0-9a-f]{8}-seed-\d+-metrics\.csv"$/`.
   - Response body (fetched via `get_network_request` / `mcp__chrome-devtools__get_network_request` if available) starts with the exact header line `tick,world,metric_name,metric_value\r\n`.
   - Response body contains at least 50 newline-terminated data rows after the header (counted via `body.split('\n').length - 2 >= 50`; the `-2` accounts for the header line and the trailing empty line after the final CRLF).
6. **Export JSON round trip.** Click `data-testid="export-json-link"`. Fetch the new request via `list_network_requests` / `get_network_request`. Assert:
   - Response status is `200`.
   - Response header `Content-Type` starts with `application/json`.
   - Response header `Content-Disposition` matches `/^attachment; filename="msksim-[0-9a-f]{8}-seed-\d+-snapshot\.json"$/`.
   - Response body is valid JSON (wrap in `try { JSON.parse(body) } catch { fail }`).
   - Parsed body has the expected top-level keys: `msksimExportVersion`, `generatedAt`, `config`, `configHash`, `seed`, `run`, `summary`, `snapshots`.
   - `parsed.configHash` is a hex string of length ≥ 8.
   - `parsed.seed` matches the seed used for the run.
   - `parsed.config` is an object (not a string — verifies the handler parses `content_json` on the way out).
   - `parsed.snapshots` is an array (may be empty if the run produced no snapshots; the test does not assert on length).
7. **Screenshot.** `take_screenshot` → save to `docs/screenshots/step-30-export.png`. The screenshot should show the run detail page with both export buttons visible and the run metrics dashboard rendered above/below them.
8. **Unauthenticated access is blocked.** Log out via the step 07 logout link (or clear the session cookie via `evaluate_script('document.cookie = "msksim_session=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/"')`). Directly fetch the CSV URL via `evaluate_script`:
   ```javascript
   await fetch('/api/export/<runId>/metrics.csv', { redirect: 'manual' }).then((r) => ({
     status: r.status,
     location: r.headers.get('Location'),
   }));
   ```
   Assert either (a) `status === 401` if the DAL returns a direct 401 (not the current implementation), or more likely (b) `status === 307` with `Location` starting with `/login` — the `NEXT_REDIRECT` thrown by `verifySession` turns into a 307 redirect in the response, and the MCP script handles either outcome. If neither holds (e.g., the response is 200 with CSV body), the step fails — that would indicate the auth gate is broken.
9. `list_console_messages` — assert no entries with level `error`. Filter out React 19 dev-mode warnings per `CLAUDE.md` "UI verification harness".
10. `list_network_requests` — assert no responses with status ≥ 400 **except** the deliberate logged-out 307 from step 8 (whitelisted by URL path and expected status).
11. Exit cleanly.

If any assertion fails, the step fails and the orchestrator surfaces the failure; the implementing claude iterates on the code until the script passes. The screenshot is committed regardless of pass/fail state for debugging, but only a passing script advances the step.

## 11. CLAUDE.md updates

Append to the **"Export conventions"** section. The section's hard cap is 20 lines; the current living text is ~8 lines. This step appends ≤ 10 new lines (total ~18, safely under the cap):

```
- API routes under `app/api/export/[runId]/<kind>.<ext>/route.ts` serve both formats — `.csv/route.ts` for the long-format tick metrics and `.snapshot.json/route.ts` for the bundled snapshot/config/summary JSON. The `.csv` and `.json` segments in the URL path are static folder names, not dynamic params; Next treats the dot as a literal.
- Every export Route Handler starts with `await verifySession()` as its first line — Route Handlers bypass the `(auth)/layout.tsx` check, so the DAL call is the sole auth gate. The v1 regime treats an unauthenticated request as a 307 redirect to `/login`.
- CSV bodies are streamed via `ReadableStream` + `TextEncoder`: header row in `start`, batches of `CSV_STREAM_BATCH_SIZE` (1000) rows in `pull`, `controller.close()` when the cursor is exhausted. Peak memory is one batch's worth of encoded bytes, not the full CSV.
- CSV field escaping follows RFC 4180: any field containing `,`, `"`, `\r`, or `\n` is double-quoted with internal `"` doubled to `""`. Numbers and fixed-enum string values are emitted unquoted. The escape helper lives in `lib/export/csv.ts` with RFC-4180-conformance unit tests.
- JSON bodies are built in one shot via `JSON.stringify(payload, null, 2)` and returned as a string — no streaming, because the bounded snapshot count makes streaming unnecessary and pretty-printing is more valuable than chunked delivery for the collaborator-replay use case.
```

The implementing claude verifies the section remains under its 20-line cap after the append; if not, promote content into a new dedicated section per `CLAUDE.md` "Living-document rules" rather than truncating existing bullets.

No other CLAUDE.md sections are touched in this step.

## 12. Commit message

Exactly:

```
step 30: export
```

No conventional-commit prefix, no emoji, no trailing period. The `step 30:` marker is load-bearing for `scripts/run-plan.ts` progress detection per `CLAUDE.md` "Commit-message convention". One commit for the whole step; if `claude -p` produces intermediate commits during implementation they are squashed by the orchestrator before advancing to step 31.

The commit body (optional but recommended) lists:

- The two new Route Handlers (`metrics.csv/route.ts` and `snapshot.json/route.ts`) under `app/api/export/[runId]/`.
- The new shared utility module `lib/export/csv.ts` with the RFC 4180 escape helpers and the filename builder.
- The new unit test file `lib/export/csv.test.ts` with thirteen test cases covering every escape edge case from the RFC.
- The two `<a>` button additions to `app/(auth)/runs/[id]/page.tsx`.
- The CLAUDE.md append to the "Export conventions" section.
- The explicit deferral of sweep exports (out of v1 scope per the step-specific context — sweeps are not persisted in v1).
- Confirmation that no new packages were added.
- The committed screenshot `docs/screenshots/step-30-export.png`.

## 13. Rollback notes

If this step lands in a bad state and needs to be undone (destructive — requires user confirmation per `CLAUDE.md` commit-safety rules):

1. `git log --oneline` to find the commit SHA immediately prior to `step 30: export` (expected to be the step 29 commit, found via `git log --grep='^step 29:'`).
2. `git reset --hard <prior-sha>` — single-move rollback. This removes every file created in §5 and every modification listed in §6 in one operation, including the CLAUDE.md append, the committed screenshot, and the two buttons added to the run detail page.
3. Run `npm install` to reconcile `node_modules/` — no-op for step 30 (no packages added), but defensive.
4. Run `npm run typecheck`, `npm test`, and `npm run build` to confirm the working tree is clean and the step 00-29 suites still pass. The step 26 run detail page should render without the two export buttons (just the "Reopen in playground" link).
5. Re-run `npx tsx scripts/run-plan.ts --only 30` once the underlying issue is fixed to redo the step from a clean base.

After rollback the repository is byte-identical to the step 29 tip. Step 30 is purely additive on top of the step-08 schema, the step-06 DAL, and the step-26 run detail page; rolling it back does not force rolling back any completed earlier step. Any step in the 31-32 range that has already landed and depends on the `/api/export/[runId]/...` routes (none expected as of plan-write time — step 31 is hypothesis presets, step 32 is polish and e2e smoke, neither consumes export URLs in its documented scope) would need to be revisited, but this is unlikely. In the unlikely case that step 32's end-to-end smoke test exercises the export URLs, rolling back step 30 while step 32 is live would break the smoke test; in that case prefer a forward-fix commit over rollback.
