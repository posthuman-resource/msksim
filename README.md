# msksim

A browser-based simulation tool for studying how shared language emerges (or fails to emerge) when immigrant populations interact with native speakers in a geographically structured environment.

## What this is

msksim is a research instrument built around an **agent-based Naming Game** model. It simulates a population of agents — some monolingual, some bilingual — placed in two "worlds" on a spatial lattice. Agents interact by trying to communicate using color-term vocabularies. When communication succeeds, the word they agreed on gets reinforced; when it fails, both agents walk away and seek other partners.

Over many rounds of interaction, large-scale social patterns emerge from these simple rules. Depending on population ratios, spatial structure, and interaction parameters, bilingual immigrants in the host world may **assimilate** (converge on the host language and integrate into a single social network) or **segregate** (retreat to their native language and form isolated clusters). The simulation lets you observe and measure this process in real time.

The core research question comes from Meissa and Mike's work on linguistic pressure and geographical location:

> **How does the communication success of color terms emerge through linguistic pressure modulated by geographical location?**

More specifically, the tool helps investigate:

- Under what population ratios and interaction probabilities do immigrants assimilate vs. segregate?
- Does spatial structure (a 2D lattice) produce different outcomes than a well-mixed population?
- How do vocabulary weights evolve over time — convergence, splitting, or metastable regimes?
- Does successful communication predict and drive social bonding (measured by network clustering)?

## What you can do with it

- **Run interactive simulations** with play/pause/step controls and adjustable speed
- **Visualize agent populations** on a lattice grid, colored by language class, dominant vocabulary, or communication success
- **Watch metrics evolve in real time** — communication success rate, token weight distributions, cluster formation, modularity
- **See the social network emerge** as agents interact, with community detection highlighting natural groupings
- **Configure experiments** by adjusting population ratios, grid size, interaction probabilities, reinforcement strengths, language policies, and preferential attachment
- **Run parameter sweeps** to systematically explore how outcomes change across combinations of settings
- **Compare runs side-by-side** to contrast outcomes under different conditions
- **Export data** as CSV (long-format, ready for R/tidyverse or Python/pandas) or JSON snapshots for further analysis
- **Use hypothesis presets** that reproduce the key scenarios from the source research (segregation, assimilation, and mean-field control)

Every simulation is **deterministic** — given the same configuration and random seed, you get identical results. This makes runs reproducible and shareable.

### Recent additions (post-v1)

- **Gaussian success policy** (configurable in the experiment editor): replace the binary "hearer-knows-the-token" success rule with a smooth probability `Ps = exp(-‖xi - xj‖² / (2σ²))`. Lets you study how vocabulary tolerance affects consensus dynamics. See the in-app guide for the full kernel and a suggested σ-sweep.
- **Linguistic migration** (configurable; lattice topology only): after each successful interaction, agents step toward (high vocabulary similarity) or away from (low similarity) their partner — a Schelling-style segregation dynamic specific to language. The new "Spatial Homophily" chart in the playground tracks the result.

Both features are off by default. Existing experiment configs continue to behave identically to v1.

## Getting it running

### Prerequisites

You need **Node.js version 20.9 or later**. Check your version:

```
node --version
```

If you need to install or update Node.js, visit [nodejs.org](https://nodejs.org/) and download the LTS release (the one marked "Recommended for Most Users"). On macOS, you can also use Homebrew (`brew install node`). On Windows, the installer from the website is simplest.

### Setup

1. **Open a terminal** and navigate to where you downloaded or cloned this repository:

   ```
   cd path/to/msksim
   ```

2. **Install dependencies** (this downloads all the libraries the project needs — it may take a minute):

   ```
   npm install
   ```

3. **Create your environment file.** Copy the example and edit it:

   ```
   cp .env.example .env
   ```

   Open `.env` in any text editor. You need to replace the placeholder value for `MSKSIM_SESSION_SECRET` with a random string at least 32 characters long. If you have `openssl` available (macOS and Linux do by default), you can generate one:

   ```
   openssl rand -base64 48
   ```

   Paste the output as the value of `MSKSIM_SESSION_SECRET`. The `MSKSIM_DB_PATH` default is fine as-is.

4. **Set up the database** (creates the local SQLite file and tables):

   ```
   npm run db:migrate
   ```

5. **Create your user account** (the app requires login):

   ```
   npm run users -- add yourname yourpassword
   ```

6. **Build and start the application:**

   ```
   npm run build
   npm start
   ```

   Then open your browser to **http://localhost:3000**. Log in with the username and password from step 5.

   Alternatively, for development with live reloading:

   ```
   npm run dev
   ```

### If something goes wrong

- **"Node version too old"** — Install Node.js 20.9+ as described above.
- **Native module errors mentioning `better-sqlite3` or `argon2`** — Run `npm rebuild` and try again.
- **"MSKSIM_SESSION_SECRET must be at least 32 characters"** — Edit your `.env` file and set a longer secret value.
- **Blank page or login loop** — Make sure you ran `npm run db:migrate` and created a user with `npm run users -- add`.

## Project documentation

- [`docs/spec.md`](docs/spec.md) — Full specification: research questions, conceptual model, features, metrics, and architecture
- [`docs/plan.md`](docs/plan.md) — Step-by-step build plan with links to each implementation step
- [`docs/interpretation.md`](docs/interpretation.md) — Interpretive framing of the research goals and methods
- [`docs/How color terms communication success is emerged through language modulated by geographical.pdf`](docs/How%20color%20terms%20communication%20success%20is%20emerged%20through%20language%20modulated%20by%20geographical.pdf) — The original research presentation
