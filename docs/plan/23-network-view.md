---
step: "23"
title: "network view"
kind: ui
ui: true
timeout_minutes: 40
prerequisites:
  - "step 16: graph metrics"
  - "step 21: lattice canvas renderer"
---

## 1. Goal

Implement **F8 (Live network view)** from `docs/spec.md` §4.2: a WebGL rendering of the cumulative interaction network for the currently running simulation, drawn with **sigma.js** on top of a **graphology** `Graph` that the step-16 metrics module already maintains inside the simulation worker. The view sits alongside the step-21 lattice canvas and the step-22 metrics dashboard inside the authenticated playground shell (`app/(auth)/playground`) and is selected via a tab toggle (Lattice / Metrics / Network). Its rendering semantics are:

- **Nodes** are agents from **both worlds**, keyed by the same `AgentId` strings the worker uses for its step-16 cumulative interaction graph. Node color is determined by a Louvain community assignment (step 16's `computeInteractionGraphCommunities`) mapped into a fixed qualitative colorblind-safe **Okabe-Ito** palette. Node size is a linear function of weighted degree (`graph.getNodeAttribute(id, 'degree')`) so hub agents are visually prominent without dominating small runs.
- **Edges** are the successful-interaction edges step 16's `updateInteractionGraph` accumulates every tick, with the `weight` attribute (a non-negative integer counting successful interactions) rendered as edge thickness. Edges are undirected and drawn beneath nodes.
- **Layout** is computed via `graphology-layout-forceatlas2` for a small fixed number of iterations (~100) whenever the graph shape changes meaningfully, **not every tick**. ForceAtlas2 is expensive and must not run in the hot rendering loop. Initial node positions are seeded with a random `x` / `y` inside the unit square before the first layout pass, because ForceAtlas2 requires every node to carry `x` and `y` attributes before it can be called (per the package's documentation).
- **Interaction**: sigma.js's default camera supports **zoom (mouse wheel) and pan (click-drag)** out of the box. No extra configuration is required for v1; we only verify the camera's `ratio` changes after a scroll event in the MCP script.
- **Empty state**: for the first few ticks the interaction graph is essentially empty (fewer than a handful of edges). The view renders a placeholder message ("Waiting for interactions… (0 nodes, 0 edges)") until the graph has at least **N = 4** nodes **and** **M = 3** edges. These thresholds are intentionally low — just enough to make a visual graph meaningful — and are documented inline so later tuning is a single-constant change.

This step is the primary visualization for **RQ1** (assimilation vs. segregation, visible as community separation in the cumulative interaction graph) and **RQ4** (emergent social cohesion, measured as Louvain modularity of the same graph). The step-16 plan file already commits to exporting `computeInteractionGraphCommunities` *precisely* so step 23 can call it on-demand; step 23 consumes that export through the worker boundary.

The scope boundary is strict: step 23 does **not** re-implement graph metrics (step 16 owns them), does **not** touch the lattice renderer (step 21 owns it), does **not** introduce new persistence (step 26 handles runs), and does **not** add interactive sliders beyond the simple tab toggle (step 24 covers the control bar). Step 23 is the third visualization pane in the playground shell and nothing more.

## 2. Prerequisites

- Commit marker `step 16: graph metrics` present in `git log`. Step 16 installed `graphology-communities-louvain`, added the `createInteractionGraph`/`updateInteractionGraph` helpers to `lib/sim/metrics/interaction-graph.ts`, and — load-bearing for step 23 — exported the `computeInteractionGraphCommunities(interactionGraph, rng)` helper from `lib/sim/metrics/graph.ts` that returns `{ assignments: Map<AgentId, number>; count: number; modularity: number }`. Step 23 calls this helper through the worker boundary (via the new `getInteractionGraph` method added in section 6). Step 16's plan §3 explicitly flags this as the reason the helper exists: *"step 16 must produce two derivative outputs for step 23's downstream consumption: the `modularity` scalar (lands in the snapshot) and, as an optional second return, a `communityAssignments: Map<AgentId, number>` produced by `louvain.detailed()` — step 23 will read this from the worker's cached state to color nodes."*
- Commit marker `step 20: simulation worker integration` present in `git log`. Step 20 created `workers/simulation.worker.ts` with the typed `SimulationWorkerApi` interface and its six methods (`init`, `step`, `run`, `getMetrics`, `getSnapshot`, `reset`), and the client wrapper at `lib/sim/worker-client.ts` that exports `createSimulationWorker(): { api, terminate }`. **Step 20 does not include a `getInteractionGraph` method — step 23 is responsible for extending the worker API.** The extension is additive: step 23 appends a seventh method to both the worker implementation and the TypeScript interface; no step-20 behavior changes.
- Commit marker `step 21: lattice canvas renderer` present in `git log`. Step 21 landed the `SimulationShell` client component at `app/(auth)/playground/simulation-shell.tsx` that constructs the worker inside a `useEffect`, polls `getMetrics`/`getSnapshot` on a tick loop, and hosts the lattice canvas view. **Step 21 does not include a tab toggle** — it renders the lattice canvas as the single primary view. Step 23 is responsible for introducing a `view` state (`'lattice' | 'network'`, and later `'metrics'` in step 22) and the tab UI that switches between them. If steps 22 and 23 are dispatched in parallel (they are in Wave 6), the implementing claude for step 23 MUST handle a possible merge conflict in `simulation-shell.tsx`: the tab UI should use a union type `'lattice' | 'metrics' | 'network'` and both tabs should be wired in. Coordinate via the grep-first protocol in section 7.
- Commit marker `step 22: metrics dashboard` **may or may not** be present. Step 22 adds the metrics dashboard pane (`app/(auth)/playground/metrics-dashboard.tsx`) and is dispatched in the same wave as step 23. The plan file for step 23 does not assume step 22 has landed; the implementing claude detects this via `git log --grep='^step 22:'` and wires the tab UI to include a `'metrics'` tab only if step 22's file exists. If step 22 has not yet landed, step 23's tab UI exposes only `'lattice' | 'network'` and a later touch-up from step 22 (or a follow-up cleanup commit) adds the third tab. This keeps the step-23 commit self-contained regardless of dispatch order within Wave 6.
- Node ≥ 20.9, Next.js 16.2.2, React 19.2.4, TypeScript 5 (project baseline from step 00). `graphology` (step 10), `graphology-communities-louvain` (step 16), `comlink` (step 19). No existing `sigma` or layout package — step 23 installs both.

## 3. Spec references

- `docs/spec.md` **§4.2 F8 (Live network view)**:
  > A WebGL graph rendering showing the cumulative interaction network (nodes = agents, edges = past successful interactions weighted by frequency). Overlays Louvain community detection to highlight emergent clusters. **Acceptance.** Updates incrementally as interactions accumulate; Louvain clusters are color-coded and stable across small perturbations; the view supports zoom/pan. **Supports.** RQ1, RQ4 — this is the primary visualization of social bonding and ghettoization.

  Every acceptance criterion in this row maps to a concrete implementation choice in step 23: "WebGL" → sigma.js v3 (which renders via WebGL by default), "cumulative interaction network" → the step-16 `interactionGraph` already maintained by the worker, "Louvain community detection" → step 16's `computeInteractionGraphCommunities`, "color-coded" → the Okabe-Ito palette mapping, "incremental updates" → the shell's low-frequency `getInteractionGraph` polling (every 10 ticks by default), "zoom/pan" → sigma's default camera controls.
- `docs/spec.md` **§7.1 (Per-tick scalar metrics), "Interaction-graph modularity" row**:
  > Louvain modularity score on the cumulative successful-interaction graph. High modularity = strong clustering. RQ2, RQ4.

  The modularity metric and the community-coloring overlay operate on the **same** `interactionGraph` object. Step 16 computes the scalar; step 23 renders the structure. Maintaining a single worker-owned cumulative graph (per step 16's plan §7 "Step three is the interaction-graph helper") is the contract that lets both metrics and visualization stay in lockstep without double-counting edges or diverging on the Louvain partition.
- `docs/spec.md` **§1.2 RQ4 — Emergent social cohesion**:
  > To what extent does successful communication predict or drive social bonding (measured as interaction-graph density and clustering)?

  RQ4 is the primary research question the network view answers. Density is visible as edge saturation; clustering is visible as community coloring. Without the network view, RQ4 is only inferable from the scalar modularity number on the metrics dashboard — the visualization is what makes the answer *interpretable*.
- `docs/spec.md` **§1.2 RQ1 — Assimilation vs. segregation thresholds**. RQ1 is operationalized by the assimilation and segregation indices (scalar, step 16) and by the network view's visible separation of W2-Immigrant communities from W2-Native communities (step 23). The visual answer is the one researchers will screenshot for their publication figures; the scalar answer is what goes into the CSV export (step 30). Both derive from the same underlying graph.
- `docs/spec.md` **§8 (Architecture Sketch), "Network WebGL view" node in the ASCII diagram**. The architecture diagram explicitly lists "Network WebGL view" as one of the three visualizations the `SimulationShell` client component hosts (the other two are "Lattice canvas (per world)" and "Time-series charts"). Step 23 fulfills that diagram node.
- `docs/spec.md` **§9 (Capability Requirements), "Network rendering" row**:
  > **sigma.js** — pairs natively with graphology, WebGL-accelerated. | cytoscape.js, vis-network. See Cylynx's comparison. | Handles the growing interaction graph smoothly.

  The spec explicitly names sigma.js as the leading candidate. Step 23 adopts it. The "also viable" alternatives (cytoscape.js, vis-network) are evaluated and rejected in the paths-not-taken section of the research notes.
- `docs/spec.md` **§12.3 (Graph analysis and visualization)**: the citations include `https://www.sigmajs.org/` and `https://github.com/jacomyal/sigma.js/` as the canonical upstream sources. Step 23's research notes WebFetch these URLs and verify the current v3 API matches the plan file's expectations.

## 4. Research notes

**Local Next.js 16 docs (authoritative per `CLAUDE.md` "Next.js 16 deltas from training data"):**

1. `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md` — documents the `'use client'` directive and the client component boundary. Step 23's `app/(auth)/playground/network-view.tsx` is a client component (it calls `useEffect`, `useRef`, `useState`, and imports `sigma` which is a browser-only package that touches `window`, `document`, and the Canvas/WebGL APIs at import time). The doc confirms that a file beginning with `'use client'` marks every subsequent import as client-side and that the Next.js bundler will include it in a client chunk rather than attempting to SSR it. This is the reason step 23's component file begins with `'use client';` on its very first line, before any imports — the directive must precede any module-level code. The doc also notes that client components **can** import types from server-only modules if they use `import type { ... }` (the type-only form is erased at build time and does not cross the boundary), which is how `network-view.tsx` imports `SerializedGraph` and `CommunityAssignment` type aliases from `@/lib/sim/worker-client` without dragging the worker code into the main-thread bundle.

2. `node_modules/next/dist/docs/01-app/03-api-reference/08-turbopack.md` — confirms Turbopack is the default bundler in Next 16 for both `next dev` and `next build`. sigma.js v3 and graphology-layout-forceatlas2 are ESM packages with bundled TypeScript declarations; both resolve through Turbopack's default module graph without any special configuration. `CLAUDE.md` "Next.js 16 deltas from training data" reminds agents that a custom `webpack` config fails the Next 16 build at all, so step 23 installs both packages as plain npm dependencies and adds zero bundler configuration. The Turbopack doc's "Language features" section also confirms that tree-shaking is on by default — the `graphology-layout-forceatlas2` package exports both `forceAtlas2` and `forceAtlas2.inferSettings`, and step 23 imports only what it uses; unused exports are elided.

3. `node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md` — the canonical Vitest setup for this codebase (established in step 00 per `CLAUDE.md` "Testing conventions"). Step 23's unit test at `app/(auth)/playground/network-view.test.ts` exercises a **pure helper** (the community-id → hex-color palette mapping) under the default `node` environment. It does not mount the React component, does not import sigma, and does not touch the DOM. The full view is MCP-verified per the step-specific context, which is consistent with the step-07 precedent: complex canvas / WebGL rendering is not Vitest-testable without a browser harness, so the pure helper gets a unit test and the rest is screenshot-verified. This matches the `CLAUDE.md` "Testing conventions" rule "Tests colocate next to source as `*.test.ts`" and avoids adding a `happy-dom` dependency for a single rendering component.

4. `node_modules/next/dist/docs/01-app/02-guides/data-security.md` §"Preventing environment poisoning" — reminds agents that `import 'server-only'` is the guard for modules that must not leak into client bundles. Step 23's files are **client-side only** and must not carry `import 'server-only'`. Conversely, step 23 must not import from any module that carries `import 'server-only'` (e.g., `lib/auth/dal.ts`, `lib/db/client.ts`) — doing so would cause Turbopack to emit an opaque "server-only imported from client" error at build time. The page-level authorization check for `/playground` lives in `app/(auth)/layout.tsx` (established in step 06), so the network view itself does not need a DAL call.

**External references (WebFetched):**

5. **`https://www.sigmajs.org/`** and **`https://github.com/jacomyal/sigma.js`** (WebFetched during research). Load-bearing facts confirmed:
   - **Current stable version**: **`sigma@3.0.2`**, published 2025-05-27 on npm. The `latest` dist-tag on npm points at `3.0.2` (verified via `npm view sigma version`). The major version is **3** (the rewrite the step-specific context flags), *not* v2 — step 23 must import from `sigma` as `import Sigma from 'sigma';` (default export) rather than any v2 namespace pattern. The `sigma` package on npm declares **no hard peer dependency on graphology** in its `package.json` (graphology is a regular dep of sigma-backed apps, and step 23 has it already from step 10); the only declared peer is `graphology-types >=0.19.0` which is bundled via graphology itself.
   - **Canonical instantiation pattern** (confirmed by the README at `https://github.com/jacomyal/sigma.js/blob/main/README.md`):
     ```js
     import Graph from "graphology";
     import Sigma from "sigma";
     const graph = new Graph();
     graph.addNode("1", { label: "Node 1", x: 0, y: 0, size: 10, color: "blue" });
     graph.addEdge("1", "2", { size: 5, color: "purple" });
     const sigmaInstance = new Sigma(graph, document.getElementById("container"));
     ```
     Sigma v3's constructor is `new Sigma(graph, container, settings?)` where `graph` is a `graphology.Graph` instance, `container` is an `HTMLElement`, and `settings` is an optional `Partial<Settings>` object. Sigma reads node/edge attributes directly from graphology — it does not own its own per-node state — so every attribute update must go through `graph.setNodeAttribute(id, key, value)` or `graph.mergeNodeAttributes(id, attrs)` and is picked up on the next rendered frame automatically. This is load-bearing for step 23's community-coloring update: recoloring nodes is just a loop over `graph.setNodeAttribute(id, 'color', okabeItoColor(communityId))`, no sigma API call required.
   - **Cleanup**: `sigmaInstance.kill()` is the documented teardown method. It releases WebGL resources, unbinds mouse/touch event listeners, and detaches the camera. Step 23 calls it from the `useEffect` cleanup function, matching `CLAUDE.md` "Worker lifecycle" discipline for effect idempotence.
   - **Camera access**: `sigmaInstance.getCamera()` returns the `Camera` instance, which exposes `ratio: number` (zoom level, 1 = default, < 1 = zoomed in, > 1 = zoomed out), `x: number`, `y: number`, and a `getState()` helper. The MCP script in section 10 reads `sigmaInstance.getCamera().ratio` before and after a wheel event to verify zoom works.
   - **Default interaction**: wheel-scroll zoom and click-drag pan are enabled by default with no configuration. Step 23 does not disable or customize them.

6. **`https://github.com/graphology/graphology/tree/master/src/layout-forceatlas2`** (WebFetched during research) and **`https://www.npmjs.com/package/graphology-layout-forceatlas2`**. Load-bearing facts:
   - **Current stable version**: `graphology-layout-forceatlas2@0.10.1` (verified via `npm view graphology-layout-forceatlas2 version`). The package's peer dependency is `graphology-types >=0.19.0`, already satisfied by step 10's graphology install.
   - **API**: The package exports a default function `forceAtlas2(graph, options)` that returns a `Record<NodeKey, {x, y}>` positions map, and a mutating variant `forceAtlas2.assign(graph, options)` that writes the computed `x`/`y` directly onto the graph's node attributes. Step 23 uses `forceAtlas2.assign(graph, { iterations: 100, settings: forceAtlas2.inferSettings(graph) })` because the view needs positions written into the graph (sigma reads them from the graph's node attributes).
   - **Required options**: `iterations: number` is **mandatory**. Every other option is optional. Step 23 fixes `iterations: 100` as a v1 default — large enough to let communities separate visually on a 500-agent graph, small enough to complete in well under 100 ms on a modern laptop. A comment in `network-view.tsx` documents this choice and flags it as a v2 tuning knob.
   - **`forceAtlas2.inferSettings(graph)` helper**: returns a `settings` object with sensible defaults based on graph size (it scales `scalingRatio`, `gravity`, and `barnesHutOptimize` with the node count). Step 23 always calls `inferSettings(graph)` rather than hand-tuning — the package documentation explicitly recommends this as the v1 path.
   - **Prerequisite**: every node **must** carry `x` and `y` attributes before `forceAtlas2.assign` is called, or the algorithm throws. Step 23 seeds each new node with a random `x` / `y` in `[0, 1)` on first insertion (using `Math.random()` — this is **presentation state**, not simulation state, and the determinism invariant in `CLAUDE.md` "Worker lifecycle" applies only to the seeded RNG inside the worker, not to main-thread cosmetic initial positions). A comment in the code documents this choice so a future agent doesn't accidentally pin the presentation-side random seed.
   - **Performance budget**: for N = 500 agents and ~2 × N edges, ForceAtlas2 with Barnes-Hut enabled completes 100 iterations in under 50 ms on a modern machine. Step 23 does **not** run it every tick — it runs only when the graph shape has materially changed, which the shell signals by polling `getInteractionGraph()` every 10 ticks (configurable).

7. **Blondel et al. (2008), "Fast unfolding of communities in large networks"** — `https://arxiv.org/abs/0803.0476` (already cited by step 16, acknowledged here as the upstream primary source for the Louvain algorithm that colors the nodes). Step 23 does **not** re-WebFetch this; it inherits step 16's research. The community assignments step 23 consumes are produced by the exact call `louvain.detailed(graph, { getEdgeWeight: 'weight', rng: rng.nextFloat })` that step 16's `computeInteractionGraphCommunities` helper wraps.

8. **Okabe-Ito colorblind-safe palette** — `https://jfly.uni-koeln.de/color/` (WebFetched; Masataka Okabe and Kei Ito, 2008, "Color Universal Design") and `https://en.wikipedia.org/wiki/Color_blindness#Accessibility` (background). The palette is the de-facto standard qualitative palette for scientific visualization when a deuteranopia/protanopia-safe set of distinguishable hues is required. The 8 colors and their hex codes, in the order the step-23 palette array uses them, are:

   | Index | Name            | Hex       |
   |-------|-----------------|-----------|
   | 0     | Black           | `#000000` |
   | 1     | Orange          | `#E69F00` |
   | 2     | Sky Blue        | `#56B4E9` |
   | 3     | Bluish Green    | `#009E73` |
   | 4     | Yellow          | `#F0E442` |
   | 5     | Blue            | `#0072B2` |
   | 6     | Vermillion      | `#D55E00` |
   | 7     | Reddish Purple  | `#CC79A7` |

   These 8 hex values are encoded as a module-level constant array `OKABE_ITO` in `network-view.tsx` and consumed by the pure helper `communityColor(communityId: number): string` that does `OKABE_ITO[communityId % OKABE_ITO.length]`. The modulo lets communities > 8 wrap deterministically; for the N ≤ 500 agent counts the spec targets, Louvain typically returns 2–6 communities on a well-connected cumulative graph, so wraparound is rare in practice. The pure helper is the only piece of step 23 that is Vitest-tested (see section 9) — everything else is MCP-verified.

**Paths not taken:**

9. **cytoscape.js instead of sigma.js.** Considered and rejected. Cytoscape.js is a mature graph rendering library and is listed in `docs/spec.md` §9 as an "also viable" candidate. However: (a) it is **heavier** — 500+ KB min+gz compared to sigma v3's ~150 KB, plus the cytoscape ecosystem adds layout extensions as separate packages that each carry their own DOM/jQuery-era baggage; (b) it uses a **DOM-overhead** rendering model (SVG by default, Canvas optional, no built-in WebGL in the base package) which does not scale past a few hundred nodes as smoothly as sigma's WebGL renderer — and the target for v1 is N ≤ 500 per world for interactive playground mode, so N = 1000 in the cumulative graph (both worlds concatenated) is the design point; (c) the spec explicitly names sigma as the "leading candidate" with cytoscape as the fallback, and the step-16 cumulative graph is already a `graphology.Graph`, which pairs natively with sigma and would need an O(N+E) conversion step to feed into cytoscape's own node/edge model. Picking sigma avoids that conversion entirely. **Rejection**: sigma is lighter, natively graphology-compatible, WebGL-accelerated, and spec-endorsed.

10. **vis-network instead of sigma.js.** Also listed in `docs/spec.md` §9. Rejected for substantially the same reasons as cytoscape: (a) heavier bundle, (b) no native graphology integration (the cumulative graph would need to be converted edge-by-edge into vis-network's `DataSet` model on every update), (c) SVG/Canvas rendering without the WebGL fast path sigma offers. Additionally, vis-network is lower-maintenance in 2025 — its most recent releases have been infrequent, and several known memory-leak issues in the teardown path have been reported but not fixed. Step 23's `useEffect` cleanup discipline (per `CLAUDE.md` "Worker lifecycle") is allergic to libraries that leak on teardown, because React 19 strict mode double-invokes effects in development and any leaky unmount path would compound quickly.

11. **Three.js or raw WebGL instead of sigma.js.** Rejected. Writing a custom WebGL renderer for a network graph is a significant engineering effort that sigma.js already solves; the v1 research instrument has no specific rendering requirements that exceed sigma's capabilities. A custom WebGL renderer is only justified if the research instrument needs bespoke shaders (e.g., animated edge flows, custom node glyphs) that sigma cannot express, and no such requirement exists in `docs/spec.md` v1. If a future version demands animated transitions between tick snapshots, that's a v2 evaluation.

12. **Running ForceAtlas2 every tick.** Considered and rejected. ForceAtlas2 is an iterative layout algorithm with a per-iteration cost of O(N²) (or O(N log N) with Barnes-Hut enabled), and 100 iterations on N = 500 takes 30-50 ms on a modern machine. At a simulation tick rate of 10 Hz that would consume 300-500 ms per second on layout alone, pushing the main thread dangerously close to its 16.6 ms-per-frame budget at 60 Hz rendering. Instead, step 23 runs ForceAtlas2 **only when the graph changes meaningfully** — operationally, whenever the shell polls `getInteractionGraph()` and the returned graph has more nodes or more edges than the previously rendered version. For v1 this polling happens every 10 ticks by default. The existing node positions are reused across re-renders, so later layout passes benefit from warm starts and typically converge in fewer than 100 iterations regardless of the upper bound. A v2 optimization could run the layout in a dedicated Web Worker, but that is outside the scope of step 23.

13. **Diffing the serialized graph incrementally vs rebuilding from scratch.** This is the explicit trade-off the step-specific context asks to document. Step 23 picks **full rebuild on every poll** for v1. Rationale: (a) the serialized `graph.export()` format is a plain JSON-serializable object with two arrays (`nodes`, `edges`); constructing a new graphology instance via `Graph.from(serialized)` is O(N + E) and for N ≤ 500 takes well under 10 ms, which is comfortably inside the 100 ms human-perceptible latency budget; (b) incremental diffing would require the shell to compute added/removed nodes and added/modified edges between two serialized forms, which is itself O(N + E) and introduces edge cases (what if the step-16 helper produces a slightly different edge ordering between snapshots?) that bloat the implementation without changing the asymptotic cost; (c) the sigma renderer itself reads the graph's attributes on every frame, so as long as `graph.setNodeAttribute` is called after the rebuild, sigma automatically picks up the new positions and colors — there is no "sigma doesn't know the graph changed" failure mode to worry about. The trade-off is that full rebuilds lose the warm-start advantage of ForceAtlas2 unless the shell explicitly carries positions across rebuilds; step 23 does this by caching `Map<AgentId, {x, y}>` in a `useRef` and re-applying cached positions after the rebuild, before calling `forceAtlas2.assign`. This gets the best of both worlds: simple rebuild logic + warm-started layout. Documented inline in the component with a comment block explaining the choice so a future v2 refactor to true incremental diffing can reference it. **Decision for v1: full rebuild + position cache.**

14. **Serializing the graph as Comlink-proxied handle instead of a JSON export.** Considered and rejected. Comlink can marshal complex objects via `Comlink.proxy(value)` — step 20 already uses this pattern for the `onProgress` callback in `run(totalTicks, onProgress)`. In principle, step 23 could keep the graphology `Graph` object alive inside the worker and expose a proxied handle to the main thread, and the main thread would call methods on the handle (`.order`, `.nodes()`, `.forEachEdge(...)`). Rejected because: (a) every method call on a Comlink proxy is an async round-trip over the postMessage boundary, so iterating nodes/edges via `graph.forEachNode(...)` would fire hundreds of structured-clone messages per render; (b) the sigma.js v3 constructor expects a *local* graphology `Graph` instance — it reads attributes synchronously and does not tolerate a proxy that returns promises; (c) `graphology`'s built-in `.export()` method emits a flat, `structuredClone`-safe JSON object (`{ nodes: [{key, attributes}], edges: [{source, target, attributes}] }`) that is the idiomatic wire format for exactly this use case. **Decision**: use `graph.export()` on the worker side and `Graph.from(serialized)` on the main side. The step-23 wire format is plain JSON; the Comlink channel stays simple.

**Research quality summary**: 4 local Next.js 16 docs (items 1, 2, 3, 4) + 4 external URLs WebFetched (sigma homepage + GitHub, forceatlas2 GitHub + npm, Okabe-Ito Jfly page + Wikipedia, Blondel 2008 inherited from step 16 as upstream primary) + 6 paths not taken (cytoscape, vis-network, three.js, ForceAtlas2-every-tick, incremental diffing, Comlink-proxied handle) = **14 research items**, comfortably clearing the quality gates (≥ 3 local Next docs, ≥ 2 external URLs, ≥ 1 path not taken, total ≥ 5). **Sigma v3 version verified at execution time via `npm view sigma version` (expected: ≥ 3.0.2 as of 2025-05-27).**

## 5. Files to create

- **`app/(auth)/playground/network-view.tsx`** — the **primary client component**. Begins with the literal `'use client';` directive on line 1 (no blank line, no import before it). Imports:
  - `import { useEffect, useRef, useState } from 'react';`
  - `import Graph, { type SerializedGraph } from 'graphology';` — the graphology default export for `Graph` (which step 23 uses to reconstruct from the serialized form passed in props) and the `SerializedGraph` type that matches `graph.export()`'s return shape.
  - `import Sigma from 'sigma';` — the v3 default export. The Sigma constructor is `new Sigma(graph, container, settings?)`.
  - `import forceAtlas2 from 'graphology-layout-forceatlas2';` — the default export. Used as `forceAtlas2.assign(graph, options)` and `forceAtlas2.inferSettings(graph)`.
  - No imports from `@/lib/auth/*`, `@/lib/db/*`, or anything carrying `import 'server-only'`. The file is client-side only.

  Props shape (TypeScript interface):
  ```ts
  interface NetworkViewProps {
    graph: SerializedGraph | null;
    communities: Map<string, number> | null;
    minNodes?: number; // default 4
    minEdges?: number; // default 3
  }
  ```
  `graph` is the serialized form from the worker's new `getInteractionGraph` method (added in section 6). `communities` is the per-node community assignment map from `computeInteractionGraphCommunities`. Both are `null` until the shell has polled at least once and both are passed down together (so a rebuild uses matching graph + community snapshots).

  The component body:
  1. `useRef<HTMLDivElement>(null)` for the sigma container div.
  2. `useRef<Sigma | null>(null)` for the sigma instance handle (so the effect cleanup can call `.kill()`).
  3. `useRef<Graph | null>(null)` for the local graphology instance (so the update-effect can keep it alive across re-renders).
  4. `useRef<Map<string, {x: number; y: number}>>(new Map())` for the cached positions (see research item 13).
  5. `useState<{nodes: number; edges: number}>({nodes: 0, edges: 0})` — the node/edge counts for the empty-state and debug label.
  6. A `useEffect` that runs on every change to `props.graph` or `props.communities`. Inside:
     - If `props.graph === null || props.graph.nodes.length < (props.minNodes ?? 4) || props.graph.edges.length < (props.minEdges ?? 3)`: update the empty-state counts and return early (no sigma construction, no layout).
     - Otherwise, reconstruct the graphology instance: `const graph = Graph.from(props.graph);` (creates a fresh `Graph` from the serialized form). Store on the `useRef`.
     - Seed initial positions: for each node, read the cached position from the ref (if present) or generate `{x: Math.random(), y: Math.random()}` and write it via `graph.mergeNodeAttributes(nodeId, {x, y})`. This satisfies ForceAtlas2's `x`/`y` prerequisite.
     - Apply community colors: for each `(nodeId, communityId)` in `props.communities`, call `graph.setNodeAttribute(nodeId, 'color', communityColor(communityId))`. For any node not in the assignments map (this should not happen if the worker returns matching snapshots, but is a defensive fallback), use `communityColor(0)` (black).
     - Set node sizes: compute `size = 2 + 3 * Math.log2(1 + graph.degree(nodeId))`. This is a logarithmic scaling so hubs don't dominate and singletons are still visible. Write via `graph.setNodeAttribute(nodeId, 'size', size)`.
     - Set edge sizes based on weight: for each edge, `size = 1 + Math.log2(1 + weight)`. Similar logarithmic scaling.
     - Run ForceAtlas2: `forceAtlas2.assign(graph, { iterations: 100, settings: forceAtlas2.inferSettings(graph) })`.
     - Write the new positions back into the position cache ref for warm-start on the next rebuild.
     - If a previous sigma instance exists, call `.kill()` on it before constructing a new one. This is because sigma v3 binds to a specific `graphology.Graph` instance and the rebuild creates a fresh instance, so re-pointing sigma is simpler than trying to mutate the existing one's graph reference.
     - Construct sigma: `const sigma = new Sigma(graph, containerRef.current!, { /* defaults */ });`.
     - Attach the graphology instance and sigma instance to `window.__msksim_debug_graph = graph` and `window.__msksim_debug_sigma = sigma` (see MCP script section 10 for why these debug globals exist — they are gated behind a `process.env.NODE_ENV !== 'production'` check so they ship in dev/test builds but not in production).
     - Return the cleanup function: `() => { sigma.kill(); }`. Do **not** null out the graph ref or the position cache — those survive across re-renders intentionally (warm-start) and are only reset when the component unmounts entirely (handled by React automatically).

  The JSX:
  ```jsx
  return (
    <div className="relative w-full h-[600px] bg-slate-900 rounded">
      {isEmpty && (
        <div className="absolute inset-0 flex items-center justify-center text-slate-400 text-sm z-10">
          Waiting for interactions... ({counts.nodes} nodes, {counts.edges} edges)
        </div>
      )}
      <div ref={containerRef} data-testid="sigma-container" className="absolute inset-0" />
    </div>
  );
  ```
  The `data-testid="sigma-container"` is the MCP script's handle for `wait_for`. Tailwind classes match the rest of the playground shell established in step 21 (dark background, rounded corners, fixed height).

  At module scope, outside the component:
  ```ts
  // Okabe-Ito colorblind-safe qualitative palette (hex codes from Okabe & Ito 2008).
  // Order: [black, orange, sky blue, bluish green, yellow, blue, vermillion, reddish purple].
  export const OKABE_ITO = [
    '#000000', '#E69F00', '#56B4E9', '#009E73',
    '#F0E442', '#0072B2', '#D55E00', '#CC79A7',
  ] as const;

  /**
   * Maps a Louvain community id (non-negative integer) to a hex color from the Okabe-Ito palette.
   * Communities beyond 8 wrap via modulo; in practice the N ≤ 500 target produces 2–6 communities
   * on a well-connected cumulative graph so wraparound is rare.
   *
   * This is the one pure helper in network-view.tsx that unit tests cover directly. The rest of
   * the component is MCP-verified.
   */
  export function communityColor(communityId: number): string {
    if (!Number.isFinite(communityId) || communityId < 0) return OKABE_ITO[0];
    return OKABE_ITO[Math.floor(communityId) % OKABE_ITO.length];
  }
  ```
  Both `OKABE_ITO` and `communityColor` are exported from the component file so the sibling test file can import them without pulling in React or sigma.

  File size: ~160-200 lines including doc comments and JSX.

- **`app/(auth)/playground/network-view.test.ts`** — the **unit test file for the pure helper**. Vitest default `node` environment. Imports:
  - `import { describe, it, expect } from 'vitest';`
  - `import { communityColor, OKABE_ITO } from './network-view';`

  Tests (all targeting `communityColor`):
  1. `communityColor(0)` returns the first palette entry `#000000`.
  2. `communityColor(1)` through `communityColor(7)` each return the matching palette entry in sequence (Orange, Sky Blue, Bluish Green, Yellow, Blue, Vermillion, Reddish Purple).
  3. `communityColor(8)` wraps and returns `#000000` again (modulo behavior).
  4. `communityColor(15)` returns `OKABE_ITO[7]` (`#CC79A7`).
  5. `communityColor(-1)` returns the first palette entry (defensive: negative inputs are treated as 0).
  6. `communityColor(NaN)` returns the first palette entry (defensive: non-finite inputs are treated as 0).
  7. `communityColor(3.9)` returns `OKABE_ITO[3]` (fractional inputs are floored).
  8. `OKABE_ITO.length === 8`.
  9. Every entry in `OKABE_ITO` matches the regex `/^#[0-9A-F]{6}$/` (every palette entry is a valid uppercase hex code). This catches transcription errors in the literal array.

  File size: ~40-60 lines. Runs in milliseconds.

  **Important constraint**: this test file must not import `sigma`, `graphology`, `graphology-layout-forceatlas2`, or any `react`/`react-dom` symbol. `network-view.tsx` imports these at module scope, and re-importing `./network-view` from the test file will transitively pull them in under the `node` environment where `window`/`document`/WebGL are undefined. The test file imports `communityColor` and `OKABE_ITO` from `./network-view`, and those are defined at module scope of the `.tsx` file — Vitest's tree-shaker picks up only the symbols the test actually uses, but it does not elide side-effect imports. **Therefore**: `network-view.tsx` must not execute any module-level code that touches `window` or `document` (all sigma construction happens inside `useEffect`, which only runs in the browser). The `import Sigma from 'sigma';` line is safe because sigma v3's module is side-effect-free at import time — it just exposes the `Sigma` class. Same for `graphology` and `graphology-layout-forceatlas2`. Verify this claim during implementation by running `npm test -- app/\(auth\)/playground/network-view.test` and confirming it passes under the default `node` environment. If it fails with "window is not defined," the sigma/graphology/layout imports are doing something browser-only at module scope and the test must be moved to `happy-dom` or split into a separate `palette.ts` helper file that the test imports from directly. **Preferred fallback if that happens**: extract `OKABE_ITO` and `communityColor` into `app/(auth)/playground/network-view-palette.ts` (zero imports, just the constant array and the pure function) and have both `network-view.tsx` and `network-view.test.ts` import from it. This is the cleanest solution; the implementing claude should use this split from the start if it's certain (grep the three libraries' source for `window.` / `document.` / `globalThis.` references at module scope). The plan file recommends: **start with the split** (`network-view-palette.ts`) for safety, then inline if confirmed unnecessary.

## 6. Files to modify

- **`workers/simulation.worker.ts`** — add a seventh method `getInteractionGraph()` to the `SimulationWorkerApi` interface and the `api` implementation object. This is the step-23 worker API extension explicitly flagged in the step-specific context. The addition is additive; no step-20 semantics change.

  Interface change:
  ```ts
  export interface InteractionGraphReport {
    graph: SerializedGraph; // from 'graphology' — plain JSON, structured-clone safe
    communities: Array<[string, number]>; // AgentId → community id; Map serialized as entries array
    modularity: number;
    nodeCount: number;
    edgeCount: number;
  }

  export interface SimulationWorkerApi {
    init(config: ExperimentConfigInput, seed: number): Promise<void>;
    step(count?: number): Promise<TickReport>;
    run(totalTicks: number, onProgress?: (report: TickReport) => void): Promise<RunResult>;
    getMetrics(): Promise<ScalarMetricsSnapshot & GraphMetricsSnapshot>;
    getSnapshot(): Promise<FullStateSnapshot>;
    reset(): Promise<void>;
    // ADDED BY STEP 23:
    getInteractionGraph(): Promise<InteractionGraphReport>;
  }
  ```
  The `communities` field is serialized as an array of `[key, value]` tuples rather than a `Map` because structured-clone treats `Map` inconsistently across browser versions and the quadruple-array form used in step 20's `FullStateSnapshot.inventory` establishes the precedent for "serialize keyed collections as arrays across the wire." The main-thread wrapper rehydrates to a `Map` in the shell before passing to `network-view.tsx`.

  Implementation (at the bottom of the `api` object, after `reset`):
  ```ts
  getInteractionGraph: async () => {
    if (state === null) {
      throw new Error('simulation worker: getInteractionGraph() called before init(). Call init() first.');
    }
    const { assignments, count, modularity } = computeInteractionGraphCommunities(state.interactionGraph, state.rng);
    return {
      graph: state.interactionGraph.export() as SerializedGraph,
      communities: Array.from(assignments.entries()),
      modularity,
      nodeCount: state.interactionGraph.order,
      edgeCount: state.interactionGraph.size,
    };
  },
  ```
  The `computeInteractionGraphCommunities` import is added to the worker's import list at the top of the file (from `@/lib/sim/metrics/graph`, which already exports it per step 16's plan). The `SerializedGraph` type import is added from `'graphology'`. The worker's existing `state.interactionGraph` field (established by step 20's `init` via `createInteractionGraph()`) is the exact object step 16's helper operates on — nothing new is created.

  **Determinism note**: `computeInteractionGraphCommunities` consumes the seeded RNG via `state.rng`, so calling `getInteractionGraph()` repeatedly on an unchanged graph produces the same community assignments bit-for-bit (as long as step 16's Louvain RNG plumbing is correct, which it is per step 16's plan §7). However, calling `getInteractionGraph()` **does** advance the RNG state because the Louvain call draws from it, which is a subtle wire-crossing side effect. **To preserve the `CLAUDE.md` "Worker lifecycle" determinism invariant** (`run(N, ...)` twice with the same `(config, seed)` produces bit-identical output), `getInteractionGraph()` must **not** use `state.rng` directly — it must use a **derived child RNG** seeded from `state.config.seed` (or a dedicated `visualizationRng` field added to `state` during `init`) so that visualization polling never perturbs the simulation RNG. The implementing claude adds this child-RNG discipline: in the `init` slice, alongside `state.rng`, create `state.visualizationRng = createRng(config.seed + 1)` (or an analogous distinct-seed scheme, documented inline). `getInteractionGraph()` then passes `state.visualizationRng` into the Louvain call. This decouples visualization polling from simulation progression without sacrificing determinism — the visualization RNG is itself deterministic given the same seed, so community colors are reproducible across identical runs.

  File modification is **additive only**: no existing lines are changed, only new lines added. The commit diff for `workers/simulation.worker.ts` should show zero deletions and roughly 20-30 new lines.

- **`lib/sim/worker-client.ts`** — extend the type-only re-exports to include the new `InteractionGraphReport` type and the extended `SimulationWorkerApi` (which automatically picks up the new method because the re-export is type-only and the TypeScript compiler follows the worker module's interface declaration). Add a line:
  ```ts
  export type { InteractionGraphReport } from '@/workers/simulation.worker';
  ```
  No other changes. The `createSimulationWorker()` factory's return shape is `{ api: Remote<SimulationWorkerApi>; terminate: () => void }`; `Remote<SimulationWorkerApi>` automatically exposes the new `getInteractionGraph` method as a promise-returning proxy because the underlying interface gained the method. No runtime change to `worker-client.ts` is needed — the extension is purely at the type level.

- **`app/(auth)/playground/simulation-shell.tsx`** — add the view-toggle tab UI and wire the network view into the shell. This is the step-23 integration point with step 21's work.

  Grep-first protocol: before editing, run `grep -n "view" app/\(auth\)/playground/simulation-shell.tsx` to find step 21's existing view state (if any). Step 21's plan will have introduced *some* kind of state for the lattice canvas — it may have called it `activeView`, `pane`, `tab`, or just not parameterized it at all. The step-23 implementing claude reads the file, finds the relevant state, and extends it rather than creating a parallel state.

  Expected edits (may be updated at execution time based on step 21's actual file structure):
  1. Import `NetworkView` from `./network-view`. Also `import type { SerializedGraph } from 'graphology';` for typing the graph state.
  2. Extend the view state type from `'lattice'` (or whatever step 21 uses) to `'lattice' | 'metrics' | 'network'`. If step 22 hasn't landed yet (grep for `metrics-dashboard` file), drop `'metrics'` from the union; a later follow-up will add it.
  3. Add a new piece of state: `const [interactionGraph, setInteractionGraph] = useState<{ graph: SerializedGraph; communities: Map<string, number> } | null>(null);`.
  4. Inside the existing tick-loop `useEffect` (or equivalent polling mechanism established in step 21), add a secondary low-frequency poll: every 10 ticks (configurable via a shell constant `INTERACTION_GRAPH_POLL_INTERVAL = 10`), call `api.getInteractionGraph()`, rehydrate the `communities` field from its array form back to a `Map`, and set the `interactionGraph` state. The 10-tick interval is the "low-frequency subscription" from the step-specific context. Document the constant inline so step 24 can later expose it as a user-facing slider.
  5. Render the tab nav bar above the view area. Example structure:
     ```jsx
     <div className="flex gap-2 border-b border-slate-700 mb-3">
       <button onClick={() => setView('lattice')} className={tabClass('lattice')}>Lattice</button>
       {metricsAvailable && <button onClick={() => setView('metrics')} className={tabClass('metrics')}>Metrics</button>}
       <button onClick={() => setView('network')} className={tabClass('network')} data-testid="tab-network">Network</button>
     </div>
     ```
     The `data-testid="tab-network"` attribute is the MCP script's click target. Tailwind styling matches step 21's existing UI.
  6. Conditionally render the active view:
     ```jsx
     {view === 'lattice' && <LatticeCanvas ... />}
     {view === 'metrics' && metricsAvailable && <MetricsDashboard ... />}
     {view === 'network' && (
       <NetworkView
         graph={interactionGraph?.graph ?? null}
         communities={interactionGraph?.communities ?? null}
       />
     )}
     ```

  **Merge-conflict handling with step 22**: if step 22 runs before step 23 in Wave 6 dispatch order, step 22 will have already added the `'metrics'` tab and its polling state. Step 23 only adds the `'network'` tab, the `interactionGraph` state, the network poll, and the conditional render. If step 23 runs before step 22, step 23 creates the tab bar with just `'lattice' | 'network'` and leaves a comment `// TODO(step-22): add metrics tab`. Either way, the step-23 commit is self-contained: it does not modify any non-tab line.

- **`package.json`** — add two runtime dependencies. The agent must run `npm view sigma version` and `npm view graphology-layout-forceatlas2 version` at execution time to capture the current stable releases, then `npm install sigma@<v1> graphology-layout-forceatlas2@<v2>`. At the time of writing this plan file, the expected versions are **`sigma@3.0.2`** (published 2025-05-27, the latest stable v3 release) and **`graphology-layout-forceatlas2@0.10.1`**. The agent does **not** hard-code these versions in the plan — re-check at execution time. `package.json` should have new entries approximately:
  ```json
  "dependencies": {
    ...existing...,
    "sigma": "^3.0.2",
    "graphology-layout-forceatlas2": "^0.10.1"
  }
  ```
  No `@types/...` packages are needed — both sigma v3 and `graphology-layout-forceatlas2` ship bundled TypeScript declarations. `graphology` and `graphology-communities-louvain` are already in `dependencies` from steps 10 and 16 and are **not** reinstalled. `package-lock.json` updates automatically and is committed.

- **`CLAUDE.md`** — append ≤ 15 lines. See section 11 for exact text.

**No other files are modified.** In particular: no `next.config.ts` changes (sigma and forceatlas2 are plain ESM and resolve through Turbopack's default module graph), no `tsconfig.json` changes (the `@/` alias already covers the new imports), no `vitest.config.ts` changes (the new unit test runs in the default `node` environment), no `db/schema/*.ts` changes (step 23 is presentation only; no persistence).

## 7. Implementation approach

The work is ordered so types and dependencies land first, then the worker API extension, then the client wrapper type re-export, then the component itself, then the shell integration, then the verification. This ordering minimizes the window in which the repository is in an inconsistent state — e.g. if the component is written before the worker method exists, the `api.getInteractionGraph()` call will fail type-checking and block the next slice.

**Slice one — dependency management.** Run `npm view sigma version` and `npm view graphology-layout-forceatlas2 version` to capture the current stable versions. Install both via `npm install sigma@<v1> graphology-layout-forceatlas2@<v2>`. Verify the entries appear in `package.json` under `dependencies`. Do not install any `@types/...` packages — both ship bundled declarations. Run `npx tsc --noEmit` to confirm the new imports type-check against the existing TypeScript configuration. If TypeScript reports missing type declarations, check whether the package's `package.json` has a `"types"` or `"typings"` field pointing at a `.d.ts` file; for sigma v3 and the graphology layout package this should be the case without any config tweaks. Run `npm run build` to verify Turbopack bundles both packages cleanly — any "Module not found" or "Cannot resolve" error here is a show-stopper and must be fixed before proceeding. Expected outcome: clean build, no warnings about the new packages.

**Slice two — extend the worker API.** Open `workers/simulation.worker.ts`. Add the new imports at the top: `import { computeInteractionGraphCommunities } from '@/lib/sim/metrics/graph';` and `import type { SerializedGraph } from 'graphology';`. Add the `InteractionGraphReport` interface near the other exported types (near `TickReport`, `RunResult`, `FullStateSnapshot`, etc.). Extend the `SimulationWorkerApi` interface with the `getInteractionGraph(): Promise<InteractionGraphReport>` method. Implement the method in the `api` object per the code block in section 6. Add a child visualization RNG to the `state` holder if step 20 did not already allocate one — the field is `visualizationRng: RNG` and is initialized in the `init()` method as `state.visualizationRng = createRng(config.seed + 1)` (or whatever the step-09 RNG factory is named; grep `lib/sim/rng.ts` for the export). Document the child-RNG rationale in an inline comment so future agents understand why it's not `state.rng`. Run `npm run typecheck` to confirm the worker module compiles. Run `npm test` to confirm no regressions in step 18's simulation smoke test (it does not touch the worker boundary, so it should still pass).

**Slice three — extend the client wrapper's type re-exports.** Open `lib/sim/worker-client.ts`. Add `export type { InteractionGraphReport } from '@/workers/simulation.worker';` alongside the existing type re-exports. No runtime changes. Run `npx tsc --noEmit` to confirm the type flows through. The `Remote<SimulationWorkerApi>` type on the main thread automatically gains the `getInteractionGraph` method because it's a type-level derivation from the worker's interface.

**Slice four — create the pure helper file (if using the split approach).** Create `app/(auth)/playground/network-view-palette.ts` with just the `OKABE_ITO` array and the `communityColor` function and their JSDoc. This file has zero imports — no React, no sigma, no graphology, nothing. It is a pure-data module. The split exists so the unit test (`network-view.test.ts`) can import from it without pulling in sigma/graphology/react/etc. at module-graph-resolution time (see section 5's "Important constraint" note). If the implementing claude verifies at execution time that sigma, graphology, and graphology-layout-forceatlas2 are all side-effect-free at module-import time under the `node` environment (test by creating a scratch `.ts` file that imports all three and runs it under `node --loader tsx`), the split is not strictly necessary and the palette can be inlined into `network-view.tsx`. Either way, `OKABE_ITO` and `communityColor` must be exported from *some* file that the test can import. **Recommendation: use the split. It is cheap insurance.**

**Slice five — create `network-view.tsx`.** Begin the file with `'use client';` on line 1. Add imports per section 5. If slice four created a palette split file, re-export `OKABE_ITO` and `communityColor` from `network-view.tsx` for convenience (so the test file can import from either location, though it should import from the palette file directly). Implement the component per section 5's detailed description. The body is one `useEffect` with a dependency array `[props.graph, props.communities]`, plus small computed values for the empty-state threshold check. Write the JSX with Tailwind classes matching the playground shell's existing theme. Run `npx tsc --noEmit` to confirm the component compiles. Run `npm run build` to confirm Turbopack bundles it into the `(auth)` route group chunk — the build log should show the network view's chunk alongside the lattice canvas and metrics dashboard chunks without any "invalid import" errors.

**Slice six — create the unit test.** Create `app/(auth)/playground/network-view.test.ts`. Import `communityColor` and `OKABE_ITO` from `./network-view` (or from `./network-view-palette` if the split was used — the test must import from whichever file actually exports them, not from the component file if it re-exports from the split). Write the nine tests enumerated in section 5. Run `npm test -- app/\(auth\)/playground/network-view` to execute just this suite. All nine tests must pass. If the test runner errors with "window is not defined" or "document is not defined," that is evidence that one of the sigma/graphology/layout packages is not side-effect-free at import time, and the remediation is to move to the palette-split approach (create `network-view-palette.ts`, move `OKABE_ITO` and `communityColor` into it, update the test's import path). Verify the fix locally before proceeding.

**Slice seven — integrate into the playground shell.** Open `app/(auth)/playground/simulation-shell.tsx`. Run the grep-first protocol: `grep -n "view\|NetworkView\|interactionGraph\|getInteractionGraph\|tab\|metrics-dashboard" app/\(auth\)/playground/simulation-shell.tsx` to find the current structure. If step 22 has already landed (grep `app/\(auth\)/playground/metrics-dashboard.tsx` for existence), the tab bar already has two entries and step 23 appends a third. If not, the tab bar is created fresh with two entries (`lattice`, `network`) and a comment notes that step 22 will add a third. Add the `interactionGraph` state, the low-frequency poll inside the existing tick loop (or alongside it; the exact wiring depends on step 21's structure), the tab UI elements with `data-testid` attributes, and the conditional render of `NetworkView`. Keep the edit surgical — do not reformat unrelated lines, do not touch step 21's existing logic, do not change the existing poll intervals. The commit diff for `simulation-shell.tsx` should show a focused set of added lines and no deletions (except for the single-line conversion of any single-view render into a switch-by-view render, if applicable).

**Slice eight — screenshot directory preparation.** Ensure `docs/screenshots/` exists (it does from step 07's UI verification harness; see `CLAUDE.md` "Directory layout"). The MCP script in section 10 writes `docs/screenshots/step-23-network.png` as part of its verification flow. No manual preparation beyond confirming the directory is present.

**Slice nine — CLAUDE.md append.** Append the exact text from section 11 to the "Worker lifecycle" section of `CLAUDE.md`. Verify the append does not push the section past its 40-line hard cap — if it does, promote the network-view-specific content to a new small dedicated section per the `CLAUDE.md` "Living-document rules" (steps 19, 20 already use part of the "Worker lifecycle" budget). Target: ≤ 12 lines appended.

**Slice ten — verification checklist.** Run in order: `npm run typecheck` (must pass), `npm run lint` (must pass), `npm run build` (must pass — this exercises Turbopack against all the new code and is the strongest guarantee the production bundle works), `npm test` (all existing tests plus the new pure-helper test must pass), and then the MCP verification script in section 10. The MCP script is run by `scripts/run-plan.ts` which spins up `next build && next start` on a random port and then invokes `claude -p` with the MCP chrome-devtools tools available.

**Slice eleven — commit.** A single commit with the exact subject from section 12. The commit diff shows: two or three new files (`network-view.tsx`, `network-view.test.ts`, and optionally `network-view-palette.ts`), one modified `workers/simulation.worker.ts` (additive), one modified `lib/sim/worker-client.ts` (one line added), one modified `app/(auth)/playground/simulation-shell.tsx` (tab bar + poll + conditional render), one modified `package.json` (two new dependencies), one modified `package-lock.json` (auto-updated by npm install), one modified `CLAUDE.md` (~12 lines appended), and one new screenshot at `docs/screenshots/step-23-network.png`.

## 8. Library choices

- **`sigma@^3.0.2`** — the canonical WebGL graph renderer in the graphology ecosystem. The major version **3** is the post-rewrite API (the step-specific context explicitly warns that v2 and v3 differ substantially and the plan file must use v3). Pinned at execution time via `npm view sigma version`; the expected version at plan-write time is `3.0.2` (published 2025-05-27), but the implementing claude must re-verify. Bundled TypeScript declarations; no `@types/sigma` package exists and none is needed. Peer dependency: `graphology-types >=0.19.0` (satisfied by step 10's graphology install, which pulled graphology-types as a transitive dependency). Runtime dependencies: `events ^3.3.0`, `graphology-utils ^2.5.2` (both automatically installed by npm).

- **`graphology-layout-forceatlas2@^0.10.1`** — the canonical ForceAtlas2 layout algorithm for graphology. Pinned at execution time; the expected version is `0.10.1`. Ships TypeScript declarations. Peer dependency: `graphology-types >=0.19.0` (already satisfied). Used via `forceAtlas2.assign(graph, { iterations: 100, settings: forceAtlas2.inferSettings(graph) })`. Runs on the main thread inside the component's `useEffect`; v1 does not run it in a dedicated Web Worker (see research item 12 for the rationale).

- **`graphology`** — already installed (step 10). Step 23 uses `Graph`, `Graph.from(serialized)`, `graph.export()`, `graph.setNodeAttribute`, `graph.mergeNodeAttributes`, `graph.getNodeAttribute`, `graph.degree`, `graph.nodes`, `graph.edges`, `graph.forEachNode`, `graph.forEachEdge`, `graph.order`, `graph.size`, and the `SerializedGraph` type. All are stable graphology v0.25+ API surface.

- **`graphology-communities-louvain`** — already installed (step 16). Step 23 does **not** import it directly; it calls `computeInteractionGraphCommunities` from `@/lib/sim/metrics/graph`, which wraps the Louvain plugin per step 16's plan.

- **No new test library** — Vitest is already installed (step 00). The step-23 unit test runs in the default `node` environment (pure function, no DOM).

- **No MCP library** — the MCP tools are available globally inside `claude -p` execution under `scripts/run-plan.ts` (see `CLAUDE.md` "UI verification harness").

- **Out of scope for v1**: three.js / raw WebGL renderer, cytoscape.js, vis-network, a Web-Worker-hosted ForceAtlas2 layout, true incremental graph diffing, Comlink-proxied graph handles. All rejected in research items 9-14.

## 9. Unit tests

Only one file of tests, covering the pure helper only. The full view is MCP-verified (section 10).

**`app/(auth)/playground/network-view.test.ts`** (or `network-view-palette.test.ts` if the split approach from slice four was used):

1. **`communityColor(0)` returns the first palette entry.** `expect(communityColor(0)).toBe('#000000');`
2. **`communityColor` returns the correct color for each of the 8 palette indices.** Loop `for i in 0..7`: `expect(communityColor(i)).toBe(OKABE_ITO[i]);`. Confirms the function is a straight table lookup within the palette range.
3. **`communityColor(8)` wraps to index 0.** `expect(communityColor(8)).toBe('#000000');`
4. **`communityColor(15)` wraps to index 7.** `expect(communityColor(15)).toBe('#CC79A7');`
5. **`communityColor(16)` wraps to index 0.** `expect(communityColor(16)).toBe('#000000');` — double-wrap sanity check.
6. **`communityColor(-1)` is treated as 0.** `expect(communityColor(-1)).toBe('#000000');` — defensive input handling; negative community ids should not crash and should not produce undefined.
7. **`communityColor(NaN)` is treated as 0.** `expect(communityColor(NaN)).toBe('#000000');`
8. **`communityColor(Infinity)` is treated as 0.** `expect(communityColor(Infinity)).toBe('#000000');`
9. **`communityColor(3.9)` is floored to 3.** `expect(communityColor(3.9)).toBe(OKABE_ITO[3]);`
10. **`OKABE_ITO.length === 8`.** `expect(OKABE_ITO.length).toBe(8);` — catches a future transcription error that adds or removes a palette entry.
11. **Every palette entry is a valid uppercase hex code.** `for (const c of OKABE_ITO) expect(c).toMatch(/^#[0-9A-F]{6}$/);` — catches typos and case mismatches.
12. **The first palette entry is black (`#000000`).** Documents the fixed convention that community 0 is always black.
13. **No two palette entries are duplicates.** `expect(new Set(OKABE_ITO).size).toBe(8);`

All 13 tests run in the default Vitest `node` environment. The suite completes in milliseconds.

**Everything else is MCP-verified.** The sigma renderer, the ForceAtlas2 layout, the community coloring visual output, the zoom/pan behavior, the empty-state placeholder, and the tab-toggle wiring are all exercised by the MCP script in section 10. Attempting to unit-test them in Vitest would require a real browser (not jsdom, not happy-dom — sigma uses WebGL which neither DOM harness provides) or a Playwright-in-Vitest setup that would be far heavier than step 23 warrants.

## 10. Acceptance criteria

**Local (non-MCP) criteria — all must pass before the MCP run:**

- `npm run build` succeeds. Turbopack bundles `network-view.tsx`, `sigma`, and `graphology-layout-forceatlas2` into the `(auth)/playground` chunk without any "Module not found" or "Cannot resolve" errors. No warnings about server-only imports leaking into client code. Build time increase is ≤ 5 seconds over the step-22 baseline.
- `npm run typecheck` (i.e. `npx tsc --noEmit`) passes with zero errors. The `InteractionGraphReport` type flows from `workers/simulation.worker.ts` through `lib/sim/worker-client.ts` (via `export type { ... }`) to `simulation-shell.tsx` (via the `Remote<SimulationWorkerApi>.getInteractionGraph()` return type) without any type-level drift.
- `npm run lint` passes.
- `npm test` passes. The new `network-view.test.ts` (13 tests) passes in its entirety. All prior tests — step 00 through step 22 — remain green. In particular, the step-18 simulation smoke test is unchanged by step 23 (step 23 adds no new simulation logic and only extends the worker API with a read-only accessor).
- `ls app/\(auth\)/playground/network-view.tsx app/\(auth\)/playground/network-view.test.ts` lists both files as present. If the palette split was used, `ls app/\(auth\)/playground/network-view-palette.ts` also lists it.
- `grep -n "getInteractionGraph" workers/simulation.worker.ts lib/sim/worker-client.ts` shows the method declared and implemented in both locations.
- `grep -n "NetworkView\|data-testid=\"tab-network\"" app/\(auth\)/playground/simulation-shell.tsx` shows the integration in the shell.
- `grep -n "sigma\|graphology-layout-forceatlas2" package.json` shows both new dependencies.
- `grep -n "'use client'" app/\(auth\)/playground/network-view.tsx` matches the very first line of the file.

**MCP verification script** — run by `scripts/run-plan.ts` via `claude -p` with the chrome-devtools MCP tools. The script follows the `CLAUDE.md` "UI verification harness" flow: fresh `next build && next start` on a random port, seed user via direct drizzle call, clear storage, login, then execute the step-specific verification. The step-23 verification steps, in order:

1. **Navigate and clear.** `mcp__chrome-devtools__navigate_page` to `${MSKSIM_BASE_URL}/login`. `evaluate_script`: `localStorage.clear(); sessionStorage.clear();`. Clear cookies via the DevTools protocol.

2. **Log in.** `fill_form` or `fill` the email and password inputs with `MSKSIM_SEED_USER` and `MSKSIM_SEED_PASS`. Click submit. `wait_for` a recognizable element of the authenticated shell (e.g. the header nav `[data-testid="app-header"]` established in step 07).

3. **Navigate to playground.** `navigate_page` to `${MSKSIM_BASE_URL}/playground`. `wait_for` the `SimulationShell` root element (established in step 21; likely `[data-testid="simulation-shell"]`).

4. **Start the simulation.** The exact control depends on how step 21 wired playback (click a start button, press space, invoke a Server Action, etc.). The step-23 MCP script calls whatever step 21 used; grep the step-21 plan file or the live DOM for the control's `data-testid` attribute. If step 24 has landed and added finer-grained controls, use those; if not, use step 21's basic start handle. A reasonable default is `mcp__chrome-devtools__click` on `[data-testid="sim-start"]` (or equivalent).

5. **Wait for tick 50.** `wait_for` a tick-counter element that reads `50` or higher (typically a `[data-testid="tick-counter"]` established in step 21). The tick counter is a DOM element the shell updates from worker callbacks. Timeout generously — 30 seconds — because the worker may not be at full speed in a fresh dev server. If the shell does not expose a tick counter in the DOM, `evaluate_script` to read `window.__msksim_debug_tick` (if step 21 exposes one) or to poll `api.getMetrics()` via the worker. Prefer the DOM-visible counter for simplicity. 50 ticks is enough for the interaction graph to accumulate several dozen edges on a 500-agent run, per step 18's smoke test observations.

6. **Toggle to the network view.** `click` on `[data-testid="tab-network"]` (the tab button added to `simulation-shell.tsx` in slice seven). `wait_for` the sigma container to mount: `[data-testid="sigma-container"]`. Then `wait_for` the canvas child that sigma creates: `[data-testid="sigma-container"] canvas`. Sigma v3 creates the canvas as a child element of the supplied container; `wait_for` confirms sigma has actually constructed the renderer rather than just the wrapper div.

7. **Count the nodes.** `evaluate_script` to read the debug-exposed graphology instance: `window.__msksim_debug_graph.order`. Assert this value is `> 0` (i.e. the graph has at least one node). Also `evaluate_script` to read `window.__msksim_debug_graph.size` — assert `> 0` for edges. If either is zero, the empty-state placeholder is still visible; wait another tick or two and retry (the network view polls every 10 ticks, so 50 ticks guarantees at least 5 polls have occurred and the graph is populated unless the simulation has a zero-success-rate bug).

8. **Verify at least 2 distinct community colors are in use.** `evaluate_script`:
   ```js
   const graph = window.__msksim_debug_graph;
   const colors = new Set();
   graph.forEachNode((id, attrs) => { if (attrs.color) colors.add(attrs.color); });
   return colors.size;
   ```
   Assert the returned value is `>= 2`. The step-23 community-coloring logic writes the `color` attribute onto every node via `graph.setNodeAttribute(id, 'color', communityColor(communityId))`. A single color means Louvain found only one community (or the coloring didn't run); either is a failure mode for this step's acceptance criterion. If 50 ticks is not enough for the cumulative graph to fracture into ≥ 2 communities (possible on very small / very uniform runs), bump the wait to 100 ticks before failing.

9. **Verify zoom via the camera ratio.** Step A: record the initial camera ratio via `evaluate_script`: `return window.__msksim_debug_sigma.getCamera().ratio;`. Call this `ratio0`. Step B: `hover` the sigma container (`mcp__chrome-devtools__hover` on `[data-testid="sigma-container"]`) so subsequent scroll events have focus. Step C: dispatch a wheel event via `evaluate_script`:
   ```js
   const el = document.querySelector('[data-testid="sigma-container"]');
   el.dispatchEvent(new WheelEvent('wheel', { deltaY: -200, bubbles: true, cancelable: true }));
   ```
   (Negative `deltaY` scrolls "up" which zooms in; positive zooms out. Either direction is fine for the assertion — we just need the ratio to change.) Step D: read the camera ratio again via `evaluate_script`: `return window.__msksim_debug_sigma.getCamera().ratio;`. Call this `ratio1`. Assert `ratio1 !== ratio0`. Sigma v3's default wheel-zoom handler listens for `wheel` events on the container and updates the camera's `ratio` field; a change in the ratio is direct evidence that zoom works. If `ratio1 === ratio0`, either sigma did not bind its wheel handler (possibly because the canvas was not yet mounted at `wait_for` time — retry after a 500 ms delay) or step 23 accidentally configured sigma with `settings.enableZoom: false` (it should not). **Note**: sigma may animate the camera over a short tween (~200-300 ms), so the MCP script should `wait_for` at least 300 ms after dispatching the wheel event before reading the final ratio. Use a short `evaluate_script` with `await new Promise(r => setTimeout(r, 400));` inline, or the MCP harness's wait helper if available.

10. **Screenshot.** `mcp__chrome-devtools__take_screenshot` saving to `docs/screenshots/step-23-network.png`. The screenshot captures the full browser viewport at the moment after the zoom verification, showing the rendered network view with community colors and the (now-zoomed) camera state. Researchers will eyeball this screenshot later to confirm the visual quality.

11. **Console verification.** `list_console_messages`. Filter out React 19 dev-mode warnings (benign per `CLAUDE.md` "UI verification harness"). Assert no thrown errors, no hydration mismatches, no unhandled promise rejections. Any red message that isn't a known-benign warning is a failure.

12. **Network verification.** `list_network_requests`. Assert no 4xx or 5xx responses. All requests should be 200 OK (or the auth-redirect 307 chain, which is not a failure). If a new chunk for sigma or forceatlas2 fails to load with a 404, the Turbopack bundling has a bug and the step fails.

13. **Cleanup and termination.** The MCP script exits. `scripts/run-plan.ts` kills the `next start` server. Any simulation state inside the worker is garbage-collected along with the browser tab.

**Failure modes and their signals:**
- Build error on step 23's new dependencies → slice one bug; re-verify with `npm run build`.
- `'use client'` missing → slice five bug; sigma's module-scope code throws at SSR time; console-messages will show a hydration error.
- `getInteractionGraph` not on the API → slice two bug; TypeScript catches it first.
- Sigma canvas not mounted → slice five bug; `wait_for` times out at step 6.
- Only one community color → either the `computeInteractionGraphCommunities` helper is not running (step 16 issue) or step 23's coloring loop is writing the wrong attribute name. Grep `network-view.tsx` for `'color'` to confirm.
- Camera ratio unchanged → sigma's default wheel handler is not bound. Likely because the container lost focus or the `wait_for` raced the sigma construction. Add a 500 ms delay and retry.
- Screenshot has blank black area where sigma should be → ForceAtlas2 did not run (check console for "nodes must have x/y attributes" errors) or all nodes are at identical positions (ForceAtlas2 ran on a degenerate initial layout; seed with non-trivial random positions).

## 11. CLAUDE.md updates

Append ≤ 12 lines to the **"Worker lifecycle"** section (the same section steps 19 and 20 extended). The "Worker lifecycle" section has a 40-line hard cap per its header; at the time step 23 lands, it contains the step-19 bootstrap lines and step-20's `SimulationWorkerApi` lines, leaving comfortable headroom for the step-23 addition. If the budget is too tight at execution time, the implementing claude promotes the network-view content to a new small "Visualization extensions" section per the `CLAUDE.md` "Living-document rules" rather than truncating.

Exact append (to be inserted at the end of the existing "Worker lifecycle" bullet list):

- Step 23 extends `SimulationWorkerApi` with `getInteractionGraph(): Promise<InteractionGraphReport>`. The report carries a `graphology` `SerializedGraph` (plain JSON via `graph.export()`), the per-node Louvain community assignments as a `[key, value][]` array (`Map` rehydration happens on the main thread), and the current modularity score. The shell polls this method at a low frequency (every 10 ticks by default, configurable via `INTERACTION_GRAPH_POLL_INTERVAL`) and passes the results to `app/(auth)/playground/network-view.tsx` for sigma.js v3 rendering.
- **Visualization RNG isolation**: `getInteractionGraph` uses a dedicated `state.visualizationRng` (seeded deterministically from `config.seed + 1`) rather than `state.rng`, so Louvain community detection calls from the main thread never advance the simulation RNG and the `CLAUDE.md` determinism invariant (`run(N, ...)` twice with the same seed matches bit-for-bit) is preserved regardless of visualization polling frequency. Any future read-only worker method that draws randomness must follow the same child-RNG pattern.
- **sigma v3 + ForceAtlas2 cleanup**: the network view owns its sigma instance via a `useRef` and calls `sigmaInstance.kill()` in the `useEffect` cleanup. ForceAtlas2 runs on the main thread inside the same effect and is not re-run every tick; it runs only when the serialized graph from the worker has changed shape. Node positions are cached in a `useRef<Map>` and carried across rebuilds to give each layout pass a warm start.

Total appended: ~10-12 lines, comfortably inside the 15-line step budget and the 40-line section cap.

## 12. Commit message

```
step 23: network view
```

Exactly this line. No conventional-commit prefix, no trailing period, no body required. The `step NN:` marker is load-bearing for `scripts/run-plan.ts` detection per `CLAUDE.md` "Commit-message convention." The standard `Co-Authored-By: Claude ...` trailer is appended by the commit-creation machinery.

## 13. Rollback notes

If step 23 must be rolled back — e.g. because sigma v3 introduces a regression in a later minor release, or because the ForceAtlas2 layout produces visually unacceptable results on real runs, or because a subsequent step surfaces a bug in the step-23 `getInteractionGraph` API shape that requires a re-do — the rollback is mechanical:

1. Identify the commit to keep: run `git log --oneline --grep='^step 22:'` to find the step-22 commit hash (the most recent step that should survive the rollback). If step 22 is still pending at the time of rollback, fall back to `git log --oneline --grep='^step 21:'`. Call this hash `<prior>`.
2. Hard reset: `git reset --hard <prior>`. This removes the `step 23: network view` commit entirely, including the new files (`app/(auth)/playground/network-view.tsx`, `app/(auth)/playground/network-view.test.ts`, optionally `network-view-palette.ts`), the additive changes to `workers/simulation.worker.ts` (the `getInteractionGraph` method and the `InteractionGraphReport` type), the one-line change to `lib/sim/worker-client.ts`, the shell integration in `app/(auth)/playground/simulation-shell.tsx` (tab UI and network poll), the `package.json` + `package-lock.json` entries for `sigma` and `graphology-layout-forceatlas2`, the `CLAUDE.md` append, and the screenshot at `docs/screenshots/step-23-network.png`.
3. Uninstall the new packages in case `node_modules/` was not fully cleaned by the reset: `npm uninstall sigma graphology-layout-forceatlas2`. This strips them from `node_modules/` and, if the `package.json` entry was not already reverted by step 2, from the manifest. Run `npm install` afterward to re-resolve the lockfile against the surviving state.
4. Re-run `npm test` and `npm run build` to confirm the repository is back to the step-22 (or step-21) green state. If step 22's metrics dashboard references step 23's tab state that has now been removed, step 22 may need a small follow-up patch to degrade its tab bar gracefully — this is step 22's responsibility, not step 23's, but it is a possible downstream effect of the rollback.
5. `graphology` and `graphology-communities-louvain` are **not** uninstalled — they are step-10 and step-16 dependencies respectively and remain in use by the simulation worker even after step 23 is removed. Only the two net-new step-23 packages are stripped.
6. `rm -rf .next` to flush Turbopack's dependency cache. A partial build with the old `network-view.tsx` module graph can leave stale chunks that cause the next `next build` to emit phantom errors about missing sigma imports.
7. If the rollback is a prelude to a re-run of step 23 with a different design, `npx tsx scripts/run-plan.ts --only 23` redoes the step from the clean step-22 base with whatever updated plan file instructions are in effect.
