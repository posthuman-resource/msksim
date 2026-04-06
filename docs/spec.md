# Specification: Color-Term Naming Game Simulation (`msksim`)

_A feature-driven specification for an agent-based model of how the communication success of color terms emerges through linguistic pressure modulated by geographical location._

**Status:** Draft v1 — pre-implementation.
**Authors of the research question:** Meissa and Mike (see `docs/How color terms communication success is emerged through language modulated by geographical.pdf`).
**Spec author:** produced collaboratively with Claude from the source PDF, its transcription (`docs/pdftext.md`), and Gemini's interpretive framing (`docs/interpretation.md`).
**Target stack:** Next.js 16 + React 19 + TypeScript 5 + Tailwind 4 (already configured in `package.json`).

---

## Table of Contents

1. [Purpose and Research Questions](#1-purpose-and-research-questions)
2. [Does the Lattice Matter? (Short answer: Yes.)](#2-does-the-lattice-matter-short-answer-yes)
3. [Conceptual Model](#3-conceptual-model)
4. [Features](#4-features)
5. [User Stories](#5-user-stories)
6. [Research Goals → Software Support Matrix](#6-research-goals--software-support-matrix)
7. [Metrics and Observables](#7-metrics-and-observables)
8. [Architecture Sketch](#8-architecture-sketch)
9. [Capability Requirements and Candidate Libraries](#9-capability-requirements-and-candidate-libraries)
10. [Out of Scope](#10-out-of-scope)
11. [Open Questions and Future Work](#11-open-questions-and-future-work)
12. [References](#12-references)

---

## 1. Purpose and Research Questions

### 1.1 Core research question

> **How does the communication success of color terms emerge through linguistic pressure modulated by geographical location?**

This question sits at the intersection of sociolinguistics, cognitive science, and complex systems. The simulation is the empirical instrument through which the research team will probe it.

### 1.2 Sub-questions the software must be able to answer

- **RQ1 — Assimilation vs. segregation thresholds.** Under what population ratios (monolingual:bilingual) and interaction probabilities do bilingual immigrants in World 2 assimilate into the host linguistic community versus segregate into an insular one?
- **RQ2 — Role of spatial topology.** Does a 2D lattice constraint produce qualitatively different macroscopic outcomes than well-mixed (random-interaction) populations with identical composition? And if yes, how do those outcomes differ quantitatively?
- **RQ3 — Token-weight dynamics.** How do per-token weights evolve over time? Do they converge to a single dominant vocabulary, split into persistent sub-vocabularies, or show metastable regimes?
- **RQ4 — Emergent social cohesion.** To what extent does successful communication predict or drive social bonding (measured as interaction-graph density and clustering)?
- **RQ5 — Linguistic pressure quantified.** Given the "Bilinguals in World 2 use both languages" rule, how much does the choice of language used by bilinguals under linguistic pressure shift the assimilation/segregation outcome?

RQ1–RQ3 are directly stated in the source PDF. RQ4–RQ5 are implied by the PDF's text on social bonding and by the interpretive framing in `docs/interpretation.md`.

### 1.3 Why this is a software problem

The system the researchers want to understand is a _complex adaptive system_: many agents with simple individual rules producing non-obvious macroscopic patterns. Such systems are typically studied with **Agent-Based Models (ABMs)**, where analytical solutions are unavailable and closed-form reasoning is insufficient. Running an ABM in a browser-hosted TypeScript application gives the team a reproducible, shareable, visual research instrument.

---

## 2. Does the Lattice Matter? (Short answer: Yes.)

The user explicitly asked whether the lattice is necessary or whether random ("well-mixed") population interactions would suffice. The Naming Game literature answers this directly and decisively:

- In **well-mixed / mean-field** populations, agents eventually converge to a single shared vocabulary. Time-to-consensus scales roughly as N^(3/2) and the dynamics are _homogeneous_ — there are no stable sub-populations with divergent vocabularies ([Dall'Asta et al., 2008](https://arxiv.org/abs/0803.0398)).
- On a **2D lattice or other low-dimensional topology**, consensus is reached through a fundamentally different mechanism: **topology-induced coarsening**. Regional clusters of locally agreeing agents form rapidly, then slowly compete at their boundaries. Time-to-consensus scales as N^(1+2/d), which in 2D means N² — dramatically slower — and the system passes through long-lived intermediate states with multiple coexisting clusters ([Baronchelli et al., 2006](https://pubmed.ncbi.nlm.nih.gov/16486202/); [Lu, Korniss, Szymanski, 2008](https://pubmed.ncbi.nlm.nih.gov/18351919/)).

The outcomes the presentation hypothesizes — "ghettoization", "social exclusion of immigrant agents", "two clusters, one indicat[ing] social exclusion" — are **literally the signatures of coarsening dynamics**. They cannot emerge from a well-mixed population because there is no spatial substrate on which sub-clusters can persist. If the team ran the model with random interactions only, the "first possible outcome" would be unobservable by construction and the second would trivialize into uniform convergence.

**Design decision:** The simulation supports **all three topologies as first-class parameters**:

1. **2D lattice** (default) — each agent occupies a grid cell and interacts with a local neighborhood (configurable between Moore (8-cell) and Von Neumann (4-cell)).
2. **Well-mixed** — every agent can interact with every other agent; used as a control to demonstrate the role of topology.
3. **Social network** — a graph topology (small-world, scale-free, or user-supplied) for future experiments on realistic social structure ([Baronchelli, 2016](https://arxiv.org/abs/1701.07419); [Baronchelli et al., 2010 — community formation](https://arxiv.org/abs/1008.1096)).

Running the same experimental configuration in both lattice and well-mixed modes constitutes a built-in empirical answer to the user's own question and produces a publication-grade figure almost for free.

---

## 3. Conceptual Model

### 3.1 Worlds

The simulation hosts **two worlds** that run in parallel and share no agents. Each world has its own lattice (or equivalent topology) and its own populations:

- **World 1** — the "home" world.
  - **Monolingual natives (W1-Mono)** — speak only Language 1 (L1). Vocabulary per agent is an initial subset of the L1 color-term lexicon (e.g. `yellow`, `red`).
  - **Bilinguals (W1-Bi)** — speak L1 and Language 2 (L2). Their L1 vocabulary overlaps with W1-Mono; their L2 vocabulary is the L2 equivalent (e.g. `jaune`, `rouge`). The PDF states these bilinguals **always use L1** when speaking to monolinguals in World 1.
- **World 2** — the "host" world that receives immigrants from World 1.
  - **Native hosts (W2-Native)** — monolingual speakers of L2. The PDF's slide 4 shows a W2-Native with only `yellow` in L2 (sic — treating English `yellow` as the L2 term for this agent; see §3.5 for how the spec resolves this apparent source inconsistency).
  - **Immigrants (W2-Immigrant)** — the bilinguals from World 1, now residing in World 2. They retain both L1 and L2 vocabularies. The PDF states these agents **use both L1 and L2** with natives and with other immigrants.

### 3.2 Agent state

Each agent carries:

| Field                   | Type                                               | Description                                                                                                                                           |
| ----------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                    | unique identifier                                  | Stable across ticks.                                                                                                                                  |
| `class`                 | enum                                               | One of `W1-Mono`, `W1-Bi`, `W2-Native`, `W2-Immigrant`.                                                                                               |
| `position`              | lattice coordinate or network-node id              | Determines who the agent can interact with. Fixed for v1 (agents do not migrate within a world).                                                      |
| `inventory`             | `Map<Language, Map<Referent, Map<Token, weight>>>` | The core Naming Game state: for each language the agent knows, for each color referent the agent is aware of, a set of candidate tokens with weights. |
| `speakerLanguagePolicy` | function                                           | Given a hearer, returns which language the agent will speak. Encodes the PDF's policy rules.                                                          |
| `interactionMemory`     | bounded list                                       | Recent partners and outcomes, used by the preferential-attachment rule.                                                                               |

A **token** is a surface form (e.g. `yellow`, `rouge`). A **referent** is the meaning the token points to (e.g. the perceptual category "yellow-ish"). A **weight** is a non-negative real number that represents how strongly this agent prefers this token for this referent. This decomposition is necessary because the interesting dynamic of the Naming Game is the _competition between tokens for the same referent_, and the bilingual variant adds the competition between _languages_ for the same referent.

### 3.3 Interaction rules (from the PDF, formalized)

Each simulation tick, the scheduler selects agents (configurable: sequential, random, or priority-based; see F3). For each activated agent:

1. **Partner selection.** The agent picks an interaction partner.
   - On a lattice: a neighbor in the configured neighborhood.
   - Well-mixed: any agent in the same world (uniform random).
   - Network: a neighbor in the interaction graph.
   - Once preferential attachment (F6) is engaged, the choice is biased toward partners with similar token-weight profiles.
2. **Language selection.** The speaker chooses a language per its `speakerLanguagePolicy`. The PDF's rules are encoded as the v1 defaults:
   - W1-Bi speaking to W1-Mono → always L1.
   - W1-Bi speaking to W1-Bi → either language (configurable bias).
   - W2-Immigrant speaking to W2-Native → both languages possible (configurable bias).
   - W2-Immigrant speaking to W2-Immigrant → both languages possible.
   - W1-Mono and W2-Native only know L1 and L2 respectively and always use them.
3. **Referent selection.** The speaker picks a referent to talk about (uniform random among referents the speaker knows in the chosen language).
4. **Token utterance.** The speaker picks a token for that referent from its inventory in the chosen language, weighted by current token weights.
5. **Guessing.** The hearer looks up the token in its own inventory.
   - If the hearer has the token associated with the _same referent_, the interaction is a **success**.
   - Otherwise it is a **failure**.
6. **Weight update.**
   - On success: both speaker and hearer increase the weight of that (referent, token) pair by a configurable step Δ⁺.
   - On failure: the PDF says "the agent will find another peer to initiate another communication." In the minimal Naming Game there is no weight decrement on failure; v1 follows this convention, with an optional penalty Δ⁻ exposed as a parameter. The speaker then selects a new partner in the same tick (bounded by a retry limit to avoid runaway tick cost).
7. **Preferential attachment update (F6).** The interaction memory is updated. Once memory is warm, step 1's partner selection begins to bias toward high-similarity partners.

### 3.4 Initial conditions

- Population ratios default to monolingual:bilingual = 3:2 in both worlds, per the PDF ("we can start with a 3/2 ratio"). Configurable.
- Each agent's inventory is seeded from the PDF's Slide 3 and Slide 4 specifications:
  - W1-Mono: `{L1: {yellow-referent: {'yellow': 1.0}, red-referent: {'red': 1.0}}}` (or the minimal subset the PDF specifies — see §3.5).
  - W1-Bi: L1 and L2 tokens, both seeded at weight 1.0.
  - W2-Native: `{L2: ...}` only.
  - W2-Immigrant: same as W1-Bi (they carry their inventory with them).
- The specific color terms (`yellow`, `red`, `jaune`, `rouge`) are defaults; the model treats them as arbitrary symbols and the vocabulary is configurable.

### 3.5 Ambiguities in the source PDF, and how this spec resolves them

The source PDF (slides 3 and 4) has a typographic oddity: the W2-Native agent is labeled "in Language 2" but its vocabulary is shown as English `yellow`. This spec reads this as a _visual shorthand_ — the researchers used English labels throughout the presentation and relied on context ("in Language 2") to indicate the abstract language assignment. The model treats tokens as opaque symbols identified by `(language, lexeme)` pairs, so the actual string does not affect dynamics; the user can rename `yellow` to any L2 surface form in the configuration UI.

Additionally, the PDF does not specify:

- whether agents move between cells (this spec defaults to fixed; see §11),
- whether the weight update is additive, multiplicative, or normalized (this spec defaults to additive with optional normalization, configurable),
- how many referents each agent knows (this spec defaults to 2 — "yellow-like" and "red-like" — matching the PDF examples, but the number is configurable).

These choices are documented in the configuration schema so that every choice is traceable.

---

## 4. Features

The simulation treats **live interactive playground** and **batch experiment runner** as equally first-class modes. A researcher can move fluidly between "tweak a slider, watch the lattice evolve" and "queue 200 replicate runs, walk away, come back to aggregated metrics." Both modes share the same underlying simulation engine and configuration schema.

Each feature below has (a) a short description, (b) acceptance criteria that tell the implementer when the feature is done, and (c) the metrics or research questions it supports.

### 4.1 Core model features

#### F1. World construction

- **Description.** Configure World 1 and World 2 populations: total counts, monolingual-to-bilingual ratio, lattice dimensions, and neighborhood type (Moore/Von Neumann/custom).
- **Acceptance.** A researcher can instantiate both worlds from a JSON config; the resulting lattice displays the correct counts and initial agent classes in the correct cells; the 3:2 PDF default can be instantiated by pressing one button.
- **Supports.** RQ1, RQ5.

#### F2. Agent vocabulary bootstrapping

- **Description.** Seed per-agent token inventories from a referent × language matrix. The default matrix is derived from the PDF's Slides 3–4 but is user-editable.
- **Acceptance.** Each agent's initial inventory is deterministic given the config and the seed; editing the matrix before a run is reflected in the first tick.
- **Supports.** RQ3.

#### F3. Interaction engine

- **Description.** The per-tick speaker→hearer→guess→weight-update loop described in §3.3, with pluggable partner-selection, language-policy, and weight-update rules.
- **Acceptance.** Unit-testable pure functions for each rule; deterministic given a seed; configurable Δ⁺, Δ⁻, retry limit; scheduler can be sequential, random, or priority-based.
- **Supports.** RQ1, RQ3, RQ4.

#### F4. Spatial mode selector

- **Description.** At experiment start the researcher picks **lattice**, **well-mixed**, or **network** topology. The rest of the model is topology-agnostic.
- **Acceptance.** The same population config can be run in all three modes without code changes; the topology is persisted with the run.
- **Supports.** RQ2 — this is the single most important lever for answering "does the lattice matter?"

#### F5. Language-selection policy

- **Description.** Encodes the PDF's policy rules ("Bilinguals in World 1 always use L1 with monolinguals"; "Bilinguals in World 2 use both") as functions of `(speaker.class, hearer.class)`. Additional policies (e.g. probabilistic code-switching) can be registered.
- **Acceptance.** The default policy set reproduces the PDF's stated rules; researchers can swap in alternative policies via the configuration UI.
- **Supports.** RQ5.

#### F6. Preferential attachment

- **Description.** After a warm-up period, partner selection is biased toward agents whose top-weighted tokens overlap with the speaker's. This encodes the PDF's rule: _"Eventually, agents will try to communicate only to agents that match most of their tokens weight."_
- **Acceptance.** The warm-up length and the similarity weighting are configurable; the feature can be disabled entirely for ablation experiments; the effect is visible in the interaction-graph view.
- **Supports.** RQ4, RQ1.

### 4.2 Live playground mode

#### F7. Live lattice view

- **Description.** A per-world canvas rendering of the lattice, with each cell colored by (a) agent class, (b) dominant token for a selected referent, or (c) matching rate with neighbors. The researcher chooses which projection.
- **Acceptance.** Renders at 30+ FPS for N ≤ 500 per world; projection toggle takes effect within one tick; hover reveals the agent's full inventory.
- **Supports.** RQ2, RQ3 — visualizes coarsening dynamics directly.

#### F8. Live network view

- **Description.** A WebGL graph rendering showing the cumulative interaction network (nodes = agents, edges = past successful interactions weighted by frequency). Overlays Louvain community detection to highlight emergent clusters.
- **Acceptance.** Updates incrementally as interactions accumulate; Louvain clusters are color-coded and stable across small perturbations; the view supports zoom/pan.
- **Supports.** RQ1, RQ4 — this is the primary visualization of social bonding and ghettoization.

#### F9. Live metrics dashboard

- **Description.** A panel of synchronized time-series charts showing the observables from §7: communication success rate, mean token weight, number of distinct tokens (Nw), cluster count, largest-cluster size, assimilation index, segregation index.
- **Acceptance.** All seven core metrics update each tick; the researcher can pin any chart to a larger view; Y-axes are auto-scaled with a manual override.
- **Supports.** RQ1–RQ5.

#### F10. Interactive controls

- **Description.** Start, pause, step, reset, variable tick-rate (1× through 1000×), RNG seed input, and sliders for the "hot" runtime parameters (monolingual:bilingual ratio, interaction probability, Δ⁺, Δ⁻, preferential-attachment strength).
- **Acceptance.** The simulation is reproducible given the same seed and config; sliders are debounced so they do not thrash the engine; a seed of 0 is explicitly supported.
- **Supports.** All RQs.

### 4.3 Batch runner mode

#### F11. Experiment configuration UI

- **Description.** A form-driven editor for the full experiment config, validated by a shared schema. Configurations can be saved to and loaded from the browser's local storage, duplicated, and exported as JSON.
- **Acceptance.** Invalid configs cannot be run (schema errors are shown inline); the exported JSON re-imports losslessly; a config library shows all saved configs with search.
- **Supports.** All RQs.

#### F12. Batch queue

- **Description.** Queue N replicate runs of the same configuration (with auto-incremented seeds) and execute them in parallel using Web Workers. A progress panel shows per-run status; completed runs land in the persistence layer.
- **Acceptance.** The runner uses at most `navigator.hardwareConcurrency - 1` workers by default; partial failure in one worker does not stop the others; the researcher can cancel the batch.
- **Supports.** RQ1 — statistical significance demands replicate runs.

#### F13. Parameter sweep

- **Description.** Select one or more parameters (e.g. mono:bi ratio, interaction probability, Δ⁺) and a grid of values; the system generates the cartesian product of configs and runs them through the batch queue. Results are aggregated into per-cell summaries with means and confidence intervals.
- **Acceptance.** A 5×5 sweep with 10 replicates per cell (250 runs) can be defined in the UI in under a minute; the aggregated view shows a heatmap of the chosen outcome metric across the grid; raw per-run metrics remain accessible.
- **Supports.** RQ1 — this is the primary mechanism for identifying critical thresholds. RQ2 — a sweep over "topology" as a categorical parameter cleanly answers the lattice question.

#### F14. Run comparison

- **Description.** Pick any two (or N) completed runs and diff their time-series metrics side-by-side on shared axes. Ideal for before/after comparisons of a single parameter change or topology swap.
- **Acceptance.** Up to 4 runs can be compared simultaneously; the comparison view downloads as a single CSV of aligned metrics.
- **Supports.** RQ2 specifically (lattice vs well-mixed comparison), and any cross-run analysis.

### 4.4 Persistence and export

#### F15. Recorded runs

- **Description.** Every completed run is persisted to browser-local storage (IndexedDB) with its config, seed, tick-by-tick metrics, and a summary snapshot. A runs browser lists them with filter/sort, and each run can be re-opened to any of the live views.
- **Acceptance.** Runs survive page reload; the browser can store at least 1000 runs of ~10k ticks each before hitting quota warnings; an explicit "clear all runs" action is available.
- **Supports.** RQ1–RQ5 — reproducibility and longitudinal analysis.

#### F16. Export

- **Description.** Two export formats are always available: (a) **CSV** of per-tick metrics for statistical analysis in R/Python, (b) **JSON** of full agent state at selected snapshots for offline replay or independent verification.
- **Acceptance.** Exports work for single runs and for sweep aggregates; the CSV is long-format (one row per tick per metric) for easy ingestion into tidyverse/pandas; file names include the config hash and seed for traceability.
- **Supports.** RQ1–RQ5 — enables the research team to do work outside the browser.

#### F17. Hypothesis presets

- **Description.** One-click configurations that reproduce the two "possible outcomes" from the source PDF: (a) Outcome 1 — segregation/ghettoization, (b) Outcome 2 — assimilation. A third preset reproduces the mean-field control.
- **Acceptance.** Each preset is tagged with a short description and a citation to the PDF slide; clicking it populates the config form and is then editable; the preset config JSON is part of the shipped application.
- **Supports.** RQ1, RQ2 — lets new collaborators see the research hypothesis in action within seconds of opening the app.

---

## 5. User Stories

Written from the perspective of **Meissa and Mike, the researchers**, and of a hypothetical **collaborator** joining the project later.

### 5.1 Researcher stories

- **US-1.** _As a researcher, I want to instantiate both worlds with the 3:2 monolingual:bilingual ratio described in our presentation so I can replicate the canonical setup in one click._ (F1, F17)
- **US-2.** _As a researcher, I want to watch the World-2 lattice evolve in real time so I can build visual intuition about cluster formation and coarsening dynamics._ (F7, F10)
- **US-3.** _As a researcher, I want to run the same population config in lattice mode and in well-mixed mode and compare the outcomes on shared axes, so I can empirically justify the geographical-constraint assumption to reviewers._ (F4, F14)
- **US-4.** _As a researcher, I want to sweep the monolingual:bilingual ratio from 1:4 to 4:1 in 10% steps with 20 replicates each, so I can identify the threshold at which ghettoization becomes the dominant outcome._ (F13, F15)
- **US-5.** _As a researcher, I want to export tick-by-tick metrics as a long-format CSV so I can do statistical analysis in R using tidyverse._ (F16)
- **US-6.** _As a researcher, I want every run to be reproducible from its seed and config, so I can share exact experimental conditions with collaborators._ (F10, F11, F15)
- **US-7.** _As a researcher, I want to save a run today and revisit it tomorrow, so I can iterate on hypotheses without losing prior work._ (F15)
- **US-8.** _As a researcher, I want to pause mid-simulation and inspect any agent's full inventory and recent interaction history, so I can understand why a specific cluster formed._ (F7, F8)
- **US-9.** _As a researcher, I want the preferential-attachment rule to be toggle-able, so I can run ablation experiments showing its causal role in cluster formation._ (F6, F13)
- **US-10.** _As a researcher, I want to parameterize the language-selection policy, so I can explore what happens if bilinguals in World 2 use L1 more often than L2 (and vice versa)._ (F5)

### 5.2 Collaborator stories

- **US-11.** _As a new collaborator, I want the spec and the code to be traceable back to the Naming Game literature, so I can verify the model's fidelity before contributing._ (§3, §12)
- **US-12.** _As a collaborator, I want to open a shared JSON config and reproduce a colleague's exact run in my browser, so I can debug disagreements without round-tripping data over email._ (F11, F15, F16)
- **US-13.** _As a collaborator reviewing a paper draft, I want the "Outcome 1" and "Outcome 2" presets to be one click away, so I can verify the figures match the text._ (F17)

---

## 6. Research Goals → Software Support Matrix

This is the traceability table. Every research question is supported by at least one concrete feature and one measurable observable.

| Research question                                               | Primary features           | Primary observables                                                              |
| --------------------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------- |
| **RQ1** — Assimilation vs. segregation thresholds in World 2    | F1, F5, F11, F13, F14, F15 | Assimilation index, segregation index, largest-cluster size                      |
| **RQ2** — Role of spatial topology (lattice vs well-mixed)      | F4, F7, F14, F17           | Cluster count, mean cluster size, time-to-consensus                              |
| **RQ3** — Token-weight dynamics                                 | F2, F3, F9, F16            | Mean token weight, weight variance, number of distinct active tokens Nw          |
| **RQ4** — Emergent social cohesion via successful communication | F3, F6, F8, F9             | Communication success rate, interaction-graph modularity, clustering coefficient |
| **RQ5** — Quantifying linguistic pressure                       | F5, F10, F13               | Per-language success rate, assimilation index, language-switch frequency         |

Every feature maps to at least one RQ; every RQ maps to at least three features. There are no orphan features and no orphan research goals.

---

## 7. Metrics and Observables

The simulation records the following metrics **every tick** (or at configurable sampling intervals for long runs). All are deterministic functions of the current agent population and interaction history given the seed.

### 7.1 Per-tick scalar metrics

| Metric                                    | Definition                                                                                                                                            | Supports |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| **Communication success rate**            | `successful_interactions / total_interactions` in the tick; broken down per world and per `(speaker.class, hearer.class)` pair.                       | RQ1, RQ4 |
| **Mean token weight**                     | Mean of all non-zero token weights, broken down per world and per language.                                                                           | RQ3      |
| **Token weight variance**                 | Variance across non-zero token weights, per world, per language. High variance indicates a split vocabulary.                                          | RQ3      |
| **Number of distinct active tokens (Nw)** | Count of tokens with any weight > 0, per world. Canonical Naming Game observable.                                                                     | RQ3      |
| **Matching rate**                         | Fraction of agent pairs whose top-weighted token for a given referent agrees, averaged over referents.                                                | RQ1, RQ4 |
| **Largest-cluster size**                  | Size of the largest connected component in the "token agreement graph" (edges where two agents share a top-weighted token).                           | RQ1, RQ2 |
| **Cluster count**                         | Number of connected components in the token-agreement graph with size ≥ 2.                                                                            | RQ1, RQ2 |
| **Interaction-graph modularity**          | Louvain modularity score on the cumulative successful-interaction graph. High modularity = strong clustering.                                         | RQ2, RQ4 |
| **Assimilation index**                    | Among successful interactions between W2-Immigrants and W2-Natives, the share that occurred in L2. Rises under assimilation, falls under segregation. | RQ1, RQ5 |
| **Segregation index**                     | Louvain modularity of the subgraph restricted to W2-Immigrants. Rises when immigrants interact mostly among themselves.                               | RQ1, RQ5 |
| **Time-to-consensus**                     | Tick at which Nw first stabilizes at its asymptote for ≥ 100 ticks; undefined if not reached.                                                         | RQ2      |

### 7.2 Per-tick tensor snapshots (optional, sampled)

At sampling intervals (default every 10 ticks), the simulation records:

- Full agent inventories (weights per (language, referent, token)), for offline replay and deep analysis.
- Interaction graph adjacency (cumulative).

### 7.3 Summary metrics (end of run)

- Mean/median/max of each per-tick metric.
- Convergence status: converged / metastable / diverged / unresolved.
- Classification: assimilation / segregation / mixed / inconclusive (computed from the final assimilation and segregation indices with user-configurable thresholds).

---

## 8. Architecture Sketch

High-level only; no code. The implementation team chooses specific libraries from §9.

```
┌──────────────────────────────────────────────────────────────┐
│  Next.js App Router page (server-rendered shell)             │
│  ─ routing, layouts, config UI (can be Server Component)     │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Client Component: SimulationShell                     │  │
│  │  ─ owns the live views, hosts the worker               │  │
│  │                                                        │  │
│  │  ┌──────────────┐   postMessage   ┌────────────────┐   │  │
│  │  │ Main thread  │ ◄─────────────► │  Web Worker    │   │  │
│  │  │ (UI, render) │   metrics/tick  │  (ABM engine)  │   │  │
│  │  └──────────────┘                 └────────────────┘   │  │
│  │         │                                              │  │
│  │         ├─► Lattice canvas (per world)                 │  │
│  │         ├─► Network WebGL view                         │  │
│  │         └─► Time-series charts                         │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Persistence (IndexedDB)                               │  │
│  │  ─ configs, runs, metrics, snapshots                   │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Batch orchestrator (spawns multiple workers for       │  │
│  │  parameter sweeps; aggregates results)                 │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### Key architectural commitments

- **Simulation runs in Web Workers**, never on the main thread. The UI must remain responsive even during a 10⁴-agent sweep. Long-running React computations without workers are a known anti-pattern ([LogRocket on Web Workers in React/TS](https://blog.logrocket.com/web-workers-react-typescript/); [Smashing Magazine on long tasks in React](https://www.smashingmagazine.com/2020/10/tasks-react-app-web-workers/)).
- **The worker-to-UI bridge is a typed interface**, not ad-hoc postMessage. Comlink is the canonical minimal solution ([Park on Next.js 15 + Comlink](https://park.is/blog_posts/20250417_nextjs_comlink_examples/)).
- **Simulation code is pure and deterministic** given seed + config. No `Math.random()`; the engine takes a seedable RNG. No wall-clock-dependent logic.
- **Rendering is decoupled from simulation**: the worker emits metrics and snapshots at the sampling interval; the main thread chooses when to redraw. A slow renderer cannot stall the simulation.
- **Config and metric schemas are defined once** (e.g. with Zod or Valibot) and reused by the UI, the worker, the persistence layer, and the export formatters.
- **Next.js 16 has breaking changes from prior versions** and the project's `AGENTS.md` explicitly directs contributors to read `node_modules/next/dist/docs/` before writing code. The implementation team **must** consult the local Next docs for the current App Router conventions, client-boundary rules, and bundling behavior before wiring the worker into a Client Component.

---

## 9. Capability Requirements and Candidate Libraries

This section describes what the implementation needs to be able to do and offers **recommended libraries** as a starting point. The implementation team is free to substitute equivalents — the contract is the capability, not the brand name.

| Capability                                                                                          | Leading candidate                                                                                                                                                                                       | Also viable                                                                                                                                         | Notes                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ABM core** (agents, environments, tick scheduling, recorders)                                     | [Flocc](https://github.com/scottpdo/flocc) — TypeScript-first, zero dependencies, ~150 KB, active (v0.7.0 March 2026). Ships environments, renderers, recorders, scheduling, and experiment primitives. | [AgentScript](http://agentscript.org/) (NetLogo-flavored, JS-first not TS-first); writing from scratch                                              | Flocc's `Environment` model plus its Canvas renderer and histogram/heatmap views cover a large fraction of F1–F9 out of the box. See also [FlowingData's 2022 write-up](https://flowingdata.com/2022/04/20/agent-based-modeling-in-javascript) and the [CoMSES Net framework catalog](https://www.comses.net/resources/modeling-frameworks/). |
| **Graph model + community detection** (for the interaction network, modularity, Louvain clustering) | [graphology](https://graphology.github.io/) — a multi-purpose graph library with metrics, layout, and Louvain community detection in its plugin ecosystem.                                              | [cytoscape.js](https://js.cytoscape.org/)                                                                                                           | Louvain directly measures the "cluster/ghetto" formation that is at the heart of the research question.                                                                                                                                                                                                                                       |
| **Network rendering** (WebGL, thousands of nodes)                                                   | [sigma.js](https://www.sigmajs.org/) — pairs natively with graphology, WebGL-accelerated.                                                                                                               | cytoscape.js, vis-network. See [Cylynx's comparison](https://www.cylynx.io/blog/a-comparison-of-javascript-graph-network-visualisation-libraries/). | Handles the growing interaction graph smoothly.                                                                                                                                                                                                                                                                                               |
| **Lattice / heatmap rendering**                                                                     | Flocc's `CanvasRenderer` / `Heatmap`, or raw HTML5 Canvas 2D                                                                                                                                            | [PixiJS](https://pixijs.com/) if performance demands a scene graph                                                                                  | For N ≤ 500 per world, plain Canvas 2D is sufficient.                                                                                                                                                                                                                                                                                         |
| **Time-series charts** (metrics dashboard, comparison views)                                        | [Recharts](https://recharts.org/) — React-declarative, TypeScript-friendly                                                                                                                              | [Plotly.js](https://plotly.com/javascript/) for more statistical features; [Visx](https://airbnb.io/visx/) for full control                         | Recharts is the path of least friction for success-rate curves and Nw plots.                                                                                                                                                                                                                                                                  |
| **Worker bridge**                                                                                   | [Comlink](https://github.com/GoogleChromeLabs/comlink) — removes postMessage boilerplate; works with Next.js ([example](https://park.is/blog_posts/20250417_nextjs_comlink_examples/))                  | Raw postMessage; SharedArrayBuffer for zero-copy (advanced)                                                                                         | Comlink gives you a typed, promise-based bridge in a few lines.                                                                                                                                                                                                                                                                               |
| **Config schema + validation**                                                                      | [Zod](https://zod.dev/)                                                                                                                                                                                 | [Valibot](https://valibot.dev/), [ArkType](https://arktype.io/)                                                                                     | De-facto TS standard; schemas can be reused across UI, worker, and export formatters.                                                                                                                                                                                                                                                         |
| **Local persistence** (IndexedDB)                                                                   | [Dexie](https://dexie.org/) — a thin, typed, battle-tested wrapper around IndexedDB.                                                                                                                    | localforage, raw IndexedDB                                                                                                                          | Ergonomic API; good enough for thousands of runs per user.                                                                                                                                                                                                                                                                                    |
| **Seedable RNG**                                                                                    | [seedrandom](https://github.com/davidbau/seedrandom) or [pure-rand](https://github.com/dubzzz/pure-rand)                                                                                                | A hand-written Mulberry32 is fine too                                                                                                               | Required for reproducibility (US-6).                                                                                                                                                                                                                                                                                                          |
| **Result export**                                                                                   | Plain CSV/JSON via `Blob` + `URL.createObjectURL` — no dependency.                                                                                                                                      | [Papa Parse](https://www.papaparse.com/) if CSV parsing is ever needed                                                                              | Long-format CSV is ingested natively by R's `tidyverse` and Python's `pandas`.                                                                                                                                                                                                                                                                |

### Frameworks that were evaluated and not chosen as the default

- **AgentScript** ([site](http://agentscript.org/), [docs](https://code.agentscript.org/)) — NetLogo-flavored browser ABM. Mature and elegant, but JS-first rather than TypeScript-first and has less explicit separation between grid and network environments in its current API. Remains viable if the team prefers NetLogo semantics.
- **Agentbase** — a minimalist earlier-generation ABM platform; less actively maintained.
- **js-simulator** — discrete-event focused; overkill for a synchronous tick-based model.
- **Writing the ABM from scratch** — perfectly viable for the minimal Naming Game; cost is the renderers, recorders, and scheduling that Flocc gives for free.

---

## 10. Out of Scope

These are explicit non-goals for v1. They are listed so that scope creep is deliberate rather than accidental.

- **Multi-user / server-side orchestration.** The app runs entirely in the researcher's browser. There is no shared backend, no user accounts, no collaboration over the network.
- **Real geography / GIS.** "World" stays an abstract 2D lattice. No maps, no coordinates, no projections.
- **Learning beyond the Naming Game weight update.** No neural networks, no LLM tokenizers, no reinforcement learning beyond the classic reinforcement rule on token weights.
- **More than 2 languages in v1.** The architecture is designed to generalize — tokens are keyed by `(language, lexeme)` — but v1 ships with L1 and L2 only.
- **Audio, speech, or physical color rendering.** Color terms are opaque symbols; the simulation does not care whether `red` is actually rendered red. (The UI may choose to do so for intuition.)
- **Dynamic migration as a process.** Immigrants are already-arrived in v1. Modeling the act of crossing from World 1 to World 2 tick-by-tick is deferred.
- **Automatic paper figure generation.** The app exports CSV/JSON; researchers make figures in R/Python/plotting tools of their choice.

---

## 11. Open Questions and Future Work

The following questions were raised during spec writing. Recommendations are given, but the research team should confirm before implementation and can revisit as evidence accumulates.

1. **Do agents move on the lattice, or stay fixed?**
   The PDF does not specify. **Recommendation:** fixed in v1. Rationale: immobile agents give the cleanest test of coarsening dynamics and match Baronchelli et al.'s 2D-lattice methodology. If mobility is later added, it should be a per-agent parameter so the team can run immobile/mobile ablations.
2. **What is the right agent count?**
   Baronchelli's papers use N up to 10⁴ for lattice Naming Games. **Recommendation:** default to N = 50–500 per world for interactive playground mode (where responsiveness matters) and allow headless sweeps up to N = 10⁴ in workers.
3. **Should the immigration process itself be modeled?**
   **Recommendation:** no in v1. Immigrants start already placed in World 2 and the simulation studies post-arrival dynamics. A future extension could model staged arrival over time.
4. **Should noise / mishearing be included?**
   Lipowski & Lipowska (2015, [Scientific Reports](https://www.nature.com/articles/srep12191)) show that learning errors change Naming Game convergence qualitatively. **Recommendation:** no by default in v1, but expose a hook in F3 so it can be added as an ablation parameter later without refactoring.
5. **Should the weight update be additive, multiplicative, or normalized?**
   The minimal Naming Game is additive; Dall'Asta et al. (2008) explore alternatives. **Recommendation:** additive as the default, with optional L1-normalization per (agent, referent) as a configurable alternative. Both are exposed in F3.
6. **How should referent perception be modeled?**
   The PDF treats referents as discrete ("yellow", "red") without modeling the underlying perceptual categorization. The literature on color-term emergence (Kay, Regier, Steels et al.) models perceptual categories continuously. **Recommendation:** start discrete in v1. A continuous-referent extension is a natural v2 feature that would dovetail with the color-terms theme.
7. **How should preferential attachment be implemented?**
   F6 specifies the rule but not the functional form. **Recommendation:** use a softmax over cosine similarity between top-weighted token vectors, with a temperature parameter exposed in the UI. This is differentiable, monotonic, and well-understood.

---

## 12. References

All references below are citable online sources that informed the design. Local source materials are listed last.

### 12.1 Naming Game theory

- Baronchelli, A., Dall'Asta, L., Barrat, A., & Loreto, V. (2006). **Topology-induced coarsening in language games.** _Physical Review E_ 73, 015102(R). <https://pubmed.ncbi.nlm.nih.gov/16486202/> — The primary citation for "the lattice matters" — establishes coarsening dynamics on 2D lattices.
- Baronchelli, A. (2016). **A gentle introduction to the minimal Naming Game.** _Belgian Journal of Linguistics_ 30, 171–192. <https://arxiv.org/abs/1701.07419> — Accessible overview and the source for the "minimal Naming Game" rules this spec follows.
- Dall'Asta, L., Baronchelli, A., Barrat, A., & Loreto, V. (2008). **In-depth analysis of the Naming Game dynamics: the homogeneous mixing case.** _International Journal of Modern Physics C_ 19, 785. <https://arxiv.org/abs/0803.0398> — Mean-field baseline used as the well-mixed control.
- Lu, Q., Korniss, G., & Szymanski, B. K. (2008). **Naming Games in Two-Dimensional and Small-World-Connected Random Geometric Networks.** _Physical Review E_ 77, 016111. <https://pubmed.ncbi.nlm.nih.gov/18351919/> — Spatial networks and cluster-size scaling; directly relevant to F4 and F8.
- Baronchelli, A., Loreto, V., & Steels, L. (2010). **In-depth analysis of the naming game dynamics in social networks.** <https://arxiv.org/abs/1008.1096> — Community formation and consensus engineering; motivates F6 (preferential attachment).
- Lipowski, A., & Lipowska, D. (2015). **Analysis of the naming game with learning errors in communications.** _Scientific Reports_ 5, 12191. <https://www.nature.com/articles/srep12191> — Source for the optional noise/mishearing extension in §11.

### 12.2 ABM frameworks and libraries

- Flocc (Scott Donaldson): <https://github.com/scottpdo/flocc>
- AgentScript: <http://agentscript.org/> and <https://code.agentscript.org/>
- CoMSES Net Computational Model Library: <https://www.comses.net/resources/modeling-frameworks/>
- Donaldson, S. (2022). **Agent-based modeling in JavaScript.** _FlowingData._ <https://flowingdata.com/2022/04/20/agent-based-modeling-in-javascript> — Accessible introduction to Flocc's philosophy.

### 12.3 Graph analysis and visualization

- graphology: <https://graphology.github.io/> — graph model, metrics, Louvain community detection.
- sigma.js: <https://www.sigmajs.org/> and <https://github.com/jacomyal/sigma.js/> — WebGL network rendering.
- Cylynx (2023). **A comparison of JavaScript graph/network visualization libraries.** <https://www.cylynx.io/blog/a-comparison-of-javascript-graph-network-visualisation-libraries/>
- Recharts: <https://recharts.org/> — declarative React charts.

### 12.4 Runtime patterns (Web Workers in Next.js / React / TypeScript)

- Park, Y. J. (2025). **Web Workers in Next.js 15 with Comlink.** <https://park.is/blog_posts/20250417_nextjs_comlink_examples/>
- LogRocket. **Web workers, React, and TypeScript.** <https://blog.logrocket.com/web-workers-react-typescript/>
- Smashing Magazine (2020). **Managing Long-Running Tasks In A React App With Web Workers.** <https://www.smashingmagazine.com/2020/10/tasks-react-app-web-workers/>
- Comlink (Google Chrome Labs): <https://github.com/GoogleChromeLabs/comlink>
- Next.js 16 documentation (local to this repository): `node_modules/next/dist/docs/` — the authoritative source for Next 16 App Router and Client Component conventions. Per `AGENTS.md`, implementation contributors must read the relevant local doc before writing Next-specific code.

### 12.5 Local source materials

- `docs/How color terms communication success is emerged through language modulated by geographical.pdf` — Meissa and Mike's original presentation.
- `docs/pdftext.md` — textual transcription of the presentation.
- `docs/interpretation.md` — Gemini's interpretive framing of the research goals (sociolinguistic assimilation vs. segregation lens). Used as a sanity check, not as a primary source.

---

_End of specification, v1 draft._
