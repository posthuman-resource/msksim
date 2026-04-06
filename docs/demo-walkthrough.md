# msksim Demo Walkthrough

**Audience:** Meissa  
**Duration:** ~10 minutes  
**What it is:** An agent-based simulation of the Naming Game — studying how color-term vocabularies emerge and spread when monolingual and bilingual populations interact on a spatial grid. The key question: under what conditions do immigrant populations assimilate linguistically vs. remain segregated?

---

## Setup (do this before the demo)

```bash
# 1. Make sure dependencies are installed
npm install

# 2. Run migrations (safe to re-run)
npm run db:migrate

# 3. Create a demo user (skip if one exists)
npm run users -- add demo demo123

# 4. Build and start
npm run build && npm start
# Or for dev mode: npm run dev

# App runs at http://localhost:3000
```

---

## Part 1: Login (~30 seconds)

1. Open **http://localhost:3000** in the browser
2. You'll see the login page — enter `demo` / `demo123`
3. You land on the **Playground** — the live simulation workspace

**What to say:** "This is msksim — a research tool for simulating how populations develop shared vocabulary through pairwise interactions. Let me show you what a simulation looks like."

---

## Part 2: Live Playground (~4 minutes)

This is the centerpiece. You're looking at two side-by-side worlds on a lattice grid.

### Start the simulation

1. Click **Play** (the triangle button in the controls panel)
2. The lattice starts animating — each cell is an agent, colored by its class

**What to say:** "Each cell is an agent. World 1 is a monolingual/bilingual mix. World 2 has native speakers and immigrants. Every tick, agents try to communicate — if they use the same word for a color concept, the interaction succeeds and that word gets reinforced."

### Show the three lattice projections

3. Click the **Class** toggle (should be default) — agents colored by role (mono, bilingual, native, immigrant)
4. Click **Dominant Token** — now each cell shows which color-term is winning in that agent's vocabulary. Watch clusters of the same color grow.
5. Click **Matching Rate** — heat map showing local agreement. Green = neighbors agree, red = friction zones.

**What to say:** "We can project the lattice three ways. Class shows who is who. Dominant Token shows vocabulary convergence — watch how one term starts dominating a region. Matching Rate shows where communication is working and where it's breaking down."

### Show the metrics

6. Click the **Metrics** tab
7. Point out **Communication Success Rate** climbing over time
8. Point out **Distinct Active Tokens** dropping — fewer words survive as agents converge
9. Point out **Assimilation Index** (World 2) — tracks whether immigrants are adopting native vocabulary

**What to say:** "These seven metrics track the simulation in real time. Success rate going up means agents are understanding each other. Token count dropping means the vocabulary is simplifying — competing words die out. The assimilation index tells us specifically whether immigrants are integrating."

### Tweak a parameter live

10. While still playing, drag the **delta-plus slider** (weight increment) higher — success rate should climb faster
11. Or drag **interaction probability** down — everything slows

**What to say:** "We can adjust parameters mid-run. If I increase the reward for successful communication, convergence speeds up. These sliders let us explore the parameter space interactively."

### Show the network graph

12. Click the **Network** tab
13. You'll see a force-directed graph of successful interactions building up — nodes are agents, edges are repeated successful communications, colors are detected communities

**What to say:** "The network view shows who's actually talking to whom successfully. The clustering algorithm detects communities — you can see whether the immigrant population forms its own cluster or integrates into the native community."

### Pause and inspect

14. Click **Pause**
15. Go back to **Lattice** tab, hover over a cell — tooltip shows that agent's full vocabulary with weights

**What to say:** "We can drill down to any individual agent and see their complete vocabulary — which words they know for each color concept and how strongly they believe in each one."

---

## Part 3: Experiment Configs (~2 minutes)

16. Click **Experiments** in the nav bar
17. Click **New config**
18. Walk through the form sections — show that you can configure:
    - **Topology**: lattice size, neighborhood type (Moore vs Von Neumann)
    - **Population**: how many monolinguals, bilinguals, natives, immigrants
    - **Interaction rules**: reward/penalty, retry limits, update rules
    - **Preferential attachment**: whether agents prefer to talk to similar partners
    - **Convergence detection**: when to declare the simulation "done"
19. Give it a name like "Demo config" and click **Save**

**What to say:** "Every parameter of the simulation is configurable. We can set up different scenarios — a larger grid, different population ratios, different learning rules — and save them as named configurations. This is how we set up reproducible experiments."

---

## Part 4: Batch Runs (~2 minutes)

20. Back on the **Experiments** page, click the green **Batch run** button
21. Select the config you just created from the dropdown
22. Set **Replicates** to 5 (five seeds, for statistical power)
23. Set **Concurrency** to 3 or 4 (uses Web Workers — runs in parallel)
24. Click **Start batch**
25. Watch the progress grid — each replicate shows its own progress bar, status badge, and current tick
26. Wait for them to complete (or cancel partway to show cancellation)

**What to say:** "For real analysis we need multiple runs with different random seeds. The batch runner spins up parallel Web Workers and sweeps across seeds automatically. Each run is persisted to the database when it finishes. If one fails, the others keep going."

---

## Part 5: Results (~1 minute)

27. Click **Runs** in the nav bar
28. You should see the completed batch runs listed with their classification badges (assimilated / segregated / mixed / inconclusive)
29. Click into one run — show the frozen metrics charts and the classification summary
30. Point out the **Reopen in playground** button — you can replay any saved run

**What to say:** "Every completed run is classified automatically based on the final metrics. We can compare outcomes across seeds and configurations. And any run can be reopened in the playground to inspect it interactively."

---

## Closing

**What to say:** "So that's the tool — interactive exploration in the playground, reproducible experiment configs, parallel batch execution, and persistent results with automatic classification. The next steps are [whatever is next in the plan — comparative analysis, export, etc.]."

---

## Troubleshooting

| Problem              | Fix                                                   |
| -------------------- | ----------------------------------------------------- |
| Login fails          | `npm run users -- add demo demo123`                   |
| DB errors            | `npm run db:migrate`                                  |
| Port in use          | `npm start -- -p 3001`                                |
| Blank lattice        | Refresh the page, click Reset, then Play              |
| Charts not rendering | Make sure the simulation has run at least a few ticks |
